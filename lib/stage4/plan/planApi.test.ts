import { EMPTY_REGULATORY } from '../planView/model';
import { applyDraftReplacement, applyStoredPatch } from './dbGuard';
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
  key: { companyId: CO, strategyId: ST, projectId: 'fict-proj-renewal' },
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
  previewSecret: 'test-secret-for-api',
  ...over,
});
const api = (g: PlanGateway, over: Partial<PlanApiDeps> = {}) => createPlanApi(deps(g, over));

const req = (method: string, path: string, body?: unknown, search = '') =>
  new Request(`http://api.test/api/stage4/${path}${search}`, {
    method,
    headers: { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });

const key = { companyId: CO, strategyId: ST, projectId: 'fict-proj-renewal' };
const SEARCH = `?companyId=${CO}&strategyId=${ST}&projectId=fict-proj-renewal`;

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

  it('署名の秘密の値が無ければ、案を作らず 503（AIを呼ばない）', async () => {
    let modelCalled = false;
    const res = await api(gateway(), {
      previewSecret: null,
      generation: {
        currentYm: () => '2026-11',
        mapStrategy: (row) => row as never,
        modelFor: async () => {
          modelCalled = true;
          return async () => ({ text: '' });
        },
      },
    }).preview(previewReq());
    expect(res.status).toBe(503);
    expect(modelCalled).toBe(false);
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
    expect(typeof body.previewToken).toBe('string');
    expect(w.calls.n).toBe(0);
  });

  it('入力が正しくなければ 400', async () => {
    const res = await api(gateway()).preview(req('POST', 'plan-documents/preview', { companyId: CO }));
    expect(res.status).toBe(400);
  });
});

