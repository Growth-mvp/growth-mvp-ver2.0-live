/* STAGE4の実行開始からSTAGE5の表示までを、実際の保存先クライアントと、実際のAPIの処理でつなぐ結合テスト。
 * 保存先は分離したメモリ上の記録（本番のDBには触れない）。通信だけを、APIの処理への直接の呼び出しに置き換える。 */
import { STAGE3_SNAPSHOT_STRATEGIES } from '@/lib/stage4/planView/fixtures/stage3Snapshot';
import { generateMockExecutionPlan } from '@/lib/stage4/plan/mockGenerate';
import { createPlanApi, type PlanApiDeps } from '@/lib/stage4/plan/planApi';
import { createRemotePlanOps, createRemotePlanStore } from '@/lib/stage4/plan/planClient';
import type { PlanDocKey, PlanDocRecord, PlanDocActor } from '@/lib/stage4/plan/planDocumentStore';
import type { GatewayResult, PlanGateway } from '@/lib/stage4/plan/planService';
import { loadStartedPlans } from './startedPlans';

const CO = '00000000-0000-4000-8000-00000000c0de';
const ST = '00000000-0000-4000-8000-0000000057a1';
const OTHER_CO = '00000000-0000-4000-8000-00000000c0df';
const RENEWAL = 'fict-proj-renewal';
const OTHER_PROJECT = 'fict-proj-referral-sales';
const USER = 'user-manager';
const NOW = '2026-11-10T00:00:00.000Z';
const ACTOR: PlanDocActor = { userId: USER, memberships: [{ companyId: CO, role: 'member' }] };
const KEY: PlanDocKey = { companyId: CO, strategyId: ST, projectId: RENEWAL };

const ok = <T,>(value: T): GatewayResult<T> => ({ ok: true, value });

type Bundle = Record<string, unknown>;
let withRegulatoryItems: Bundle = {};
let withoutRegulatoryItems: Bundle = {};
let formalStrategy: Record<string, unknown> = {};

beforeAll(async () => {
  formalStrategy = { ...JSON.parse(JSON.stringify(STAGE3_SNAPSHOT_STRATEGIES[0])), id: ST, company_id: CO, revision: 3 };
  const r = await generateMockExecutionPlan({
    strategy: JSON.parse(JSON.stringify(formalStrategy)) as never,
    membershipCompanyId: CO,
    requestedStrategyId: ST,
    requestedProjectId: RENEWAL,
    currentYm: '2026-11',
    companyName: '架空',
    createdAt: NOW,
  });
  if (r.status !== 'READY') throw new Error('mock draft must be ready');
  withRegulatoryItems = r.bundle;
  withoutRegulatoryItems = JSON.parse(
    JSON.stringify(r.bundle).replace(/規制|法令|薬機|医療機器|安全|認証|許認可|コンプライアンス/g, '運用')
  );
});

/* 保存先の記録（1件）と、正式な戦略データ。二つは別々に変えられる（STAGE3の確定KPIの変更を再現するため） */
function world(bundle: Bundle) {
  let record: PlanDocRecord = {
    key: KEY,
    version: 1,
    aiDraft: bundle,
    userEdits: {},
    adopted: false,
    updatedAt: NOW,
    updatedBy: USER,
    status: 'DRAFT',
    adoption: null,
    startInfo: null,
    regulatory: undefined,
  };
  let strategy: Record<string, unknown> = JSON.parse(JSON.stringify(formalStrategy));

  const gateway = {
    membershipRole: async (_userId: string, companyId: string) => ok(companyId === CO ? 'member' : null),
    findPlan: async (key: PlanDocKey) =>
      ok(key.companyId === record.key.companyId && key.strategyId === record.key.strategyId && key.projectId === record.key.projectId ? record : null),
    listEvents: async () => ok([]),
    readStrategyRow: async () => ok(strategy),
    updatePlan: async (_key: PlanDocKey, expectedVersion: number, patch: Record<string, unknown>) => {
      if (record.version !== expectedVersion) return ok(null);
      record = {
        ...record,
        version: record.version + 1,
        updatedBy: USER,
        aiDraft: patch.aiDraft !== undefined ? (patch.aiDraft as Record<string, unknown>) : record.aiDraft,
        userEdits: (patch.userEdits as PlanDocRecord['userEdits'] | undefined) ?? record.userEdits,
        adoption: patch.adoption !== undefined ? (patch.adoption as PlanDocRecord['adoption']) : record.adoption,
        startInfo: patch.startInfo !== undefined ? (patch.startInfo as PlanDocRecord['startInfo']) : record.startInfo,
        regulatory: patch.regulatory !== undefined ? (patch.regulatory as PlanDocRecord['regulatory']) : record.regulatory,
      };
      record.adopted = record.adoption != null;
      return ok(record);
    },
  } as unknown as PlanGateway;

  const deps: PlanApiDeps = {
    verifyUser: async () => USER,
    gatewayFor: () => gateway,
    enabled: true,
    generation: {
      currentYm: () => '2026-11',
      mapStrategy: (row) => row as never,
      modelFor: async () => async () => ({ text: 'not json' }),
    },
    now: () => NOW,
  };
  const api = createPlanApi(deps);

  /* ブラウザの通信を、APIの処理へ直接つなぐ（経路・認証の扱いは本番の保存先クライアントのまま） */
  const fetchFn = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input), 'http://api.test');
    const req = new Request(url.toString(), init);
    if (url.pathname === '/api/stage4/plan-documents' && (req.method === 'GET' || req.method === 'PUT')) return api.plans(req);
    if (url.pathname === '/api/stage4/plan-documents/transition') return api.transition(req);
    return new Response(JSON.stringify({ status: 'NOT_FOUND' }), { status: 404 });
  }) as typeof fetch;

  const options = { baseUrl: '', getToken: async () => 'token-of-user', fetchFn };
  return {
    store: () => createRemotePlanStore(options),
    ops: createRemotePlanOps(options),
    record: () => record,
    setFormalKpiTarget: (id: string, target: number) => {
      strategy = JSON.parse(JSON.stringify(strategy));
      for (const d of strategy.departments as Array<{ projects: Array<Record<string, unknown>> }>) {
        for (const p of d.projects) {
          if (p.id !== RENEWAL) continue;
          p.okrsV2 = (p.okrsV2 as Array<Record<string, unknown>>).map((k) => (k.id === id ? { ...k, target } : k));
        }
      }
    },
  };
}

