import type { Department, FinanceBSRow, FinancePLRow } from '@/types/strategy';
import { buildCashFlowPlan, type CashFlowPlan } from './cashflow';
import { buildDebtSchedule, type DebtInput, type DebtSchedule } from './debt';
import {
  buildInvestmentDemandSummary,
  parseFiscalYearEndMonth,
  type InvestmentDemandSummary,
} from './investmentDemand';
import {
  hashOf,
  sourceHashOf,
  toSavedFinancePlan,
  type FinancePlanDomain,
} from './financePlanSnapshot';

export type Stage6ComputeInput = {
  financePL: FinancePLRow[];
  financeBS: FinanceBSRow[];
  departments: Department[];
  fiscalYearEnd: string | undefined;
  domain: FinancePlanDomain;
  currentYear: number;
};

export type Stage6Computed = {
  investment: InvestmentDemandSummary;
  fiscalYearEndSet: boolean;
  basePlan: CashFlowPlan;
  forecastYears: number[];
  schedule: DebtSchedule;
  debtEntered: boolean;
  plan: CashFlowPlan;
  sourceHash: string;
  assumptionsHash: string;
};

const EXISTING_LOAN_FALLBACK_NAME = '既存借入';
const NEW_LOAN_FALLBACK_NAME = '新規借入';

export function isDebtDomainEntered(domain: FinancePlanDomain): boolean {
  return (
    domain.existingLoans.length > 0 ||
    domain.newLoans.length > 0 ||
    Object.values(domain.dividendsYen).some((v) => v !== null && v !== undefined)
  );
}

function buildDebtInput(args: {
  domain: FinancePlanDomain;
  forecastYears: number[];
  stage1InterestBearingDebtYen: number | null;
  fiscalYearEndSet: boolean;
}): DebtInput {
  const { domain, forecastYears } = args;
  return {
    forecastYears,
    existingLoans: domain.existingLoans.map((l) => {
      const scheduled: Record<number, number | null> = {};
      for (const y of forecastYears) scheduled[y] = l.scheduledPrincipalYen[y] ?? null;
      return {
        id: l.id,
        name: l.name || EXISTING_LOAN_FALLBACK_NAME,
        category: l.category,
        balanceYen: l.balanceYen,
        annualRate: l.annualRate,
        scheduledPrincipalYen: scheduled,
      };
    }),
    newLoans: domain.newLoans.map((l) => ({ ...l, name: l.name || NEW_LOAN_FALLBACK_NAME })),
    stage1InterestBearingDebtYen: args.stage1InterestBearingDebtYen,
    dividendsYen: Object.fromEntries(forecastYears.map((y) => [y, domain.dividendsYen[y] ?? null])),
    fiscalYearEndSet: args.fiscalYearEndSet,
  };
}

export function computeStage6FinancePlan(input: Stage6ComputeInput): Stage6Computed {
  const { financePL, financeBS, domain, currentYear } = input;

  const investment = buildInvestmentDemandSummary(input.departments, input.fiscalYearEnd);
  const fiscalYearEndSet = parseFiscalYearEndMonth(input.fiscalYearEnd) !== null;
  const investmentInput = {
    yearlyByCategory: investment.yearlyByCategory,
    unclassifiedYen: investment.unclassifiedYen,
    unscheduledYen: investment.unscheduledYen,
    candidateYen: investment.candidateYen,
    basisPendingYen: investment.basisPendingYen,
  };

  const basePlan = buildCashFlowPlan(
    { financePL, financeBS, investment: investmentInput, assumptions: domain.assumptions, fiscalYearEndSet },
    currentYear,
  );
  const forecastYears = basePlan.years.filter((y) => y.kind === 'FORECAST').map((y) => y.year);

  const stage1Debt = (() => {
    if (basePlan.bsBaseYear === null) return null;
    const row = financeBS.find((r) => r.year === basePlan.bsBaseYear);
    const v = row?.interestBearingDebt;
    return typeof v === 'number' && Number.isFinite(v) ? v : null;
  })();

  const schedule = buildDebtSchedule(
    buildDebtInput({ domain, forecastYears, stage1InterestBearingDebtYen: stage1Debt, fiscalYearEndSet }),
  );
  const debtEntered = isDebtDomainEntered(domain);

  const plan = buildCashFlowPlan(
    {
      financePL,
      financeBS,
      investment: investmentInput,
      assumptions: domain.assumptions,
      fiscalYearEndSet,
      debt: debtEntered ? schedule : undefined,
    },
    currentYear,
  );

  return {
    investment,
    fiscalYearEndSet,
    basePlan,
    forecastYears,
    schedule,
    debtEntered,
    plan,
    sourceHash: sourceHashOf({
      financePL,
      financeBS,
      investment: {
        approvedReadyYen: investment.approvedReadyYen,
        unapprovedReadyYen: investment.unapprovedReadyYen,
        unclassifiedYen: investment.unclassifiedYen,
        unscheduledYen: investment.unscheduledYen,
        candidateYen: investment.candidateYen,
        basisPendingYen: investment.basisPendingYen,
        yearlyByCategory: investment.yearlyByCategory,
      },
      fiscalYearEnd: input.fiscalYearEnd || undefined,
    }),
    assumptionsHash: hashOf(toSavedFinancePlan(domain)),
  };
}
