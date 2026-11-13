/* STAGE4の一連の操作を、クライアント（保存先・操作の窓口）から、API、保存の規則、再読み込み、STAGE5 まで通す結合テスト。
 * 保存先はメモリ上で、本番の保存の規則（applyStoredPatch）と同じに働く。本番のDB・実AIには触れない。 */
import { STAGE3_SNAPSHOT_STRATEGIES } from '@/lib/stage4/planView/fixtures/stage3Snapshot';
import { loadStartedPlans } from '@/lib/stage5/startedPlans';
import { applyDraftReplacement, applyStoredPatch } from './dbGuard';
import { createMockModel } from './mockGenerate';
import { createPlanApi, type PlanApiDeps } from './planApi';
import { createRemotePlanOps, createRemotePlanStore } from './planClient';
import type { PlanDocActor, PlanDocKey, PlanDocRecord } from './planDocumentStore';
import type { GatewayResult, PlanGateway } from './planService';

const CO = '00000000-0000-4000-8000-00000000c0de';
const ST = '00000000-0000-4000-8000-0000000057a1';
const RENEWAL = 'fict-proj-renewal';
const USER = 'user-manager';
const NOW = '2026-11-10T00:00:00.000Z';
const ACTOR: PlanDocActor = { userId: USER, memberships: [{ companyId: CO, role: 'member' }] };
const KEY: PlanDocKey = { companyId: CO, strategyId: ST, projectId: RENEWAL };

const ok = <T,>(value: T): GatewayResult<T> => ({ ok: true, value });

function formalStrategy(): Record<string, unknown> {
  return { ...JSON.parse(JSON.stringify(STAGE3_SNAPSHOT_STRATEGIES[0])), id: ST, company_id: CO, revision: 3 };
}

