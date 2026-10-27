/* eslint-disable @typescript-eslint/no-explicit-any -- 管理 API のモックは意図的に緩く定義している */
jest.mock('server-only', () => ({}));

import { requireAdminMfa } from './mfaGuard';

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
  isAdmin?: boolean;
  roleError?: unknown;
  roleThrows?: boolean;
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
    from: jest.fn(() => {
      if (opts.roleThrows) throw new Error('boom');
      const result = opts.roleError
        ? { data: null, error: opts.roleError }
        : { data: opts.isAdmin ? [{ company_id: 'company-1' }] : [], error: null };
      const chain: any = {
        select: () => chain,
        eq: () => chain,
        limit: async () => result,
      };
      return chain;
    }),
  } as any;
}

const req = (token?: string) =>
  new Request('http://localhost/api/x', { headers: token ? { authorization: `Bearer ${token}` } : {} });

describe('requireAdminMfa（管理者操作の MFA ガード）', () => {
  describe('認証', () => {
    it('Bearer が無ければ 401', async () => {
      const res = await requireAdminMfa(makeAdmin({}), req());
      expect(res).toEqual({ ok: false, status: 401, error: 'unauthorized' });
    });

    it('不正な JWT・期限切れの JWT（getClaims がエラー）は 401', async () => {
      const res = await requireAdminMfa(makeAdmin({ claimsError: { message: 'JWT expired' } }), req('x.y.z'));
      expect(res).toEqual({ ok: false, status: 401, error: 'unauthorized' });
    });

    it('JWT の検証で例外が出ても 401（通す側に倒さない）', async () => {
      const res = await requireAdminMfa(makeAdmin({ claimsThrows: true }), req('x.y.z'));
      expect(res).toEqual({ ok: false, status: 401, error: 'unauthorized' });
    });

    it('JWT の検証は getClaims で行う', async () => {
      const admin = makeAdmin({ isAdmin: false });
      await requireAdminMfa(admin, req('the-token'));
      expect(admin.auth.getClaims).toHaveBeenCalledWith('the-token');
    });
  });

  describe('管理者でないユーザー', () => {
    it('MFA 未登録の一般メンバーは通す（権限の可否は各ルートが判定する）', async () => {
      const res = await requireAdminMfa(makeAdmin({ isAdmin: false, factors: [] }), req('t'));
      expect(res).toEqual({ ok: true, userId: USER, isAdmin: false });
    });

    it('MFA 登録済みでも aal1 の一般メンバーは通す（管理者の要件を一般メンバーに広げない）', async () => {
      const res = await requireAdminMfa(
        makeAdmin({ isAdmin: false, claims: { sub: USER, aal: 'aal1' }, factors: [verified] }),
        req('t')
      );
      expect(res).toEqual({ ok: true, userId: USER, isAdmin: false });
    });
  });

  describe('管理者', () => {
    it('MFA 未登録の管理者は 403（mfa_enrollment_required）', async () => {
      const res = await requireAdminMfa(makeAdmin({ isAdmin: true, factors: [] }), req('t'));
      expect(res).toEqual({ ok: false, status: 403, error: 'mfa_enrollment_required' });
    });

    it('未検証の要素しかない管理者は登録済みではないので 403（mfa_enrollment_required）', async () => {
      const res = await requireAdminMfa(makeAdmin({ isAdmin: true, factors: [unverified] }), req('t'));
      expect(res).toEqual({ ok: false, status: 403, error: 'mfa_enrollment_required' });
    });

    it('MFA 登録済みで aal1 の管理者は 403（mfa_required）', async () => {
      const res = await requireAdminMfa(
        makeAdmin({ isAdmin: true, claims: { sub: USER, aal: 'aal1' }, factors: [verified] }),
        req('t')
      );
      expect(res).toEqual({ ok: false, status: 403, error: 'mfa_required' });
    });

    it('MFA 登録済みで aal クレームが無い JWT も拒否する（fail closed）', async () => {
      const res = await requireAdminMfa(
        makeAdmin({ isAdmin: true, claims: { sub: USER }, factors: [verified] }),
        req('t')
      );
      expect(res).toEqual({ ok: false, status: 403, error: 'mfa_required' });
    });

    it('MFA 登録済みで aal2 の管理者は通す', async () => {
      const res = await requireAdminMfa(
        makeAdmin({ isAdmin: true, claims: { sub: USER, aal: 'aal2' }, factors: [verified] }),
        req('t')
      );
      expect(res).toEqual({ ok: true, userId: USER, isAdmin: true });
    });

    it('想定外の aal は 403（invalid_aal）', async () => {
      const res = await requireAdminMfa(
        makeAdmin({ isAdmin: true, claims: { sub: USER, aal: 'aal9' }, factors: [verified] }),
        req('t')
      );
      expect(res).toEqual({ ok: false, status: 403, error: 'invalid_aal' });
    });
  });

  describe('確認できない場合は通さない（503）', () => {
    it('ロールの確認に失敗したら 503', async () => {
      const res = await requireAdminMfa(makeAdmin({ roleError: { message: 'db down' } }), req('t'));
      expect(res).toEqual({ ok: false, status: 503, error: 'mfa_check_unavailable' });
    });

    it('ロールの確認で例外が出たら 503', async () => {
      const res = await requireAdminMfa(makeAdmin({ roleThrows: true }), req('t'));
      expect(res).toEqual({ ok: false, status: 503, error: 'mfa_check_unavailable' });
    });

    it('管理者の要素一覧の取得に失敗したら 503', async () => {
      const res = await requireAdminMfa(makeAdmin({ isAdmin: true, listError: { status: 500 } }), req('t'));
      expect(res).toEqual({ ok: false, status: 503, error: 'mfa_check_unavailable' });
    });

    it('管理者の要素一覧の取得で例外が出たら 503', async () => {
      const res = await requireAdminMfa(makeAdmin({ isAdmin: true, listThrows: true }), req('t'));
      expect(res).toEqual({ ok: false, status: 503, error: 'mfa_check_unavailable' });
    });
  });
});
