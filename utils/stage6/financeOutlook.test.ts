import type { CompanyTarget, Department, FinanceBSRow, FinancePLRow } from '@/types/strategy';
import { achievementPct, buildTargetSummary } from '@/components/stage6/financeSummaryModel';
import { buildFinanceOutlook, type FinanceOutlookInput } from './financeOutlook';
import { buildStoredFinancePlan, readStoredFinancePlan, type CalcSnapshotMeta, type FinancePlanDomain } from './financePlanSnapshot';

/* 手計算の前提（架空企業、百万円単位で入力）
 * STAGE1：基準年度 2024 売上 1,000・営業利益 70 → 予測は 2025〜2027 年度の横ばい
 * 決算月 3 月。財務効果の年度は 2026年度 = 2025年4月〜2026年3月
 * STAGE2目標：売上 1,200（2027年度）、営業利益 100（2027年度）
 */
const M = 1_000_000;
const CURRENT_YEAR = 2025;
const FY_END = '3';

const PL: FinancePLRow[] = [{ year: 2024, revenue: 1_000 * M, operatingIncome: 70 * M, interest: 0 }];
const BS: FinanceBSRow[] = [{ year: 2024, cash: 100 * M, ar: 150 * M, inventory: 50 * M, ap: 80 * M }];
const TARGETS = [
  { id: 't-rev', label: '売上', unit: '百万円', base: 1_200, dueYear: 2027 },
  { id: 't-op', label: '営業利益', unit: '百万円', base: 100, dueYear: 2027 },
] as unknown as CompanyTarget[];

