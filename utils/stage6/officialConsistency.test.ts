import type { CompanyTarget, Department, FinanceBSRow, FinancePLRow } from '@/types/strategy';
import { buildBankFinancialPlanBlock, type BankFinancialPlanBlock } from './bankFinancialPlan';
import { computeStage6FinancePlan } from './financePlanPipeline';
import { FINANCE_PLAN_CALC_VERSION, buildStoredFinancePlan, toSavedFinancePlan, hashOf, type CalcSnapshotMeta, type FinancePlanDomain } from './financePlanSnapshot';
import { buildFinanceOutlook, type FinanceOutlook } from './financeOutlook';
import { buildTargetSummary } from '@/components/stage6/financeSummaryModel';
import type { CfAssumptions } from './cashflow';

/* 手計算の前提（架空企業、百万円）
 * 基準（直近実績）：2024年度 売上 1,000・営業利益 70。決算月3月。予測 2025〜2027年度
 * 既存事業の増減（直近実績比）：2026年度 売上 +20・営業利益 +2
 * 確認済み施策：
 *   A 売上増加 年額60（2025年4月〜）、営業利益の増分 年額10
 *   B 費用削減 月額1（2025年4月〜）
 *   C 追加費用 月額0.5（2026年4月〜）
 * 期待値：
 *   FY2026 売上 1,080 ／ 営業利益 (70+2)+10+12 = 94 ／ 営業費用 986
 *   FY2027 売上 1,060 ／ 営業利益 70 + 10 + 12 − 6 = 86 ／ 営業費用 974
 */
const M = 1_000_000;
const PL: FinancePLRow[] = [{ year: 2024, revenue: 1_000 * M, operatingIncome: 70 * M, interest: 0 }];
const BS: FinanceBSRow[] = [{ year: 2024, cash: 100 * M, ar: 150 * M, inventory: 50 * M, ap: 80 * M }];
const TARGETS = [
  { id: 't-rev', label: '売上', unit: '百万円', base: 1_200, dueYear: 2027 },
  { id: 't-op', label: '営業利益', unit: '百万円', base: 100, dueYear: 2027 },
] as unknown as CompanyTarget[];
const COMPANY = '11111111-1111-4111-8111-111111111111';
const STRATEGY = '33333333-3333-4333-8333-333333333333';
const NOW = new Date('2025-10-01T00:00:00Z');

const ASSUMPTIONS: CfAssumptions = {
  minCashYen: 50 * M,
  taxRate: 0.3,
  depreciationYen: 0,
  arRatio: null,
  inventoryRatio: null,
  apRatio: null,
  targetRevenueYen: null,
  targetOperatingIncomeYen: null,
  targetYear: null,
  baseScenario: { 2026: { revenueYen: 20 * M, operatingIncomeYen: 2 * M } },
};

const eff = (over: Record<string, unknown>) => ({ confirmed: true, sourceNote: '見積書（架空）', source: 'USER_INPUT', ...over });
const projects = (overrides: { aOp?: number | null; aOpOmitted?: boolean } = {}) => [
  {
    id: 'A',
    title: 'A 新規開拓',
    financeEffect: eff({
      kind: 'REVENUE_UP',
      method: 'DIRECT_AMOUNT',
      directAmountYen: 60 * M,
      amountBasis: 'ANNUAL',
      startYm: '2025-04',
      ...(overrides.aOpOmitted ? {} : { operatingIncomeEffectYen: overrides.aOp === undefined ? 10 * M : (overrides.aOp ?? undefined) }),
    }),
  },
  {
    id: 'B',
    title: 'B 工程改善',
    financeEffect: eff({ kind: 'COST_REDUCTION', method: 'DIRECT_AMOUNT', directAmountYen: 1 * M, amountBasis: 'MONTHLY', startYm: '2025-04' }),
  },
  {
    id: 'C',
    title: 'C 人員増',
    financeEffect: eff({ kind: 'COST_INCREASE', method: 'DIRECT_AMOUNT', directAmountYen: 0.5 * M, amountBasis: 'MONTHLY', startYm: '2026-04' }),
  },
];
const departments = (p: ReturnType<typeof projects> = projects()) =>
  [{ id: 'd1', name: '営業部', projects: p }] as unknown as Department[];

const domainOf = (assumptions: CfAssumptions = ASSUMPTIONS): FinancePlanDomain => ({
  assumptions,
  existingLoans: [],
  newLoans: [],
  dividendsYen: {},
});

