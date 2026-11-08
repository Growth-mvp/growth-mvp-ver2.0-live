import type { CompanyTarget, Department, FinanceBSRow, FinancePLRow } from '@/types/strategy';
import { computeFinanceEffect } from '@/lib/financeEffect';
import { buildFinanceOutlook, type FinanceOutlookInput } from './financeOutlook';
import type { CfAssumptions } from './cashflow';
import type { FinancePlanDomain } from './financePlanSnapshot';

/* 手計算の前提（架空企業、百万円）
 * 基準：2024年度 売上 1,000・営業利益 70。決算月3月。予測 2025〜2027（FY2026 = 2025年4月〜2026年3月）
 * 既存事業の増減（保存済み前提）：2026年度 売上 +20・営業利益 +2
 * 確認済み施策：売上増加 年額 60（2025年4月開始）、そのうち営業利益の増分 年額 10
 */
const M = 1_000_000;
const CURRENT_YEAR = 2025;
const PL: FinancePLRow[] = [{ year: 2024, revenue: 1_000 * M, operatingIncome: 70 * M, interest: 0 }];
const BS: FinanceBSRow[] = [{ year: 2024, cash: 100 * M, ar: 150 * M, inventory: 50 * M, ap: 80 * M }];
const TARGETS = [
  { id: 't-rev', label: '売上', unit: '百万円', base: 1_200, dueYear: 2027 },
  { id: 't-op', label: '営業利益', unit: '百万円', base: 100, dueYear: 2027 },
] as unknown as CompanyTarget[];

const ASSUMPTIONS: CfAssumptions = {
  minCashYen: null,
  taxRate: null,
  depreciationYen: null,
  arRatio: null,
  inventoryRatio: null,
  apRatio: null,
  targetRevenueYen: null,
  targetOperatingIncomeYen: null,
  targetYear: null,
  baseScenario: { 2026: { revenueYen: 20 * M, operatingIncomeYen: 2 * M } },
};
const DOMAIN: FinancePlanDomain = { assumptions: ASSUMPTIONS, existingLoans: [], newLoans: [], dividendsYen: {} };

const dept = (projects: unknown[]) => ({ id: 'd1', name: '営業部', projects }) as unknown as Department;
const proj = (title: string, financeEffect: unknown) => ({ id: title, title, financeEffect });
const confirmed = (over: Record<string, unknown>) => ({ confirmed: true, sourceNote: '見積書（架空）', source: 'USER_INPUT', ...over });
const revenueUp = (over: Record<string, unknown> = {}) =>
  confirmed({ kind: 'REVENUE_UP', method: 'DIRECT_AMOUNT', directAmountYen: 60 * M, amountBasis: 'ANNUAL', startYm: '2025-04', operatingIncomeEffectYen: 10 * M, ...over });

const outlookOf = (over: Partial<FinanceOutlookInput> = {}) =>
  buildFinanceOutlook({
    financePL: PL,
    financeBS: BS,
    departments: [dept([])],
    fiscalYearEnd: '3',
    companyTargets: TARGETS,
    domain: DOMAIN,
    currentYear: CURRENT_YEAR,
    ...over,
  });

const planAt = (o: ReturnType<typeof outlookOf>, fy: number) => o.unifiedPl.years.find((y) => y.fiscalYear === fy)!.plan;
const baselineAt = (o: ReturnType<typeof outlookOf>, fy: number) => o.unifiedPl.years.find((y) => y.fiscalYear === fy)!.baseline;

