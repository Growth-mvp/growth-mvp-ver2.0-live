import { buildStage6PlanBlock } from './stage6Plan';
import { buildStage4PlanBlock, loadStage4PlanRows } from './stage4PlanBlock';
import { selectStage56Sources } from './contextSelection';
import { buildStoredFinancePlan, FINANCE_PLAN_CALC_VERSION, readStoredFinancePlan } from '@/utils/stage6/financePlanSnapshot';
import { computeStage6FinancePlan } from '@/utils/stage6/financePlanPipeline';
import { buildFinanceOutlook } from '@/utils/stage6/financeOutlook';
import { formatAmount } from './stage1Blocks';
import { FICTIONAL_STRATEGY_ROW, FICTIONAL_COMPANY_ID } from '../../eval/quality/fictionalCompany';
import { generateMockExecutionPlan } from '@/lib/stage4/plan/mockGenerate';
import { STAGE3_SNAPSHOT_STRATEGIES } from '@/lib/stage4/planView/fixtures/stage3Snapshot';
import { buildDocModel } from '@/lib/stage4/planView/documentModel';
import type { RawPlanStrategy } from '@/lib/stage4/plan/source';

const M = 1_000_000;
const CURRENT_YEAR = 2026;
const PL = FICTIONAL_STRATEGY_ROW.financePL as any[];
const BS = FICTIONAL_STRATEGY_ROW.financeBS as any[];
const COMPANY_TARGETS = [{ id: 't-rev', label: '売上高', base: 1000, unit: '百万円', dueYear: 2030, prioritySimple: 'primary' }];

const confirmed = (over: Record<string, unknown>) => ({ confirmed: true, sourceNote: '見積書（架空）', ...over });
const DEPARTMENTS = [
  {
    id: 'dept-sales',
    name: '営業部',
    projects: [
      {
        id: 'proj-new-customers',
        title: '新規顧客開拓',
        financeEffect: confirmed({ kind: 'REVENUE_UP', method: 'DIRECT_AMOUNT', directAmountYen: 60 * M, amountBasis: 'ANNUAL', startYm: '2025-04' }),
      },
    ],
  },
];

const SAVED_DOMAIN_ASSUMPTIONS = {
  minCashYen: 150 * M,
  taxRate: 0.3,
  depreciationYen: 10 * M,
  arRatio: null,
  inventoryRatio: null,
  apRatio: null,
  targetRevenueYen: 1_000 * M,
  targetOperatingIncomeYen: 70 * M,
  targetYear: 2030,
};

function savedPlan() {
  const domain = {
    assumptions: SAVED_DOMAIN_ASSUMPTIONS,
    existingLoans: [],
    newLoans: [],
    dividendsYen: {},
  };
  const computed = computeStage6FinancePlan({
    financePL: PL as any,
    financeBS: BS as any,
    departments: DEPARTMENTS as any,
    fiscalYearEnd: '3',
    domain: domain as any,
    currentYear: CURRENT_YEAR,
  });
  return buildStoredFinancePlan({
    domain: domain as any,
    companyId: FICTIONAL_COMPANY_ID,
    savedAt: '2026-10-20T00:00:00Z',
    meta: {
      calcVersion: FINANCE_PLAN_CALC_VERSION,
      companyId: FICTIONAL_COMPANY_ID,
      baseYear: computed.basePlan.baseYear,
      bsBaseYear: computed.basePlan.bsBaseYear,
      assumptionsHash: computed.assumptionsHash,
      sourceHash: computed.sourceHash,
      unconfirmed: { unapprovedReadyYen: 0, unclassifiedYen: 0, unscheduledYen: 0, candidateYen: 0, basisPendingYen: 0 },
      computedAt: '2026-10-20T00:00:00Z',
    },
  } as any);
}

function stage6(question: string) {
  return buildStage6PlanBlock({
    csvFinanceData: { financePlanAssumptions: savedPlan() },
    companyId: FICTIONAL_COMPANY_ID,
    financePL: PL,
    financeBS: BS,
    departments: DEPARTMENTS,
    fiscalYearEnd: '3',
    currentYear: CURRENT_YEAR,
    companyTargets: COMPANY_TARGETS,
    simulationResults: [],
    question,
  });
}

function outlook() {
  const stored = readStoredFinancePlan(savedPlan(), FICTIONAL_COMPANY_ID);
  if (stored.kind !== 'OK') throw new Error('saved plan must read as OK');
  return buildFinanceOutlook({
    financePL: PL as any,
    financeBS: BS as any,
    departments: DEPARTMENTS as any,
    fiscalYearEnd: '3',
    companyTargets: COMPANY_TARGETS as any,
    domain: stored.domain,
    currentYear: CURRENT_YEAR,
  });
}