function outlookOf(domain: FinancePlanDomain, deps: Department[] = departments()): FinanceOutlook {
  return buildFinanceOutlook({
    financePL: PL,
    financeBS: BS,
    departments: deps,
    fiscalYearEnd: '3',
    companyTargets: TARGETS,
    domain,
    currentYear: 2025,
  });
}

function bankBlock(domain: FinancePlanDomain, deps: Department[] = departments()): BankFinancialPlanBlock {
  const inputs = {
    financePL: PL,
    financeBS: BS,
    departments: deps,
    fiscalYearEnd: '3',
    companyTargets: TARGETS as unknown as unknown[],
    storedFinancePlan: undefined,
    financeUnitConfirmedPl: [2024],
  };
  const computed = computeStage6FinancePlan({ financePL: PL, financeBS: BS, departments: deps, fiscalYearEnd: '3', domain, currentYear: 2025 });
  const meta: CalcSnapshotMeta = {
    calcVersion: FINANCE_PLAN_CALC_VERSION,
    companyId: COMPANY,
    baseYear: computed.basePlan.baseYear,
    bsBaseYear: computed.basePlan.bsBaseYear,
    assumptionsHash: computed.assumptionsHash,
    sourceHash: computed.sourceHash,
    unconfirmed: {
      unapprovedReadyYen: computed.investment.unapprovedReadyYen,
      unclassifiedYen: computed.investment.unclassifiedYen,
      unscheduledYen: computed.investment.unscheduledYen,
      candidateYen: computed.investment.candidateYen,
      basisPendingYen: computed.investment.basisPendingYen,
    },
    computedAt: '2025-10-01T00:00:00.000Z',
  };
  const stored = JSON.parse(JSON.stringify(buildStoredFinancePlan({ domain, companyId: COMPANY, meta, savedAt: '2025-10-01T00:00:00.000Z' })));
  return buildBankFinancialPlanBlock({
    companyId: COMPANY,
    strategyId: STRATEGY,
    storedFinancePlan: stored,
    inputs: { ...inputs, storedFinancePlan: stored },
    currentYear: 2025,
    computedAt: NOW.toISOString(),
  });
}

const planAt = (o: FinanceOutlook, fy: number) => o.unifiedPl.years.find((y) => y.fiscalYear === fy)!.plan;