describe('採用・開始は、計画書の参照KPIを最新の正式KPIに合わせ、止めない（API経路）', () => {
  const PROJ = 'fict-proj-renewal';
  const k = { companyId: CO, strategyId: ST, projectId: PROJ };
  const recP = (version: number, over: Partial<PlanDocRecord> = {}): PlanDocRecord => ({ ...rec(version), key: k, ...over });
  const adopt = (version: number) => req('POST', 'plan-documents/transition', { ...k, action: 'ADOPT', expectedVersion: version });
  const start = (version: number) => req('POST', 'plan-documents/transition', { ...k, action: 'START', expectedVersion: version });

  /* 計画書の作成後に、正式データのKPIが変わった戦略（STAGE3で変更された状態を再現する） */
  function strategyWhere(edit: (list: Array<Record<string, unknown>>) => Array<Record<string, unknown>>) {
    const row = strategyRow();
    for (const d of row.departments as Array<{ projects: Array<Record<string, unknown>> }>) {
      for (const project of d.projects) {
        if (project.id === PROJ) project.okrsV2 = edit(project.okrsV2 as Array<Record<string, unknown>>);
      }
    }
    return row;
  }
  const patchKpi = (id: string, patch: Record<string, unknown>) => (list: Array<Record<string, unknown>>) =>
    list.map((x) => (x.id === id ? { ...x, ...patch } : x));

  /* 保存の窓口（本番の規則と同じく、草案は書き換えない）。何を書こうとしたかだけを記録する */
  const sinkOf = () => {
    const sink: { patch?: Record<string, unknown> } = {};
    const update = async (_key: unknown, _v: number, patch: Record<string, unknown>) => {
      sink.patch = patch;
      return ok(recP(2));
    };
    return { sink, update };
  };
  const shownKpis = async (res: Response) =>
    ((await res.json()).record.aiDraft as { plan: { section3: { protectedKpis: Array<Record<string, unknown>> } } }).plan.section3.protectedKpis;

  it('KPIが変わっていなければ、採用できる（従来どおり 200）', async () => {
    const res = await api(gateway({ findPlan: async () => ok(recP(1)) })).transition(adopt(1));
    expect(res.status).toBe(200);
  });

  it('目標値が変わった計画も採用でき、表示は最新の目標値になり、保存する草案は書き換えない', async () => {
    const { sink, update } = sinkOf();
    const g = gateway({
      findPlan: async () => ok(recP(1)),
      readStrategyRow: async () => ok(strategyWhere(patchKpi('kr-renew-1', { target: 120 }))),
      updatePlan: update,
    });
    const res = await api(g).transition(adopt(1));
    expect(res.status).toBe(200);
    expect(sink.patch?.aiDraft).toBeUndefined();
    expect((await shownKpis(await api(g).transition(adopt(1)))).find((x) => x.stage3KpiId === 'kr-renew-1')?.target).toBe(120);
  });

  it.each([
    ['単位', { unit: '件' }, 'unit', '件'],
    ['期限', { due: '2027-12' }, 'due', '2027-12'],
    ['担当', { owner: '別の担当（仮）' }, 'owner', '別の担当（仮）'],
    ['名称', { label: '保守契約の更新件数' }, 'label', '保守契約の更新件数'],
  ])('%sが変わった計画も採用でき、表示に最新の値が入る（200）', async (_name, patch, field, value) => {
    const { update } = sinkOf();
    const g = gateway({
      findPlan: async () => ok(recP(1)),
      readStrategyRow: async () => ok(strategyWhere(patchKpi('kr-renew-1', patch))),
      updatePlan: update,
    });
    const res = await api(g).transition(adopt(1));
    expect(res.status).toBe(200);
    expect((await shownKpis(res)).find((x) => x.stage3KpiId === 'kr-renew-1')?.[field]).toBe(value);
  });

  it('KPIが正式データから消えても止めず、旧い目標値は出さず、名称に注記する（200）', async () => {
    const { update } = sinkOf();
    const g = gateway({
      findPlan: async () => ok(recP(1)),
      readStrategyRow: async () => ok(strategyWhere((list) => list.filter((x) => x.id !== 'kr-renew-1'))),
      updatePlan: update,
    });
    const res = await api(g).transition(adopt(1));
    expect(res.status).toBe(200);
    const gone = (await shownKpis(res)).find((x) => x.stage3KpiId === 'kr-renew-1');
    expect(gone).toMatchObject({ target: null, confirmation: 'UNCONFIRMED' });
    expect(String(gone?.label)).toContain('正式データにありません');
  });

  it('KPIが計画書の作成後に追加されても止めず、表示の保護一覧に最新の確定KPIが加わる（200）', async () => {
    const { update } = sinkOf();
    const added = strategyWhere((list) => [
      ...list,
      { id: 'kr-renew-4', label: '新しく確定した指標', target: 10, unit: '%', due: '2027-08', owner: null, targetBasis: 'USER_CONFIRMED' },
    ]);
    const g = gateway({ findPlan: async () => ok(recP(1)), readStrategyRow: async () => ok(added), updatePlan: update });
    const res = await api(g).transition(adopt(1));
    expect(res.status).toBe(200);
    expect((await shownKpis(res)).map((x) => x.stage3KpiId)).toContain('kr-renew-4');
  });

  it('目標値が未入力のKPIは、0にせず未設定のまま（200）', async () => {
    const { update } = sinkOf();
    const g = gateway({
      findPlan: async () => ok(recP(1)),
      readStrategyRow: async () => ok(strategyWhere(patchKpi('kr-renew-2', { target: null }))),
      updatePlan: update,
    });
    const res = await api(g).transition(adopt(1));
    expect(res.status).toBe(200);
    expect((await shownKpis(res)).find((x) => x.stage3KpiId === 'kr-renew-2')?.target).toBeNull();
  });

  it('AIが仮に置いたKPI（確定ではない）が変わっても、確定の保護一覧には入れない（200）', async () => {
    const { update } = sinkOf();
    const g = gateway({
      findPlan: async () => ok(recP(1)),
      readStrategyRow: async () => ok(strategyWhere(patchKpi('kr-renew-3', { target: 4 }))),
      updatePlan: update,
    });
    const res = await api(g).transition(adopt(1));
    expect(res.status).toBe(200);
    expect((await shownKpis(res)).find((x) => x.stage3KpiId === 'kr-renew-3')).toBeUndefined();
  });

  it('対象プロジェクトが正式データに無ければ、採用せず、計画書も書き換えない（422）', async () => {
    let written = false;
    const g = gateway({
      findPlan: async () => ok(recP(1)),
      readStrategyRow: async () => {
        const row = strategyRow();
        for (const d of row.departments as Array<{ projects: Array<Record<string, unknown>> }>) {
          d.projects = d.projects.filter((p) => p.id !== PROJ);
        }
        return ok(row);
      },
      updatePlan: async () => {
        written = true;
        return ok(recP(2));
      },
    });
    const res = await api(g).transition(adopt(1));
    expect(res.status).toBe(422);
    expect((await res.json()).blockers.join('\n')).toContain('対象プロジェクト');
    expect(written).toBe(false);
  });

  it('採用後にKPIが変わった計画も、開始できる（200）。開始の記録だけを書き、草案は書き換えない', async () => {
    const { sink, update } = sinkOf();
    const adoptedRec = recP(2, { adoption: { version: 1, byUserId: USER, at: '2026-11-09T00:00:00.000Z', edits: { responsible: '佐藤（仮）' } }, userEdits: { responsible: '佐藤（仮）' } });
    const g = gateway({
      findPlan: async () => ok(adoptedRec),
      readStrategyRow: async () => ok(strategyWhere(patchKpi('kr-renew-1', { target: 120 }))),
      updatePlan: update,
    });
    const res = await api(g).transition(start(2));
    expect(res.status).toBe(200);
    expect(sink.patch?.startInfo).toBeDefined();
    expect(sink.patch?.aiDraft).toBeUndefined();
  });

  it('正式データを読めなければ、採用せず、計画書も書き換えない（500）', async () => {
    let written = false;
    const g = gateway({
      findPlan: async () => ok(recP(1)),
      readStrategyRow: async () => ({ ok: false, code: 'ERROR' }),
      updatePlan: async () => {
        written = true;
        return ok(recP(2));
      },
    });
    const res = await api(g).transition(adopt(1));
    expect(res.status).toBe(500);
    expect(written).toBe(false);
  });
});

