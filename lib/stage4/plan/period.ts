import type { PeriodBasis, PlanSource } from './types';

export type ResolvedPeriod = {
  startYm: string;
  /** null のときは AI に仮期間を提案させる */
  endYm: string | null;
  basis: PeriodBasis | null;
};

export const PROVISIONAL_MIN_MONTHS = 3;
export const PROVISIONAL_MAX_MONTHS = 12;

export function addMonths(ym: string, n: number): string {
  const [y, m] = ym.split('-').map(Number);
  const t = y * 12 + (m - 1) + n;
  return `${Math.floor(t / 12)}-${String((t % 12) + 1).padStart(2, '0')}`;
}

/**
 * 計画期間の決め方（優先順）：
 * 1. プロジェクト期限（STAGE3）
 * 2. 全社計画期間の終了（計画終了年度と決算期から求める）
 * 3. 既存の確定KPIの期限のうち最も遅いもの
 * 4. いずれも無い場合は AI が仮期間を提案する（endYm = null で返す）
 * 開始は現在月の翌月。終了が開始より前の候補は採用しない。
 */
export function resolvePlanPeriod(source: PlanSource): ResolvedPeriod {
  const startYm = addMonths(source.currentYm, 1);
  const usable = (ym: string | null | undefined): ym is string => !!ym && ym >= startYm;

  const deadline = source.period.projectDeadlineYm;
  if (usable(deadline)) return { startYm, endYm: deadline, basis: 'PROJECT_DEADLINE' };

  const { companyEndYear, fiscalYearEndMonth } = source.period;
  if (companyEndYear && fiscalYearEndMonth) {
    const company = `${companyEndYear}-${String(fiscalYearEndMonth).padStart(2, '0')}`;
    if (/^\d{4}-\d{2}$/.test(company) && usable(company)) {
      return { startYm, endYm: company, basis: 'COMPANY_PLAN' };
    }
  }

  const dues = source.stage3.project.kpis.map((k) => k.due).filter((d): d is string => !!d && d >= startYm);
  if (dues.length > 0) {
    return { startYm, endYm: dues.reduce((a, b) => (a > b ? a : b)), basis: 'STAGE3_KPI_DUE' };
  }

  return { startYm, endYm: null, basis: null };
}
