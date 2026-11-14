import {
  FINANCE_PLAN_CALC_VERSION,
  buildStoredFinancePlan,
  hashOf,
  judgeFreshness,
  readStoredFinancePlan,
  toSavedFinancePlan,
  type CalcSnapshotMeta,
  type FinancePlanDomain,
} from '@/utils/stage6/financePlanSnapshot';
import { debtFormFrom, MILLION, toDebtDomain } from './financePlanForm';

const COMPANY = 'company-1';
const SAVED_AT = '2026-11-01T00:00:00.000Z';

/* 3年（FY2027〜FY2029）で保存された前提。以前の保存データと同じ形 */
const DOMAIN_3Y = {
  assumptions: {
    minCashYen: 150 * MILLION,
    taxRate: 0.3,
    depreciationYen: 10 * MILLION,
    arRatio: 0.15,
    inventoryRatio: 0.05,
    apRatio: 0.08,
    targetRevenueYen: 1_200 * MILLION,
    targetOperatingIncomeYen: 80 * MILLION,
    targetYear: 2030,
    baseScenario: {
      2027: { revenueYen: 20 * MILLION, operatingIncomeYen: 2 * MILLION },
      2028: { revenueYen: 40 * MILLION, operatingIncomeYen: 4 * MILLION },
      2029: { revenueYen: 60 * MILLION, operatingIncomeYen: 6 * MILLION },
    },
  },
  existingLoans: [
    {
      id: 'e1',
      name: '既存借入A',
      category: 'BANK',
      balanceYen: 100 * MILLION,
      annualRate: 0.01,
      scheduledPrincipalYen: { 2027: 10 * MILLION, 2028: 10 * MILLION, 2029: 10 * MILLION },
    },
  ],
  newLoans: [],
  dividendsYen: { 2027: 5 * MILLION },
} as unknown as FinancePlanDomain;

const metaOf = (domain: FinancePlanDomain, overrides: Partial<CalcSnapshotMeta> = {}): CalcSnapshotMeta => ({
  calcVersion: FINANCE_PLAN_CALC_VERSION,
  companyId: COMPANY,
  baseYear: 2026,
  bsBaseYear: 2026,
  assumptionsHash: hashOf(toSavedFinancePlan(domain)),
  sourceHash: 'source-1',
  unconfirmed: { unapprovedReadyYen: 0, unclassifiedYen: 0, unscheduledYen: 0, candidateYen: 0, basisPendingYen: 0 },
  computedAt: SAVED_AT,
  ...overrides,
});

/** データベースへの保存・読込を通す（JSON往復） */
const savedRoundTrip = (domain: FinancePlanDomain) =>
  JSON.parse(JSON.stringify(buildStoredFinancePlan({ domain, companyId: COMPANY, meta: metaOf(domain), savedAt: SAVED_AT })));

/** 画面の入力（フォーム）へ戻し、指定した予測年度で前提を組み直す */
const domainFromForm = (saved: FinancePlanDomain, forecastYears: number[]): FinancePlanDomain => {
  const form = debtFormFrom(saved);
  return { ...toDebtDomain(form, forecastYears), assumptions: saved.assumptions } as FinancePlanDomain;
};

describe('保存済みの財務計画は、予測期間を3年から4年に延ばしても失効・消去されない', () => {
  it('3年で保存した前提を、4年の画面で読み込める（借入・配当・財務前提を保持）', () => {
    const read = readStoredFinancePlan(savedRoundTrip(DOMAIN_3Y), COMPANY);
    expect(read.kind).toBe('OK');
    if (read.kind !== 'OK') return;
    expect(read.domain.existingLoans[0].scheduledPrincipalYen[2027]).toBe(10 * MILLION);
    expect(read.domain.existingLoans[0].scheduledPrincipalYen[2029]).toBe(10 * MILLION);
    expect(read.domain.dividendsYen[2027]).toBe(5 * MILLION);
    expect(read.domain.assumptions.taxRate).toBe(0.3);
    expect(read.domain.assumptions.minCashYen).toBe(150 * MILLION);
    expect(read.domain.assumptions.targetYear).toBe(2030);
  });

  it('4年の予測で保存し直しても、前提の識別子は変わらない（空欄の2030年度は保存されない）', () => {
    const read = readStoredFinancePlan(savedRoundTrip(DOMAIN_3Y), COMPANY);
    if (read.kind !== 'OK') throw new Error('読込に失敗');
    const domain4 = domainFromForm(read.domain, [2027, 2028, 2029, 2030]);
    expect(hashOf(toSavedFinancePlan(domain4))).toBe(metaOf(DOMAIN_3Y).assumptionsHash);
  });

  it('同じ元データなら、4年に延ばしても過去の計算とは判定されない', () => {
    const read = readStoredFinancePlan(savedRoundTrip(DOMAIN_3Y), COMPANY);
    if (read.kind !== 'OK') throw new Error('読込に失敗');
    const domain4 = domainFromForm(read.domain, [2027, 2028, 2029, 2030]);
    const current = metaOf(domain4, { assumptionsHash: hashOf(toSavedFinancePlan(domain4)) });
    expect(judgeFreshness(read.meta, current).kind).toBe('CURRENT');
  });

  it('期間を3年に縮めても、保存済みの入力（2030年度を含む）は消えない', () => {
    const read = readStoredFinancePlan(savedRoundTrip(DOMAIN_3Y), COMPANY);
    if (read.kind !== 'OK') throw new Error('読込に失敗');
    const with2030 = domainFromForm(read.domain, [2027, 2028, 2029, 2030]);
    const withDividend2030 = { ...with2030, dividendsYen: { ...with2030.dividendsYen, 2030: 3 * MILLION } } as FinancePlanDomain;
    const shrunk = domainFromForm(withDividend2030, [2027, 2028, 2029]);
    expect(shrunk.dividendsYen[2030]).toBe(3 * MILLION);
    expect(shrunk.existingLoans[0].scheduledPrincipalYen[2029]).toBe(10 * MILLION);
  });

  it('2030年度の返済を新しく入力した場合は、入力が変わったとして過去の計算と判定する（黙って上書きしない）', () => {
    const read = readStoredFinancePlan(savedRoundTrip(DOMAIN_3Y), COMPANY);
    if (read.kind !== 'OK') throw new Error('読込に失敗');
    const form = debtFormFrom(read.domain);
    form.existing[0].schedule[2030] = '7';
    const edited = { ...toDebtDomain(form, [2027, 2028, 2029, 2030]), assumptions: read.domain.assumptions } as FinancePlanDomain;
    const current = metaOf(edited, { assumptionsHash: hashOf(toSavedFinancePlan(edited)) });
    const freshness = judgeFreshness(read.meta, current);
    expect(freshness.kind).toBe('STALE');
    if (freshness.kind === 'STALE') expect(freshness.reasons).toContain('入力前提が変わりました');
  });
});
