import type { DebtForm } from '@/components/stage6/DebtPanel';
import {
  cashFlowFormFrom,
  toCashFlowAssumptions,
  toDebtDomain,
  toDebtInput,
} from '@/components/stage6/financePlanForm';
import type { Department, FinanceBSRow, FinancePLRow } from '@/types/strategy';
import type { CfAssumptions } from './cashflow';
import { buildCashFlowPlan } from './cashflow';
import { buildDebtSchedule } from './debt';
import { buildInvestmentDemandSummary, parseFiscalYearEndMonth } from './investmentDemand';
import { computeStage6FinancePlan } from './financePlanPipeline';
import {
  FINANCE_PLAN_CALC_VERSION,
  buildStoredFinancePlan,
  hashOf,
  readStoredFinancePlan,
  sourceHashOf,
  toSavedFinancePlan,
  type CalcSnapshotMeta,
  type FinancePlanDomain,
} from './financePlanSnapshot';

const COMPANY = '11111111-1111-4111-8111-111111111111';
const YEAR = 2026;

const financePL: FinancePLRow[] = [
  { year: 2024, revenue: 900_000_000, operatingIncome: 40_000_000, netIncome: 25_000_000, depreciation: 18_000_000, interest: 6_000_000, tax: 8_000_000 },
  { year: 2025, revenue: 1_000_000_000, operatingIncome: 50_000_000, netIncome: 30_000_000, depreciation: 20_000_000, interest: 5_000_000, tax: 10_000_000 },
];

const financeBS: FinanceBSRow[] = [
  { year: 2025, cash: 100_000_000, ar: 150_000_000, inventory: 80_000_000, ap: 60_000_000, interestBearingDebt: 300_000_000 },
];

const departments = [
  {
    name: '営業部',
    projects: [
      {
        title: 'A社開拓',
        planStatus: 'approved',
        impactRevenueMJPY: 100,
        skillPlans: [
          {
            id: 'sk1',
            skillName: '提案力',
            cost: 30_000_000,
            spend: { category: 'CAPEX', recurrence: 'ONE_TIME', amountBasis: 'TOTAL', paymentYm: '2027-03' },
          },
          { id: 'sk2', skillName: '外注', cost: 5_000_000 },
        ],
      },
    ],
  },
  {
    name: '開発部',
    projects: [
      {
        title: 'SaaS基盤',
        planStatus: 'draft',
        okrsV2: [
          {
            id: 'kr1',
            kind: 'INVEST',
            label: '改善投資',
            target: 12_000_000,
            unit: 'JPY',
            scope: 'project',
            baseKey: 'invest',
            spend: { category: 'CAPEX', recurrence: 'ONE_TIME', amountBasis: 'TOTAL', paymentYm: '2028-06' },
          },
        ],
      },
    ],
  },
] as unknown as Department[];

const cfAssumptions: CfAssumptions = {
  minCashYen: 80_000_000,
  taxRate: 0.3,
  depreciationYen: null,
  arRatio: 0.15,
  inventoryRatio: null,
  apRatio: null,
  targetRevenueYen: 1_200_000_000,
  targetOperatingIncomeYen: 80_000_000,
  targetYear: 2028,
};

const fullDebtForm: DebtForm = {
  existing: [
    {
      id: 'e1',
      name: '',
      category: 'BANK',
      balance: '300',
      rate: '2',
      schedule: { 2026: '30', 2027: '30', 2028: '' },
    },
  ],
  newLoans: [
    {
      id: 'n1',
      name: '',
      drawYear: '2027',
      drawMonth: '',
      amount: '100',
      rate: '1.5',
      term: '5',
      grace: '1',
      method: 'EQUAL_PRINCIPAL',
    },
  ],
  dividends: { 2026: '0', 2027: '5' },
  seq: 2,
};

const emptyDebtForm: DebtForm = { existing: [], newLoans: [], dividends: {}, seq: 0 };

type Scenario = {
  name: string;
  debtForm: DebtForm;
  fiscalYearEnd: string | undefined;
  departments: Department[];
  financeBS: FinanceBSRow[];
};

const scenarios: Scenario[] = [
  { name: '借入あり・決算期3月', debtForm: fullDebtForm, fiscalYearEnd: '3', departments, financeBS },
  { name: '借入なし', debtForm: emptyDebtForm, fiscalYearEnd: '3', departments, financeBS },
  { name: '決算期未設定', debtForm: fullDebtForm, fiscalYearEnd: undefined, departments, financeBS },
  {
    name: '年度不一致（BSが1年前）',
    debtForm: fullDebtForm,
    fiscalYearEnd: '3',
    departments,
    financeBS: [{ ...financeBS[0], year: 2024 }],
  },
];

