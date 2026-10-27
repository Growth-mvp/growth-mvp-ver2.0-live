/* eslint-disable @typescript-eslint/no-explicit-any -- 管理 API のモックは意図的に緩く定義している */
jest.mock('server-only', () => ({}));

import { requireMfaSatisfied } from './mfaGuard';

const USER = '99999999-9999-4999-8999-999999999999';
const verified = { id: 'f1', status: 'verified' };
const unverified = { id: 'f2', status: 'unverified' };

function makeAdmin(opts: {
  claims?: any;
  claimsError?: unknown;
  claimsThrows?: boolean;
  factors?: any[];
  listError?: unknown;
  listThrows?: boolean;
}) {
  return {
    auth: {
      getClaims: jest.fn(async () => {
        if (opts.claimsThrows) throw new Error('boom');
        if (opts.claimsError) return { data: null, error: opts.claimsError };
        return { data: { claims: opts.claims ?? { sub: USER, aal: 'aal1' } }, error: null };
      }),
      admin: {
        mfa: {
          listFactors: jest.fn(async () => {
            if (opts.listThrows) throw new Error('boom');
            if (opts.listError) return { data: null, error: opts.listError };
            return { data: { factors: opts.factors ?? [] }, error: null };
          }),
        },
      },
    },
  } as any;
}

const req = (token?: string) =>
  new Request('http://localhost/api/x', { headers: token ? { authorization: `Bearer ${token}` } : {} });

describe('requireMfaSatisfied（保護対象ルートのMFAガード）', () => {
  it('Bearer が無ければ 401', async () => {
    const res = await requireMfaSatisfied(makeAdmin({}), req());
    expect(res).toEqual({ ok: false, status: 401, error: 'unauthorized' });
  });

  it('不正な JWT・期限切れの JWT（getClaims がエラー）は 401', async () => {
    const res = await requireMfaSatisfied(makeAdmin({ claimsError: { message: 'JWT expired' } }), req('x.y.z'));
    expect(res).toEqual({ ok: false, status: 401, error: 'unauthorized' });
  });

  it('JWT の検証で例外が出ても 401（通す側に倒さない）', async () => {
    const res = await requireMfaSatisfied(makeAdmin({ claimsThrows: true }), req('x.y.z'));
    expect(res).toEqual({ ok: false, status: 401, error: 'unauthorized' });
  });

  it('MFA 未登録のユーザーは aal1 でも従来どおり通す', async () => {
    const res = await requireMfaSatisfied(makeAdmin({ factors: [] }), req('t'));
    expect(res).toEqual({ ok: true, userId: USER });
  });

  it('未検証の要素しかないユーザーは、登録済みではないので通す', async () => {
    const res = await requireMfaSatisfied(makeAdmin({ factors: [unverified] }), req('t'));
    expect(res).toEqual({ ok: true, userId: USER });
  });

  it('MFA 登録済みで aal1 のユーザーは 403（mfa_required）', async () => {
    const res = await requireMfaSatisfied(makeAdmin({ claims: { sub: USER, aal: 'aal1' }, factors: [verified] }), req('t'));
    expect(res).toEqual({ ok: false, status: 403, error: 'mfa_required' });
  });

  it('MFA 登録済みで aal クレームが無い JWT も拒否する（fail closed）', async () => {
    const res = await requireMfaSatisfied(makeAdmin({ claims: { sub: USER }, factors: [verified] }), req('t'));
    expect(res).toEqual({ ok: false, status: 403, error: 'mfa_required' });
  });

  it('MFA 登録済みで aal2 のユーザーは通す', async () => {
    const res = await requireMfaSatisfied(makeAdmin({ claims: { sub: USER, aal: 'aal2' }, factors: [verified] }), req('t'));
    expect(res).toEqual({ ok: true, userId: USER });
  });

  it('想定外の aal は 403（invalid_aal）', async () => {
    const res = await requireMfaSatisfied(makeAdmin({ claims: { sub: USER, aal: 'aal9' }, factors: [] }), req('t'));
    expect(res).toEqual({ ok: false, status: 403, error: 'invalid_aal' });
  });

  it('要素の一覧の取得に失敗したら 503（安全側。通さない）', async () => {
    const res = await requireMfaSatisfied(makeAdmin({ listError: { status: 500 } }), req('t'));
    expect(res).toEqual({ ok: false, status: 503, error: 'mfa_check_unavailable' });
  });

  it('要素の一覧の取得で例外が出たら 503', async () => {
    const res = await requireMfaSatisfied(makeAdmin({ listThrows: true }), req('t'));
    expect(res).toEqual({ ok: false, status: 503, error: 'mfa_check_unavailable' });
  });

  it('JWT の検証は getClaims で行い、サービス側でデコードだけはしない', async () => {
    const admin = makeAdmin({ factors: [] });
    await requireMfaSatisfied(admin, req('the-token'));
    expect(admin.auth.getClaims).toHaveBeenCalledWith('the-token');
  });
});
