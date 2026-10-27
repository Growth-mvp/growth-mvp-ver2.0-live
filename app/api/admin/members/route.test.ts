/* eslint-disable @typescript-eslint/no-explicit-any -- 管理 API のモックは意図的に緩く定義している */
jest.mock('server-only', () => ({}));
jest.mock('@/lib/supabaseAdmin', () => ({ getSupabaseAdmin: jest.fn() }));
jest.mock('@/lib/server/rbacGuard', () => ({ getAuthUserIdFromBearer: jest.fn() }));

import { GET, DELETE } from './route';
import { getSupabaseAdmin } from '@/lib/supabaseAdmin';
import { getAuthUserIdFromBearer } from '@/lib/server/rbacGuard';

const USER = '99999999-9999-4999-8999-999999999999';
const verified = { id: 'f1', status: 'verified' };

function setup(opts: { claims?: any; claimsError?: unknown; factors?: any[] }) {
  const admin: any = {
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
  new Request('http://localhost/api/admin/members', { headers: { authorization: `Bearer ${token}` } });

describe('DELETE /api/admin/members（MFA ガードの適用）', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (getAuthUserIdFromBearer as jest.Mock).mockResolvedValue(null);
  });

  const delReq = (token: string) =>
    new Request('http://localhost/api/admin/members?userId=x', {
      method: 'DELETE',
      headers: { authorization: `Bearer ${token}` },
    });

  it('MFA 登録済みで aal1 の管理者は 403（mfa_required）。削除には進まない', async () => {
    setup({ claims: { sub: USER, aal: 'aal1' }, factors: [verified] });

    const res = await DELETE(delReq('t'));

    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: 'mfa_required' });
    expect(getAuthUserIdFromBearer).not.toHaveBeenCalled();
  });

  it('MFA 登録済みで aal2 の管理者はガードを通過する', async () => {
    setup({ claims: { sub: USER, aal: 'aal2' }, factors: [verified] });

    const res = await DELETE(delReq('t'));

    expect(getAuthUserIdFromBearer).toHaveBeenCalledTimes(1);
    expect(res.status).toBe(401);
  });

  it('MFA 未登録のユーザーは従来どおり通過する', async () => {
    setup({ factors: [] });

    await DELETE(delReq('t'));

    expect(getAuthUserIdFromBearer).toHaveBeenCalledTimes(1);
  });
});

describe('GET /api/admin/members（MFA ガードの適用）', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    // 従来の認証の結果（ガードを通過した後の動作）を固定する
    (getAuthUserIdFromBearer as jest.Mock).mockResolvedValue(null);
  });

  it('MFA 登録済みで aal1 のユーザーは 403（mfa_required）。従来の認証には進まない', async () => {
    setup({ claims: { sub: USER, aal: 'aal1' }, factors: [verified] });

    const res = await GET(req('t'));

    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: 'mfa_required' });
    expect(getAuthUserIdFromBearer).not.toHaveBeenCalled();
  });

  it('MFA 登録済みで aal2 のユーザーはガードを通過する', async () => {
    setup({ claims: { sub: USER, aal: 'aal2' }, factors: [verified] });

    const res = await GET(req('t'));

    expect(getAuthUserIdFromBearer).toHaveBeenCalledTimes(1);
    expect(res.status).toBe(401); // 従来の認証の結果（この試験では null を返している）
  });

  it('MFA 未登録のユーザーは従来どおり、ガードを通過して従来の認証に進む', async () => {
    setup({ claims: { sub: USER, aal: 'aal1' }, factors: [] });

    const res = await GET(req('t'));

    expect(getAuthUserIdFromBearer).toHaveBeenCalledTimes(1);
    expect(res.status).toBe(401);
  });

  it('不正・期限切れの JWT は 401 で、従来の認証に進まない', async () => {
    setup({ claimsError: { message: 'JWT expired' } });

    const res = await GET(req('bad'));

    expect(res.status).toBe(401);
    expect(getAuthUserIdFromBearer).not.toHaveBeenCalled();
  });
});
