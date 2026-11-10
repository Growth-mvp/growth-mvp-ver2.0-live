import { STAGE3_SNAPSHOT_STRATEGIES } from '@/lib/stage4/planView/fixtures/stage3Snapshot';
import { generateMockExecutionPlan } from './mockGenerate';
import { createPlanApi, type PlanApiDeps } from './planApi';
import type { GatewayResult, PlanGateway } from './planService';
import type { PlanDocRecord } from './planDocumentStore';

const CO = '00000000-0000-4000-8000-00000000c0de';
const ST = '00000000-0000-4000-8000-0000000057a1';
const USER = '00000000-0000-4000-8000-00000000a11c';
const NEW_ID = '00000000-0000-4000-8000-0000000001d1';

const ok = <T,>(value: T): GatewayResult<T> => ({ ok: true, value });

/* 生成の対象になる戦略（架空・SWOTつき）と、エンジンの検証を通った草案 */
const strategyRow = () => ({ ...JSON.parse(JSON.stringify(STAGE3_SNAPSHOT_STRATEGIES[0])), id: ST, company_id: CO, revision: 3 });
let bundle: Record<string, unknown> = {};
beforeAll(async () => {
  const r = await generateMockExecutionPlan({ strategy: strategyRow() as never, membershipCompanyId: CO, requestedStrategyId: ST, requestedProjectId: 'fict-proj-renewal', currentYm: '2026-11', companyName: '架空', createdAt: '2026-11-10T00:00:00.000Z' });
  if (r.status !== 'READY') throw new Error('mock draft must be ready');
  bundle = r.bundle;
});
const rec = (version: number, status: PlanDocRecord['status'] = 'DRAFT'): PlanDocRecord => ({
  key: { companyId: CO, strategyId: ST, projectId: 'p-1' },
  version,
  aiDraft: bundle,
  userEdits: {},
  adopted: false,
  updatedAt: '2026-11-10T00:00:00.000Z',
  updatedBy: USER,
  status,
  adoption: null,
  startInfo: null,
});

function gateway(over: Partial<PlanGateway> = {}): PlanGateway {
  return {
    membershipRole: async () => ok<string | null>('member'),
    findPlan: async () => ok<PlanDocRecord | null>(null),
    listEvents: async () => ok([]),
    claimGeneration: async () => ok({ claimed: true as const, record: rec(1, 'GENERATING') }),
    completeGeneration: async () => ok<PlanDocRecord | null>(rec(1)),
    failGeneration: async () => ok<PlanDocRecord | null>(null),
    updatePlan: async () => ok<PlanDocRecord | null>(rec(2)),
    readStrategyRow: async () => ok(strategyRow()),
    assignIdentity: async () => ok({ status: 'ASSIGNED', projectId: NEW_ID, revision: 2, alreadyAssigned: false }),
    ...over,
  } as PlanGateway;
}

const deps = (g: PlanGateway, over: Partial<PlanApiDeps> = {}): PlanApiDeps => ({
  verifyUser: async () => USER,
  gatewayFor: () => g,
  enabled: true,
  generation: {
    currentYm: () => '2026-11',
    mapStrategy: (row) => row as never,
    modelFor: async () => async () => ({ text: 'not json' }),
  },
  now: () => '2026-11-10T00:00:00.000Z',
  ...over,
});
const api = (g: PlanGateway, over: Partial<PlanApiDeps> = {}) => createPlanApi(deps(g, over));