describe('経路B：ホーム・STAGE6・銀行向け計画書の年度別売上・営業利益の照合', () => {
  it('ベースシナリオ＋確認済み効果の合計が期待どおりで、営業費用＝売上−営業利益が成り立つ', () => {
    const o = outlookOf(domainOf());
    expect(planAt(o, 2026)).toEqual({ revenueYen: 1_080 * M, operatingExpenseYen: 986 * M, operatingIncomeYen: 94 * M });
    expect(planAt(o, 2027)).toEqual({ revenueYen: 1_060 * M, operatingExpenseYen: 974 * M, operatingIncomeYen: 86 * M });
    for (const y of o.unifiedPl.years) {
      expect(y.plan.revenueYen! - y.plan.operatingIncomeYen!).toBe(y.plan.operatingExpenseYen);
    }
  });

  it('銀行向け計画書の年度別売上・営業利益は、共通の財務試算と一致する（ホーム・STAGE6と同じ計算元）', () => {
    const domain = domainOf();
    const o = outlookOf(domain);
    const block = bankBlock(domain);
    expect(block.status).toBe('CURRENT');
    for (const fy of [2026, 2027]) {
      const row = block.sections!.revenuePlan.years.find((y) => y.year === fy)!;
      expect(row.revenue.value).toBe(planAt(o, fy).revenueYen);
      expect(row.operatingIncome.value).toBe(planAt(o, fy).operatingIncomeYen);
    }
  });

  it('ホームは保存済み前提から、STAGE6と同じ関数で同じ年度値を得る（保存・再読込を経ても一致）', () => {
    const domain = domainOf();
    const stage6 = outlookOf(domain);
    const home = outlookOf(JSON.parse(JSON.stringify(domain)) as FinancePlanDomain);
    expect(home.unifiedPl).toEqual(stage6.unifiedPl);
  });

  it('営業利益の増分が未入力なら、その年度の営業利益と営業費用は未算定（推定しない）、銀行書類でも確定値にしない', () => {
    const domain = domainOf();
    const deps = departments(projects({ aOpOmitted: true }));
    const o = outlookOf(domain, deps);
    expect(planAt(o, 2026).operatingIncomeYen).toBeNull();
    expect(planAt(o, 2026).operatingExpenseYen).toBeNull();
    expect(planAt(o, 2026).revenueYen).toBe(1_080 * M);
    const block = bankBlock(domain, deps);
    const row = block.sections!.revenuePlan.years.find((y) => y.year === 2026)!;
    expect(row.operatingIncome.value).toBeNull();
    expect(row.operatingIncome.basis).toBe('HELD');
    expect(row.operatingMarginRate.value).toBeNull();
    const gap = block.sections!.financialTargets.gaps.operatingIncome;
    expect(gap.projectedYen).toBeNull();
    expect(gap.differenceYen).toBeNull();
  });

  it('未算定の営業利益は、達成率を確定値として出さない', () => {
    const o = outlookOf(domainOf(), departments(projects({ aOpOmitted: true })));
    const summary = buildTargetSummary({ unifiedPl: o.unifiedPl, target: o.target });
    expect(summary.operatingIncome.status).toBe('PLAN_UNKNOWN');
    expect(summary.revenue.status).toBe('READY');
  });

  it('利益減少（既存事業の営業利益を減らす増減）も、営業利益・営業費用に反映される', () => {
    const domain = domainOf({ ...ASSUMPTIONS, baseScenario: { 2026: { revenueYen: null, operatingIncomeYen: -15 * M } } });
    const o = outlookOf(domain, departments([]));
    expect(planAt(o, 2026).revenueYen).toBe(1_000 * M);
    expect(planAt(o, 2026).operatingIncomeYen).toBe(55 * M);
    expect(planAt(o, 2026).operatingExpenseYen).toBe(945 * M);
  });

  it('赤字（営業利益のマイナス）は、そのまま表示・計算され、0に丸めない', () => {
    const domain = domainOf();
    const deps = departments(projects({ aOp: -150 * M }));
    const o = outlookOf(domain, deps);
    expect(planAt(o, 2026).operatingIncomeYen).toBe(-66 * M);
    const block = bankBlock(domain, deps);
    const row = block.sections!.revenuePlan.years.find((y) => y.year === 2026)!;
    expect(row.operatingIncome.value).toBe(-66 * M);
  });

  it('PLの変化は営業CFへ反映される：営業利益が変われば営業CFも同じ方向に変わり、未算定の年度はCFも未算定', () => {
    const base = bankBlock(domainOf(), departments([]));
    const withLoss = bankBlock(domainOf(), departments(projects({ aOp: -150 * M })));
    const cfOf = (b: BankFinancialPlanBlock) => b.sections!.cashFlow.years.find((y) => y.year === 2026)!.operatingCf.value;
    const baseCf = cfOf(base);
    const lossCf = cfOf(withLoss);
    expect(baseCf).not.toBeNull();
    expect(lossCf).not.toBeNull();
    expect((baseCf as number) - (lossCf as number)).toBeGreaterThan(0);

    const unknown = bankBlock(domainOf(), departments(projects({ aOpOmitted: true })));
    expect(cfOf(unknown)).toBeNull();
  });

  it('費用削減の効果は営業利益を増やし、売上は変えない', () => {
    const o = outlookOf(domainOf(), departments(projects().filter((p) => p.id === 'B')));
    expect(planAt(o, 2026).revenueYen).toBe(1_020 * M);
    expect(planAt(o, 2026).operatingIncomeYen).toBe(84 * M);
  });

  it('旧見込み（impactRevenueMJPY）は、どの計算元にも無条件では加算されない', () => {
    const deps = [
      {
        id: 'd1',
        name: '営業部',
        projects: [{ id: 'L', title: '旧見込み', impactRevenueMJPY: 300, impactRevenueProgress: 100, impactOpIncomeMJPY: 30, impactOpIncomeProgress: 100 }],
      },
    ] as unknown as Department[];
    const o = outlookOf(domainOf({ ...ASSUMPTIONS, baseScenario: undefined }), deps);
    expect(planAt(o, 2026).revenueYen).toBe(1_000 * M);
    expect(planAt(o, 2026).operatingIncomeYen).toBe(70 * M);
    const block = bankBlock(domainOf({ ...ASSUMPTIONS, baseScenario: undefined }), deps);
    expect(block.sections!.revenuePlan.years.find((y) => y.year === 2026)!.revenue.value).toBe(1_000 * M);
  });

  it('保存形式は、ベースシナリオを含めても同じ前提なら同じハッシュになる（再読込で壊れない）', () => {
    const d = domainOf();
    expect(hashOf(toSavedFinancePlan(d))).toBe(hashOf(toSavedFinancePlan(JSON.parse(JSON.stringify(d)) as FinancePlanDomain)));
  });
});
