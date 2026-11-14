import type { CompanyTarget, FinanceBSRow, FinancePLRow } from '@/types/strategy';
import { gapText, buildTargetSummary, achievementPct } from '@/components/stage6/financeSummaryModel';
import { buildCashFlowPlan, type CfAssumptions } from './cashflow';
import { buildFinanceOutlook, forecastHorizonOf, type FinanceOutlookInput } from './financeOutlook';
import { withoutTargetPath } from './financeEffectPlan';
import type { FinancePlanDomain } from './financePlanSnapshot';

/* 手計算の前提（架空企業、百万円）
 * 基準：FY2026（2025年4月〜2026年3月）売上 1,000・営業利益 70。決算月3月。
 * 既存事業の増減（直近実績比の差額）：売上 +20/+40/+60/+80、営業利益 +2/+4/+6/+8（FY2027〜FY2030）
 * 確認済み施策：
 *   売上増加 年額 60（2026年4月開始）、営業利益への効果 年額 12
 *   費用削減 年額 1.2（2026年4月開始）
 *   追加費用 月額 5（2027年1〜6月の6か月＝30）
 * 未確認：売上増加 年額 100（効果に含めない）
 * 目標：売上 1,200・営業利益 80（いずれも FY2030）
 */
const M = 1_000_000;
const CURRENT_YEAR = 2026;
const PL: FinancePLRow[] = [{ year: 2026, revenue: 1_000 * M, operatingIncome: 70 * M, interest: 0 }];
const BS: FinanceBSRow[] = [{ year: 2026, cash: 100 * M, ar: 0, inventory: 0, ap: 0 }];

const targetsOf = (revenue: number, operating: number, dueYear = 2030) =>
  [
    { id: 't-rev', label: '売上', unit: '百万円', base: revenue, dueYear },
    { id: 't-op', label: '営業利益', unit: '百万円', base: operating, dueYear },
  ] as unknown as CompanyTarget[];

const ASSUMPTIONS: CfAssumptions = {
  minCashYen: 150 * M,
  taxRate: 0,
  depreciationYen: 0,
  arRatio: null,
  inventoryRatio: null,
  apRatio: null,
  targetRevenueYen: null,
  targetOperatingIncomeYen: null,
  targetYear: null,
  baseScenario: {
    2027: { revenueYen: 20 * M, operatingIncomeYen: 2 * M },
    2028: { revenueYen: 40 * M, operatingIncomeYen: 4 * M },
    2029: { revenueYen: 60 * M, operatingIncomeYen: 6 * M },
    2030: { revenueYen: 80 * M, operatingIncomeYen: 8 * M },
  },
};
const DOMAIN: FinancePlanDomain = { assumptions: ASSUMPTIONS, existingLoans: [], newLoans: [], dividendsYen: {} };

const confirmed = (over: Record<string, unknown>) => ({ confirmed: true, sourceNote: '見積書（架空）', source: 'USER_INPUT', ...over });

const DEPARTMENTS = [
  {
    id: 'd-sales',
    name: '営業部',
    projects: [
      {
        id: 'p-new',
        title: '新規開拓',
        financeEffect: confirmed({
          kind: 'REVENUE_UP',
          method: 'DIRECT_AMOUNT',
          directAmountYen: 60 * M,
          amountBasis: 'ANNUAL',
          startYm: '2026-04',
          operatingIncomeEffectYen: 12 * M,
        }),
      },
      {
        id: 'p-draft',
        title: '未確認の受注',
        financeEffect: {
          kind: 'REVENUE_UP',
          method: 'DIRECT_AMOUNT',
          directAmountYen: 100 * M,
          amountBasis: 'ANNUAL',
          startYm: '2026-04',
          operatingIncomeEffectYen: 20 * M,
          confirmed: false,
          source: 'USER_INPUT',
          sourceNote: '未確認（架空）',
        },
      },
    ],
  },
  {
    id: 'd-mfg',
    name: '製造部',
    projects: [
      {
        id: 'p-kaizen',
        title: '工程改善',
        financeEffect: confirmed({ kind: 'COST_REDUCTION', method: 'DIRECT_AMOUNT', directAmountYen: 1_200_000, amountBasis: 'ANNUAL', startYm: '2026-04' }),
      },
      {
        id: 'p-outsource',
        title: '設備保守の外注',
        financeEffect: confirmed({
          kind: 'COST_INCREASE',
          method: 'DIRECT_AMOUNT',
          directAmountYen: 5 * M,
          amountBasis: 'MONTHLY',
          startYm: '2027-01',
          endYm: '2027-06',
        }),
      },
    ],
  },
] as unknown as FinanceOutlookInput['departments'];

