import { STAGE3_SNAPSHOT_STRATEGIES } from '@/lib/stage4/planView/fixtures/stage3Snapshot';
import { generateMockExecutionPlan } from '@/lib/stage4/plan/mockGenerate';
import type { PlanDocKey, PlanDocRecord } from '@/lib/stage4/plan/planDocumentStore';
import type { RawPlanStrategy } from '@/lib/stage4/plan/source';
import { startedPlanView } from './startedPlans';

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
    const proposed = v!.kpis.filter((k) => k.statusLabel === '提案');
    const confirmed = v!.kpis.filter((k) => k.confirmed);
    expect(proposed.every((k) => k.confirmed === false)).toBe(true);
    expect(confirmed.every((k) => k.statusLabel === '確定')).toBe(true);
    expect(JSON.stringify(v)).not.toMatch(/AI_ESTIMATE|NOT_CALCULATED/);
  });

  it('利用者の修正（項目の値）は、表示に反映される', () => {
    const edited = view(record({ userEdits: { 'action:1:title': '修正後の実施事項名' } as PlanDocRecord['userEdits'] }));
    expect(edited!.actions[0].title).toBe('修正後の実施事項名');
  });
});
