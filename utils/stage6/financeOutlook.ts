import type { CompanyTarget, Department, FinanceBSRow, FinancePLRow } from '@/types/strategy';
import { isOperatingIncomeLabel, isRevenueLabel, northStarValueToMJPY } from './compute';
import { buildCashFlowPlan, DEFAULT_HORIZON, type CashFlowPlan, type CfAssumptions } from './cashflow';
import { buildConditionalCashFlow, type ConditionalCf } from './conditionalCf';
import { buildFinanceEffectTrial, withoutTargetPath, type FinanceEffectTrial } from './financeEffectPlan';
import type { InvestmentDemandSummary } from './investmentDemand';
import { computeStage6FinancePlan } from './financePlanPipeline';
import type { FinancePlanDomain } from './financePlanSnapshot';
import { buildUnifiedPl, type PlTarget, type UnifiedPl } from './unifiedPl';

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

const EMPTY_DOMAIN: FinancePlanDomain = {
  assumptions: NO_ASSUMPTIONS,
  existingLoans: [],
  newLoans: [],
  dividendsYen: {},
};

export type FinanceOutlookInput = {
  financePL: FinancePLRow[];
  financeBS: FinanceBSRow[];
  departments: Department[];
  fiscalYearEnd: string | undefined;
  companyTargets: CompanyTarget[] | null | undefined;
  /** 保存済みの財務計画前提。未保存・別会社・読めない場合は null（横ばい・借入なし） */
  domain: FinancePlanDomain | null;
  currentYear: number;
};

export type FinanceOutlook = {
  baselinePlan: CashFlowPlan;
  target: PlTarget;
  effectTrial: FinanceEffectTrial;
  unifiedPl: UnifiedPl;
  conditionalCf: ConditionalCf;
};

/** 経営目標の期限年度と金額（円）。STAGE2の目標は予測に加算せず、差額の比較にのみ使う */
export function unifiedTargetOf(companyTargets: CompanyTarget[] | null | undefined): PlTarget {
  const targets = companyTargets ?? [];
  const revenueTarget = targets.find((t) => isRevenueLabel(t.label));
  const opTarget = targets.find((t) => isOperatingIncomeLabel(t.label));
  const toYen = (t: CompanyTarget | undefined) => {
    if (!t || !Number.isFinite(t.base) || t.base <= 0) return null;
    const mjpy = northStarValueToMJPY(t.base, t.unit);
    return Number.isFinite(mjpy) ? mjpy * 1_000_000 : null;
  };
  return {
    revenueYen: toYen(revenueTarget),
    operatingIncomeYen: toYen(opTarget),
    revenueDueYear: revenueTarget?.dueYear ?? null,
    operatingIncomeDueYear: opTarget?.dueYear ?? null,
  };
}

/** 最新の売上実績年度（currentYear まで）。予測期間はこの年度の翌年から数える */
function latestRevenueYearOf(financePL: FinancePLRow[], currentYear: number): number | null {
  let year: number | null = null;
  for (const r of financePL) {
    if (!Number.isFinite(r?.year) || r.year > currentYear) continue;
    if (typeof r.revenue !== 'number' || !Number.isFinite(r.revenue)) continue;
    if (year === null || r.year > year) year = r.year;
  }
  return year;
}

/** 予測期間（年数）。最低 DEFAULT_HORIZON 年、経営目標の期限年度がそれより先ならその年度まで延ばす。目標値は使わない */
export function forecastHorizonOf(
  financePL: FinancePLRow[],
  currentYear: number,
  companyTargets: CompanyTarget[] | null | undefined,
): number {
  const baseYear = latestRevenueYearOf(financePL, currentYear);
  if (baseYear === null) return DEFAULT_HORIZON;
  const target = unifiedTargetOf(companyTargets);
  let horizon = DEFAULT_HORIZON;
  for (const due of [target.revenueDueYear, target.operatingIncomeDueYear]) {
    if (due !== null && due - baseYear > horizon) horizon = due - baseYear;
  }
  return horizon;
}

/** STAGE6とホームで共通の財務試算（経路B）。基準CF（横ばい）＋確認済み財務効果＋経営目標との差額 */
export function buildFinanceOutlook(input: FinanceOutlookInput): FinanceOutlook {
  const { financePL, financeBS, departments, fiscalYearEnd, currentYear } = input;
  const domain = input.domain ?? EMPTY_DOMAIN;
  const horizonYears = forecastHorizonOf(financePL, currentYear, input.companyTargets);

  const computed = computeStage6FinancePlan({
    financePL,
    financeBS,
    departments,
    fiscalYearEnd,
    domain,
    currentYear,
    horizonYears,
  });
  const baselinePlan = buildCashFlowPlan(
    {
      financePL,
      financeBS,
      investment: investmentInputOf(computed.investment),
      assumptions: withoutTargetPath(domain.assumptions),
      fiscalYearEndSet: computed.fiscalYearEndSet,
      debt: computed.debtEntered ? computed.schedule : undefined,
      horizonYears,
    },
    currentYear,
  );

  const baselineForecastYears = baselinePlan.years.filter((y) => y.kind === 'FORECAST');
  const target = unifiedTargetOf(input.companyTargets);
  const effectTrial = buildFinanceEffectTrial({
    departments,
    fiscalYearEnd,
    fiscalYears: baselineForecastYears.map((y) => y.year),
  });
  const unifiedPl = buildUnifiedPl({
    baseline: baselineForecastYears.map((y) => ({
      fiscalYear: y.year,
      revenueYen: y.revenue.value,
      operatingIncomeYen: y.operatingIncome.value,
    })),
    effects: effectTrial.years,
    target,
  });
  const conditionalCf = buildConditionalCashFlow({ baseline: baselinePlan, unified: unifiedPl });

  return { baselinePlan, target, effectTrial, unifiedPl, conditionalCf };
}

function investmentInputOf(inv: InvestmentDemandSummary) {
  return {
    yearlyByCategory: inv.yearlyByCategory,
    unclassifiedYen: inv.unclassifiedYen,
    unscheduledYen: inv.unscheduledYen,
    candidateYen: inv.candidateYen,
    basisPendingYen: inv.basisPendingYen,
  };
}