describe('実行開始の一連の操作（保存された草案から、API経路で採用・規制の記録・開始）', () => {
  const PROJ = 'fict-proj-renewal';
  const k = { companyId: CO, strategyId: ST, projectId: PROJ };
  const call = (action: string, version: number, extra: Record<string, unknown> = {}) =>
    req('POST', 'plan-documents/transition', { ...k, action, expectedVersion: version, ...extra });

  /* 規制・安全に関わる言葉を外した計画書（規制の項目が無い案件を再現する） */
  const bundleWithoutRegulatoryItems = (): Record<string, unknown> =>
    JSON.parse(JSON.stringify(bundle).replace(/規制|法令|薬機|医療機器|安全|認証|許認可|コンプライアンス/g, '運用'));

  /* 状態を保持する保存先（採用・規制・開始・草案の差し替えの結果が次の操作に引き継がれる） */
  function statefulGateway(initial: PlanDocRecord) {
    let current = initial;
    const g = gateway({
      findPlan: async () => ok(current),
      updatePlan: async (_key, expected, patch) => {
        if (current.version !== expected) return ok(null);
        const stored = applyStoredPatch(current, patch, USER);
        if (!stored.ok) return { ok: false, code: 'FORBIDDEN' } as never;
        current = stored.record;
        return ok(current);
      },
    });
    return { g, state: () => current };
  }
  const saved = (aiDraft: Record<string, unknown>, version = 1): PlanDocRecord => ({
    ...rec(version),
    key: k,
    aiDraft,
    userEdits: { responsible: '佐藤（仮）' },
  });

  it('規制・安全の項目が無い案件は、対象外を選んで、採用・開始まで進める（判断内容は不要）', async () => {
    const store = statefulGateway(saved(bundleWithoutRegulatoryItems()));
    const a = api(store.g);
    const adopt = await a.transition(call('ADOPT', 1));
    expect(adopt.status).toBe(200);
    const record = await a.transition(call('RECORD_REGULATORY', 2, { regulatory: { decision: 'NOT_APPLICABLE' } }));
    expect(record.status).toBe(200);
    expect(store.state().regulatory).toMatchObject({ decision: 'NOT_APPLICABLE', confirmedOn: '2026-11-10' });
    const start = await a.transition(call('START', 3));
    expect(start.status).toBe(200);
    expect(store.state().startInfo).not.toBeNull();
    expect(store.state().adoption).not.toBeNull();
  });

  it('規制・安全の項目がある案件も、語では開始を妨げない（記録が無くても開始でき、規制の記録は作られない）', async () => {
    const store = statefulGateway(saved(bundle));
    const a = api(store.g);
    expect((await a.transition(call('ADOPT', 1))).status).toBe(200);
    expect((await a.transition(call('START', 2))).status).toBe(200);
    expect(store.state().startInfo).not.toBeNull();
    expect(store.state().regulatory).toEqual(EMPTY_REGULATORY);
  });

  it('規制の記録の入力の検査は従来どおり（対象外だけでは、項目がある案件は記録できない）', async () => {
    const store = statefulGateway(saved(bundle));
    const a = api(store.g);
    await a.transition(call('ADOPT', 1));
    const onlyNa = await a.transition(call('RECORD_REGULATORY', 2, { regulatory: { decision: 'NOT_APPLICABLE' } }));
    expect(onlyNa.status).toBe(400);
  });

  it('「未確認」の記録は開始を止めず、記録も確認済みに変えない', async () => {
    const store = statefulGateway(saved(bundle));
    const a = api(store.g);
    expect((await a.transition(call('ADOPT', 1))).status).toBe(200);
    expect((await a.transition(call('RECORD_REGULATORY', 2, { regulatory: { decision: 'UNCONFIRMED' } }))).status).toBe(200);
    expect((await a.transition(call('START', 3))).status).toBe(200);
    expect(store.state().startInfo).not.toBeNull();
    expect(store.state().regulatory).toMatchObject({ decision: 'UNCONFIRMED' });
  });

  it('確認事項の無い案件は、規制の記録が無くても、採用から開始まで進める', async () => {
    const store = statefulGateway(saved(bundleWithoutRegulatoryItems()));
    const a = api(store.g);
    expect((await a.transition(call('ADOPT', 1))).status).toBe(200);
    expect((await a.transition(call('START', 2))).status).toBe(200);
    expect(store.state().startInfo).not.toBeNull();
    expect(store.state().regulatory).toEqual(EMPTY_REGULATORY);
  });

  it('採用せずに開始しても、開始の処理の中で採用されてから開始する', async () => {
    const store = statefulGateway(saved(bundleWithoutRegulatoryItems()));
    expect((await api(store.g).transition(call('START', 1))).status).toBe(200);
    expect(store.state().adoption).not.toBeNull();
    expect(store.state().startInfo).not.toBeNull();
  });

  it('実行責任者が無ければ、開始は止まる（理由つき）', async () => {
    const store = statefulGateway({ ...saved(bundleWithoutRegulatoryItems()), userEdits: {} });
    const res = await api(store.g).transition(call('START', 1));
    expect(res.status).toBe(422);
    expect((await res.json()).blockers.join('\n')).toContain('実行責任者');
    expect(store.state().startInfo).toBeNull();
  });
});