const startItem = (projectId = RENEWAL) => ({
  key: { ...KEY, projectId },
  departmentName: '設計部',
  projectTitle: '既存顧客の保守契約更新',
});

describe('STAGE4 の実行開始 → STAGE5 の表示（保存・認証・状態遷移を含む経路）', () => {
  it('草案の保存 → 責任者 → 採用 → 対象外 → 開始 → STAGE5 で同じプロジェクトとKPIを表示 → 再読み込みでも残る', async () => {
    const w = world(withoutRegulatoryItems);
    const store = w.store();

    const saved = await store.update(ACTOR, KEY, 1, { userEdits: { 'action:1:title': '利用者が修正した実施事項' }, adopted: false });
    expect(saved.status).toBe('SAVED');
    const named = await store.update(ACTOR, KEY, 2, { userEdits: { 'action:1:title': '利用者が修正した実施事項', responsible: '佐藤（仮）' }, adopted: false });
    expect(named.status).toBe('SAVED');
    if (named.status !== 'SAVED') throw new Error('save');

    const adopted = await w.ops.transition(KEY, named.record.version, 'ADOPT');
    expect(adopted.status).toBe('OK');
    if (adopted.status !== 'OK') throw new Error('adopt');
    const recorded = await w.ops.transition(KEY, adopted.record.version, 'RECORD_REGULATORY', { decision: 'NOT_APPLICABLE' });
    expect(recorded.status).toBe('OK');
    if (recorded.status !== 'OK') throw new Error('record');
    const started = await w.ops.transition(KEY, recorded.record.version, 'START');
    expect(started.status).toBe('OK');
    if (started.status !== 'OK') throw new Error('start');
    expect(started.record.startInfo).not.toBeNull();

    const stage5 = await loadStartedPlans({ items: [startItem()], load: (key) => w.store().load(ACTOR, key) });
    expect(stage5.failed).toBe(0);
    expect(stage5.views).toHaveLength(1);
    const view = stage5.views[0];
    expect(view.key).toEqual(KEY);
    expect(view.projectTitle).toBe('既存顧客の保守契約更新');
    expect(view.responsible).toContain('佐藤');
    expect(view.startedVersion).toBe(started.record.startInfo!.version);
    expect(view.actions[0].title).toBe('利用者が修正した実施事項');
    expect(view.actions.every((a) => a.actionKey !== '')).toBe(true);

    const kpi = view.kpis.find((k) => k.label === '保守契約の継続率');
    expect(kpi).toBeDefined();
    expect(kpi!.target).toContain('95');
    expect(kpi!.due).toBe('2027年6月');
    expect(kpi!.confirmed).toBe(true);

    const reloaded = await loadStartedPlans({ items: [startItem()], load: (key) => w.store().load(ACTOR, key) });
    expect(reloaded.views[0].startedVersion).toBe(view.startedVersion);
    expect(reloaded.views[0].kpis).toEqual(view.kpis);
  });

  it('確認事項の無い案件は、責任者と保存済みの計画があれば、規制の記録なしに開始でき、STAGE5に表示される', async () => {
    const w = world(withoutRegulatoryItems);
    const saved = await w.store().update(ACTOR, KEY, 1, { userEdits: { responsible: '佐藤（仮）' }, adopted: false });
    if (saved.status !== 'SAVED') throw new Error('save');
    const adopted = await w.ops.transition(KEY, saved.record.version, 'ADOPT');
    if (adopted.status !== 'OK') throw new Error('adopt');
    const started = await w.ops.transition(KEY, adopted.record.version, 'START');
    expect(started.status).toBe('OK');
    const stage5 = await loadStartedPlans({ items: [startItem()], load: (key) => w.store().load(ACTOR, key) });
    expect(stage5.views).toHaveLength(1);
    expect(stage5.views[0].kpis.find((k) => k.label === '保守契約の継続率')?.target).toContain('95');
  });

  it('法令・安全の項目がある案件も、語では開始を妨げず、開始した計画はSTAGE5に表示される（規制の記録は作られない）', async () => {
    const w = world(withRegulatoryItems);
    const saved = await w.store().update(ACTOR, KEY, 1, { userEdits: { responsible: '佐藤（仮）' }, adopted: false });
    if (saved.status !== 'SAVED') throw new Error('save');
    const adopted = await w.ops.transition(KEY, saved.record.version, 'ADOPT');
    if (adopted.status !== 'OK') throw new Error('adopt');
    const started = await w.ops.transition(KEY, adopted.record.version, 'START');
    expect(started.status).toBe('OK');
    expect(w.record().regulatory).toBeUndefined();
    const stage5 = await loadStartedPlans({ items: [startItem()], load: (key) => w.store().load(ACTOR, key) });
    expect(stage5.views).toHaveLength(1);
    expect(stage5.views[0].responsible).toContain('佐藤');
  });

  it('明示的に「未確認」と記録された案件も開始でき、記録は確認済みに変えず、STAGE5に表示される', async () => {
    const w = world(withRegulatoryItems);
    const saved = await w.store().update(ACTOR, KEY, 1, { userEdits: { responsible: '佐藤（仮）' }, adopted: false });
    if (saved.status !== 'SAVED') throw new Error('save');
    const adopted = await w.ops.transition(KEY, saved.record.version, 'ADOPT');
    if (adopted.status !== 'OK') throw new Error('adopt');
    const held = await w.ops.transition(KEY, adopted.record.version, 'RECORD_REGULATORY', { decision: 'UNCONFIRMED' });
    if (held.status !== 'OK') throw new Error('record');
    const started = await w.ops.transition(KEY, held.record.version, 'START');
    expect(started.status).toBe('OK');
    expect(w.record().regulatory).toMatchObject({ decision: 'UNCONFIRMED' });
    expect((await loadStartedPlans({ items: [startItem()], load: (key) => w.store().load(ACTOR, key) })).views).toHaveLength(1);
  });

  it('正式なKPIが変わった計画も開始でき、STAGE5には最新のKPIの目標値が出る', async () => {
    const w = world(withoutRegulatoryItems);
    const saved = await w.store().update(ACTOR, KEY, 1, { userEdits: { responsible: '佐藤（仮）' }, adopted: false });
    if (saved.status !== 'SAVED') throw new Error('save');
    const adopted = await w.ops.transition(KEY, saved.record.version, 'ADOPT');
    if (adopted.status !== 'OK') throw new Error('adopt');
    const recorded = await w.ops.transition(KEY, adopted.record.version, 'RECORD_REGULATORY', { decision: 'NOT_APPLICABLE' });
    if (recorded.status !== 'OK') throw new Error('record');

    w.setFormalKpiTarget('kr-renew-1', 120);
    const started = await w.ops.transition(KEY, recorded.record.version, 'START');
    expect(started.status).toBe('OK');
    const views = (await loadStartedPlans({ items: [startItem()], load: (key) => w.store().load(ACTOR, key) })).views;
    expect(views).toHaveLength(1);
    expect(views[0].kpis.find((k) => k.label === '保守契約の継続率')?.target).toContain('120');
  });

  it('別のプロジェクトや別の会社の計画は、STAGE5に混ざらない', async () => {
    const w = world(withoutRegulatoryItems);
    const saved = await w.store().update(ACTOR, KEY, 1, { userEdits: { responsible: '佐藤（仮）' }, adopted: false });
    if (saved.status !== 'SAVED') throw new Error('save');
    const adopted = await w.ops.transition(KEY, saved.record.version, 'ADOPT');
    if (adopted.status !== 'OK') throw new Error('adopt');
    const recorded = await w.ops.transition(KEY, adopted.record.version, 'RECORD_REGULATORY', { decision: 'NOT_APPLICABLE' });
    if (recorded.status !== 'OK') throw new Error('record');
    const started = await w.ops.transition(KEY, recorded.record.version, 'START');
    expect(started.status).toBe('OK');

    const otherProject = await loadStartedPlans({ items: [startItem(OTHER_PROJECT)], load: (key) => w.store().load(ACTOR, key) });
    expect(otherProject.views).toHaveLength(0);

    const otherCompanyKey = { ...KEY, companyId: OTHER_CO };
    const otherCompany = await loadStartedPlans({
      items: [{ ...startItem(), key: otherCompanyKey }],
      load: (key) => w.store().load(ACTOR, key),
    });
    expect(otherCompany.views).toHaveLength(0);
  });
});
