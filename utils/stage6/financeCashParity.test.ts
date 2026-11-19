import type { FinancePLRow, FinanceBSRow } from '@/types/strategy';
import { buildCashFlowPlan, type CashFlowInput, type CfAssumptions } from './cashflow';
import { buildConditionalCashFlow } from './conditionalCf';
import type { UnifiedPl } from './unifiedPl';

const M = 1_000_000;

const FINANCE_PL = [{ year: 2025, revenue: 1_000 * M, operatingIncome: 70 * M, interest: 2 * M, depreciation: 10 * M }] as FinancePLRow[];
const FINANCE_BS = [{ year: 2025, cash: 200 * M, ar: 100 * M, inventory: 50 * M, ap: 80 * M }] as FinanceBSRow[];

const ASSUMPTIONS: CfAssumptions = {
  minCashYen: null,
  taxRate: 0.3,
  depreciationYen: 10 * M,
  arRatio: null,
  inventoryRatio: null,
  apRatio: null,
  targetRevenueYen: null,
  targetOperatingIncomeYen: null,
  targetYear: null,
};

const YEARS = [2026, 2027, 2028];
const REVENUE_UP = [60 * M, 60 * M, 60 * M];
const OPERATING_UP = [30 * M, 30 * M, 20 * M];

const input = (overrides: Partial<CashFlowInput> = {}): CashFlowInput => ({
  financePL: FINANCE_PL,
  financeBS: FINANCE_BS,
  investment: { yearlyByCategory: [], unclassifiedYen: 0, unscheduledYen: 0, candidateYen: 0, basisPendingYen: 0 },
  assumptions: ASSUMPTIONS,
  fiscalYearEndSet: true,
  ...overrides,
});

const unifiedOf = (): UnifiedPl =>
  ({
    years: YEARS.map((fiscalYear, i) => ({
      fiscalYear,
      plan: {
        revenueYen: 1_000 * M + REVENUE_UP[i],
        operatingIncomeYen: 70 * M + OPERATING_UP[i],
        operatingExpenseYen: null,
      },
      unknownReasons: [],
    })),
    gap: null,
  }) as unknown as UnifiedPl;

describe('STAGE6の条件付きCFと、施策反映後の財務試算（銀行向けと同じ計算）の一致', () => {
  it('売上が施策で増えると運転資金が増え、営業CF・期末現預金は財務試算と同じ値になる', () => {
    const baseline = buildCashFlowPlan(input(), 2025);
    const unified = unifiedOf();
    const financed = buildCashFlowPlan(
      input({
        yearlyOverride: Object.fromEntries(
          unified.years.map((y) => [y.fiscalYear, { revenueYen: y.plan.revenueYen, operatingIncomeYen: y.plan.operatingIncomeYen }]),
        ),
      }),
      2025,
    );
    const cond = buildConditionalCashFlow({ baseline, unified });
    const forecast = financed.years.filter((y) => y.kind === 'FORECAST');

    expect(cond.years.map((y) => y.operatingCf.conditionalYen)).toEqual(forecast.map((y) => y.operatingCf.value));
    expect(cond.years.map((y) => y.closingCashYen)).toEqual(forecast.map((y) => y.closingCashBeforeFinancing.value));
    expect(cond.years.every((y) => y.closingCashYen !== null)).toBe(true);
  });

  it('運転資金の増加は、売上の増加分×（売掛金比率＋棚卸比率−買掛金比率）だけ営業CFを減らす', () => {
    const baseline = buildCashFlowPlan(input(), 2025);
    const cond = buildConditionalCashFlow({ baseline, unified: unifiedOf() });
    const ratio = 100 / 1_000 + 50 / 1_000 - 80 / 1_000;
    const expectedWcIncrease = ratio * REVENUE_UP[0];
    const pretax = 100 * M - 2 * M;
    const expectedOcf = pretax * (1 - 0.3) + 10 * M - expectedWcIncrease;
    expect(cond.years[0].operatingCf.conditionalYen).toBeCloseTo(expectedOcf, 0);
  });

  it('基準年度の運転資金が欠ければ、営業CFは0ではなく未算定になる', () => {
    const baseline = buildCashFlowPlan(input({ financeBS: [{ year: 2025, cash: 200 * M }] as FinanceBSRow[] }), 2025);
    const cond = buildConditionalCashFlow({ baseline, unified: unifiedOf() });
    expect(cond.years.every((y) => y.operatingCf.conditionalYen === null)).toBe(true);
    expect(cond.years.every((y) => y.closingCashYen === null)).toBe(true);
    expect(cond.years[0].unknownReasons.join('、')).toContain('運転資金');
  });
});