function world() {
  let record: PlanDocRecord | null = null;
  let strategy = formalStrategy();

  const gateway = {
    membershipRole: async (_u: string, companyId: string) => ok(companyId === CO ? 'member' : null),
    findPlan: async () => ok(record),
    listEvents: async () => ok([]),
    readStrategyRow: async () => ok(strategy),
    claimGeneration: async (key: PlanDocKey) => {
      if (record) return ok({ claimed: false as const, existing: record });
      record = {
        key,
        version: 1,
        aiDraft: {},
        userEdits: {},
        adopted: false,
        updatedAt: NOW,
        updatedBy: USER,
        status: 'GENERATING',
        adoption: null,
        startInfo: null,
        regulatory: undefined,
      } as PlanDocRecord;
      return ok({ claimed: true as const, record });
    },
    completeGeneration: async (_key: PlanDocKey, _u: string, aiDraft: Record<string, unknown>) => {
      if (!record || record.status !== 'GENERATING') return ok(null);
      record = { ...record, aiDraft, status: 'DRAFT', updatedBy: USER };
      return ok(record);
    },
    failGeneration: async () => {
      if (record) record = { ...record, status: 'GENERATION_FAILED' };
      return ok(record);
    },
    updatePlan: async (_key: PlanDocKey, expectedVersion: number, patch: Parameters<typeof applyStoredPatch>[1]) => {
      if (!record || record.version !== expectedVersion) return ok(null);
      const stored = applyStoredPatch(record, patch, USER);
      if (!stored.ok) return { ok: false, code: 'FORBIDDEN' as const };
      record = stored.record;
      return ok(record);
    },
    replaceDraft: async (_key: PlanDocKey, expectedVersion: number, args: { aiDraft: Record<string, unknown>; userEdits: Record<string, unknown> }) => {
      if (!record) return ok({ status: 'NOT_FOUND' as const });
      const out = applyDraftReplacement(record, { expectedVersion, aiDraft: args.aiDraft, userEdits: args.userEdits }, USER);
      if (out.status !== 'REPLACED') return ok({ status: out.status });
      record = out.record;
      return ok({ status: 'REPLACED' as const, record });
    },
  } as unknown as PlanGateway;

  const deps: PlanApiDeps = {
    verifyUser: async () => USER,
    gatewayFor: () => gateway,
    enabled: true,
    previewSecret: 'flow-test-secret',
    generation: {
      currentYm: () => '2026-11',
      mapStrategy: (row) => row as never,
      modelFor: async (raw) => {
        const mock = createMockModel(raw as never);
        return async (prompt) => mock(prompt);
      },
    },
    now: () => NOW,
  };
  const api = createPlanApi(deps);

  /* ブラウザの通信を、APIの入口へ直接つなぐ（経路・認証の扱いは本番の窓口のまま） */
  const fetchFn = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input), 'http://api.test');
    const req = new Request(url.toString(), init);
    const path = url.pathname;
    if (path === '/api/stage4/plan-documents' && (req.method === 'GET' || req.method === 'PUT')) return api.plans(req);
    if (path === '/api/stage4/plan-documents/generate') return api.generate(req);
    if (path === '/api/stage4/plan-documents/preview') return api.preview(req);
    if (path === '/api/stage4/plan-documents/use-draft') return api.useDraft(req);
    if (path === '/api/stage4/plan-documents/transition') return api.transition(req);
    return new Response(JSON.stringify({ status: 'NOT_FOUND' }), { status: 404 });
  }) as typeof fetch;

  const options = { baseUrl: '', getToken: async () => 'token-of-user', fetchFn };
  return {
    store: createRemotePlanStore(options),
    ops: createRemotePlanOps(options),
    record: () => record,
    /* STAGE3で、計画書の作成後に正式KPIの目標値が変わった状態を再現する */
    setFormalKpiTarget(id: string, target: number | null) {
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

const startItem = () => ({ key: KEY, departmentName: '設計部', projectTitle: '既存顧客の保守契約更新' });

describe('STAGE4 の一連の操作（生成 → 保存 → 再読み込み → 草案の差し替え → 責任者 → 採用 → 開始 → STAGE5）', () => {
  it('生成から開始まで、各段階の応答・保存・再読み込みで確かめる', async () => {
    const w = world();

    /* 1. AIで計画書を生成する */
    const generated = await w.ops.generate(KEY);
    expect(generated.status).toBe('CREATED');
    const loaded = await w.store.load(ACTOR, KEY);
    expect(loaded.status).toBe('FOUND');
    if (loaded.status !== 'FOUND') throw new Error('load');
    expect(loaded.record).toMatchObject({ version: 1, status: 'DRAFT', adopted: false });
    const originalDraft = JSON.stringify(loaded.record.aiDraft);

    /* 2. 計画書を編集して保存する（版番号が進み、再読み込みでも残る） */
    const edited = await w.store.update(ACTOR, KEY, 1, { userEdits: { 'action:1:title': '利用者が直した実施事項' }, adopted: false });
    expect(edited.status).toBe('SAVED');
    if (edited.status !== 'SAVED') throw new Error('save');
    expect(edited.record.version).toBe(2);
    const reloaded = await w.store.load(ACTOR, KEY);
    expect(reloaded.status === 'FOUND' && reloaded.record.userEdits).toEqual({ 'action:1:title': '利用者が直した実施事項' });

    /* 3. 保存競合：古い版番号での保存は、保存されず、最新を返す */
    const stale = await w.store.update(ACTOR, KEY, 1, { userEdits: { 'action:1:title': '古い版からの修正' }, adopted: false });
    expect(stale.status).toBe('CONFLICT');
    expect(w.record()?.userEdits).toEqual({ 'action:1:title': '利用者が直した実施事項' });

    /* 4. 再生成の案を見て、「この案を使う」で原案を差し替える。版は1つ進み、同じ項目の修正は残る */
    const preview = await w.ops.preview(KEY);
    expect(preview.status).toBe('PREVIEW');
    if (preview.status !== 'PREVIEW') throw new Error('preview');
    const useResult = await w.ops.useDraft(KEY, 2, preview.draft, preview.previewToken);
    expect(useResult.status).toBe('OK');
    expect(JSON.stringify(w.record()?.aiDraft)).toBe(JSON.stringify(preview.draft));
    expect(JSON.stringify(w.record()?.aiDraft)).not.toBe(originalDraft);
    expect(w.record()?.version).toBe(3);
    expect(w.record()?.userEdits).toEqual({ 'action:1:title': '利用者が直した実施事項' });

    /* 5. 実行責任者を設定して保存し、採用する */
    const named = await w.store.update(ACTOR, KEY, 3, {
      userEdits: { 'action:1:title': '利用者が直した実施事項', responsible: '佐藤（仮）' },
      adopted: false,
    });
    expect(named.status).toBe('SAVED');
    if (named.status !== 'SAVED') throw new Error('named');
    const adopted = await w.ops.transition(KEY, named.record.version, 'ADOPT');
    expect(adopted.status).toBe('OK');
    if (adopted.status !== 'OK') throw new Error('adopt');

    /* 6. 計画作成後に正式KPIが変わっても、開始は止まらず、表示は最新の目標値になる（草案は書き換えない） */
    w.setFormalKpiTarget('kr-renew-1', 120);
    const started = await w.ops.transition(KEY, adopted.record.version, 'START');
    expect(started.status).toBe('OK');
    if (started.status !== 'OK') throw new Error('start');
    expect(started.record.startInfo).not.toBeNull();
    const shown = (started.record.aiDraft as { plan: { section3: { protectedKpis: Array<{ stage3KpiId: string; target: unknown }> } } }).plan.section3.protectedKpis;
    expect(shown.find((k) => k.stage3KpiId === 'kr-renew-1')?.target).toBe(120);
    expect(JSON.stringify(w.record()?.aiDraft)).toBe(JSON.stringify(preview.draft));

    /* 7. STAGE5で、開始した計画を、同じプロジェクトと最新のKPIで確認できる */
    const stage5 = await loadStartedPlans({ items: [startItem()], load: (key) => w.store.load(ACTOR, key) });
    expect(stage5.failed).toBe(0);
    expect(stage5.views).toHaveLength(1);
    expect(stage5.views[0].responsible).toContain('佐藤');
    expect(stage5.views[0].kpis.find((k) => k.label === '保守契約の継続率')?.target).toContain('120');
  });

  it('開始の前に実行責任者が無ければ、開始は止まり、理由が返る（保存の記録は変わらない）', async () => {
    const w = world();
    await w.ops.generate(KEY);
    const adopted = await w.ops.transition(KEY, 1, 'ADOPT');
    expect(adopted.status).toBe('OK');
    if (adopted.status !== 'OK') throw new Error('adopt');
    const blocked = await w.ops.transition(KEY, adopted.record.version, 'START');
    expect(blocked.status).toBe('BLOCKED');
    if (blocked.status !== 'BLOCKED') throw new Error('blocked');
    expect(blocked.blockers.join('\n')).toContain('実行責任者');
    expect(w.record()?.startInfo).toBeNull();
  });

  it('採用せずに、責任者を入れて開始すると、開始の処理の中で採用されてから開始される', async () => {
    const w = world();
    await w.ops.generate(KEY);
    const named = await w.store.update(ACTOR, KEY, 1, { userEdits: { responsible: '佐藤（仮）' }, adopted: false });
    if (named.status !== 'SAVED') throw new Error('named');
    const started = await w.ops.transition(KEY, named.record.version, 'START');
    expect(started.status).toBe('OK');
    expect(w.record()?.adoption).not.toBeNull();
    expect(w.record()?.startInfo).not.toBeNull();
  });
});
