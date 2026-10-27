import type { FakeAdminOptions } from './fakeAdmin';

/** 管理者・メンバー操作のテストで共通に使う固定データ（架空の ID のみ） */
export const CO_A = '11111111-1111-4111-8111-111111111111';
export const CO_B = '22222222-2222-4222-8222-222222222222';
export const CO_C = '33333333-3333-4333-8333-333333333333';

export const U = {
  adminA: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', // A の管理者、MFA 登録済み、aal2
  adminANoEnroll: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', // A の管理者、MFA 未登録
  adminAAal1: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc', // A の管理者、MFA 登録済み、aal1
  memberA: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd', // A の一般メンバー
  targetA: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee', // A のメンバー（操作対象）
  adminAB: 'ffffffff-ffff-4fff-8fff-ffffffffffff', // A と B の両方で管理者
  targetB: '99999999-9999-4999-8999-999999999999', // B のメンバー（操作対象）
  adminB: '88888888-8888-4888-8888-888888888888', // B の管理者のみ
  adminC: '77777777-7777-4777-8777-777777777777', // C の唯一の管理者
  newUser: '66666666-6666-4666-8666-666666666666', // 追加対象（どの会社にも居ない）
} as const;

export const TOKEN = {
  adminA: 'tok-admin-a',
  adminANoEnroll: 'tok-admin-a-noenroll',
  adminAAal1: 'tok-admin-a-aal1',
  memberA: 'tok-member-a',
  adminAB: 'tok-admin-ab',
  adminB: 'tok-admin-b',
  adminC: 'tok-admin-c',
} as const;

export function fixtureOptions(overrides: Partial<FakeAdminOptions> = {}): FakeAdminOptions {
  const verified = [{ status: 'verified' as const }];
  return {
    members: [
      { company_id: CO_A, user_id: U.adminA, role: 'admin' },
      { company_id: CO_A, user_id: U.adminANoEnroll, role: 'admin' },
      { company_id: CO_A, user_id: U.adminAAal1, role: 'admin' },
      { company_id: CO_A, user_id: U.adminAB, role: 'admin' },
      { company_id: CO_A, user_id: U.memberA, role: 'member' },
      { company_id: CO_A, user_id: U.targetA, role: 'member' },
      { company_id: CO_B, user_id: U.adminAB, role: 'admin' },
      { company_id: CO_B, user_id: U.adminB, role: 'admin' },
      { company_id: CO_B, user_id: U.targetB, role: 'member' },
      { company_id: CO_C, user_id: U.adminC, role: 'admin' },
    ],
    users: {
      [TOKEN.adminA]: { id: U.adminA, aal: 'aal2' },
      [TOKEN.adminANoEnroll]: { id: U.adminANoEnroll, aal: 'aal1' },
      [TOKEN.adminAAal1]: { id: U.adminAAal1, aal: 'aal1' },
      [TOKEN.memberA]: { id: U.memberA, aal: 'aal2' },
      [TOKEN.adminAB]: { id: U.adminAB, aal: 'aal2' },
      [TOKEN.adminB]: { id: U.adminB, aal: 'aal2' },
      [TOKEN.adminC]: { id: U.adminC, aal: 'aal2' },
    },
    factors: {
      [U.adminA]: verified,
      [U.adminAAal1]: verified,
      [U.memberA]: verified,
      [U.adminAB]: verified,
      [U.adminB]: verified,
      [U.adminC]: verified,
      [U.adminANoEnroll]: [],
    },
    ...overrides,
  };
}
