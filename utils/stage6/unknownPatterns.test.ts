import type { Department, FinanceBSRow, FinancePLRow } from '@/types/strategy';
import { buildCashFlowPlan, type CfAssumptions, type CashFlowInput, type CashFlowPlan } from './cashflow';
import { buildFinanceEffectTrial, withoutTargetPath } from './financeEffectPlan';
import { buildConditionalCashFlow, type ConditionalCf } from './conditionalCf';
import { buildUnifiedPl } from './unifiedPl';

/* 未算定の発生パターン（架空企業）。期間は FY2026〜FY2028 の3年。
 * 件数は規則から手で数えた期待値（実装の出力からコピーしない）。
 * 「営業利益・営業CF・期末現預金」の欄ごとに、未算定になった年度の数を数える。 */
const M = 1_000_000;
const YEARS = [2026, 2027, 2028];
const NO_INVESTMENT: CashFlowInput['investment'] = { yearlyByCategory: [], unclassifiedYen: 0, unscheduledYen: 0, candidateYen: 0, basisPendingYen: 0 };
const FULL_PL = [{ year: 2025, revenue: 1_000 * M, operatingIncome: 70 * M, interest: 2 * M, depreciation: 10 * M }] as FinancePLRow[];
const FULL_BS = [{ year: 2025, cash: 200 * M, ar: 100 * M, inventory: 50 * M, ap: 80 * M }] as FinanceBSRow[];
const BASE_ASSUMPTIONS: CfAssumptions = {
  minCashYen: null,
  taxRate: 0.3,
  depreciationYen: null,
  arRatio: null,
  inventoryRatio: null,
  apRatio: null,
  targetRevenueYen: null,
  targetOperatingIncomeYen: null,
  targetYear: null,
};
const REVENUE_UP = {
  id: 'p-r',
  title: '新規開拓',
  financeEffect: { kind: 'REVENUE_UP', method: 'DIRECT_AMOUNT', directAmountYen: 60 * M, amountBasis: 'ANNUAL', startYm: '2026-04', sourceNote: '見積書（架空）', confirmed: true, source: 'USER_INPUT' },
};
const COST_REDUCTION = {
  id: 'p-c',
  title: '工程改善',
  financeEffect: { kind: 'COST_REDUCTION', method: 'DIRECT_AMOUNT', directAmountYen: 500_000, amountBasis: 'MONTHLY', startYm: '2025-10', endYm: '2026-09', sourceNote: '見積書（架空）', confirmed: true, source: 'USER_INPUT' },
};

function run(opts: { pl?: FinancePLRow[]; bs?: FinanceBSRow[]; assumptions?: CfAssumptions; debt?: undefined; investment?: CashFlowInput['investment']; projects?: unknown[] }) {
  const departments = [{ id: 'd1', name: '営業部', projects: opts.projects ?? [REVENUE_UP, COST_REDUCTION] }] as unknown as Department[];
  const baseline: CashFlowPlan = buildCashFlowPlan(
    {
      financePL: opts.pl ?? FULL_PL,
      financeBS: opts.bs ?? FULL_BS,
      investment: opts.investment ?? NO_INVESTMENT,
      assumptions: withoutTargetPath(opts.assumptions ?? BASE_ASSUMPTIONS),
      fiscalYearEndSet: true,
      debt: opts.debt,
    },
    2025,
  );
  const trial = buildFinanceEffectTrial({ departments, fiscalYearEnd: '3', fiscalYears: YEARS });
  const forecast = baseline.years.filter((y) => y.kind === 'FORECAST');
  const unified = buildUnifiedPl({
    baseline: forecast.map((y) => ({ fiscalYear: y.year, revenueYen: y.revenue.value, operatingIncomeYen: y.operatingIncome.value })),
    effects: trial.years,
    target: null,
  });
  const cf: ConditionalCf = buildConditionalCashFlow({ baseline, unified });
  return { baseline, unified, cf };
}

/** 未算定（null）の年度数 */
const countNull = (xs: (number | null)[]) => xs.filter((x) => x === null).length;

