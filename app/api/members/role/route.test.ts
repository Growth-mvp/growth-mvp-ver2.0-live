/* eslint-disable @typescript-eslint/no-explicit-any -- 管理 API のモックは意図的に緩く定義している */
jest.mock('server-only', () => ({}));
jest.mock('@/lib/supabaseAdmin', () => ({ getSupabaseAdmin: jest.fn() }));
jest.mock('@/lib/server/auditLog', () => ({
  logAuditEvent: jest.fn(async () => true),
  extractAuditMetadata: jest.fn(() => ({ ip: null, userAgent: null })),
}));

import { PATCH } from './route';
import { getSupabaseAdmin } from '@/lib/supabaseAdmin';

const USER = '99999999-9999-4999-8999-999999999999';
const verified = { id: 'f1', status: 'verified' };

function setup(opts: { claims?: any; claimsError?: unknown; factors?: any[] }) {
  const getUser = jest.fn(async () => ({ data: { user: null }, error: { message: 'no session' } }));
  const admin: any = {
    auth: {
      getUser,
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
  return { getUser };
}

const req = (token: string) =>
  new Request('http://localhost/api/members/role', {
    method: 'PATCH',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: JSON.stringify({ targetUserId: USER, newRole: 'member' }),
  });

describe('PATCH /api/members/role（MFA ガードの適用）', () => {
  it('MFA 登録済みで aal1 のユーザーは 403（mfa_required）。権限の変更には進まない', async () => {
    const { getUser } = setup({ claims: { sub: USER, aal: 'aal1' }, factors: [verified] });

    const res = await PATCH(req('t'));

    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: 'mfa_required' });
    expect(getUser).not.toHaveBeenCalled();
  });

  it('MFA 登録済みで aal2 のユーザーはガードを通過する', async () => {
    const { getUser } = setup({ claims: { sub: USER, aal: 'aal2' }, factors: [verified] });

    const res = await PATCH(req('t'));

    expect(getUser).toHaveBeenCalledTimes(1);
    expect(res.status).toBe(401);
  });

  it('MFA 未登録のユーザーは従来どおり、ガードを通過して従来の認証に進む', async () => {
    const { getUser } = setup({ factors: [] });

    const res = await PATCH(req('t'));

    expect(getUser).toHaveBeenCalledTimes(1);
    expect(res.status).toBe(401);
  });

  it('不正・期限切れの JWT は 401 で、従来の認証にも進まない', async () => {
    const { getUser } = setup({ claimsError: { message: 'JWT expired' } });

    const res = await PATCH(req('bad'));

    expect(res.status).toBe(401);
    expect(getUser).not.toHaveBeenCalled();
  });
});
