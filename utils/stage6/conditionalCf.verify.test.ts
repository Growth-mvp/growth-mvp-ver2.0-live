import type { Department, FinanceBSRow, FinancePLRow } from '@/types/strategy';
import { guardFinanceEffectConfirmation } from '@/lib/financeEffect';
import { buildCashFlowPlan, type CfAssumptions, type CashFlowInput, type CashFlowPlan } from './cashflow';
import type { DebtSchedule } from './debt';
import { buildFinanceEffectTrial, withoutTargetPath } from './financeEffectPlan';
import { buildConditionalCashFlow } from './conditionalCf';
import { buildUnifiedPl } from './unifiedPl';

/* 架空企業（単位：百万円。計算は円で入力）
 * 基準 FY2025：売上 1,000、営業利益 70、支払利息 2、減価償却費 10、税率 30%、現預金 200、売掛 100・棚卸 50・買掛 80
 * 基準CF（手計算）：税引後 47.6 + 減価償却 10 = 営業CF 57.6、期末 257.6 → 315.2 → 372.8（借入・投資なし）
 * 手計算の見方：効果の営業CFへの影響 ＝ 営業利益の増減 × (1 − 30%)
 */
const M = 1_000_000;
const YEARS = [2026, 2027, 2028];
const NO_INVESTMENT: CashFlowInput['investment'] = { yearlyByCategory: [], unclassifiedYen: 0, unscheduledYen: 0, candidateYen: 0, basisPendingYen: 0 };
const BS = [{ year: 2025, cash: 200 * M, ar: 100 * M, inventory: 50 * M, ap: 80 * M }] as FinanceBSRow[];
const PL = [{ year: 2025, revenue: 1_000 * M, operatingIncome: 70 * M, interest: 2 * M, depreciation: 10 * M }] as FinancePLRow[];
const ASSUMPTIONS: CfAssumptions = {
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

const v = (value: number) => ({ value, basis: 'USER' as const });
const debtOf = (years: { year: number; principal: number; interest: number }[]) =>
  ({
    years: years.map((y) => ({
      year: y.year,
      openingBalance: v(0),
      draw: v(0),
      principal: v(y.principal),
      closingBalance: v(0),
      newClosingBalance: v(0),
      interest: v(y.interest),
      debtService: v(y.principal + y.interest),
      existingPrincipal: v(0),
      existingInterest: v(0),
      newPrincipal: v(0),
      newInterest: v(0),
      dividends: v(0),
      holds: [],
    })),
    reconciliation: { status: 'NOT_ENTERED', statedTotalYen: null, stage1InterestBearingDebtYen: null, differenceYen: null },
    existingLoansEntered: false,
    newLoansEntered: false,
    globalHolds: [],
    assumptions: [],
  }) as unknown as DebtSchedule;

const baselineWith = (opts: {
  pl?: FinancePLRow[];
  assumptions?: CfAssumptions;
  debt?: DebtSchedule;
  investment?: CashFlowInput['investment'];
  bs?: FinanceBSRow[];
}): CashFlowPlan =>
  buildCashFlowPlan(
    {
      financePL: opts.pl ?? PL,
      financeBS: opts.bs ?? BS,
      investment: opts.investment ?? NO_INVESTMENT,
      assumptions: withoutTargetPath(opts.assumptions ?? ASSUMPTIONS),
      fiscalYearEndSet: true,
      debt: opts.debt,
    },
    2025,
  );

const dept = (name: string, projects: unknown[]) => ({ id: name, name, projects }) as unknown as Department;
const proj = (title: string, financeEffect?: unknown) => ({ id: title, title, financeEffect });
const confirmed = (over: Record<string, unknown>) => ({ confirmed: true, sourceNote: '見積書（架空）', ...over });

/* 費用削減 3：月 0.5、2025年10月〜2026年9月（FY2026 は3、FY2027 は3、FY2028 は0） */
const COST_REDUCTION_3 = confirmed({ kind: 'COST_REDUCTION', method: 'DIRECT_AMOUNT', directAmountYen: 500_000, amountBasis: 'MONTHLY', startYm: '2025-10', endYm: '2026-09' });
/* 追加費用 30：一回限り、2026年1月〜6月（FY2026 は15、FY2027 は15、FY2028 は0） */
const ADDITIONAL_COST_30 = confirmed({ kind: 'COST_INCREASE', method: 'DIRECT_AMOUNT', directAmountYen: 30 * M, amountBasis: 'TOTAL', startYm: '2026-01', endYm: '2026-06' });

function run(departments: Department[], baseline: CashFlowPlan, fiscalYearEnd = '3') {
  const trial = buildFinanceEffectTrial({ departments, fiscalYearEnd, fiscalYears: YEARS });
  const forecast = baseline.years.filter((y) => y.kind === 'FORECAST');
  const unified = buildUnifiedPl({
    baseline: forecast.map((y) => ({ fiscalYear: y.year, revenueYen: y.revenue.value, operatingIncomeYen: y.operatingIncome.value })),
    effects: trial.years,
    target: null,
  });
  return buildConditionalCashFlow({ baseline, unified });
}

const mil = (x: number | null) => (x === null ? null : Math.round((x / M) * 100) / 100);
const milAll = (xs: (number | null)[]) => xs.map(mil);

describe('確認1：費用削減の終了後、営業CFへの効果は止まるが、過去の現預金増加は残る', () => {
  it('FY2028 の営業CF差は 0、期末の差は 2.1 + 2.1 = 4.2 のまま残る（手計算）', () => {
    const base = baselineWith({});
    const c = run([dept('製造部', [proj('工程改善', COST_REDUCTION_3)])], base);
    expect(milAll(c.years.map((y) => y.operatingCf.deltaYen))).toEqual([2.1, 2.1, 0]);
    const diff = c.years.map((y, i) => mil((y.closingCashYen as number) - (y.baselineClosingCashYen as number)));
    expect(diff).toEqual([2.1, 4.2, 4.2]);
  });
});

describe('確認2：追加費用の終了後も、過去の支出による現預金減少は残る', () => {
  it('FY2028 の営業CF差は 0、期末の差は −10.5 − 10.5 = −21.0 のまま残る（手計算）', () => {
    const c = run([dept('製造部', [proj('設備保守の外注', ADDITIONAL_COST_30)])], baselineWith({}));
    expect(milAll(c.years.map((y) => y.operatingCf.deltaYen))).toEqual([-10.5, -10.5, 0]);
    const diff = c.years.map((y) => mil((y.closingCashYen as number) - (y.baselineClosingCashYen as number)));
    expect(diff).toEqual([-10.5, -21, -21]);
  });
});

describe('確認3：税率30%・費用削減3の営業CF増加は 2.1', () => {
  it('税引前 +3 × (1 − 0.3) = 2.1（他の条件は一定）', () => {
    const c = run([dept('製造部', [proj('工程改善', COST_REDUCTION_3)])], baselineWith({}));
    expect(mil(c.years[0].operatingCf.deltaYen)).toBe(2.1);
  });
});

describe('確認4：借入計画が未入力・未確定のとき、財務CFと期末現預金の表示が矛盾しない', () => {
  it('借入計画が未入力：財務CFは null、期末現預金は借入反映前（期首＋営業CF＋投資CF）と一致', () => {
    const c = run([dept('製造部', [proj('工程改善', COST_REDUCTION_3)])], baselineWith({}));
    expect(c.debtEnabled).toBe(false);
    expect(c.years.map((y) => y.financingCfYen)).toEqual([null, null, null]);
    // 手計算：期末 = 期首 + 営業CF + 投資CF（0）。FY2026 は 200 + 59.7 = 259.7
    for (const y of c.years) {
      expect(mil(y.closingCashYen as number)).toBe(mil((y.openingCashYen as number) + (y.operatingCf.conditionalYen as number) + (y.investingCfYen as number)));
    }
    expect(mil(c.years[0].closingCashYen)).toBe(259.7);
  });

  it('借入計画の一部の年度が欠ける：その年度の財務CFは未算定、期末も未算定、次年度以降も未算定', () => {
    // FY2026 だけ借入計画がある（返済0）。FY2027・FY2028 は計画がないため財務CFが決まらない
    const debt = debtOf([{ year: 2026, principal: 0, interest: 2 * M }]);
    const base = baselineWith({ debt });
    const c = run([dept('製造部', [proj('工程改善', COST_REDUCTION_3)])], base);
    expect(c.debtEnabled).toBe(true);
    expect(mil(c.years[0].closingCashYen)).toBe(259.7);
    expect(c.years[1].financingCfYen).toBeNull();
    expect(c.years[1].closingCashYen).toBeNull();
    expect(c.years[2].closingCashYen).toBeNull();
    expect(c.years[1].unknownReasons.join('')).toContain('財務CF');
  });
});

describe('確認5：売上増加に対応する原価が不明なら、営業利益・営業CF・期末現預金を推測で確定しない', () => {
  it('全年度 未算定。翌年度の期首も未算定として連鎖し、確定値を出さない', () => {
    const c = run([dept('営業部', [proj('新規開拓', confirmed({ kind: 'REVENUE_UP', method: 'DIRECT_AMOUNT', directAmountYen: 60 * M, amountBasis: 'ANNUAL', startYm: '2025-04' }))])], baselineWith({}));
    expect(c.years.map((y) => y.operatingIncomeYen)).toEqual([null, null, null]);
    expect(c.years.map((y) => y.operatingCf.conditionalYen)).toEqual([null, null, null]);
    expect(c.years.map((y) => y.closingCashYen)).toEqual([null, null, null]);
    expect(c.years[1].openingCashYen).toBeNull();
    expect(c.years[1].unknownReasons.join('')).toContain('前年度末の現預金が未確定');
  });
});

describe('確認6：設備投資・借入返済・運転資金が二重計上されない', () => {
  it('設備投資 40（FY2027）と元本返済 10（FY2027）は1回だけ反映。期末の差は効果分（OCF差）の累計と一致', () => {
    const debt = debtOf([
      { year: 2026, principal: 0, interest: 2 * M },
      { year: 2027, principal: 10 * M, interest: 2 * M },
      { year: 2028, principal: 0, interest: 2 * M },
    ]);
    const investment = { ...NO_INVESTMENT, yearlyByCategory: [{ fiscalYear: 2027, CAPEX: 40 * M, OPEX: 0, OTHER: 0 }] };
    const base = baselineWith({ debt, investment });
    const c = run([dept('製造部', [proj('工程改善', COST_REDUCTION_3)])], base);
    // 投資CF・財務CFは基準と同じ（効果で変わらない）
    expect(milAll(c.years.map((y) => y.investingCfYen))).toEqual([0, -40, 0]);
    expect(milAll(c.years.map((y) => y.financingCfYen))).toEqual([0, -10, 0]);
    // 期末の差 ＝ 営業CF差の累計（2.1, 2.1, 0 → 2.1, 4.2, 4.2）。投資・返済の差は含まれない
    const diff = c.years.map((y) => mil((y.closingCashYen as number) - (y.baselineClosingCashYen as number)));
    expect(diff).toEqual([2.1, 4.2, 4.2]);
    // 手計算の期末：259.7 → 269.4 → 327.0
    expect(milAll(c.years.map((y) => y.closingCashYen))).toEqual([259.7, 269.4, 327]);
  });

  it('運転資金は基準CFの増減をそのまま使い、効果分を二重に足さない（売上不変なので効果による運転資金の差は 0）', () => {
    const base = baselineWith({ assumptions: { ...ASSUMPTIONS, arRatio: 0.12 } });
    const c = run([dept('製造部', [proj('工程改善', COST_REDUCTION_3)])], base);
    // 基準の運転資金増減 20（FY2026）。条件付きCFの差は効果分 2.1 のみ
    expect(mil(base.years.find((y) => y.year === 2026)?.workingCapitalChange.value ?? null)).toBe(20);
    expect(milAll(c.years.map((y) => y.operatingCf.deltaYen))).toEqual([2.1, 2.1, 0]);
  });
});

describe('確認7：基準年度の税率・減価償却・支払利息が欠けると、未算定が正しく波及する', () => {
  it('支払利息が欠落（借入計画なし）：税引前が決まらず営業CF・期末現預金は未算定', () => {
    const pl = [{ year: 2025, revenue: 1_000 * M, operatingIncome: 70 * M, depreciation: 10 * M }] as FinancePLRow[];
    const c = run([dept('製造部', [proj('工程改善', COST_REDUCTION_3)])], baselineWith({ pl }));
    expect(c.years.map((y) => y.operatingCf.conditionalYen)).toEqual([null, null, null]);
    expect(c.years.map((y) => y.closingCashYen)).toEqual([null, null, null]);
    expect(c.years[0].unknownReasons.join('')).toContain('支払利息');
  });

  it('税率が未確定（利用者入力なし・税の実績なし）：営業CFは未算定、税率の表示も未算定', () => {
    const c = run([dept('製造部', [proj('工程改善', COST_REDUCTION_3)])], baselineWith({ assumptions: { ...ASSUMPTIONS, taxRate: null } }));
    expect(c.taxRate).toBeNull();
    expect(c.years.map((y) => y.operatingCf.conditionalYen)).toEqual([null, null, null]);
    expect(c.years[0].unknownReasons.join('')).toContain('税率');
  });

  it('減価償却費が欠落：営業CFは未算定', () => {
    const pl = [{ year: 2025, revenue: 1_000 * M, operatingIncome: 70 * M, interest: 2 * M }] as FinancePLRow[];
    const c = run([dept('製造部', [proj('工程改善', COST_REDUCTION_3)])], baselineWith({ pl }));
    expect(c.years.map((y) => y.operatingCf.conditionalYen)).toEqual([null, null, null]);
    expect(c.years[0].unknownReasons.join('')).toContain('減価償却費');
  });
});

describe('確認8：企業・戦略の切替、効果の確認解除、年度・決算月の変更で、前回の値が残らない', () => {
  it('確認解除：効果が外れ、基準CFと同じ期末に戻る（257.6・315.2・372.8）', () => {
    const prev = confirmed({ kind: 'COST_REDUCTION', method: 'DIRECT_AMOUNT', directAmountYen: 500_000, amountBasis: 'MONTHLY', startYm: '2025-10', endYm: '2026-09' });
    const released = guardFinanceEffectConfirmation(prev, { ...prev, directAmountYen: 600_000 });
    const c = run([dept('製造部', [proj('工程改善', released)])], baselineWith({}));
    expect(milAll(c.years.map((y) => y.closingCashYen))).toEqual([257.6, 315.2, 372.8]);
  });

  it('企業（戦略）切替：A → 別企業B → A で、A の結果は最初と同じ（残留なし）', () => {
    const stratA = [dept('製造部', [proj('工程改善', COST_REDUCTION_3)])];
    const stratB = [dept('製造部', [proj('設備保守の外注', ADDITIONAL_COST_30)])];
    const first = milAll(run(stratA, baselineWith({})).years.map((y) => y.closingCashYen));
    const other = milAll(run(stratB, baselineWith({})).years.map((y) => y.closingCashYen));
    const back = milAll(run(stratA, baselineWith({})).years.map((y) => y.closingCashYen));
    expect(other).toEqual([247.1, 294.2, 351.8]);
    expect(back).toEqual(first);
    expect(first).toEqual([259.7, 319.4, 377]);
  });

  it('決算月の変更：12月 → 3月 → 12月で結果が戻り、別の年度割り付けが残らない', () => {
    const annual12 = confirmed({ kind: 'COST_REDUCTION', method: 'DIRECT_AMOUNT', directAmountYen: 1_200_000, amountBasis: 'ANNUAL', startYm: '2026-01' });
    const dept12 = [dept('製造部', [proj('工程改善', annual12)])];
    const dec1 = milAll(run(dept12, baselineWith({}), '12').years.map((y) => y.closingCashYen));
    const mar = milAll(run(dept12, baselineWith({}), '3').years.map((y) => y.closingCashYen));
    const dec2 = milAll(run(dept12, baselineWith({}), '12').years.map((y) => y.closingCashYen));
    expect(dec1).toEqual([258.44, 316.88, 375.32]);
    expect(mar).toEqual([257.81, 316.25, 374.69]);
    expect(dec2).toEqual(dec1);
  });
});