describe('未算定パターン1：売上増加施策の原価不足', () => {
  it('営業利益・営業CF・期末現預金は FY2027・FY2028 の2年度が未算定（FY2026 は費用削減のみで確定）', () => {
    const { unified, cf } = run({});
    expect(countNull(unified.years.map((y) => y.plan.operatingIncomeYen))).toBe(2);
    expect(countNull(cf.years.map((y) => y.operatingCf.conditionalYen))).toBe(2);
    expect(countNull(cf.years.map((y) => y.closingCashYen))).toBe(2);
    expect(unified.years[0].plan.operatingIncomeYen).toBe(73 * M);
    expect(unified.years[1].unknownReasons.join('')).toContain('売上原価・変動費が未確定');
  });
});

describe('未算定パターン2：支払利息・減価償却の不足', () => {
  it('支払利息なし：税引前が決まらず、営業CF・期末現預金は3年とも未算定', () => {
    const pl = [{ year: 2025, revenue: 1_000 * M, operatingIncome: 70 * M, depreciation: 10 * M }] as FinancePLRow[];
    const { cf } = run({ pl, projects: [] });
    expect(countNull(cf.years.map((y) => y.operatingCf.conditionalYen))).toBe(3);
    expect(countNull(cf.years.map((y) => y.closingCashYen))).toBe(3);
    expect(cf.years[0].unknownReasons.join('')).toContain('支払利息');
  });

  it('減価償却費なし：営業CF・期末現預金は3年とも未算定', () => {
    const pl = [{ year: 2025, revenue: 1_000 * M, operatingIncome: 70 * M, interest: 2 * M }] as FinancePLRow[];
    const { cf } = run({ pl, projects: [] });
    expect(countNull(cf.years.map((y) => y.operatingCf.conditionalYen))).toBe(3);
    expect(cf.years[0].unknownReasons.join('')).toContain('減価償却費');
  });
});

describe('未算定パターン3：税率・運転資金の不足', () => {
  it('税率が未確定（利用者入力なし・税の実績なし）：営業CF・期末現預金は3年とも未算定', () => {
    const { cf } = run({ assumptions: { ...BASE_ASSUMPTIONS, taxRate: null }, projects: [] });
    expect(cf.taxRate).toBeNull();
    expect(countNull(cf.years.map((y) => y.operatingCf.conditionalYen))).toBe(3);
  });

  it('基準BSの在庫・買掛がない：運転資金増減が決まらず、営業CF・期末現預金は3年とも未算定', () => {
    const bs = [{ year: 2025, cash: 200 * M, ar: 100 * M }] as FinanceBSRow[];
    const { cf } = run({ bs, projects: [] });
    expect(countNull(cf.years.map((y) => y.operatingCf.conditionalYen))).toBe(3);
    expect(cf.years[0].unknownReasons.join('')).toContain('運転資金');
  });
});

describe('未算定パターン4：借入計画の未入力', () => {
  it('財務CFは3年とも「未入力」（null）。期末現預金は借入未反映の暫定値として算定される（最終値ではない）', () => {
    const { cf } = run({ projects: [] });
    expect(cf.debtEnabled).toBe(false);
    expect(countNull(cf.years.map((y) => y.financingCfYen))).toBe(3);
    // 借入未反映でも、営業CFが決まれば暫定の期末は出る（表示上は「借入未反映・暫定」と明示する）
    expect(countNull(cf.years.map((y) => y.closingCashYen))).toBe(0);
    expect(cf.years[2].closingCashYen).toBe(372.8 * M);
  });
});

describe('未算定パターン5：設備投資の未入力', () => {
  it('STAGE4の資本的支出の登録がなければ、投資CFは0（未登録の意味。未算定ではない）と判定される', () => {
    const { cf } = run({ projects: [] });
    expect(cf.years.map((y) => y.investingCfYen)).toEqual([0, 0, 0]);
    // 0 は「登録なし」であり、通常の設備更新は含まれない（既存のCFエンジンの保留事項）
  });
});

describe('未算定パターン6：財務情報（BS）がない', () => {
  it('基準BSがない：期首現預金が決まらず、営業CF以降は3年とも未算定', () => {
    const { cf } = run({ bs: [], projects: [] });
    expect(countNull(cf.years.map((y) => y.openingCashYen))).toBe(3);
    expect(countNull(cf.years.map((y) => y.closingCashYen))).toBe(3);
  });
});
