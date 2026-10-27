/* eslint-disable @typescript-eslint/no-explicit-any -- 偽の管理クライアントを通して、API の振る舞いを確認する */
jest.mock('server-only', () => ({}));
jest.mock('@/lib/supabaseAdmin', () => ({ getSupabaseAdmin: jest.fn() }));
jest.mock('@/lib/server/auditLog', () => ({
  logAuditEvent: jest.fn(async () => true),
  extractAuditMetadata: jest.fn(() => ({ ip: null, userAgent: null })),
}));

import { PATCH } from './route';
import { getSupabaseAdmin } from '@/lib/supabaseAdmin';
import { logAuditEvent } from '@/lib/server/auditLog';
import { createFakeAdmin, type FakeAdminOptions } from '@/lib/server/testing/fakeAdmin';
import { CO_A, CO_B, CO_C, TOKEN, U, fixtureOptions } from '@/lib/server/testing/fixtures';

function setup(overrides: Partial<FakeAdminOptions> = {}) {
  const fake = createFakeAdmin(fixtureOptions(overrides));
  (getSupabaseAdmin as jest.Mock).mockReturnValue(fake);
  return fake;
}

function patch(token: string, body: unknown) {
  return PATCH(
    new Request('http://localhost/api/members/role', {
      method: 'PATCH',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: JSON.stringify(body),
    })
  );
}

const roleOf = (fake: ReturnType<typeof createFakeAdmin>, company: string, user: string) =>
  fake.snapshot().find((r) => r.company_id === company && r.user_id === user)?.role;

describe('PATCH /api/members/role（MFA と会社の権限）', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('MFA 未登録の管理者は 403（mfa_enrollment_required）。ロールは変わらない', async () => {
    const fake = setup();
    const before = fake.snapshot();

    const res = await patch(TOKEN.adminANoEnroll, { companyId: CO_A, targetUserId: U.targetA, newRole: 'manager' });

    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: 'mfa_enrollment_required' });
    expect(fake.snapshot()).toEqual(before);
  });

  it('MFA 登録済みで aal1 の管理者は 403（mfa_required）。ロールは変わらない', async () => {
    const fake = setup();
    const before = fake.snapshot();

    const res = await patch(TOKEN.adminAAal1, { companyId: CO_A, targetUserId: U.targetA, newRole: 'manager' });

    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: 'mfa_required' });
    expect(fake.snapshot()).toEqual(before);
  });

  it('aal2 の管理者は、指定した会社のメンバーのロールを変更でき、監査ログに残る', async () => {
    const fake = setup();

    const res = await patch(TOKEN.adminA, { companyId: CO_A, targetUserId: U.targetA, newRole: 'manager' });

    expect(res.status).toBe(200);
    expect(roleOf(fake, CO_A, U.targetA)).toBe('manager');
    expect(logAuditEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        companyId: CO_A,
        actorUserId: U.adminA,
        action: 'member_role_changed',
        targetId: U.targetA,
        before: { role: 'member' },
        after: { role: 'manager' },
      })
    );
  });

  it('一般メンバーは 403（forbidden）。ロールは変わらない', async () => {
    const fake = setup();
    const before = fake.snapshot();

    const res = await patch(TOKEN.memberA, { companyId: CO_A, targetUserId: U.targetA, newRole: 'admin' });

    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: 'forbidden' });
    expect(fake.snapshot()).toEqual(before);
  });

  it('複数の会社の管理者は、指定した会社のメンバーだけを操作できる', async () => {
    const fake = setup();

    const ok = await patch(TOKEN.adminAB, { companyId: CO_A, targetUserId: U.targetA, newRole: 'manager' });
    expect(ok.status).toBe(200);
    expect(roleOf(fake, CO_A, U.targetA)).toBe('manager');

    // 同じ人を、B の会社の指定で操作すると、B の所属には居ない
    const other = await patch(TOKEN.adminAB, { companyId: CO_B, targetUserId: U.targetA, newRole: 'admin' });
    expect(other.status).toBe(404);
    expect(await other.json()).toEqual({ error: 'member_not_found' });
    expect(roleOf(fake, CO_A, U.targetA)).toBe('manager');
    expect(fake.snapshot().some((r) => r.company_id === CO_B && r.user_id === U.targetA)).toBe(false);
  });

  it('別会社の管理者は、その会社のメンバーのロールを変更できない（403）', async () => {
    const fake = setup();
    const before = fake.snapshot();

    const res = await patch(TOKEN.adminA, { companyId: CO_B, targetUserId: U.targetB, newRole: 'admin' });

    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: 'forbidden' });
    expect(fake.snapshot()).toEqual(before);
  });

  it('別会社のメンバーを、自社の会社指定で操作すると 404 になる', async () => {
    const fake = setup();
    const before = fake.snapshot();

    const res = await patch(TOKEN.adminA, { companyId: CO_A, targetUserId: U.targetB, newRole: 'admin' });

    expect(res.status).toBe(404);
    expect(fake.snapshot()).toEqual(before);
  });

  it('最後の管理者は降格できない（403）。ロールは変わらない', async () => {
    const fake = setup();
    const before = fake.snapshot();

    const res = await patch(TOKEN.adminC, { companyId: CO_C, targetUserId: U.adminC, newRole: 'member' });

    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: 'last_admin_cannot_be_downgraded' });
    expect(fake.snapshot()).toEqual(before);
  });

  it('会社の指定や対象が不正なら 400', async () => {
    setup();

    const noCompany = await patch(TOKEN.adminA, { targetUserId: U.targetA, newRole: 'manager' });
    expect(noCompany.status).toBe(400);

    const badRole = await patch(TOKEN.adminA, { companyId: CO_A, targetUserId: U.targetA, newRole: 'owner' });
    expect(badRole.status).toBe(400);

    const badCompany = await patch(TOKEN.adminA, { companyId: 'not-a-uuid', targetUserId: U.targetA, newRole: 'manager' });
    expect(badCompany.status).toBe(400);
  });

  it('会社の所属を確認できない場合は、通さない（503）', async () => {
    const fake = setup({ failMemberReads: true });
    const before = fake.snapshot();

    const res = await patch(TOKEN.adminA, { companyId: CO_A, targetUserId: U.targetA, newRole: 'manager' });

    expect(res.status).toBe(503);
    expect(fake.snapshot()).toEqual(before);
  });
});
