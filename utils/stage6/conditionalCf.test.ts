import type { Department, FinanceBSRow, FinancePLRow } from '@/types/strategy';
import { guardFinanceEffectConfirmation } from '@/lib/financeEffect';
import { buildCashFlowPlan, type CashFlowInput, type CfAssumptions, type CashFlowPlan } from './cashflow';
import type { DebtSchedule } from './debt';
import { buildFinanceEffectTrial, withoutTargetPath } from './financeEffectPlan';
import { buildConditionalCashFlow } from './conditionalCf';
import { buildUnifiedPl } from './unifiedPl';

/* 架空企業の前提（単位：百万円。計算には円に換算して入力）
 * 基準年度 FY2025：売上 1,000、営業利益 70、支払利息 2、減価償却費 10（利用者指定）、税率 30%（利用者指定）
 * 基準年度の現預金 200、売掛金 100、棚卸資産 50、買掛金 80（比率は基準年度の残高÷売上で据え置き）
 * 手計算の基準CF：税引前 68、税引後 47.6、営業CF 47.6 + 10 = 57.6、運転資金増減 0、投資CF 0
 *   → 期末現預金 FY2026 257.6、FY2027 315.2、FY2028 372.8
 */
const M = 1_000_000;
const YEARS = [2026, 2027, 2028];

const FINANCE_PL = [{ year: 2025, revenue: 1_000 * M, operatingIncome: 70 * M, interest: 2 * M, depreciation: 10 * M }] as FinancePLRow[];
const FINANCE_BS = [{ year: 2025, cash: 200 * M, ar: 100 * M, inventory: 50 * M, ap: 80 * M }] as FinanceBSRow[];
const NO_INVESTMENT: CashFlowInput['investment'] = { yearlyByCategory: [], unclassifiedYen: 0, unscheduledYen: 0, candidateYen: 0, basisPendingYen: 0 };

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

const v = (value: number, basis: 'USER' | 'ESTIMATE' = 'USER') => ({ value, basis });

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

const baselineCf = (assumptions: CfAssumptions = ASSUMPTIONS, debt?: DebtSchedule, investment = NO_INVESTMENT): CashFlowPlan =>
  buildCashFlowPlan(
    { financePL: FINANCE_PL, financeBS: FINANCE_BS, investment, assumptions: withoutTargetPath(assumptions), fiscalYearEndSet: true, debt },
    2025,
  );

const dept = (name: string, projects: unknown[]) => ({ id: name, name, projects }) as unknown as Department;
const proj = (title: string, financeEffect?: unknown, extra: Record<string, unknown> = {}) => ({ id: title, title, financeEffect, ...extra });
const confirmed = (over: Record<string, unknown>) => ({ confirmed: true, sourceNote: '見積書（架空）', ...over });

/* 費用削減：月 0.5 百万円、2025年10月〜2026年9月。決算3月なら FY2026 は 10〜3月の6か月（3）、FY2027 は 4〜9月の6か月（3）、FY2028 は 0 */
const COST_REDUCTION_3 = confirmed({ kind: 'COST_REDUCTION', method: 'DIRECT_AMOUNT', directAmountYen: 500_000, amountBasis: 'MONTHLY', startYm: '2025-10', endYm: '2026-09' });
/* 追加費用：一回限り 30 百万円、2026年1月〜6月。FY2026 は 1〜3月（15）、FY2027 は 4〜6月（15）、FY2028 は 0 */
const ADDITIONAL_COST_30 = confirmed({ kind: 'COST_INCREASE', method: 'DIRECT_AMOUNT', directAmountYen: 30 * M, amountBasis: 'TOTAL', startYm: '2026-01', endYm: '2026-06' });
/* 売上増加：年額 60 百万円、2025年4月開始（FY2026〜FY2028 とも 12か月分） */
const REVENUE_UP_60 = confirmed({ kind: 'REVENUE_UP', method: 'DIRECT_AMOUNT', directAmountYen: 60 * M, amountBasis: 'ANNUAL', startYm: '2025-04' });

function conditional(departments: Department[], baseline: CashFlowPlan, fiscalYearEnd = '3') {
  const trial = buildFinanceEffectTrial({ departments, fiscalYearEnd, fiscalYears: YEARS });
  const baseYears = baseline.years.filter((y) => y.kind === 'FORECAST');
  const unified = buildUnifiedPl({
    baseline: baseYears.map((y) => ({ fiscalYear: y.year, revenueYen: y.revenue.value, operatingIncomeYen: y.operatingIncome.value })),
    effects: trial.years,
    target: null,
  });
  return buildConditionalCashFlow({ baseline, unified });
}

