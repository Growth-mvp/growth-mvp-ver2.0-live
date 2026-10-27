/* eslint-disable @typescript-eslint/no-explicit-any -- 偽の管理クライアントを通して、API の振る舞いを確認する */
jest.mock('server-only', () => ({}));
jest.mock('@/lib/supabaseAdmin', () => ({ getSupabaseAdmin: jest.fn() }));
jest.mock('@/lib/server/auditLog', () => ({
  logAuditEvent: jest.fn(async () => true),
  extractAuditMetadata: jest.fn(() => ({ ip: null, userAgent: null })),
}));

import { POST, DELETE } from './route';
import { getSupabaseAdmin } from '@/lib/supabaseAdmin';
import { logAuditEvent } from '@/lib/server/auditLog';
import { createFakeAdmin, type FakeAdminOptions } from '@/lib/server/testing/fakeAdmin';
import { CO_A, CO_B, CO_C, TOKEN, U, fixtureOptions } from '@/lib/server/testing/fixtures';

function setup(overrides: Partial<FakeAdminOptions> = {}) {
  const fake = createFakeAdmin(fixtureOptions(overrides));
  (getSupabaseAdmin as jest.Mock).mockReturnValue(fake);
  return fake;
}

function call(method: 'POST' | 'DELETE', token: string, body: unknown) {
  return (method === 'POST' ? POST : DELETE)(
    new Request('http://localhost/api/members', {
      method,
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: JSON.stringify(body),
    })
  );
}

const isMember = (fake: ReturnType<typeof createFakeAdmin>, company: string, user: string) =>
  fake.snapshot().some((r) => r.company_id === company && r.user_id === user);

describe('POST /api/members（会社を明示して追加）', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('MFA 未登録の管理者は 403（mfa_enrollment_required）。追加されない', async () => {
    const fake = setup();
    const before = fake.snapshot();

    const res = await call('POST', TOKEN.adminANoEnroll, { companyId: CO_A, targetUserId: U.newUser, role: 'member' });

    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: 'mfa_enrollment_required' });
    expect(fake.snapshot()).toEqual(before);
  });

  it('aal2 の管理者は指定した会社に追加でき、監査ログに残る', async () => {
    const fake = setup();

    const res = await call('POST', TOKEN.adminA, { companyId: CO_A, targetUserId: U.newUser, role: 'manager' });

    expect(res.status).toBe(200);
    expect(fake.snapshot()).toContainEqual(expect.objectContaining({ company_id: CO_A, user_id: U.newUser, role: 'manager' }));
    expect(logAuditEvent).toHaveBeenCalledWith(
      expect.objectContaining({ companyId: CO_A, action: 'member_added', targetId: U.newUser, after: { role: 'manager' } })
    );
  });

  it('別会社の管理者は、その会社に追加できない（403）', async () => {
    const fake = setup();
    const before = fake.snapshot();

    const res = await call('POST', TOKEN.adminA, { companyId: CO_B, targetUserId: U.newUser, role: 'member' });

    expect(res.status).toBe(403);
    expect(fake.snapshot()).toEqual(before);
  });

  it('一般メンバーは 403（forbidden）', async () => {
    const fake = setup();
    const before = fake.snapshot();

    const res = await call('POST', TOKEN.memberA, { companyId: CO_A, targetUserId: U.newUser, role: 'member' });

    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: 'forbidden' });
    expect(fake.snapshot()).toEqual(before);
  });

  it('既存の管理者を、最後の管理者のまま member に上書きできない（403）', async () => {
    const fake = setup();
    const before = fake.snapshot();

    const res = await call('POST', TOKEN.adminC, { companyId: CO_C, targetUserId: U.adminC, role: 'member' });

    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: 'last_admin_cannot_be_downgraded' });
    expect(fake.snapshot()).toEqual(before);
  });

  it('役割が不正なら 400', async () => {
    const fake = setup();
    const before = fake.snapshot();

    const res = await call('POST', TOKEN.adminA, { companyId: CO_A, targetUserId: U.newUser, role: 'owner' });

    expect(res.status).toBe(400);
    expect(fake.snapshot()).toEqual(before);
  });
});

describe('DELETE /api/members（会社を明示して削除）', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('MFA 未登録の管理者は 403（mfa_enrollment_required）。削除されない', async () => {
    const fake = setup();
    const before = fake.snapshot();

    const res = await call('DELETE', TOKEN.adminANoEnroll, { companyId: CO_A, targetUserId: U.targetA });

    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: 'mfa_enrollment_required' });
    expect(fake.snapshot()).toEqual(before);
  });

  it('aal2 の管理者は指定した会社からメンバーを削除でき、監査ログに残る', async () => {
    const fake = setup();

    const res = await call('DELETE', TOKEN.adminA, { companyId: CO_A, targetUserId: U.targetA });

    expect(res.status).toBe(200);
    expect(isMember(fake, CO_A, U.targetA)).toBe(false);
    expect(logAuditEvent).toHaveBeenCalledWith(
      expect.objectContaining({ companyId: CO_A, action: 'member_removed', targetId: U.targetA })
    );
  });

  it('複数の会社の管理者でも、別会社のメンバーは指定会社の所属として見つからず 404', async () => {
    const fake = setup();
    const before = fake.snapshot();

    const res = await call('DELETE', TOKEN.adminAB, { companyId: CO_A, targetUserId: U.targetB });

    expect(res.status).toBe(404);
    expect(fake.snapshot()).toEqual(before);
  });

  it('自分自身は削除できない（400）', async () => {
    const fake = setup();
    const before = fake.snapshot();

    const res = await call('DELETE', TOKEN.adminA, { companyId: CO_A, targetUserId: U.adminA });

    expect(res.status).toBe(400);
    expect(fake.snapshot()).toEqual(before);
  });

  it('対象会社の管理者でなければ、その会社の最後の管理者も削除できない（403）', async () => {
    const fake = setup();
    const before = fake.snapshot();

    // C の唯一の管理者を、別の人（C に居ない）が削除しようとしても、C の管理者でなければ 403
    const notAdminOfC = await call('DELETE', TOKEN.adminA, { companyId: CO_C, targetUserId: U.adminC });
    expect(notAdminOfC.status).toBe(403);
    expect(fake.snapshot()).toEqual(before);
  });

  it('一般メンバーは 403（forbidden）', async () => {
    const fake = setup();
    const before = fake.snapshot();

    const res = await call('DELETE', TOKEN.memberA, { companyId: CO_A, targetUserId: U.targetA });

    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: 'forbidden' });
    expect(fake.snapshot()).toEqual(before);
  });
});
