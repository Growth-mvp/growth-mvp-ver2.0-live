/* eslint-disable @typescript-eslint/no-explicit-any -- 管理 API のモックは意図的に緩く定義している */
jest.mock('server-only', () => ({}));
jest.mock('@/lib/supabaseAdmin', () => ({ getSupabaseAdmin: jest.fn() }));
jest.mock('@/lib/server/rbacGuard', () => ({
  getAuthUserIdFromBearer: jest.fn(),
  pickOneMembershipServer: jest.fn(),
}));
jest.mock('@/lib/server/auditLog', () => ({
  logAuditEvent: jest.fn(async () => true),
  extractAuditMetadata: jest.fn(() => ({ ip: null, userAgent: null })),
}));

import { POST } from './route';
import { getSupabaseAdmin } from '@/lib/supabaseAdmin';
import { getAuthUserIdFromBearer } from '@/lib/server/rbacGuard';

const USER = '99999999-9999-4999-8999-999999999999';
const verified = { id: 'f1', status: 'verified' };

function membershipChain(isAdmin: boolean) {
  const result = { data: isAdmin ? [{ company_id: 'company-1' }] : [], error: null };
  const chain: any = { select: () => chain, eq: () => chain, limit: async () => result };
  return chain;
}

function setup(opts: { claims?: any; claimsError?: unknown; factors?: any[]; isAdmin?: boolean }) {
  const admin: any = {
    from: jest.fn(() => membershipChain(opts.isAdmin ?? true)),
    auth: {
      getClaims: jest.fn(async () =>
        opts.claimsError
          ? { data: null, error: opts.claimsError }
          : { data: { claims: opts.claims ?? { sub: USER, aal: 'aal1' } }, error: null }
      ),
      admin: {
        mfa: {
          listFactors: jest.fn(async () => ({ data: { factors: opts.factors ?? [] }, error: null })),
        },
      },
    },
  };
  (getSupabaseAdmin as jest.Mock).mockReturnValue(admin);
  return admin;
}

const req = (token: string) =>
  new Request('http://localhost/api/invites/create', {
    method: 'POST',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: JSON.stringify({ email: 'invitee@example.com', role: 'member' }),
  });

describe('POST /api/invites/create（MFA ガードの適用）', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (getAuthUserIdFromBearer as jest.Mock).mockResolvedValue(null);
  });

  it('MFA 登録済みで aal1 の管理者は 403（mfa_required）。招待は作らない', async () => {
    setup({ claims: { sub: USER, aal: 'aal1' }, factors: [verified] });

    const res = await POST(req('t'));

    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: 'mfa_required' });
    expect(getAuthUserIdFromBearer).not.toHaveBeenCalled();
  });

  it('MFA 登録済みで aal2 の管理者はガードを通過する', async () => {
    setup({ claims: { sub: USER, aal: 'aal2' }, factors: [verified] });

    const res = await POST(req('t'));

    expect(getAuthUserIdFromBearer).toHaveBeenCalledTimes(1);
    expect(res.status).toBe(401);
  });

    it('MFA 未登録の管理者は 403（mfa_enrollment_required）。招待は作らない', async () => {
    setup({ factors: [], isAdmin: true });

    const res = await POST(req('t'));

    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: 'mfa_enrollment_required' });
  });

it('MFA 未登録の一般メンバーはガードを通過し、従来の認証に進む', async () => {
    setup({ factors: [], isAdmin: false });

    const res = await POST(req('t'));

    expect(getAuthUserIdFromBearer).toHaveBeenCalledTimes(1);
    expect(res.status).toBe(401);
  });

  it('不正・期限切れの JWT は 401 で、従来の認証にも進まない', async () => {
    setup({ claimsError: { message: 'JWT expired' } });

    const res = await POST(req('bad'));

    expect(res.status).toBe(401);
    expect(getAuthUserIdFromBearer).not.toHaveBeenCalled();
  });
});