describe('再生成の案：プレビューの署名と「この案を使う」（POST …/use-draft）', () => {
  const PROJ = 'fict-proj-renewal';
  const k = { companyId: CO, strategyId: ST, projectId: PROJ };
  const previewReq = () => req('POST', 'plan-documents/preview', { ...k });
  const generation = {
    currentYm: () => '2026-11',
    mapStrategy: (row: Record<string, unknown>) => row as never,
    modelFor: (async (raw: never) => {
      const { createMockModel } = await import('./mockGenerate');
      const m = createMockModel(raw);
      return async (prompt: string) => m(prompt);
    }) as never,
  };

  function holder(initial: PlanDocRecord) {
    let current = initial;
    const g = gateway({
      findPlan: async () => ok(current),
      updatePlan: async (_key, expected, patch) => {
        if (current.version !== expected) return ok(null);
        const stored = applyStoredPatch(current, patch, USER);
        if (!stored.ok) return { ok: false, code: 'FORBIDDEN' } as never;
        current = stored.record;
        return ok(current);
      },
      replaceDraft: async (_key, expected, args) => {
        const out = applyDraftReplacement(current, { expectedVersion: expected, aiDraft: args.aiDraft, userEdits: args.userEdits }, USER);
        if (out.status !== 'REPLACED') return ok({ status: out.status });
        current = out.record;
        return ok({ status: 'REPLACED' as const, record: out.record });
      },
    });
    return { g, state: () => current };
  }
  const base = (): PlanDocRecord => ({ ...rec(1), key: k, aiDraft: bundle, userEdits: { responsible: '佐藤（仮）', 'action:1:title': '利用者の修正' } });

  it('「この案を使う」は、署名された新しい案で原案を差し替え、版を1つ進める（200 OK）', async () => {
    const h = holder(base());
    const previewed = await api(h.g, { generation }).preview(previewReq());
    expect(previewed.status).toBe(200);
    const body = await previewed.json();
    const used = await api(h.g, { generation }).useDraft(
      req('POST', 'plan-documents/use-draft', { ...k, expectedVersion: 1, draft: body.draft, previewToken: body.previewToken })
    );
    expect(used.status).toBe(200);
    expect((await used.json()).status).toBe('OK');
    expect(h.state().aiDraft).toEqual(body.draft);
    expect(h.state().version).toBe(2);
    expect(h.state().userEdits.responsible).toBe('佐藤（仮）');
  });

  it('案の内容を書き換えた場合や、別の署名の場合は使えない（409 PREVIEW_EXPIRED・計画書は変わらない）', async () => {
    const h = holder(base());
    const body = await (await api(h.g, { generation }).preview(previewReq())).json();
    const tampered = { ...body.draft, plan: { ...body.draft.plan, section1: { purpose: '差し替えた内容' } } };
    const res = await api(h.g, { generation }).useDraft(
      req('POST', 'plan-documents/use-draft', { ...k, expectedVersion: 1, draft: tampered, previewToken: body.previewToken })
    );
    expect(res.status).toBe(409);
    expect((await res.json()).status).toBe('PREVIEW_EXPIRED');
    expect(h.state().aiDraft).toBe(bundle);
  });

  it('開始済みの計画は差し替えられない（409 NOT_READY）', async () => {
    const h = holder({
      ...base(),
      adoption: { version: 1, byUserId: USER, at: '2026-11-09T00:00:00.000Z', edits: {} },
      adopted: true,
      startInfo: { version: 1, byUserId: USER, at: '2026-11-09T00:00:00.000Z' },
    });
    const body = await (await api(h.g, { generation }).preview(previewReq())).json();
    const res = await api(h.g, { generation }).useDraft(
      req('POST', 'plan-documents/use-draft', { ...k, expectedVersion: 1, draft: body.draft, previewToken: body.previewToken })
    );
    expect(res.status).toBe(409);
    expect((await res.json()).status).toBe('NOT_READY');
  });

  it('秘密の値が無い環境では、差し替えも 503（保存しない）', async () => {
    const h = holder(base());
    const res = await api(h.g, { previewSecret: null }).useDraft(
      req('POST', 'plan-documents/use-draft', { ...k, expectedVersion: 1, draft: bundle, previewToken: 'x.y' })
    );
    expect(res.status).toBe(503);
    expect(h.state().aiDraft).toBe(bundle);
  });
});