const NO_DOMAIN_ASSUMPTIONS = {
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
const DOMAIN_WITH_CASH: FinancePlanDomain = {
  assumptions: { ...NO_DOMAIN_ASSUMPTIONS, minCashYen: 50 * M, taxRate: 0.3 },
  existingLoans: [],
  newLoans: [],
  dividendsYen: {},
};

const dept = (projects: unknown[]) => ({ id: 'd1', name: '営業部', projects }) as unknown as Department;
const proj = (title: string, extra: Record<string, unknown> = {}) => ({ id: title, title, ...extra });
const confirmed = (over: Record<string, unknown>) => ({ confirmed: true, sourceNote: '見積書（架空）', ...over });

const revenueUp60 = confirmed({
  kind: 'REVENUE_UP',
  method: 'DIRECT_AMOUNT',
  directAmountYen: 60 * M,
  amountBasis: 'ANNUAL',
  startYm: '2025-04',
});

const outlookOf = (over: Partial<FinanceOutlookInput> = {}) =>
  buildFinanceOutlook({
    financePL: PL,
    financeBS: BS,
    departments: [dept([])],
    fiscalYearEnd: FY_END,
    companyTargets: TARGETS,
    domain: null,
    currentYear: CURRENT_YEAR,
    ...over,
  });

const planOf = (o: ReturnType<typeof outlookOf>, fy: number) => o.unifiedPl.years.find((y) => y.fiscalYear === fy)!.plan;

describe('財務試算（共通）：STAGE6とホームで同じ経路B', () => {
  it('施策なし：予測は基準年度の横ばい。STAGE2の目標は予測に加算されず、差額だけに使われる', () => {
    const o = outlookOf();
    expect(planOf(o, 2027).revenueYen).toBe(1_000 * M);
    expect(planOf(o, 2027).operatingIncomeYen).toBe(70 * M);
    expect(o.unifiedPl.gap?.revenue).toEqual({ fiscalYear: 2027, valueYen: 200 * M, reason: null });
    expect(o.unifiedPl.gap?.operatingIncome).toEqual({ fiscalYear: 2027, valueYen: 30 * M, reason: null });
    expect(achievementPct(buildTargetSummary({ unifiedPl: o.unifiedPl, target: o.target }).revenue)).toBeCloseTo(83.333, 2);
  });

  it('確認済みの売上増加：開始月の属する年度から加算され、営業利益は売上原価が不明なため未算定（0扱いしない）', () => {
    const o = outlookOf({ departments: [dept([proj('新規開拓', { financeEffect: revenueUp60 })])] });
    expect(planOf(o, 2025).revenueYen).toBe(1_000 * M);
    expect(planOf(o, 2026).revenueYen).toBe(1_060 * M);
    expect(planOf(o, 2027).revenueYen).toBe(1_060 * M);
    expect(planOf(o, 2027).operatingIncomeYen).toBeNull();
    expect(o.unifiedPl.gap?.operatingIncome.valueYen).toBeNull();
    expect(o.unifiedPl.gap?.operatingIncome.reason).toContain('売上増加');
    const summary = buildTargetSummary({ unifiedPl: o.unifiedPl, target: o.target });
    expect(summary.operatingIncome.status).toBe('PLAN_UNKNOWN');
  });

  it('未確認（確認待ち）の効果は試算に加算されない', () => {
    const o = outlookOf({
      departments: [dept([proj('新規開拓', { financeEffect: { ...revenueUp60, confirmed: false } })])],
    });
    expect(planOf(o, 2027).revenueYen).toBe(1_000 * M);
    expect(o.effectTrial.excluded.map((e) => e.reason)).toEqual(['利用者が未確認（確認すると試算に入ります）']);
  });

  it('入力不足の効果は未算定として除外し、0円扱いにしない', () => {
    const incomplete = confirmed({ kind: 'REVENUE_UP', method: 'DIRECT_AMOUNT', amountBasis: 'ANNUAL', startYm: '2025-04' });
    const o = outlookOf({ departments: [dept([proj('新規開拓', { financeEffect: incomplete })])] });
    expect(planOf(o, 2027).revenueYen).toBe(1_000 * M);
    expect(o.effectTrial.excluded[0].reason).toContain('入力不足');
  });

  it('旧データの見込み（impactRevenueMJPY × 進捗率）は財務試算に加算されない', () => {
    const o = outlookOf({
      departments: [dept([proj('旧見込み', { impactRevenueMJPY: 500, impactRevenueProgress: 100 })])],
    });
    expect(planOf(o, 2027).revenueYen).toBe(1_000 * M);
  });

  it('同じ施策に確認済み効果と旧見込みがあっても、確認済み効果の1回だけ計上する', () => {
    const o = outlookOf({
      departments: [dept([proj('新規開拓', { financeEffect: revenueUp60, impactRevenueMJPY: 60, impactRevenueProgress: 100 })])],
    });
    expect(planOf(o, 2027).revenueYen).toBe(1_060 * M);
  });

  it('費用削減（月額・確認済み）は営業利益に反映され、売上は変わらない', () => {
    const costDown = confirmed({
      kind: 'COST_REDUCTION',
      method: 'DIRECT_AMOUNT',
      directAmountYen: 1 * M,
      amountBasis: 'MONTHLY',
      startYm: '2025-04',
    });
    const o = outlookOf({ departments: [dept([proj('工程改善', { financeEffect: costDown })])] });
    expect(planOf(o, 2026).operatingIncomeYen).toBe(82 * M);
    expect(planOf(o, 2026).revenueYen).toBe(1_000 * M);
    expect(o.unifiedPl.gap?.operatingIncome).toEqual({ fiscalYear: 2027, valueYen: 18 * M, reason: null });
  });

  it('保存して読み直しても、同じ前提・同じ試算になる', () => {
    const departments = [dept([proj('新規開拓', { financeEffect: revenueUp60 })])];
    const before = outlookOf({ departments, domain: DOMAIN_WITH_CASH });
    const meta = {
      calcVersion: 'test',
      companyId: 'c1',
      baseYear: 2024,
      bsBaseYear: 2024,
      assumptionsHash: 'h',
      sourceHash: 'h',
      unconfirmed: { unapprovedReadyYen: 0, unclassifiedYen: 0, unscheduledYen: 0, candidateYen: 0, basisPendingYen: 0 },
      computedAt: '2025-01-01T00:00:00.000Z',
    } as CalcSnapshotMeta;
    const saved = JSON.parse(JSON.stringify(buildStoredFinancePlan({ domain: DOMAIN_WITH_CASH, companyId: 'c1', meta, savedAt: '2025-01-01T00:00:00.000Z' })));
    const reloaded = readStoredFinancePlan(saved, 'c1');
    expect(reloaded.kind).toBe('OK');
    const after = outlookOf({ departments, domain: reloaded.kind === 'OK' ? reloaded.domain : null });
    expect(after.unifiedPl).toEqual(before.unifiedPl);
    expect(after.effectTrial).toEqual(before.effectTrial);
  });

  it('別の会社の保存データは読み込まず、横ばい・借入なしとして計算する', () => {
    const meta = {
      calcVersion: 'test',
      companyId: 'c1',
      baseYear: 2024,
      bsBaseYear: 2024,
      assumptionsHash: 'h',
      sourceHash: 'h',
      unconfirmed: { unapprovedReadyYen: 0, unclassifiedYen: 0, unscheduledYen: 0, candidateYen: 0, basisPendingYen: 0 },
      computedAt: '2025-01-01T00:00:00.000Z',
    } as CalcSnapshotMeta;
    const stored = buildStoredFinancePlan({ domain: DOMAIN_WITH_CASH, companyId: 'c1', meta, savedAt: '2025-01-01T00:00:00.000Z' });
    const other = readStoredFinancePlan(stored, 'c2');
    expect(other.kind).toBe('DIFFERENT_COMPANY');
    const o = outlookOf({ domain: other.kind === 'OK' ? other.domain : null });
    expect(o.unifiedPl).toEqual(outlookOf().unifiedPl);
  });
});