describe('既存事業の増減と確認済み施策効果の合算（二重計上なし）', () => {
  it('将来業績 ＝ 既存事業（基準）＋ 確認済み施策効果。基準には施策効果が混ざらない', () => {
    const o = outlookOf({ departments: [dept([proj('新規開拓', revenueUp())])] });
    expect(baselineAt(o, 2026)).toEqual({ revenueYen: 1_020 * M, operatingExpenseYen: 948 * M, operatingIncomeYen: 72 * M });
    expect(planAt(o, 2026).revenueYen).toBe(1_080 * M);
    expect(planAt(o, 2026).operatingIncomeYen).toBe(82 * M);
    expect(planAt(o, 2026).operatingExpenseYen).toBe(998 * M);
    expect(planAt(o, 2025)).toEqual({ revenueYen: 1_000 * M, operatingExpenseYen: 930 * M, operatingIncomeYen: 70 * M });
  });

  it('売上と営業利益の整合：営業費用は 売上 − 営業利益 で一致する', () => {
    const o = outlookOf({ departments: [dept([proj('新規開拓', revenueUp())])] });
    for (const y of o.unifiedPl.years) {
      if (y.plan.revenueYen !== null && y.plan.operatingIncomeYen !== null) {
        expect(y.plan.revenueYen - y.plan.operatingIncomeYen).toBe(y.plan.operatingExpenseYen);
      }
    }
  });

  it('売上増加の営業利益入力がなければ、営業利益は未算定（基準の営業利益から推定しない）', () => {
    const o = outlookOf({ departments: [dept([proj('新規開拓', revenueUp({ operatingIncomeEffectYen: undefined }))])] });
    expect(planAt(o, 2026).revenueYen).toBe(1_080 * M);
    expect(planAt(o, 2026).operatingIncomeYen).toBeNull();
    expect(planAt(o, 2026).operatingExpenseYen).toBeNull();
    expect(o.unifiedPl.years.find((y) => y.fiscalYear === 2026)!.unknownReasons.join('')).toContain('未入力');
  });

  it('未確認の売上増加は、営業利益の入力があっても試算に加算しない', () => {
    const o = outlookOf({ departments: [dept([proj('新規開拓', revenueUp({ confirmed: false }))])] });
    expect(planAt(o, 2026).revenueYen).toBe(1_020 * M);
    expect(planAt(o, 2026).operatingIncomeYen).toBe(72 * M);
  });

  it('費用増加（追加固定費）と売上増加の営業利益を重ねても、それぞれ1回だけ計上する', () => {
    const fixedCost = confirmed({ kind: 'COST_INCREASE', method: 'DIRECT_AMOUNT', directAmountYen: 1 * M, amountBasis: 'MONTHLY', startYm: '2025-04' });
    const o = outlookOf({ departments: [dept([proj('新規開拓', revenueUp()), proj('人員増', fixedCost)])] });
    // FY2026：基準 72 ＋ 売上増加の営業利益 10 − 追加費用 12（1百万円×12か月）
    expect(planAt(o, 2026).operatingIncomeYen).toBe(70 * M);
  });

  it('赤字方向の営業利益入力（マイナス）もそのまま反映する', () => {
    const o = outlookOf({ departments: [dept([proj('新規開拓', revenueUp({ operatingIncomeEffectYen: -5 * M }))])] });
    expect(planAt(o, 2026).operatingIncomeYen).toBe(67 * M);
  });

  it('既存事業の増減を設定しない場合は、従来どおり横ばいに施策効果だけを加える', () => {
    const o = outlookOf({
      domain: { ...DOMAIN, assumptions: { ...ASSUMPTIONS, baseScenario: undefined } },
      departments: [dept([proj('新規開拓', revenueUp())])],
    });
    expect(o.baselinePlan.basisMode).toBe('FLAT');
    expect(planAt(o, 2026).revenueYen).toBe(1_060 * M);
    expect(planAt(o, 2026).operatingIncomeYen).toBe(80 * M);
  });

  it('既存事業の増減は、保存済みのドメインから読んでも同じ結果になる（ホームとSTAGE6の一致）', () => {
    const departments = [dept([proj('新規開拓', revenueUp())])];
    const a = outlookOf({ departments });
    const b = outlookOf({ departments, domain: JSON.parse(JSON.stringify(DOMAIN)) as FinancePlanDomain });
    expect(b.unifiedPl).toEqual(a.unifiedPl);
  });
});

describe('営業利益の単位換算（financeEffect）', () => {
  const base = { kind: 'REVENUE_UP', method: 'DIRECT_AMOUNT', directAmountYen: 24 * M, source: 'USER_INPUT', confirmed: true, sourceNote: 'x', startYm: '2025-04', operatingIncomeEffectYen: 6 * M } as const;

  it('年額：営業利益の増分はそのまま年額', () => {
    expect(computeFinanceEffect({ ...base, amountBasis: 'ANNUAL' }).annualOperatingEffectYen).toBe(6 * M);
  });
  it('月額：営業利益の増分は月額×12で年額になる', () => {
    expect(computeFinanceEffect({ ...base, amountBasis: 'MONTHLY', operatingIncomeEffectYen: 0.5 * M }).annualOperatingEffectYen).toBe(6 * M);
  });
  it('一回限り：営業利益の増分は一回限りの効果として扱う', () => {
    const r = computeFinanceEffect({ ...base, amountBasis: 'TOTAL', endYm: '2026-03' });
    expect(r.oneTimeOperatingEffectYen).toBe(6 * M);
    expect(r.annualOperatingEffectYen).toBeUndefined();
  });
  it('営業利益の入力がなければ、年額の営業利益効果は未定義（0ではない）', () => {
    const r = computeFinanceEffect({ ...base, amountBasis: 'ANNUAL', operatingIncomeEffectYen: undefined });
    expect(r.annualOperatingEffectYen).toBeUndefined();
    expect(r.annualRevenueYen).toBe(24 * M);
  });
  it('既存の原価率（costRatePct）は参考のまま、営業利益には自動で差し引かない', () => {
    const r = computeFinanceEffect({ ...base, amountBasis: 'ANNUAL', operatingIncomeEffectYen: undefined, costRatePct: 40 });
    expect(r.referenceCostYen).toBe(9.6 * M);
    expect(r.annualOperatingEffectYen).toBeUndefined();
  });
});