// ブラウザ（FinancePlanSection）の計算手順を、同じヘルパー関数で再現する
function browserSequence(s: Scenario) {
  const cfForm = cashFlowFormFrom(cfAssumptions);
  const investment = buildInvestmentDemandSummary(s.departments, s.fiscalYearEnd);
  const fiscalYearEndSet = parseFiscalYearEndMonth(s.fiscalYearEnd) !== null;
  const assumptions = toCashFlowAssumptions(cfForm);
  const investmentInput = {
    yearlyByCategory: investment.yearlyByCategory,
    unclassifiedYen: investment.unclassifiedYen,
    unscheduledYen: investment.unscheduledYen,
    candidateYen: investment.candidateYen,
    basisPendingYen: investment.basisPendingYen,
  };
  const basePlan = buildCashFlowPlan(
    { financePL, financeBS: s.financeBS, investment: investmentInput, assumptions, fiscalYearEndSet },
    YEAR,
  );
  const forecastYears = basePlan.years.filter((y) => y.kind === 'FORECAST').map((y) => y.year);
  const stage1Debt = (() => {
    if (basePlan.bsBaseYear === null) return null;
    const row = s.financeBS.find((r) => r.year === basePlan.bsBaseYear);
    const v = row?.interestBearingDebt;
    return typeof v === 'number' && Number.isFinite(v) ? v : null;
  })();
  const debtEntered =
    s.debtForm.existing.length > 0 ||
    s.debtForm.newLoans.length > 0 ||
    Object.values(s.debtForm.dividends).some((v) => v.trim() !== '');
  const schedule = buildDebtSchedule(toDebtInput(s.debtForm, forecastYears, stage1Debt, fiscalYearEndSet));
  const plan = buildCashFlowPlan(
    {
      financePL,
      financeBS: s.financeBS,
      investment: investmentInput,
      assumptions,
      fiscalYearEndSet,
      debt: debtEntered ? schedule : undefined,
    },
    YEAR,
  );
  const d = toDebtDomain(s.debtForm, forecastYears);
  const currentDomain: FinancePlanDomain = {
    assumptions,
    existingLoans: d.existingLoans,
    newLoans: d.newLoans,
    dividendsYen: d.dividendsYen,
  };
  const sourceHash = sourceHashOf({
    financePL,
    financeBS: s.financeBS,
    investment: {
      approvedReadyYen: investment.approvedReadyYen,
      unapprovedReadyYen: investment.unapprovedReadyYen,
      unclassifiedYen: investment.unclassifiedYen,
      unscheduledYen: investment.unscheduledYen,
      candidateYen: investment.candidateYen,
      basisPendingYen: investment.basisPendingYen,
      yearlyByCategory: investment.yearlyByCategory,
    },
    fiscalYearEnd: s.fiscalYearEnd || undefined,
  });
  return {
    investment,
    plan,
    schedule,
    forecastYears,
    debtEntered,
    currentDomain,
    assumptionsHash: hashOf(toSavedFinancePlan(currentDomain)),
    sourceHash,
  };
}

// 保存 → 永続化（JSON）→ サーバー側での読み戻し → 再計算
function serverSequence(s: Scenario, browser: ReturnType<typeof browserSequence>) {
  const meta: CalcSnapshotMeta = {
    calcVersion: FINANCE_PLAN_CALC_VERSION,
    companyId: COMPANY,
    baseYear: browser.plan.baseYear,
    bsBaseYear: browser.plan.bsBaseYear,
    assumptionsHash: browser.assumptionsHash,
    sourceHash: browser.sourceHash,
    unconfirmed: {
      unapprovedReadyYen: browser.investment.unapprovedReadyYen,
      unclassifiedYen: browser.investment.unclassifiedYen,
      unscheduledYen: browser.investment.unscheduledYen,
      candidateYen: browser.investment.candidateYen,
      basisPendingYen: browser.investment.basisPendingYen,
    },
    computedAt: '2026-10-19T00:00:00.000Z',
  };
  const persisted = JSON.parse(
    JSON.stringify(
      buildStoredFinancePlan({
        domain: browser.currentDomain,
        companyId: COMPANY,
        meta,
        savedAt: '2026-10-19T00:00:00.000Z',
      }),
    ),
  ) as unknown;
  const read = readStoredFinancePlan(persisted, COMPANY);
  if (read.kind !== 'OK') throw new Error(`saved plan not readable: ${read.kind}`);
  return computeStage6FinancePlan({
    financePL,
    financeBS: s.financeBS,
    departments: s.departments,
    fiscalYearEnd: s.fiscalYearEnd,
    domain: read.domain,
    currentYear: YEAR,
  });
}

describe('7. ブラウザ表示との数値一致（同一手順の再現との比較）', () => {
  it.each(scenarios)('$name：識別子・CF・借入・投資の結果がブラウザ手順と一致する', (s) => {
    const browser = browserSequence(s);
    const server = serverSequence(s, browser);

    expect(server.assumptionsHash).toBe(browser.assumptionsHash);
    expect(server.sourceHash).toBe(browser.sourceHash);
    expect(server.forecastYears).toEqual(browser.forecastYears);
    expect(server.debtEntered).toBe(browser.debtEntered);
    expect(server.investment).toEqual(browser.investment);
    expect(server.schedule).toEqual(browser.schedule);
    expect(server.plan).toEqual(browser.plan);
  });

  it('比較対象が空の結果にならず、借入ありの計算が実際に動いている', () => {
    const browser = browserSequence(scenarios[0]);
    expect(browser.debtEntered).toBe(true);
    const y27 = browser.plan.years.find((y) => y.year === 2027)!;
    expect(y27.capex.value).toBe(30_000_000);
    expect(y27.principal.value).toBeGreaterThan(0);
    expect(y27.financingCf.value).not.toBeNull();
    expect(y27.verdict).not.toBe('評価保留');
  });
});
