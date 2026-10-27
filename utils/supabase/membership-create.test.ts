/* eslint-disable @typescript-eslint/no-explicit-any -- ブラウザ用クライアントのモックは意図的に緩く定義している */
jest.mock('./client', () => {
  const from = jest.fn(() => {
    throw new Error('browser must not access company tables directly');
  });
  return {
    supabase: {
      from,
      auth: { getSession: jest.fn(async () => ({ data: { session: { access_token: 'tok' } } })) },
    },
    isValidUUID: (v: unknown) =>
      typeof v === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v),
    setCompanyIdCookie: jest.fn(),
    getCompanyIdFromCookie: jest.fn(() => null),
  };
});

import { createCompanyAndJoin, joinCompany } from './membership';
import { supabase } from './client';

const USER = '99999999-9999-4999-8999-999999999999';
const COMPANY = '11111111-1111-4111-8111-111111111111';

const jsonResponse = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

const emptyMembership = { companyId: null, departmentId: null, role: null };

describe('createCompanyAndJoin（会社作成はサーバーの provision API に委譲する）', () => {
  let fetchMock: jest.Mock;

  beforeEach(() => {
    jest.clearAllMocks();
    fetchMock = jest.fn();
    (global as any).fetch = fetchMock;
  });

  it('calls /api/companies/provision in create mode with the session token and returns the server result', async () => {
    fetchMock.mockResolvedValue(jsonResponse(200, { ok: true, companyId: COMPANY, role: 'admin' }));

    const m = await createCompanyAndJoin({ userId: USER, companyName: '  Acme  ' });

    expect(m).toEqual({ companyId: COMPANY, departmentId: null, role: 'admin' });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('/api/companies/provision');
    expect(init.method).toBe('POST');
    expect(init.headers.authorization).toBe('Bearer tok');
    expect(init.headers['x-growth-provision-mode']).toBe('create');
    expect(JSON.parse(init.body)).toEqual({ companyName: 'Acme', departmentId: null, allowCreateCompany: true });
  });

  it('never writes to companies or company_members from the browser', async () => {
    fetchMock.mockResolvedValue(jsonResponse(200, { ok: true, companyId: COMPANY, role: 'admin' }));
    await createCompanyAndJoin({ userId: USER });
    expect((supabase as any).from).not.toHaveBeenCalled();
  });

  it('returns no membership when the server denies creation (for example signup_admin_disabled)', async () => {
    fetchMock.mockResolvedValue(jsonResponse(403, { ok: false, code: 'signup_admin_disabled' }));

    const m = await createCompanyAndJoin({ userId: USER });

    expect(m).toEqual(emptyMembership);
    expect((supabase as any).from).not.toHaveBeenCalled();
  });

  it('returns no membership when the server response has no valid company id', async () => {
    fetchMock.mockResolvedValue(jsonResponse(200, { ok: true, companyId: 'not-a-uuid' }));

    const m = await createCompanyAndJoin({ userId: USER });

    expect(m).toEqual(emptyMembership);
  });

  it('makes no request without a session', async () => {
    (supabase.auth.getSession as jest.Mock).mockResolvedValueOnce({ data: { session: null } });

    const m = await createCompanyAndJoin({ userId: USER });

    expect(fetchMock).not.toHaveBeenCalled();
    expect(m).toEqual(emptyMembership);
  });
});

describe('joinCompany（既存会社への直接参加はしない）', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (global as any).fetch = jest.fn();
  });

  it('does not write membership and does not call the network', async () => {
    const m = await joinCompany({ userId: USER, companyId: COMPANY, role: 'member' });

    expect(m).toEqual(emptyMembership);
    expect((supabase as any).from).not.toHaveBeenCalled();
    expect((global as any).fetch).not.toHaveBeenCalled();
  });
});
