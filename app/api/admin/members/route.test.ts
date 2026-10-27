/* eslint-disable @typescript-eslint/no-explicit-any -- 偽の管理クライアントを通して、API の振る舞いを確認する */
jest.mock('server-only', () => ({}));
jest.mock('@/lib/supabaseAdmin', () => ({ getSupabaseAdmin: jest.fn() }));
jest.mock('@/lib/server/auditLog', () => ({
  logAuditEvent: jest.fn(async () => true),
  extractAuditMetadata: jest.fn(() => ({ ip: null, userAgent: null })),
}));

import { DELETE, GET } from './route';
import { getSupabaseAdmin } from '@/lib/supabaseAdmin';
import { logAuditEvent } from '@/lib/server/auditLog';
import { createFakeAdmin, type FakeAdminOptions } from '@/lib/server/testing/fakeAdmin';
import { CO_A, CO_B, CO_C, TOKEN, U, fixtureOptions } from '@/lib/server/testing/fixtures';

function setup(overrides: Partial<FakeAdminOptions> = {}) {
  const fake = createFakeAdmin(fixtureOptions(overrides));
  (getSupabaseAdmin as jest.Mock).mockReturnValue(fake);
  return fake;
}

function remove(token: string, companyId: string | null, userId: string | null) {
  const url = new URL('http://localhost/api/admin/members');
  if (companyId !== null) url.searchParams.set('companyId', companyId);
  if (userId !== null) url.searchParams.set('userId', userId);
  return DELETE(new Request(url, { method: 'DELETE', headers: { authorization: `Bearer ${token}` } }));
}

const isMember = (fake: ReturnType<typeof createFakeAdmin>, company: string, user: string) =>
  fake.snapshot().some((r) => r.company_id === company && r.user_id === user);

describe('DELETE /api/admin/members（MFA と会社の権限）', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('MFA 未登録の管理者は 403（mfa_enrollment_required）。削除されない', async () => {
    const fake = setup();
    const before = fake.snapshot();

    const res = await remove(TOKEN.adminANoEnroll, CO_A, U.targetA);

    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: 'mfa_enrollment_required' });
    expect(fake.snapshot()).toEqual(before);
  });

  it('MFA 登録済みで aal1 の管理者は 403（mfa_required）。削除されない', async () => {
    const fake = setup();
    const before = fake.snapshot();

    const res = await remove(TOKEN.adminAAal1, CO_A, U.targetA);

    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: 'mfa_required' });
    expect(fake.snapshot()).toEqual(before);
  });

  it('aal2 の管理者は指定した会社からメンバーを削除でき、監査ログに残る', async () => {
    const fake = setup();

    const res = await remove(TOKEN.adminA, CO_A, U.targetA);

    expect(res.status).toBe(200);
    expect(isMember(fake, CO_A, U.targetA)).toBe(false);
    expect(logAuditEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        companyId: CO_A,
        actorUserId: U.adminA,
        action: 'member_removed',
        targetId: U.targetA,
        before: { role: 'member' },
      })
    );
  });

  it('一般メンバーは 403（forbidden）。削除されない', async () => {
    const fake = setup();
    const before = fake.snapshot();

    const res = await remove(TOKEN.memberA, CO_A, U.targetA);

    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: 'forbidden' });
    expect(fake.snapshot()).toEqual(before);
  });

  it('複数の会社の管理者は、指定した会社のメンバーだけを削除できる', async () => {
    const fake = setup();

    // 指定会社 B に居ない人は削除できない
    const wrong = await remove(TOKEN.adminAB, CO_B, U.targetA);
    expect(wrong.status).toBe(404);
    expect(isMember(fake, CO_A, U.targetA)).toBe(true);

    // 指定会社 A の人は削除できる（B の管理者でも、A の所属は A の指定で操作する）
    const ok = await remove(TOKEN.adminAB, CO_A, U.targetA);
    expect(ok.status).toBe(200);
    expect(isMember(fake, CO_A, U.targetA)).toBe(false);
    expect(isMember(fake, CO_B, U.adminAB)).toBe(true);
  });

  it('別会社の管理者は、その会社のメンバーを削除できない（403）', async () => {
    const fake = setup();
    const before = fake.snapshot();

    const res = await remove(TOKEN.adminA, CO_B, U.targetB);

    expect(res.status).toBe(403);
    expect(fake.snapshot()).toEqual(before);
  });

  it('別会社のメンバーを、自社の会社指定で削除しようとすると 404 になる', async () => {
    const fake = setup();
    const before = fake.snapshot();

    const res = await remove(TOKEN.adminA, CO_A, U.targetB);

    expect(res.status).toBe(404);
    expect(fake.snapshot()).toEqual(before);
  });

  it('最後の管理者は削除できない（400）。削除されない', async () => {
    const fake = setup();
    const before = fake.snapshot();

    const res = await remove(TOKEN.adminC, CO_C, U.adminC);

    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: 'cannot_remove_last_admin' });
    expect(fake.snapshot()).toEqual(before);
  });

  it('管理者が 2 人以上いれば、管理者の 1 人を削除できる', async () => {
    const fake = setup();

    const res = await remove(TOKEN.adminA, CO_A, U.adminANoEnroll);

    expect(res.status).toBe(200);
    expect(isMember(fake, CO_A, U.adminANoEnroll)).toBe(false);
  });

  it('会社または対象の指定が無い・不正なら 400', async () => {
    const fake = setup();
    const before = fake.snapshot();

    expect((await remove(TOKEN.adminA, null, U.targetA)).status).toBe(400);
    expect((await remove(TOKEN.adminA, CO_A, null)).status).toBe(400);
    expect((await remove(TOKEN.adminA, 'not-a-uuid', U.targetA)).status).toBe(400);
    expect(fake.snapshot()).toEqual(before);
  });
});

