import { renderToStaticMarkup } from 'react-dom/server';
import type { CompanyTarget, Department, FinanceBSRow, FinancePLRow } from '@/types/strategy';
import { buildFinanceOutlook, type FinanceOutlook } from '@/utils/stage6/financeOutlook';
import type { CfAssumptions } from '@/utils/stage6/cashflow';
import type { FinancePlanDomain } from '@/utils/stage6/financePlanSnapshot';
import { buildTargetSummary } from './financeSummaryModel';
import { buildOutlookCharts } from './financeOutlookChartModel';
import { FinanceOutlookCharts } from './FinanceOutlookCharts';

/* 手計算の前提（架空企業、百万円）
 * 基準：2024年度 売上 1,000・営業利益 70。決算月3月。予測 2025〜2027（FY2026 = 2025年4月〜2026年3月）
 * 目標：売上 1,200・営業利益 100（2027年度）
 */
const M = 1_000_000;
const PL: FinancePLRow[] = [{ year: 2024, revenue: 1_000 * M, operatingIncome: 70 * M, interest: 0 }];
const BS: FinanceBSRow[] = [{ year: 2024, cash: 100 * M, ar: 150 * M, inventory: 50 * M, ap: 80 * M }];
const TARGETS = [
  { id: 't-rev', label: '売上', unit: '百万円', base: 1_200, dueYear: 2027 },
  { id: 't-op', label: '営業利益', unit: '百万円', base: 100, dueYear: 2027 },
] as unknown as CompanyTarget[];
const NO_ASSUMPTIONS: CfAssumptions = {
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
const dept = (projects: unknown[]) => ({ id: 'd1', name: '営業部', projects }) as unknown as Department;
const confirmedUp = (over: Record<string, unknown> = {}) => ({
  kind: 'REVENUE_UP',
  method: 'DIRECT_AMOUNT',
  directAmountYen: 60 * M,
  amountBasis: 'ANNUAL',
  startYm: '2025-04',
  sourceNote: '見積書（架空）',
  source: 'USER_INPUT',
  confirmed: true,
  ...over,
});

function outlookOf(args: { departments?: Department[]; domain?: FinancePlanDomain | null; targets?: CompanyTarget[] } = {}): FinanceOutlook {
  return buildFinanceOutlook({
    financePL: PL,
    financeBS: BS,
    departments: args.departments ?? [dept([])],
    fiscalYearEnd: '3',
    companyTargets: args.targets ?? TARGETS,
    domain: args.domain === undefined ? { assumptions: NO_ASSUMPTIONS, existingLoans: [], newLoans: [], dividendsYen: {} } : args.domain,
    currentYear: 2025,
  });
}

const chartsOf = (o: FinanceOutlook) => buildOutlookCharts(o, buildTargetSummary({ unifiedPl: o.unifiedPl, target: o.target }));

describe('STAGE6 経年グラフ：共通の財務試算と同じ値を示す', () => {
  it('売上・営業利益の点は、財務試算（既存事業＋確認済み効果）の年度値と一致する', () => {
    const o = outlookOf({ departments: [dept([{ id: 'p', title: '新規開拓', financeEffect: confirmedUp({ operatingIncomeEffectYen: 10 * M }) }])] });
    const c = chartsOf(o);
    const fy26 = c.revenue.points.find((p) => p.fiscalYear === 2026)!;
    expect(fy26.planMil).toBe(o.unifiedPl.years.find((y) => y.fiscalYear === 2026)!.plan.revenueYen! / M);
    expect(fy26.baselineMil).toBe(1_000);
    expect(fy26.planMil).toBe(1_060);
    const opFy26 = c.operatingIncome.points.find((p) => p.fiscalYear === 2026)!;
    expect(opFy26.planMil).toBe(80);
    expect(opFy26.baselineMil).toBe(70);
  });

  it('営業利益が算定不能の年度は線を描かず（null）、0や推定値では補わない', () => {
    const o = outlookOf({ departments: [dept([{ id: 'p', title: '新規開拓', financeEffect: confirmedUp({ operatingIncomeEffectYen: undefined }) }])] });
    const c = chartsOf(o);
    expect(c.operatingIncome.points.find((p) => p.fiscalYear === 2026)!.planMil).toBeNull();
    expect(c.operatingIncome.unknownYears).toEqual([2026, 2027]);
    expect(c.operatingIncome.unknownReasons.join('')).toContain('未入力');
    expect(c.operatingIncome.headline).toContain('未算定');
    expect(c.revenue.points.find((p) => p.fiscalYear === 2026)!.planMil).toBe(1_060);
  });

  it('未確認の施策は、見通し（施策反映後の線）に入らない', () => {
    const o = outlookOf({ departments: [dept([{ id: 'p', title: '新規開拓', financeEffect: confirmedUp({ confirmed: false }) }])] });
    const c = chartsOf(o);
    expect(c.revenue.points.find((p) => p.fiscalYear === 2027)!.planMil).toBe(1_000);
  });

  it('達成率は共通の計算（試算÷目標）で、目標年度の値から出す', () => {
    const o = outlookOf({ departments: [dept([{ id: 'p', title: '新規開拓', financeEffect: confirmedUp({ operatingIncomeEffectYen: 30 * M }) }])] });
    const c = chartsOf(o);
    expect(c.revenue.targetMil).toBe(1_200);
    expect(c.revenue.targetFiscalYear).toBe(2027);
    expect(c.revenue.targetInRange).toBe(true);
    expect(c.revenue.achievementPct).toBeCloseTo((1_060 / 1_200) * 100, 6);
    expect(c.revenue.headline).toBe('達成率 88.3%（2027年度）');
    expect(c.operatingIncome.achievementPct).toBeCloseTo((100 / 100) * 100, 6);
  });

  it('横ばい仮定は、設定がないことを明示する', () => {
    const c = chartsOf(outlookOf());
    expect(c.basis).toBe('FLAT');
    expect(c.basisText).toContain('横ばい仮定');
  });

  it('既存事業の年度別増減を設定すると、その旨を示し、基準の線に反映する', () => {
    const domain: FinancePlanDomain = {
      assumptions: { ...NO_ASSUMPTIONS, baseScenario: { 2026: { revenueYen: 20 * M, operatingIncomeYen: 2 * M } } },
      existingLoans: [],
      newLoans: [],
      dividendsYen: {},
    };
    const c = chartsOf(outlookOf({ domain }));
    expect(c.basis).toBe('BASE_SCENARIO');
    expect(c.basisText).toContain('年度別増減');
    expect(c.revenue.points.find((p) => p.fiscalYear === 2026)!.baselineMil).toBe(1_020);
    expect(c.operatingIncome.points.find((p) => p.fiscalYear === 2026)!.baselineMil).toBe(72);
  });

  it('目標年度が試算期間の外なら、目標の印を描かず、期間外と示す', () => {
    const c = chartsOf(outlookOf({ targets: [{ id: 't', label: '売上', unit: '百万円', base: 1_500, dueYear: 2035 } as unknown as CompanyTarget] }));
    expect(c.revenue.targetInRange).toBe(false);
    expect(c.revenue.headline).toContain('試算期間の外');
  });

  it('経営目標が未設定なら、達成率を出さず未設定と示す', () => {
    const c = chartsOf(outlookOf({ targets: [] }));
    expect(c.revenue.achievementPct).toBeNull();
    expect(c.revenue.headline).toContain('経営目標が未設定');
  });

  it('グラフ部品は、売上・営業利益それぞれの見通しと、単位・未算定の注記を描く', () => {
    const o = outlookOf({ departments: [dept([{ id: 'p', title: '新規開拓', financeEffect: confirmedUp({ operatingIncomeEffectYen: undefined }) }])] });
    const html = renderToStaticMarkup(<FinanceOutlookCharts charts={chartsOf(o)} />);
    expect(html).toContain('売上高の見通し');
    expect(html).toContain('営業利益の見通し');
    expect(html).toContain('単位：百万円');
    expect(html).toContain('未算定：2026年、2027年');
    expect(html).toContain('横ばい仮定');
  });
});