describe('経営情報の質問6問：チャットに渡る数値は、STAGE6の画面と同じ試算結果', () => {
  it('Q1 2030年度の売上高と営業利益の見込み：2030年度の施策反映後の値を、既存事業と施策効果に分けて渡す', () => {
    const o = outlook();
    const u = o.unifiedPl.years.find((r) => r.fiscalYear === 2030);
    expect(u).toBeTruthy();
    const text = stage6('2030年度の売上高と営業利益の見込みは？');
    expect(text).toContain(
      `・2030年度｜売上 ${formatAmount(u!.plan.revenueYen as number)}（既存事業 ${formatAmount(u!.baseline.revenueYen as number)}・施策効果 ${formatAmount(u!.effect.revenueUpYen)}）｜営業利益 ${formatAmount(u!.plan.operatingIncomeYen as number)}`
    );
    expect(text).not.toContain('予測未算出');
  });

  it('Q2 各プロジェクトの営業利益への貢献額：確認済みで反映された施策の効果を、年度ごとに渡す', () => {
    const text = stage6('各プロジェクトの営業利益への貢献額は？');
    expect(text).toContain('プロジェクト別の財務効果（確認済みで試算に反映されたもの）');
    expect(text).toContain('・営業部／新規顧客開拓（売上増加）：2030年度 売上増');
    expect(text).toContain('営業利益効果');
  });

  it('Q3 現場はどれだけ成果を上げていますか：STAGE5の登録済みの実績と達成率を、画面と同じ計算で渡す', () => {
    const text = stage6('現場はどれだけ成果を上げていますか？');
    expect(text).toContain('登録済みの実績と達成率（STAGE5・当会計年度');
    expect(text).toContain('会社全体・売上高');
    expect(text).toContain('達成率');
  });

  it('Q4 資金不足や借入返済の懸念：年度別の現預金・返済・利息・資金不足を、借入反映後の値で渡す', () => {
    const o = outlook();
    const c = o.financedPlan.years.find((y) => y.year === 2030);
    expect(c).toBeTruthy();
    const text = stage6('資金不足や借入返済の懸念は？');
    expect(text).toContain('設備投資・借入・返済・資金（年度別、借入反映後）');
    expect(text).toContain(`・2030年度｜設備投資 ${formatAmount(c!.capex.value ?? undefined)}`);
    expect(text).toContain('返済余力（DSCR）');
    expect(text).toContain('資金不足');
  });

  it('Q5 各部門は何を優先すべきですか：経営課題の全体を聞く質問として、進捗と計画の両方を参照させる', () => {
    expect(selectStage56Sources('各部門は何を優先すべきですか？')).toEqual({ progress: true, plan: true });
  });

  it('Q6 KPIの変更後の目標値や単位：保存された編集を優先し、目標と単位を渡す', async () => {
    const r = await generateMockExecutionPlan({
      strategy: JSON.parse(JSON.stringify(STAGE3_SNAPSHOT_STRATEGIES[0])) as RawPlanStrategy,
      membershipCompanyId: 'fict-co-a',
      requestedStrategyId: 'fict-strategy-a',
      requestedProjectId: 'fict-proj-renewal',
      currentYm: '2026-11',
      companyName: '架空',
      createdAt: '2026-11-10T00:00:00.000Z',
    });
    if (r.status !== 'READY') throw new Error('mock draft must be ready');
    const bundle = r.bundle as Record<string, unknown>;
    const kpi = buildDocModel(bundle, {}).goals.kpis[0];
    expect(kpi.targetKey && kpi.unitKey).toBeTruthy();
    const edited = buildDocModel(bundle, { [kpi.targetKey!]: '3社', [kpi.unitKey!]: '社' });
    const row = {
      project_id: 'fict-proj-renewal',
      ai_draft: bundle,
      user_edits: { [kpi.targetKey!]: '3社', [kpi.unitKey!]: '社' },
      started: false,
      adopted: true,
    };
    const departments = [{ id: 'dept-x', name: '営業部', projects: [{ id: 'fict-proj-renewal', title: '既存顧客の保守契約更新' }] }];
    const text = buildStage4PlanBlock({ rows: [row], departments, question: 'KPIの変更後の目標値や単位は？' });
    expect(text).toContain(`KPI：${edited.goals.kpis[0].label}`);
    expect(text).toContain('目標 3社');
    expect(text).toContain('（STAGE3で確定）');
  });

  it('参照のための読み込みは、会社と戦略で絞って行う（他社の計画は読まない）', async () => {
    const seen: Array<[string, unknown]> = [];
    const admin = {
      from: () => {
        const b: any = {
          select: () => b,
          eq: (k: string, v: unknown) => {
            seen.push([k, v]);
            return b;
          },
          then: (resolve: (v: unknown) => void) => resolve({ data: [], error: null }),
        };
        return b;
      },
    };
    await loadStage4PlanRows(admin, 'co-1', 'st-1');
    expect(seen).toEqual([
      ['company_id', 'co-1'],
      ['strategy_id', 'st-1'],
    ]);
  });
});