const req = (method: string, path: string, body?: unknown, search = '') =>
  new Request(`http://api.test/api/stage4/${path}${search}`, {
    method,
    headers: { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });

const key = { companyId: CO, strategyId: ST, projectId: 'p-1' };
const SEARCH = `?companyId=${CO}&strategyId=${ST}&projectId=p-1`;

describe('入口の認証と入力の検査', () => {
  it('認証されていなければ 401（どの操作でも、データベースに触れない）', async () => {
    let called = false;
    const g = gateway({ findPlan: async () => ((called = true), ok(null)) });
    const res = await api(g, { verifyUser: async () => null }).plans(req('GET', 'plan-documents', undefined, SEARCH));
    expect(res.status).toBe(401);
    expect(called).toBe(false);
  });

  it('入力が正しくなければ 400', async () => {
    const res = await api(gateway()).plans(req('PUT', 'plan-documents', { ...key, companyId: 'not-a-uuid', expectedVersion: 1, userEdits: {} }));
    expect(res.status).toBe(400);
    const bad = await api(gateway()).identity(req('POST', 'project-identity', { companyId: CO }));
    expect(bad.status).toBe(400);
  });

  it('草案をクライアントから作る経路は無い（POST は 405）', async () => {
    const res = await api(gateway()).plans(req('POST', 'plan-documents', { ...key, aiDraft: { x: 1 }, userEdits: {}, adopted: true }));
    expect(res.status).toBe(405);
  });
});

describe('草案の読み込みと修正の保存', () => {
  it('読み込み：見つかれば 200 FOUND（履歴つき）、無ければ 200 NONE、他社は 403', async () => {
    const found = await api(gateway({ findPlan: async () => ok(rec(2)) })).plans(req('GET', 'plan-documents', undefined, SEARCH));
    expect(found.status).toBe(200);
    expect((await found.json()).status).toBe('FOUND');
    const none = await api(gateway()).plans(req('GET', 'plan-documents', undefined, SEARCH));
    expect((await none.json()).status).toBe('NONE');
    const denied = await api(gateway({ membershipRole: async () => ok(null) })).plans(req('GET', 'plan-documents', undefined, SEARCH));
    expect(denied.status).toBe(403);
  });

  it('修正の保存：200。版番号が違えば 409（最新の内容つき）。生成中は 409（NOT_READY）', async () => {
    const put = (version: number) => req('PUT', 'plan-documents', { ...key, expectedVersion: version, userEdits: { a: 'x' } });
    expect((await api(gateway()).plans(put(1))).status).toBe(200);
    const stale = await api(gateway({ updatePlan: async () => ok(null), findPlan: async () => ok(rec(3)) })).plans(put(1));
    expect(stale.status).toBe(409);
    expect((await stale.json()).status).toBe('CONFLICT');
    const generating = await api(gateway({ updatePlan: async () => ok(null), findPlan: async () => ok(rec(1, 'GENERATING')) })).plans(put(1));
    expect((await generating.json()).status).toBe('NOT_READY');
  });
});

describe('AI生成（POST …/generate）', () => {
  const gen = (g: PlanGateway, over: Partial<PlanApiDeps> = {}) =>
    api(g, over).generate(req('POST', 'plan-documents/generate', { ...key, projectId: 'fict-proj-renewal' }));

  it('生成が無効なら 503（既定では使わない）', async () => {
    const res = await gen(gateway(), { enabled: false });
    expect(res.status).toBe(503);
  });

  it('草案が既にあれば 200 EXISTS（AIを呼ばない）', async () => {
    let modelCalled = false;
    const res = await gen(gateway({ claimGeneration: async () => ok({ claimed: false as const, existing: rec(1) }) }), {
      generation: {
        currentYm: () => '2026-11',
        mapStrategy: (row) => row as never,
        modelFor: async () => {
          modelCalled = true;
          return async () => ({ text: '' });
        },
      },
    });
    expect(res.status).toBe(200);
    expect((await res.json()).status).toBe('EXISTS');
    expect(modelCalled).toBe(false);
  });

  it('生成中の別の操作があれば 409（IN_PROGRESS）', async () => {
    const res = await gen(gateway({ claimGeneration: async () => ok({ claimed: false as const, existing: rec(1, 'GENERATING') }) }));
    expect(res.status).toBe(409);
  });

  it('入力が正しくなければ 400', async () => {
    const res = await api(gateway()).generate(req('POST', 'plan-documents/generate', { companyId: CO }));
    expect(res.status).toBe(400);
  });
});

describe('採用・規制の記録・開始・取り消し（POST …/transition）', () => {
  it('入力が正しくなければ 400', async () => {
    const res = await api(gateway()).transition(req('POST', 'plan-documents/transition', { ...key, action: 'BOGUS', expectedVersion: 1 }));
    expect(res.status).toBe(400);
  });

  it('採用：草案が採用できれば 200、版番号が違えば 409', async () => {
    const adopt = (version: number) => req('POST', 'plan-documents/transition', { ...key, action: 'ADOPT', expectedVersion: version });
    const ok200 = await api(gateway({ findPlan: async () => ok(rec(1)) })).transition(adopt(1));
    expect(ok200.status).toBe(200);
    expect((await ok200.json()).record.version).toBe(2);
    const conflict = await api(gateway({ findPlan: async () => ok(rec(3)) })).transition(adopt(1));
    expect(conflict.status).toBe(409);
  });

  it('開始の条件が足りなければ 422（理由つき）', async () => {
    const res = await api(gateway({ findPlan: async () => ok(rec(1)) })).transition(
      req('POST', 'plan-documents/transition', { ...key, action: 'START', expectedVersion: 1 })
    );
    expect(res.status).toBe(422);
    expect((await res.json()).blockers.length).toBeGreaterThan(0);
  });

  it('規制・安全の記録が不完全なら 400', async () => {
    const res = await api(gateway({ findPlan: async () => ok(rec(1)) })).transition(
      req('POST', 'plan-documents/transition', { ...key, action: 'RECORD_REGULATORY', expectedVersion: 1, regulatory: { decision: 'NOT_APPLICABLE' } })
    );
    expect(res.status).toBe(400);
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
    const g = gateway({ readStrategyRow: async () => ok({ revision: 9, departments: [{ projects: [{ id: 'p-a', title: '案件' }] }] }) });
    const res = await api(g).identity(req('GET', 'project-identity', undefined, `?companyId=${CO}&strategyId=${ST}`));
    expect(res.status).toBe(200);
    const body2 = await res.json();
    expect(body2.revision).toBe(9);
    expect(body2.projects[0]).toEqual({ departmentIndex: 0, projectIndex: 0, title: '案件', projectId: 'p-a' });
  });
});

describe('無効な間（既定）は、認証・データベース・AIのいずれにも触れない', () => {
  const body = { companyId: CO, strategyId: ST, departmentIndex: 0, projectIndex: 1, expectedTitle: '案件', expectedRevision: 5, newId: NEW_ID };
  const cases: Array<[string, (a: ReturnType<typeof api>) => Promise<Response>]> = [
    ['草案の読み込み', (a) => a.plans(req('GET', 'plan-documents', undefined, SEARCH))],
    ['修正の保存', (a) => a.plans(req('PUT', 'plan-documents', { ...key, expectedVersion: 1, userEdits: { a: 'x' } }))],
    ['AI生成', (a) => a.generate(req('POST', 'plan-documents/generate', { ...key, projectId: 'fict-proj-renewal' }))],
    ['採用', (a) => a.transition(req('POST', 'plan-documents/transition', { ...key, action: 'ADOPT', expectedVersion: 1 }))],
    ['番号の読み取り', (a) => a.identity(req('GET', 'project-identity', undefined, `?companyId=${CO}&strategyId=${ST}`))],
    ['番号の付与', (a) => a.identity(req('POST', 'project-identity', body))],
  ];

  it.each(cases)('%s は 503 で、認証・データベース・AIを呼ばない', async (_name, call) => {
    let touched = 0;
    const a = api(gateway(), {
      enabled: false,
      verifyUser: async () => {
        touched++;
        return USER;
      },
      gatewayFor: () => {
        touched++;
        return gateway();
      },
      generation: {
        currentYm: () => '2026-11',
        mapStrategy: (row) => row as never,
        modelFor: async () => {
          touched++;
          return async () => ({ text: '' });
        },
      },
    });
    const res = await call(a);
    expect(res.status).toBe(503);
    expect((await res.json()).status).toBe('DISABLED');
    expect(touched).toBe(0);
  });
});

describe('保存テーブルが無い環境（本番の未導入）', () => {
  const unavailable = { storeAvailable: async () => false };

  it('読み込みは 503 UNAVAILABLE（理由つき）で、データベースの保存の表には触れない', async () => {
    let touched = 0;
    const g = gateway({ findPlan: async () => ((touched += 1), ok<PlanDocRecord | null>(null)) });
    const res = await api(g, unavailable).plans(req('GET', 'plan-documents', undefined, SEARCH));
    expect(res.status).toBe(503);
    const body = await res.json();
    expect(body.status).toBe('UNAVAILABLE');
    expect(body.message).toContain('導入されていません');
    expect(touched).toBe(0);
  });

  it('生成・採用・保存も 503 UNAVAILABLE で、草案を作る前に止まる', async () => {
    let touched = 0;
    const g = gateway({ claimGeneration: async () => ((touched += 1), ok({ claimed: true as const, record: rec(1, 'GENERATING') })) });
    const res = await api(g, unavailable).generate(req('POST', 'plan-documents/generate', { ...key, projectId: 'fict-proj-renewal' }));
    expect(res.status).toBe(503);
    expect((await res.json()).status).toBe('UNAVAILABLE');
    expect(touched).toBe(0);
  });

  it('保存テーブルがある環境では、従来どおり読み込める（確認の呼び出しだけが増える）', async () => {
    const res = await api(gateway(), { storeAvailable: async () => true }).plans(req('GET', 'plan-documents', undefined, SEARCH));
    expect(res.status).toBe(200);
    expect((await res.json()).status).toBe('NONE');
  });
});

describe('再生成のプレビュー（POST …/preview）', () => {
  const previewReq = () => req('POST', 'plan-documents/preview', { ...key, projectId: 'fict-proj-renewal' });
  const writes = () => {
    const calls = { n: 0 };
    const count = async () => {
      calls.n += 1;
      return ok(null as never);
    };
    return {
      calls,
      g: gateway({
        claimGeneration: count as never,
        completeGeneration: count as never,
        failGeneration: count as never,
        updatePlan: count as never,
      }),
    };
  };
  const mockModelFor = async (raw: never) => {
    const { createMockModel } = await import('./mockGenerate');
    const m = createMockModel(raw);
    return async (prompt: string) => m(prompt);
  };

  it('無効なら 503（既定では使わない）', async () => {
    const res = await api(gateway(), { enabled: false }).preview(previewReq());
    expect(res.status).toBe(503);
  });

  it('新しい案を 200 PREVIEW で返し、保存（権利・完了・失敗・更新）は一切しない', async () => {
    const w = writes();
    const res = await api(w.g, {
      generation: { currentYm: () => '2026-11', mapStrategy: (row) => row as never, modelFor: mockModelFor as never },
    }).preview(previewReq());
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.status).toBe('PREVIEW');
    expect(body.draft.generatedBy).toBe('SERVER');
    expect(w.calls.n).toBe(0);
  });

  it('入力が正しくなければ 400', async () => {
    const res = await api(gateway()).preview(req('POST', 'plan-documents/preview', { companyId: CO }));
    expect(res.status).toBe(400);
  });
});
