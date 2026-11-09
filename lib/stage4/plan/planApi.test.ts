import { createPlanApi } from './planApi';
import type { GatewayResult, PlanGateway } from './planService';
import type { PlanDocRecord } from './planDocumentStore';

const CO = '00000000-0000-4000-8000-00000000c0de';
const ST = '00000000-0000-4000-8000-0000000057a1';
const USER = '00000000-0000-4000-8000-00000000a11c';
const NEW_ID = '00000000-0000-4000-8000-0000000001d1';

const ok = <T,>(value: T): GatewayResult<T> => ({ ok: true, value });
const rec = (version: number): PlanDocRecord => ({
  key: { companyId: CO, strategyId: ST, projectId: 'p-1' },
  version,
  aiDraft: {},
  userEdits: {},
  adopted: false,
  updatedAt: '2026-11-10T00:00:00.000Z',
  updatedBy: USER,
});

function gateway(over: Partial<PlanGateway> = {}): PlanGateway {
  return {
    membershipRole: async () => ok<string | null>('member'),
    findPlan: async () => ok<PlanDocRecord | null>(null),
    insertPlan: async () => ok(rec(1)),
    updatePlan: async () => ok<PlanDocRecord | null>(rec(2)),
    readStrategy: async () => ok(null),
    assignIdentity: async () => ok({ status: 'ASSIGNED', projectId: NEW_ID, revision: 2, alreadyAssigned: false }),
    ...over,
  } as PlanGateway;
}

const api = (g: PlanGateway, verified: string | null = USER) =>
  createPlanApi({ verifyUser: async () => verified, gatewayFor: () => g });

const req = (method: string, path: string, body?: unknown, search = '') =>
  new Request(`http://api.test/api/stage4/${path}${search}`, {
    method,
    headers: { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });

const draftBody = { companyId: CO, strategyId: ST, projectId: 'p-1', aiDraft: { mock: true }, userEdits: { a: 'x' }, adopted: false };

describe('入口の認証と入力の検査', () => {
  it('認証されていなければ 401（どの操作でも、データベースに触れない）', async () => {
    let called = false;
    const g = gateway({ findPlan: async () => ((called = true), ok(null)) });
    const res = await api(g, null).plans(req('GET', 'plan-documents', undefined, `?companyId=${CO}&strategyId=${ST}&projectId=p-1`));
    expect(res.status).toBe(401);
    expect(called).toBe(false);
  });

  it('入力が正しくなければ 400', async () => {
    const res = await api(gateway()).plans(req('POST', 'plan-documents', { ...draftBody, companyId: 'not-a-uuid' }));
    expect(res.status).toBe(400);
    const bad = await api(gateway()).identity(req('POST', 'project-identity', { companyId: CO }));
    expect(bad.status).toBe(400);
  });

  it('対応していない方法は 405', async () => {
    const res = await api(gateway()).plans(req('DELETE', 'plan-documents'));
    expect(res.status).toBe(405);
  });
});

describe('草案の読み書きの結果を、HTTPの状態に変える', () => {
  it('読み込み：見つかれば 200 FOUND、無ければ 200 NONE、他社は 403', async () => {
    const q = `?companyId=${CO}&strategyId=${ST}&projectId=p-1`;
    const found = await api(gateway({ findPlan: async () => ok(rec(2)) })).plans(req('GET', 'plan-documents', undefined, q));
    expect(found.status).toBe(200);
    expect((await found.json()).status).toBe('FOUND');
    const none = await api(gateway()).plans(req('GET', 'plan-documents', undefined, q));
    expect((await none.json()).status).toBe('NONE');
    const denied = await api(gateway({ membershipRole: async () => ok(null) })).plans(req('GET', 'plan-documents', undefined, q));
    expect(denied.status).toBe(403);
  });

  it('新規作成：201 SAVED。同じキーが既にあれば 409 CONFLICT（最新の内容を返す）', async () => {
    const saved = await api(gateway()).plans(req('POST', 'plan-documents', draftBody));
    expect(saved.status).toBe(201);
    const conflict = await api(gateway({ insertPlan: async () => ({ ok: false, code: 'DUPLICATE' }), findPlan: async () => ok(rec(4)) })).plans(req('POST', 'plan-documents', draftBody));
    expect(conflict.status).toBe(409);
    expect((await conflict.json()).current.version).toBe(4);
  });

  it('版番号つき更新：200 SAVED、版番号が違えば 409、保存の失敗は 500（失敗として返す）', async () => {
    const put = (version: number) => req('PUT', 'plan-documents', { ...draftBody, expectedVersion: version });
    expect((await api(gateway()).plans(put(1))).status).toBe(200);
    const stale = await api(gateway({ updatePlan: async () => ok(null), findPlan: async () => ok(rec(3)) })).plans(put(1));
    expect(stale.status).toBe(409);
    const failed = await api(gateway({ updatePlan: async () => ({ ok: false, code: 'ERROR' }) })).plans(put(1));
    expect(failed.status).toBe(500);
    expect((await failed.json()).status).toBe('FAILED');
  });
});

describe('番号の付与の結果を、HTTPの状態に変える', () => {
  const body = { companyId: CO, strategyId: ST, departmentIndex: 0, projectIndex: 1, expectedTitle: '案件', expectedRevision: 5, newId: NEW_ID };

  it('付与できれば 200、版番号が違えば 409（REVISION_CHANGED）、名称が違えば 409（TITLE_CHANGED）', async () => {
    const assigned = await api(gateway()).identity(req('POST', 'project-identity', body));
    expect(assigned.status).toBe(200);
    expect((await assigned.json()).projectId).toBe(NEW_ID);
    const changed = await api(gateway({ assignIdentity: async () => ok({ status: 'REVISION_CHANGED', revision: 6 }) })).identity(req('POST', 'project-identity', body));
    expect(changed.status).toBe(409);
    expect((await changed.json()).status).toBe('REVISION_CHANGED');
    const title = await api(gateway({ assignIdentity: async () => ok({ status: 'TITLE_CHANGED' }) })).identity(req('POST', 'project-identity', body));
    expect(title.status).toBe(409);
  });

  it('読み取りは、版番号と各プロジェクトの番号を返す', async () => {
    const g = gateway({
      readStrategy: async () => ok({ revision: 9, departments: [{ projects: [{ id: 'p-a', title: '案件' }] }] }),
    });
    const res = await api(g).identity(req('GET', 'project-identity', undefined, `?companyId=${CO}&strategyId=${ST}`));
    expect(res.status).toBe(200);
    const body2 = await res.json();
    expect(body2.revision).toBe(9);
    expect(body2.projects[0]).toEqual({ departmentIndex: 0, projectIndex: 0, title: '案件', projectId: 'p-a' });
  });
});
