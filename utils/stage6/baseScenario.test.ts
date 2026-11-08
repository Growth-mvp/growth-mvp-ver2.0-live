import type { FinanceBSRow, FinancePLRow } from '@/types/strategy';
import { buildCashFlowPlan, normalizeBaseScenario, type CfAssumptions } from './cashflow';
import { buildStoredFinancePlan, hashOf, readStoredFinancePlan, toSavedFinancePlan, type CalcSnapshotMeta, type FinancePlanDomain } from './financePlanSnapshot';

/* 手計算の前提（架空企業、百万円）
 * 基準（直近実績）：2024年度 売上 1,000・営業利益 70。予測は 2025〜2027 年度（3年）
 */
const M = 1_000_000;
const CURRENT_YEAR = 2025;
const PL: FinancePLRow[] = [{ year: 2024, revenue: 1_000 * M, operatingIncome: 70 * M, interest: 0 }];
const BS: FinanceBSRow[] = [{ year: 2024, cash: 100 * M, ar: 150 * M, inventory: 50 * M, ap: 80 * M }];
const INVESTMENT = { yearlyByCategory: [], unclassifiedYen: 0, unscheduledYen: 0, candidateYen: 0, basisPendingYen: 0 };

const BASE: CfAssumptions = {
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

const planOf = (assumptions: CfAssumptions) =>
  buildCashFlowPlan({ financePL: PL, financeBS: BS, investment: INVESTMENT, assumptions, fiscalYearEndSet: true }, CURRENT_YEAR);
const forecast = (assumptions: CfAssumptions) => planOf(assumptions).years.filter((y) => y.kind === 'FORECAST');

describe('既存事業のベースシナリオ（年度別の増減）', () => {
  it('未設定（undefined・空・全年度が未入力）は従来の横ばい計算と完全に一致する', () => {
    const plain = planOf(BASE);
    expect(planOf({ ...BASE, baseScenario: undefined })).toEqual(plain);
    expect(planOf({ ...BASE, baseScenario: normalizeBaseScenario({ 2025: { revenueYen: null, operatingIncomeYen: null } }) })).toEqual(plain);
    expect(plain.basisMode).toBe('FLAT');
    expect(forecast(BASE).map((y) => y.revenue.value)).toEqual([1_000 * M, 1_000 * M, 1_000 * M]);
  });

  it('売上と営業利益の増減を年度別に反映する（直近実績からの差額）', () => {
    const years = forecast({
      ...BASE,
      baseScenario: {
        2025: { revenueYen: 50 * M, operatingIncomeYen: 5 * M },
        2026: { revenueYen: -20 * M, operatingIncomeYen: -10 * M },
      },
    });
    expect(years.map((y) => y.revenue.value)).toEqual([1_050 * M, 980 * M, 1_000 * M]);
    expect(years.map((y) => y.operatingIncome.value)).toEqual([75 * M, 60 * M, 70 * M]);
    expect(years[0].revenue.basis).toBe('USER');
    expect(planOf({ ...BASE, baseScenario: { 2025: { revenueYen: 1, operatingIncomeYen: 1 } } }).basisMode).toBe('BASE_SCENARIO');
  });

  it('売上だけ増減し営業利益が未入力の年度は、営業利益を推定せず未算定にする（0にしない）', () => {
    const plan = planOf({ ...BASE, baseScenario: { 2025: { revenueYen: 50 * M, operatingIncomeYen: null } } });
    const y = plan.years.find((r) => r.year === 2025)!;
    expect(y.revenue.value).toBe(1_050 * M);
    expect(y.operatingIncome.value).toBeNull();
    expect(y.operatingIncome.note).toContain('未入力のため未算定');
    expect(y.operatingCf.value).toBeNull();
    expect(plan.years.find((r) => r.year === 2026)!.operatingIncome.value).toBe(70 * M);
  });

  it('営業利益だけを増減した場合、売上は横ばいのまま営業利益だけが動く', () => {
    const years = forecast({ ...BASE, baseScenario: { 2026: { revenueYen: null, operatingIncomeYen: 8 * M } } });
    expect(years.map((y) => y.revenue.value)).toEqual([1_000 * M, 1_000 * M, 1_000 * M]);
    expect(years.map((y) => y.operatingIncome.value)).toEqual([70 * M, 78 * M, 70 * M]);
  });

  it('赤字（営業利益のマイナス）も扱え、0に丸めない', () => {
    const years = forecast({ ...BASE, baseScenario: { 2025: { revenueYen: -300 * M, operatingIncomeYen: -120 * M } } });
    expect(years[0].revenue.value).toBe(700 * M);
    expect(years[0].operatingIncome.value).toBe(-50 * M);
  });

  it('経営目標の参考経路は、既存事業の年度別増減を無視せず、その値を起点に目標年度へ差を直線で加える', () => {
    const plan = planOf({
      ...BASE,
      targetRevenueYen: 1_200 * M,
      targetOperatingIncomeYen: 100 * M,
      targetYear: 2027,
      baseScenario: { 2025: { revenueYen: 50 * M, operatingIncomeYen: 5 * M } },
    });
    expect(plan.basisMode).toBe('TARGET_PATH');
    // 2025年度：既存事業 1,050 ＋（目標 1,200 − 2027年度の既存事業 1,000）× 1/3
    expect(plan.years.find((y) => y.year === 2025)!.revenue.value).toBeCloseTo(1_050 * M + (200 * M) / 3, 0);
    expect(plan.years.find((y) => y.year === 2027)!.revenue.value).toBe(1_200 * M);
    // 2026年度：既存事業は横ばい 1,000、残差は 2/3
    expect(plan.years.find((y) => y.year === 2026)!.revenue.value).toBeCloseTo(1_000 * M + (200 * M) * (2 / 3), 0);
    expect(plan.globalHolds.join('')).toContain('既存事業の年度別増減を起点');
  });

  it('目標を設定しない場合の参考経路は、従来の直線補間と同じ値になる', () => {
    const withTarget = forecast({ ...BASE, targetRevenueYen: 1_300 * M, targetYear: 2027 }).map((y) => y.revenue.value);
    // 従来式：基準 1,000 から目標 1,300 へ 2027年度に到達（2025・2026年度は 1/3、2/3）
    expect(withTarget).toEqual([1_100 * M, 1_200 * M, 1_300 * M]);
  });

  it('増減の入力は保存・読込で失われず、ハッシュも変わらない', () => {
    const domain: FinancePlanDomain = {
      assumptions: { ...BASE, minCashYen: 50 * M, baseScenario: { 2026: { revenueYen: -20 * M, operatingIncomeYen: null } } },
      existingLoans: [],
      newLoans: [],
      dividendsYen: {},
    };
    const meta = {
      calcVersion: 'phase4a-v1',
      companyId: 'c1',
      baseYear: 2024,
      bsBaseYear: 2024,
      assumptionsHash: '',
      sourceHash: 'h',
      unconfirmed: { unapprovedReadyYen: 0, unclassifiedYen: 0, unscheduledYen: 0, candidateYen: 0, basisPendingYen: 0 },
      computedAt: '2025-01-01T00:00:00.000Z',
    } as CalcSnapshotMeta;
    const before = hashOf(toSavedFinancePlan(domain));
    const saved = JSON.parse(JSON.stringify(buildStoredFinancePlan({ domain, companyId: 'c1', meta, savedAt: '2025-01-01T00:00:00.000Z' })));
    const reloaded = readStoredFinancePlan(saved, 'c1');
    expect(reloaded.kind).toBe('OK');
    if (reloaded.kind !== 'OK') return;
    expect(reloaded.domain.assumptions.baseScenario).toEqual({ 2026: { revenueYen: -20 * M, operatingIncomeYen: null } });
    expect(hashOf(toSavedFinancePlan(reloaded.domain))).toBe(before);
  });

  it('増減のない既存データは、保存・読込しても形式が変わらない（既存データを壊さない）', () => {
    const domain: FinancePlanDomain = { assumptions: { ...BASE, minCashYen: 50 * M }, existingLoans: [], newLoans: [], dividendsYen: {} };
    const saved = JSON.parse(JSON.stringify(toSavedFinancePlan(domain)));
    expect(saved.cashFlow).not.toHaveProperty('baseScenario');
  });
});