const outlookOf = (over: Partial<FinanceOutlookInput> = {}) =>
  buildFinanceOutlook({
    financePL: PL,
    financeBS: BS,
    departments: DEPARTMENTS,
    fiscalYearEnd: '3',
    companyTargets: targetsOf(1_200, 80),
    domain: DOMAIN,
    currentYear: CURRENT_YEAR,
    ...over,
  });

const mil = (yen: number | null) => (yen === null ? null : yen / M);
const yearOf = (o: ReturnType<typeof outlookOf>, fy: number) => o.unifiedPl.years.find((y) => y.fiscalYear === fy)!;

describe('予測期間：経営目標の年度まで延ばす（最低3年）', () => {
  it('2030年度の目標があれば、予測は FY2027〜FY2030 の4年', () => {
    expect(forecastHorizonOf(PL, CURRENT_YEAR, targetsOf(1_200, 80))).toBe(4);
    const o = outlookOf();
    expect(o.baselinePlan.years.filter((y) => y.kind === 'FORECAST').map((y) => y.year)).toEqual([2027, 2028, 2029, 2030]);
    expect(o.unifiedPl.years.map((y) => y.fiscalYear)).toEqual([2027, 2028, 2029, 2030]);
  });

  it('目標がない・目標年度が基準年度以前なら、従来どおり3年', () => {
    expect(forecastHorizonOf(PL, CURRENT_YEAR, [])).toBe(3);
    expect(forecastHorizonOf(PL, CURRENT_YEAR, targetsOf(1_200, 80, 2026))).toBe(3);
    expect(outlookOf({ companyTargets: [] }).unifiedPl.years.map((y) => y.fiscalYear)).toEqual([2027, 2028, 2029]);
  });
});

describe('3系列の年度別期待値（既存事業・施策効果反映・経営目標）', () => {
  it('① 既存事業の見通し：直近実績＋年度別増減（施策効果は含まない）', () => {
    const o = outlookOf();
    const expected: Record<number, [number, number]> = { 2027: [1_020, 72], 2028: [1_040, 74], 2029: [1_060, 76], 2030: [1_080, 78] };
    for (const [fy, [rev, oi]] of Object.entries(expected)) {
      const b = yearOf(o, Number(fy)).baseline;
      expect(mil(b.revenueYen)).toBeCloseTo(rev, 6);
      expect(mil(b.operatingIncomeYen)).toBeCloseTo(oi, 6);
    }
  });

  it('② 施策効果反映後：確認済みの効果だけを加算。未確認の売上100は入らない', () => {
    const o = outlookOf();
    const expected: Record<number, [number, number]> = { 2027: [1_080, 70.2], 2028: [1_100, 72.2], 2029: [1_120, 89.2], 2030: [1_140, 91.2] };
    for (const [fy, [rev, oi]] of Object.entries(expected)) {
      const p = yearOf(o, Number(fy)).plan;
      expect(mil(p.revenueYen)).toBeCloseTo(rev, 6);
      expect(mil(p.operatingIncomeYen)).toBeCloseTo(oi, 6);
    }
    expect(o.effectTrial.excluded.map((e) => e.projectTitle)).toContain('未確認の受注');
  });

  it('FY2027 の営業利益 70.2 の内訳：基準 72 ＋ 売上増加の営業利益 12 ＋ 費用削減 1.2 − 追加費用 15', () => {
    const y = yearOf(outlookOf(), 2027);
    expect(mil(y.baseline.operatingIncomeYen)).toBeCloseTo(72, 6);
    expect(mil(y.effect.revenueOperatingIncomeYen)).toBeCloseTo(12, 6);
    expect(mil(y.effect.costReductionYen)).toBeCloseTo(1.2, 6);
    expect(mil(y.effect.costIncreaseYen)).toBeCloseTo(15, 6);
    expect(mil(y.plan.operatingIncomeYen)).toBeCloseTo(72 + 12 + 1.2 - 15, 6);
  });

  it('費用の発生期間：追加費用は2027年1〜6月の6か月で、FY2027（1〜3月）とFY2028（4〜6月）に各15', () => {
    const o = outlookOf();
    expect(mil(yearOf(o, 2027).effect.costIncreaseYen)).toBeCloseTo(15, 6);
    expect(mil(yearOf(o, 2028).effect.costIncreaseYen)).toBeCloseTo(15, 6);
    expect(mil(yearOf(o, 2029).effect.costIncreaseYen)).toBeCloseTo(0, 6);
  });

  it('③ 経営目標：予測に加算しない。FY2030 の②は目標（1,200）ではなく 1,140', () => {
    const o = outlookOf();
    expect(mil(yearOf(o, 2030).plan.revenueYen)).toBeCloseTo(1_140, 6);
    expect(mil(o.target.revenueYen)).toBeCloseTo(1_200, 6);
  });
});