const closings = (c: ReturnType<typeof conditional>) => c.years.map((y) => y.closingCashYen);
const toMil = (xs: (number | null)[]) => xs.map((x) => (x === null ? null : Math.round((x / M) * 100) / 100));

describe('条件付きCF：基準CF（横ばい）と手計算の期待値', () => {
  it('基準：効果なしの期末現預金は 257.6・315.2・372.8（税引後47.6＋減価償却10＝営業CF57.6）', () => {
    const c = conditional([dept('製造部', [proj('工程改善')])], baselineCf());
    expect(toMil(closings(c))).toEqual([257.6, 315.2, 372.8]);
    expect(toMil(c.years.map((y) => y.operatingCf.conditionalYen))).toEqual([57.6, 57.6, 57.6]);
  });

  it('A 費用削減のみ：税引前 +3 → 税引後 +2.1 → 期末 259.7・319.4・377.0（FY2028は効果なし）', () => {
    const c = conditional([dept('製造部', [proj('工程改善', COST_REDUCTION_3)])], baselineCf());
    expect(toMil(c.years.map((y) => y.operatingIncomeYen))).toEqual([73, 73, 70]);
    expect(toMil(c.years.map((y) => y.operatingCf.deltaYen))).toEqual([2.1, 2.1, 0]);
    expect(toMil(closings(c))).toEqual([259.7, 319.4, 377]);
  });

  it('B 追加費用のみ：税引前 −15 → 税引後 −10.5 → 期末 247.1・294.2・351.8', () => {
    const c = conditional([dept('製造部', [proj('設備保守の外注', ADDITIONAL_COST_30)])], baselineCf());
    expect(toMil(c.years.map((y) => y.operatingIncomeYen))).toEqual([55, 55, 70]);
    expect(toMil(c.years.map((y) => y.operatingCf.deltaYen))).toEqual([-10.5, -10.5, 0]);
    expect(toMil(closings(c))).toEqual([247.1, 294.2, 351.8]);
  });

  it('C 売上増加（原価不明）：営業利益・営業CF・期末現預金は全年度未算定（根拠のない営業CFを作らない）', () => {
    const c = conditional([dept('営業部', [proj('新規開拓', REVENUE_UP_60)])], baselineCf());
    expect(c.years.map((y) => y.operatingIncomeYen)).toEqual([null, null, null]);
    expect(c.years.map((y) => y.operatingCf.conditionalYen)).toEqual([null, null, null]);
    expect(closings(c)).toEqual([null, null, null]);
    expect(c.years[0].unknownReasons.join('')).toContain('売上増加の原価が不明');
    // 基準CFの値は残る（比較用）
    expect(toMil(c.years.map((y) => y.operatingCf.baselineYen))).toEqual([57.6, 57.6, 57.6]);
  });

  it('D 運転資金の増減：売掛金比率を 12% にすると FY2026 の運転資金が +20 増え、営業CF 37.6・期末 237.6（効果と独立に反映される）', () => {
    const baseline = baselineCf({ ...ASSUMPTIONS, arRatio: 0.12 });
    // 手計算：比率 12% + 棚卸 5% − 買掛 8% = 9%、売上 1,000 → 運転資金 90、基準 70 → 増加 20
    expect(toMil(baseline.years.filter((y) => y.kind === 'FORECAST').map((y) => y.workingCapitalChange.value))).toEqual([20, 0, 0]);
    const plain = conditional([dept('製造部', [proj('工程改善')])], baseline);
    expect(toMil(plain.years.map((y) => y.operatingCf.conditionalYen))).toEqual([37.6, 57.6, 57.6]);
    expect(toMil(closings(plain))).toEqual([237.6, 295.2, 352.8]);
    // 費用削減と組み合わせても、運転資金の影響は残ったまま加算される
    const withEffect = conditional([dept('製造部', [proj('工程改善', COST_REDUCTION_3)])], baseline);
    expect(toMil(withEffect.years.map((y) => y.operatingCf.conditionalYen))).toEqual([39.7, 59.7, 57.6]);
    expect(toMil(closings(withEffect))).toEqual([239.7, 299.4, 357]);
  });

  it('E 設備投資と借入返済：FY2027 に投資 40、元本返済 10。費用削減 A と組み合わせた期末現預金', () => {
    const debt = debtOf([
      { year: 2026, principal: 0, interest: 2 * M },
      { year: 2027, principal: 10 * M, interest: 2 * M },
      { year: 2028, principal: 0, interest: 2 * M },
    ]);
    const investment = { ...NO_INVESTMENT, yearlyByCategory: [{ fiscalYear: 2027, CAPEX: 40 * M, OPEX: 0, OTHER: 0 }] };
    const baseline = baselineCf(ASSUMPTIONS, debt, investment);
    // 基準：FY2026 257.6 → FY2027 257.6+57.6−40 = 275.2 → 借入返済後 265.2 → FY2028 322.8
    const base = conditional([dept('製造部', [proj('工程改善')])], baseline);
    expect(toMil(base.years.map((y) => y.investingCfYen))).toEqual([0, -40, 0]);
    expect(toMil(base.years.map((y) => y.financingCfYen))).toEqual([0, -10, 0]);
    expect(toMil(closings(base))).toEqual([257.6, 265.2, 322.8]);
    // 費用削減 A：FY2026 259.7 → FY2027 259.7+59.7−40 = 279.4 → 返済後 269.4 → FY2028 327.0
    const withEffect = conditional([dept('製造部', [proj('工程改善', COST_REDUCTION_3)])], baseline);
    expect(toMil(closings(withEffect))).toEqual([259.7, 269.4, 327]);
    // 投資CF・財務CFは効果の有無で変わらない
    expect(toMil(withEffect.years.map((y) => y.investingCfYen))).toEqual([0, -40, 0]);
  });

  it('F 複数年度・決算月：12月決算は FY2026 も 1.2、3月決算は FY2026 が 0.3（2026年1月開始・年額 1.2）', () => {
    const annual12 = confirmed({ kind: 'COST_REDUCTION', method: 'DIRECT_AMOUNT', directAmountYen: 1_200_000, amountBasis: 'ANNUAL', startYm: '2026-01' });
    const baseline = baselineCf();
    // 手計算（税引後 ×0.7）：12月決算 ΔOCF 0.84 × 3年 → 期末 258.44・316.88・375.32
    const dec = conditional([dept('製造部', [proj('工程改善', annual12)])], baseline, '12');
    expect(toMil(dec.years.map((y) => y.operatingCf.deltaYen))).toEqual([0.84, 0.84, 0.84]);
    expect(toMil(closings(dec))).toEqual([258.44, 316.88, 375.32]);
    // 3月決算：FY2026 は 0.3 → ΔOCF 0.21、FY2027・FY2028 は 1.2 → 0.84 → 期末 257.81・316.25・374.69
    const mar = conditional([dept('製造部', [proj('工程改善', annual12)])], baseline, '3');
    expect(toMil(mar.years.map((y) => y.operatingCf.deltaYen))).toEqual([0.21, 0.84, 0.84]);
    expect(toMil(closings(mar))).toEqual([257.81, 316.25, 374.69]);
  });

  it('G 旧金額・目標・financeEffectの共存：旧北極星の金額と経営目標（売上 1,500・FY2028）は条件付きCFに入らない', () => {
    const withTarget = { ...ASSUMPTIONS, targetRevenueYen: 1_500 * M, targetYear: 2028 };
    const legacy = proj('工程改善', COST_REDUCTION_3, { impactRevenueMJPY: 50, impactOpIncomeMJPY: 5 });
    const c = conditional([dept('製造部', [legacy])], baselineCf(withTarget));
    // 費用削減 A と同じ結果（259.7・319.4・377.0）
    expect(toMil(closings(c))).toEqual([259.7, 319.4, 377]);
    // 既存の目標経路つきのCF表は別に残っている（上書きしない）
    const existing = buildCashFlowPlan(
      { financePL: FINANCE_PL, financeBS: FINANCE_BS, investment: NO_INVESTMENT, assumptions: withTarget, fiscalYearEndSet: true },
      2025,
    );
    expect(existing.years.find((y) => y.year === 2028)?.revenue.value).toBe(1_500 * M);
  });

  it('H 確認解除・企業切替：金額を変えて確認が外れた効果は外れ、戦略を戻すと元の結果に戻る', () => {
    const prev = confirmed({ kind: 'COST_REDUCTION', method: 'DIRECT_AMOUNT', directAmountYen: 500_000, amountBasis: 'MONTHLY', startYm: '2025-10', endYm: '2026-09' });
    const released = guardFinanceEffectConfirmation(prev, { ...prev, directAmountYen: 600_000 });
    expect(released?.confirmed).toBe(false);
    const cReleased = conditional([dept('製造部', [proj('工程改善', released)])], baselineCf());
    expect(toMil(closings(cReleased))).toEqual([257.6, 315.2, 372.8]);

    const stratA = [dept('製造部', [proj('工程改善', COST_REDUCTION_3)])];
    const stratB = [dept('製造部', [proj('設備保守の外注', ADDITIONAL_COST_30)])];
    const a1 = closings(conditional(stratA, baselineCf()));
    const b = closings(conditional(stratB, baselineCf()));
    const a2 = closings(conditional(stratA, baselineCf()));
    expect(toMil(b)).toEqual([247.1, 294.2, 351.8]);
    expect(a2).toEqual(a1);
  });
});
