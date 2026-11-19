import { currentFiscalYearOf, performanceViewOf, projectAchievementOf, projectTargetYenOf } from './performanceView';
import type { FinanceEffectTrialYear } from './financeEffectPlan';
import type { PlanActualProject } from './planActualComparison';
import type { PlTarget } from './unifiedPl';

const M = 1_000_000;

const trialYear = (fiscalYear: number, over: Partial<FinanceEffectTrialYear>): FinanceEffectTrialYear =>
  ({
    fiscalYear,
    revenueYen: 0,
    costReductionYen: 0,
    costIncreaseYen: 0,
    operatingEffectYen: 0,
    revenueOperatingIncomeYen: 0,
    grossProfitYen: null,
    ...over,
  }) as FinanceEffectTrialYear;

/* 株式会社ジャーナル（検証データ）の確認済み効果：2027年3月期は費用削減2.0−追加費用0.2、2030年3月期は売上15.0・営業利益6.5（OPEX控除後） */
const TRIAL = [
  trialYear(2027, { costReductionYen: 2 * M, costIncreaseYen: 0.2 * M, operatingEffectYen: 1.8 * M }),
  trialYear(2028, { revenueYen: 12 * M, revenueOperatingIncomeYen: 4.8 * M, costReductionYen: 2 * M, costIncreaseYen: 1.2 * M }),
  trialYear(2030, { revenueYen: 15 * M, revenueOperatingIncomeYen: 5.7 * M, costReductionYen: 2 * M, costIncreaseYen: 1.2 * M }),
];

const TARGET: PlTarget = { revenueYen: 175 * M, revenueDueYear: 2030, operatingIncomeYen: 8 * M, operatingIncomeDueYear: 2030 };
const CURRENT = { fiscalYear: 2025, revenueYen: 160 * M, operatingIncomeYen: 1.5 * M };
const NOW = new Date(2026, 10, 19);

/* 費用削減の実績：2026年11月に10万円（2027年3月期の一部・登録途中）。売上増加の実績は登録されていない */
const PROJECTS = [
  {
    deptIndex: 0,
    projectIndex: 0,
    deptName: '新聞販売・配達事業',
    projectTitle: '新聞購読世帯との継続接点',
    items: [
      {
        kind: 'COST_REDUCTION',
        plan: [{ fiscalYear: 2027, amountYen: 2 * M, months: ['2026-04', '2026-05', '2026-06', '2026-07', '2026-08', '2026-09', '2026-10', '2026-11', '2026-12', '2027-01', '2027-02', '2027-03'] }],
        actuals: [{ ym: '2026-11', amountYen: 100_000 }],
      },
    ],
  },
] as unknown as PlanActualProject[];

describe('当会計年度', () => {
  it('決算月3月なら、2026年11月は2027年3月期（当会計年度）', () => {
    expect(currentFiscalYearOf(NOW, 3)).toBe(2027);
    expect(currentFiscalYearOf(new Date(2027, 3, 1), 3)).toBe(2028);
  });

  it('決算月が未設定なら当会計年度は決められない（null）', () => {
    expect(currentFiscalYearOf(NOW, null)).toBeNull();
  });
});