describe('2030年度の目標との比較（差額・達成率）', () => {
  it('売上は 1,200 − 1,140 = 60 の不足、営業利益は 80 − 91.2 = −11.2（達成）', () => {
    const o = outlookOf();
    expect(mil(o.unifiedPl.gap!.revenue.valueYen)).toBeCloseTo(60, 6);
    expect(o.unifiedPl.gap!.revenue.fiscalYear).toBe(2030);
    expect(mil(o.unifiedPl.gap!.operatingIncome.valueYen)).toBeCloseTo(-11.2, 6);
    expect(o.unifiedPl.gap!.operatingIncome.fiscalYear).toBe(2030);
  });

  it('達成率は 売上 95.0%、営業利益 114.0%', () => {
    const o = outlookOf();
    const summary = buildTargetSummary({ unifiedPl: o.unifiedPl, target: o.target });
    expect(achievementPct(summary.revenue)).toBeCloseTo(95.0, 6);
    expect(achievementPct(summary.operatingIncome)).toBeCloseTo(114.0, 6);
  });

  it('差額がゼロなら「目標どおり（差額なし）」と表示する（売上の目標を②の1,140にそろえる）', () => {
    const o = outlookOf({ companyTargets: targetsOf(1_140, 80) });
    expect(o.unifiedPl.gap!.revenue.valueYen).toBe(0);
    expect(gapText(o.unifiedPl.gap!.revenue.valueYen!)).toBe('目標どおり（差額なし）');
  });
});

describe('未確認の効果と、STAGE5の進捗率は加算されない', () => {
  it('STAGE5の進捗率の項目（impact…Progress）があっても、②は変わらない', () => {
    const withProgress = JSON.parse(JSON.stringify(DEPARTMENTS)) as typeof DEPARTMENTS;
    Object.assign(withProgress[0].projects[0], {
      impactRevenueMJPY: 999,
      impactRevenueProgress: 100,
      impactOpIncomeMJPY: 999,
      impactOpIncomeProgress: 100,
    });
    expect(outlookOf({ departments: withProgress }).unifiedPl).toEqual(outlookOf().unifiedPl);
  });
});

describe('資金判定の前提（既存事業の増減＋確認済み効果）', () => {
  const investment = { yearlyByCategory: [], unclassifiedYen: 0, unscheduledYen: 0, candidateYen: 0, basisPendingYen: 0 };

  const fundingPlanOf = (assumptions: CfAssumptions, unified: ReturnType<typeof outlookOf>['unifiedPl']) =>
    buildCashFlowPlan(
      {
        financePL: PL,
        financeBS: BS,
        investment,
        assumptions: withoutTargetPath(assumptions),
        fiscalYearEndSet: true,
        yearlyOverride: Object.fromEntries(unified.years.map((r) => [r.fiscalYear, { revenueYen: r.plan.revenueYen, operatingIncomeYen: r.plan.operatingIncomeYen }])),
        horizonYears: 4,
      },
      CURRENT_YEAR,
    );

  it('営業CF＝統一PLの営業利益（税率0・減価償却0・運転資金0の検証条件）。現預金は FY2027〜FY2030 で 170.2 / 242.4 / 331.6 / 422.8', () => {
    const unified = outlookOf().unifiedPl;
    const plan = fundingPlanOf(ASSUMPTIONS, unified);
    const forecast = plan.years.filter((y) => y.kind === 'FORECAST');
    const rounded = (yen: number | null) => (yen === null ? null : Math.round(yen / M * 1e6) / 1e6);
    expect(forecast.map((y) => rounded(y.operatingCf.value))).toEqual([70.2, 72.2, 89.2, 91.2]);
    expect(forecast.map((y) => rounded(y.closingCashBeforeFinancing.value))).toEqual([170.2, 242.4, 331.6, 422.8]);
  });

  it('目標補間の前提を入れても、資金判定の計算は変わらない（TARGET_PATHは使わない）', () => {
    const unified = outlookOf().unifiedPl;
    const withTarget: CfAssumptions = { ...ASSUMPTIONS, targetRevenueYen: 1_200 * M, targetOperatingIncomeYen: 80 * M, targetYear: 2030 };
    const a = fundingPlanOf(ASSUMPTIONS, unified).years.map((y) => y.closingCashBeforeFinancing.value);
    const b = fundingPlanOf(withTarget, unified).years.map((y) => y.closingCashBeforeFinancing.value);
    expect(b).toEqual(a);
  });
});
