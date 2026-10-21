/* eslint-disable @typescript-eslint/no-explicit-any -- DB モックの型は意図的に緩く定義している */
jest.mock('server-only', () => ({}));
jest.mock('@/lib/authUtils', () => ({ getAuthenticatedUserIdWithVerification: jest.fn() }));
jest.mock('@/lib/supabaseAdmin', () => ({ getSupabaseAdmin: jest.fn() }));

import { POST } from './route';
import { getAuthenticatedUserIdWithVerification } from '@/lib/authUtils';
import { getSupabaseAdmin } from '@/lib/supabaseAdmin';

const USER = '99999999-9999-4999-8999-999999999999';
const MEMBER_COMPANY = '11111111-1111-4111-8111-111111111111';
const OTHER_COMPANY = '22222222-2222-4222-8222-222222222222';

function mockMembership(rows: Array<{ company_id: string; user_id: string }>) {
  const filters: Record<string, unknown> = {};
  const builder: any = {
    select: () => builder,
    eq: (col: string, val: unknown) => {
      filters[col] = val;
      return builder;
    },
    maybeSingle: async () => {
      const hit = rows.find((r) => r.company_id === filters.company_id && r.user_id === filters.user_id);
      return { data: hit ? { company_id: hit.company_id } : null, error: null };
    },
  };
  (getSupabaseAdmin as jest.Mock).mockReturnValue({ from: () => builder });
}

function req(body: unknown) {
  return new Request('http://localhost/api/_session/set-cookie', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

describe('POST /api/_session/set-cookie', () => {
  beforeEach(() => {
    (getSupabaseAdmin as jest.Mock).mockClear();
    (getAuthenticatedUserIdWithVerification as jest.Mock).mockResolvedValue(USER);
    mockMembership([{ company_id: MEMBER_COMPANY, user_id: USER }]);
  });

  it('認証なしは 401', async () => {
    (getAuthenticatedUserIdWithVerification as jest.Mock).mockResolvedValue(null);
    const res = await POST(req({ name: 'company_id', value: MEMBER_COMPANY }));
    expect(res.status).toBe(401);
  });

  it('所属していない会社IDは 403 で、Cookie を設定しない', async () => {
    const res = await POST(req({ name: 'company_id', value: OTHER_COMPANY }));
    expect(res.status).toBe(403);
    expect(res.headers.get('set-cookie')).toBeNull();
  });

  it('所属している会社IDは Cookie を設定する', async () => {
    const res = await POST(req({ name: 'company_id', value: MEMBER_COMPANY }));
    expect(res.status).toBe(200);
    expect(res.cookies.get('company_id')?.value).toBe(MEMBER_COMPANY);
  });

  it('UUID でない会社IDは 400', async () => {
    const res = await POST(req({ name: 'company_id', value: 'not-a-uuid' }));
    expect(res.status).toBe(400);
  });

  it('会社以外の許可された Cookie は従来どおり所属確認なしで設定する', async () => {
    const res = await POST(req({ name: 'theme', value: 'dark' }));
    expect(res.status).toBe(200);
    expect(res.cookies.get('theme')?.value).toBe('dark');
    expect(getSupabaseAdmin).not.toHaveBeenCalled();
  });

  it('許可されていない Cookie 名は 403', async () => {
    const res = await POST(req({ name: 'session_secret', value: 'x' }));
    expect(res.status).toBe(403);
  });

  it('会社IDの値が無い場合は 400 で、所属確認もしない', async () => {
    const res = await POST(req({ name: 'company_id' }));
    expect(res.status).toBe(400);
    expect(res.headers.get('set-cookie')).toBeNull();
    expect(getSupabaseAdmin).not.toHaveBeenCalled();
  });

  it('所属する A 社から B 社へ切り替えられ、未所属の C 社には切り替えられない', async () => {
    mockMembership([
      { company_id: MEMBER_COMPANY, user_id: USER },
      { company_id: OTHER_COMPANY, user_id: USER },
    ]);

    const toA = await POST(req({ name: 'company_id', value: MEMBER_COMPANY }));
    expect(toA.cookies.get('company_id')?.value).toBe(MEMBER_COMPANY);

    const toB = await POST(req({ name: 'company_id', value: OTHER_COMPANY }));
    expect(toB.status).toBe(200);
    expect(toB.cookies.get('company_id')?.value).toBe(OTHER_COMPANY);

    const toC = await POST(req({ name: 'company_id', value: '33333333-3333-4333-8333-333333333333' }));
    expect(toC.status).toBe(403);
    expect(toC.headers.get('set-cookie')).toBeNull();
  });

  it('検証に失敗しても既存の正常な所属会社の Cookie 設定は影響を受けない', async () => {
    const failed = await POST(req({ name: 'company_id', value: OTHER_COMPANY }));
    expect(failed.status).toBe(403);

    const ok = await POST(req({ name: 'company_id', value: MEMBER_COMPANY }));
    expect(ok.status).toBe(200);
    expect(ok.cookies.get('company_id')?.value).toBe(MEMBER_COMPANY);
  });
});
