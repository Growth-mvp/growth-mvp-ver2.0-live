jest.mock('server-only', () => ({}));

import { createFakeAdmin } from './testing/fakeAdmin';
import { CO_A, CO_B, U } from './testing/fixtures';
import {
  assertCompanyAdmin,
  countOtherAdmins,
  isAppRole,
  isLastAdminViolation,
  isUuid,
  removeCompanyMember,
} from './companyAdmin';

describe('入力の判定', () => {
  it('UUID の形式だけを通す', () => {
    expect(isUuid(CO_A)).toBe(true);
    expect(isUuid('not-a-uuid')).toBe(false);
    expect(isUuid('')).toBe(false);
    expect(isUuid(undefined)).toBe(false);
    expect(isUuid(123)).toBe(false);
  });

  it('役割は admin / manager / member だけを通す', () => {
    expect(isAppRole('admin')).toBe(true);
    expect(isAppRole('manager')).toBe(true);
    expect(isAppRole('member')).toBe(true);
    expect(isAppRole('owner')).toBe(false);
    expect(isAppRole(undefined)).toBe(false);
  });
});

describe('DB トリガーの例外の判定（最後の管理者）', () => {
  it('P0001 かつ last_admin の例外だけを、最後の管理者の違反として扱う', () => {
    expect(isLastAdminViolation({ code: 'P0001', message: 'last_admin: 会社には管理者が 1 人以上必要です' })).toBe(true);
    expect(isLastAdminViolation({ code: 'P0001', message: 'something else' })).toBe(false);
    expect(isLastAdminViolation({ code: '42501', message: 'permission denied' })).toBe(false);
    expect(isLastAdminViolation(null)).toBe(false);
    expect(isLastAdminViolation(undefined)).toBe(false);
  });
});

describe('assertCompanyAdmin（会社を明示した管理者の確認）', () => {
  const admin = () =>
    createFakeAdmin({
      members: [
        { company_id: CO_A, user_id: U.adminA, role: 'admin' },
        { company_id: CO_A, user_id: U.targetA, role: 'member' },
        { company_id: CO_B, user_id: U.adminB, role: 'admin' },
      ],
      users: {},
    });

  it('その会社の admin なら通す', async () => {
    expect(await assertCompanyAdmin(admin() as any, U.adminA, CO_A)).toEqual({ ok: true });
  });

  it('別の会社の admin は 403', async () => {
    expect(await assertCompanyAdmin(admin() as any, U.adminA, CO_B)).toEqual({ ok: false, status: 403, error: 'forbidden' });
  });

  it('その会社の一般メンバーは 403', async () => {
    expect(await assertCompanyAdmin(admin() as any, U.targetA, CO_A)).toEqual({ ok: false, status: 403, error: 'forbidden' });
  });
});

describe('removeCompanyMember（最後の管理者を守る削除）', () => {
  it('管理者が 2 人いれば、一方を削除できる', async () => {
    const fake = createFakeAdmin({
      members: [
        { company_id: CO_A, user_id: U.adminA, role: 'admin' },
        { company_id: CO_A, user_id: U.adminAAal1, role: 'admin' },
      ],
      users: {},
    });

    const r = await removeCompanyMember(fake as any, CO_A, U.adminAAal1);

    expect(r).toEqual({ ok: true, role: 'admin' });
    expect(fake.snapshot()).toEqual([{ company_id: CO_A, user_id: U.adminA, role: 'admin' }]);
  });

  it('最後の管理者は削除できず、データは変わらない', async () => {
    const fake = createFakeAdmin({
      members: [{ company_id: CO_A, user_id: U.adminA, role: 'admin' }],
      users: {},
    });
    const before = fake.snapshot();

    const r = await removeCompanyMember(fake as any, CO_A, U.adminA);

    expect(r).toMatchObject({ ok: false, status: 400, error: 'cannot_remove_last_admin' });
    expect(fake.snapshot()).toEqual(before);
  });

  it('会社に居ないメンバーは 404', async () => {
    const fake = createFakeAdmin({ members: [{ company_id: CO_A, user_id: U.adminA, role: 'admin' }], users: {} });
    const r = await removeCompanyMember(fake as any, CO_A, U.targetB);
    expect(r).toMatchObject({ ok: false, status: 404, error: 'member_not_found' });
  });
});

describe('countOtherAdmins', () => {
  it('対象以外の admin の人数を返す（別会社の admin は数えない）', async () => {
    const fake = createFakeAdmin({
      members: [
        { company_id: CO_A, user_id: U.adminA, role: 'admin' },
        { company_id: CO_A, user_id: U.adminAAal1, role: 'admin' },
        { company_id: CO_B, user_id: U.adminB, role: 'admin' },
      ],
      users: {},
    });
    expect(await countOtherAdmins(fake as any, CO_A, U.adminA)).toBe(1);
    expect(await countOtherAdmins(fake as any, CO_B, U.adminB)).toBe(0);
  });
});