function list(token: string, companyId: string | null) {
  const url = new URL('http://localhost/api/admin/members');
  if (companyId !== null) url.searchParams.set('companyId', companyId);
  return GET(new Request(url, { headers: { authorization: `Bearer ${token}` } }));
}

async function listedUserIds(res: Response): Promise<string[]> {
  const body = (await res.json()) as { members: Array<{ userId: string }> };
  return body.members.map((m) => m.userId).sort();
}

const idsOf = (...ids: string[]) => [...ids].sort();

describe('GET /api/admin/members（MFA ガードと会社の権限）', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('MFA 登録済みで aal1 の管理者は 403（mfa_required）', async () => {
    setup();
    const res = await list(TOKEN.adminAAal1, CO_A);
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: 'mfa_required' });
  });

  it('不正な JWT は 401', async () => {
    setup();
    const res = await list('bad', CO_A);
    expect(res.status).toBe(401);
  });

  it('単一会社の管理者は、指定した会社の全メンバーを取得できる', async () => {
    setup();
    const res = await list(TOKEN.adminA, CO_A);
    expect(res.status).toBe(200);
    expect(await listedUserIds(res)).toEqual(
      idsOf(U.adminA, U.adminANoEnroll, U.adminAAal1, U.adminAB, U.memberA, U.targetA)
    );
  });

  it('複数会社の管理者は、指定した会社の一覧だけを取得できる（別会社のメンバーを返さない）', async () => {
    setup();

    const inA = await listedUserIds(await list(TOKEN.adminAB, CO_A));
    expect(inA).toEqual(idsOf(U.adminA, U.adminANoEnroll, U.adminAAal1, U.adminAB, U.memberA, U.targetA));
    expect(inA).not.toContain(U.targetB);
    expect(inA).not.toContain(U.adminB);

    const inB = await listedUserIds(await list(TOKEN.adminAB, CO_B));
    expect(inB).toEqual(idsOf(U.adminAB, U.adminB, U.targetB));
    expect(inB).not.toContain(U.targetA);
    expect(inB).not.toContain(U.memberA);
  });

  it('一般メンバーは、指定した会社でも 403（forbidden）', async () => {
    setup();
    const res = await list(TOKEN.memberA, CO_A);
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: 'forbidden' });
  });

  it('別会社の管理者は、所属していない会社の一覧を取得できない（403）', async () => {
    setup();
    const res = await list(TOKEN.adminA, CO_B);
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: 'forbidden' });
  });

  it('どの会社にも所属しない会社 ID は 403（forbidden）', async () => {
    setup();
    const res = await list(TOKEN.adminA, '44444444-4444-4444-8444-444444444444');
    expect(res.status).toBe(403);
  });

  it('会社の指定が無い・不正な場合は 400（既定の会社には切り替えない）', async () => {
    setup();
    expect((await list(TOKEN.adminAB, null)).status).toBe(400);
    expect((await list(TOKEN.adminAB, 'not-a-uuid')).status).toBe(400);
  });
});