describe('4本の棒：全社は現状と経営目標、プロジェクトは目標年度の財務効果と当会計年度の実績', () => {
  const sales = performanceViewOf({ metric: 'REVENUE', now: NOW, fiscalYearEnd: '3', current: CURRENT, target: TARGET, trialYears: TRIAL, projects: PROJECTS });
  const profit = performanceViewOf({ metric: 'OPERATING_INCOME', now: NOW, fiscalYearEnd: '3', current: CURRENT, target: TARGET, trialYears: TRIAL, projects: PROJECTS });

  it('売上高：160・175・15・未登録', () => {
    expect(sales.bars.map((b) => b.yen)).toEqual([160 * M, 175 * M, 15 * M, null]);
    expect(sales.bars.map((b) => b.periodLabel)).toEqual(['2025年度', '2030年度', '2030年度', '2027年3月期']);
    expect(sales.bars[3].unknownText).toBe('未登録');
  });

  it('営業利益：1.5・8.0・6.5・登録済み実績0.1（費用削減分・登録途中は参考値）', () => {
    expect(profit.bars.map((b) => b.yen)).toEqual([1.5 * M, 8 * M, 6.5 * M, 0.1 * M]);
    expect(profit.bars[3].note).toBe('登録途中の実績（参考値）（費用削減分）');
  });

  it('経営目標の目標年度が未登録なら、目標の棒は0にせず未登録と示す', () => {
    const v = performanceViewOf({
      metric: 'REVENUE',
      now: NOW,
      fiscalYearEnd: '3',
      current: CURRENT,
      target: { ...TARGET, revenueDueYear: null },
      trialYears: TRIAL,
      projects: PROJECTS,
    });
    expect(v.bars[2].yen).toBeNull();
    expect(v.bars[2].unknownText).toBe('目標年度が未登録のため算出しません');
  });
});

describe('当会計年度の目標・実績・達成率（同じ年度どうしだけで算出する）', () => {
  it('営業利益：目標1.8（2027年3月期）・実績0.1・達成率は参考値として5.6%', () => {
    const v = performanceViewOf({ metric: 'OPERATING_INCOME', now: NOW, fiscalYearEnd: '3', current: CURRENT, target: TARGET, trialYears: TRIAL, projects: PROJECTS });
    expect(v.current.periodLabel).toBe('2027年3月期');
    expect(v.current.targetYen).toBe(1.8 * M);
    expect(v.current.actualYen).toBe(0.1 * M);
    expect(v.current.achievement.pct).toBeCloseTo((0.1 / 1.8) * 100, 6);
    expect(v.current.achievement.reference).toBe(true);
  });

  it('売上高：目標が0円なので達成率は出さず、実績は未登録と示す', () => {
    const v = performanceViewOf({ metric: 'REVENUE', now: NOW, fiscalYearEnd: '3', current: CURRENT, target: TARGET, trialYears: TRIAL, projects: [] });
    expect(v.current.targetYen).toBe(0);
    expect(v.current.achievement.pct).toBeNull();
    expect(v.current.achievement.text).toBe('目標が0円のため算出しません');
    expect(v.current.actualUnknownText).toBe('未登録');
  });

  it('確定した実績（全月登録）の達成率は参考ではない', () => {
    const a = projectAchievementOf({ targetYen: 6.5 * M, actualYen: 3.25 * M, actualStatus: 'COMPLETE', periodLabel: '2030年3月期' });
    expect(a.pct).toBeCloseTo(50, 6);
    expect(a.reference).toBe(false);
  });
});

describe('確認済みの財務効果の年度値', () => {
  it('2027年3月期の営業利益は 1.8（費用削減 2.0 − 追加費用 0.2）、2030年3月期は売上 15.0・営業利益 6.5', () => {
    expect(projectTargetYenOf(TRIAL, 'OPERATING_INCOME', 2027)).toBe(1.8 * M);
    expect(projectTargetYenOf(TRIAL, 'REVENUE', 2030)).toBe(15 * M);
    expect(projectTargetYenOf(TRIAL, 'OPERATING_INCOME', 2030)).toBe(6.5 * M);
  });

  it('試算の期間外の年度は0にせず null', () => {
    expect(projectTargetYenOf(TRIAL, 'REVENUE', 2035)).toBeNull();
  });

  it('売上効果があり営業利益を算定できない年度は、営業利益を null（未算定）にする', () => {
    const trial = [trialYear(2028, { revenueYen: 12 * M, revenueOperatingIncomeYen: null })];
    expect(projectTargetYenOf(trial, 'OPERATING_INCOME', 2028)).toBeNull();
  });
});
