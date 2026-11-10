import { STAGE3_SNAPSHOT_STRATEGIES } from '@/lib/stage4/planView/fixtures/stage3Snapshot';
import { generateMockExecutionPlan } from '@/lib/stage4/plan/mockGenerate';
import type { PlanDocKey, PlanDocRecord } from '@/lib/stage4/plan/planDocumentStore';
import type { RawPlanStrategy } from '@/lib/stage4/plan/source';
import { loadStartedPlans, startedPlanView } from './startedPlans';

const CO = 'fict-co-a';
const ST = 'fict-strategy-a';
const RENEWAL = 'fict-proj-renewal';
const KEY: PlanDocKey = { companyId: CO, strategyId: ST, projectId: RENEWAL };
const NOW = '2026-11-10T00:00:00.000Z';

let draft: Record<string, unknown>;
beforeAll(async () => {
  const r = await generateMockExecutionPlan({
    strategy: JSON.parse(JSON.stringify(STAGE3_SNAPSHOT_STRATEGIES[0])) as RawPlanStrategy,
    membershipCompanyId: CO,
    requestedStrategyId: ST,
    requestedProjectId: RENEWAL,
    currentYm: '2026-11',
    companyName: '架空',
    createdAt: NOW,
  });
  if (r.status !== 'READY') throw new Error('mock draft must be ready');
  draft = r.bundle;
});

function record(over: Partial<PlanDocRecord> = {}): PlanDocRecord {
  return {
    key: KEY,
    version: 9,
    aiDraft: draft,
    userEdits: {},
    adopted: true,
    updatedAt: NOW,
    updatedBy: 'alice',
    status: 'DRAFT',
    adoption: { version: 8, byUserId: 'alice', at: NOW, edits: {} },
    startInfo: { version: 9, byUserId: 'alice', at: '2026-11-11T09:00:00.000Z' },
    regulatory: undefined,
    ...over,
  };
}

const view = (r: PlanDocRecord, expected: PlanDocKey = KEY) =>
  startedPlanView({ expected, departmentName: '設計部', projectTitle: '更新案内', record: r });

describe('STAGE5 の実行開始済み計画の読み取り', () => {
  it('実行開始していない計画は表示しない（null）', () => {
    expect(view(record({ startInfo: null, adopted: true }))).toBeNull();
  });

  it('草案が生成中・失敗のものは表示しない（null）', () => {
    expect(view(record({ status: 'GENERATING' }))).toBeNull();
  });

  it('別の企業・戦略・プロジェクトの計画は表示しない（null）', () => {
    expect(view(record(), { ...KEY, companyId: 'fict-co-b' })).toBeNull();
    expect(view(record(), { ...KEY, strategyId: 'fict-other' })).toBeNull();
    expect(view(record(), { ...KEY, projectId: 'fict-proj-inspection' })).toBeNull();
  });

  it('開始済みなら、目的・担当・実施事項・KPIを、開始者・日時・版つきで読み取れる', () => {
    const v = view(record());
    expect(v).not.toBeNull();
    expect(v!.startedVersion).toBe(9);
    expect(v!.startedAt).toBe('2026-11-11T09:00:00.000Z');
    expect(v!.purpose.length).toBe(4);
    expect(v!.actions.length).toBeGreaterThan(0);
    expect(v!.actions[0].title.length).toBeGreaterThan(0);
    expect(v!.kpis.length).toBeGreaterThan(0);
  });

  it('計画書の提案KPIは「提案」と表示し、確定KPI（STAGE3由来）と区別する。財務の数値は含めない', () => {
    const v = view(record());
    const proposed = v!.kpis.filter((k) => k.statusLabel === 'AI提案（追加KPI）');
    const confirmed = v!.kpis.filter((k) => k.confirmed);
    expect(proposed.every((k) => k.confirmed === false)).toBe(true);
    expect(confirmed.every((k) => k.statusLabel === 'STAGE3で確定')).toBe(true);
    expect(JSON.stringify(v)).not.toMatch(/AI_ESTIMATE|NOT_CALCULATED/);
  });

  it('利用者の修正（項目の値）は、表示に反映される', () => {
    const edited = view(record({ userEdits: { 'action:1:title': '修正後の実施事項名' } as PlanDocRecord['userEdits'] }));
    expect(edited!.actions[0].title).toBe('修正後の実施事項名');
  });
});

describe('STAGE5 の読み込み（公開前の保護）', () => {
  const item = (projectId: string) => ({ key: { ...KEY, projectId }, departmentName: '設計部', projectTitle: projectId });

  it('APIが無効（DISABLED）なら、要求は1回で止まり、残りは読まない', async () => {
    const load = jest.fn(async () => ({ status: 'DISABLED' as const }));
    const out = await loadStartedPlans({ items: [item('a'), item('b'), item('c')], load });
    expect(out).toEqual({ views: [], failed: 0, disabled: true });
    expect(load).toHaveBeenCalledTimes(1);
  });

  it('開始済みだけを表示し、未開始・他社（DENIED）は黙って外し、失敗は件数で返す', async () => {
    const started = record({ key: { ...KEY, projectId: 'started' } });
    const outcomes: Record<string, unknown> = {
      started: { status: 'FOUND', record: started },
      notstarted: { status: 'FOUND', record: record({ key: { ...KEY, projectId: 'notstarted' }, startInfo: null }) },
      denied: { status: 'DENIED' },
      broken: { status: 'FAILED', message: 'x' },
    };
    const load = jest.fn(async (k: PlanDocKey) => outcomes[k.projectId] as never);
    const out = await loadStartedPlans({ items: [item('started'), item('notstarted'), item('denied'), item('broken')], load });
    expect(out.disabled).toBe(false);
    expect(out.views.map((v) => v.key.projectId)).toEqual(['started']);
    expect(out.failed).toBe(1);
    expect(load).toHaveBeenCalledTimes(4);
  });

  it('読み込みの例外は失敗として数え、以降の項目は読む', async () => {
    const load = jest.fn(async (k: PlanDocKey) => {
      if (k.projectId === 'boom') throw new Error('network');
      return { status: 'NONE' as const };
    });
    const out = await loadStartedPlans({ items: [item('boom'), item('ok')], load });
    expect(out.failed).toBe(1);
    expect(load).toHaveBeenCalledTimes(2);
  });
});
