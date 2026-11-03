import type { FinanceBSRow, FinancePLRow } from '@/types/strategy';
import { FICTIONAL_STRATEGY_ROW } from '../../eval/quality/fictionalCompany';
import { buildCashFlowPlan, type CfAssumptions } from './cashflow';
import { buildFinanceEffectTrial, withoutTargetPath } from './financeEffectPlan';

const CURRENT_YEAR = 2026;
const NO_INVESTMENT = { yearlyByCategory: [], unclassifiedYen: 0, unscheduledYen: 0, candidateYen: 0, basisPendingYen: 0 };
const financePL = (FICTIONAL_STRATEGY_ROW as any).financePL as FinancePLRow[];
const financeBS = (FICTIONAL_STRATEGY_ROW as any).financeBS as FinanceBSRow[];

const EMPTY: CfAssumptions = {
  minCashYen: null,
  taxRate: null,
  depreciationYen: null,
  arRatio: null,
  inventoryRatio: null,
  apRatio: null,
  targetRevenueYen: null,
  targetOperatingIncomeYen: null,
  targetYear: null,
};

const plan = (assumptions: CfAssumptions) =>
  buildCashFlowPlan({ financePL, financeBS, investment: NO_INVESTMENT, assumptions, fiscalYearEndSet: true }, CURRENT_YEAR);

const forecastRevenue = (p: ReturnType<typeof plan>) =>
  p.years.filter((y) => y.kind === 'FORECAST').map((y) => ({ year: y.year, revenue: y.revenue.value }));

describe('経営目標を入れても、条件付き試算の基準は現状延長になる', () => {
  const withTarget: CfAssumptions = { ...EMPTY, targetRevenueYen: 2_000_000_000, targetYear: CURRENT_YEAR + 2 };

  it('目標あり：CFの予測は目標への補間になる（参照用）', () => {
    const rows = forecastRevenue(plan(withTarget));
    expect(rows.length).toBeGreaterThan(1);
    expect(new Set(rows.map((r) => r.revenue)).size).toBeGreaterThan(1);
  });

  it('withoutTargetPath は目標3項目だけを外し、他の前提は変えない', () => {
    const stripped = withoutTargetPath({ ...withTarget, minCashYen: 5_000_000, taxRate: 0.3 });
    expect(stripped.targetRevenueYen).toBeNull();
    expect(stripped.targetOperatingIncomeYen).toBeNull();
    expect(stripped.targetYear).toBeNull();
    expect(stripped.minCashYen).toBe(5_000_000);
    expect(stripped.taxRate).toBe(0.3);
  });

  it('現状延長の基準は、目標を入れても全年度で同じ（基準年度の水準を横置き）', () => {
    const rows = forecastRevenue(plan(withoutTargetPath(withTarget)));
    expect(rows.length).toBeGreaterThan(1);
    expect(new Set(rows.map((r) => r.revenue)).size).toBe(1);
  });

  it('施策効果は現状延長に加算され、目標経路の値には加算されない', () => {
    const baseline = forecastRevenue(plan(withoutTargetPath(withTarget)));
    const targetPath = forecastRevenue(plan(withTarget));
    const flat = baseline[0].revenue as number;
    const trial = buildFinanceEffectTrial({
      departments: [
        {
          id: 'd1',
          name: '営業部',
          projects: [
            {
              id: 'p1',
              title: '新規開拓',
              financeEffect: {
                kind: 'REVENUE_UP',
                method: 'DIRECT_AMOUNT',
                directAmountYen: 12_000_000,
                amountBasis: 'ANNUAL',
                startYm: `${CURRENT_YEAR}-04`,
                sourceNote: '見積書（架空）',
                confirmed: true,
              },
            },
          ],
        },
      ] as any,
      fiscalYearEnd: '3',
      fiscalYears: baseline.map((r) => r.year),
    });
    const fy = CURRENT_YEAR + 1;
    expect(trial.years.find((y) => y.fiscalYear === fy)?.revenueYen).toBe(12_000_000);
    expect(targetPath[targetPath.length - 1].revenue).not.toBe(flat);
  });
});
