import type { Department, FinanceBSRow, FinancePLRow } from '@/types/strategy';
import type { CfAssumptions } from './cashflow';
import { bankFinancialPlanForRow } from './bankFinancialPlan';
import { computeStage6FinancePlan } from './financePlanPipeline';
import {
  FINANCE_PLAN_CALC_VERSION,
  buildStoredFinancePlan,
  readStoredFinancePlan,
  type CalcSnapshotMeta,
  type FinancePlanDomain,
} from './financePlanSnapshot';

const COMPANY = '11111111-1111-4111-8111-111111111111';
const STRATEGY = '33333333-3333-4333-8333-333333333333';
const NOW = new Date('2026-10-20T00:00:00Z');

/** store/strategyStore.ts の buildSavePayload 内 pruneUndefinedDeep と同じ規則（null・空文字を落とす） */
function storePrune(obj: unknown): unknown {
  if (Array.isArray(obj)) return obj.map(storePrune).filter((v) => !(v === undefined || v === null));
  if (obj && typeof obj === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
      const pv = storePrune(v);
      const drop = pv === undefined || pv === null || (typeof pv === 'string' && pv.trim() === '');
      if (!drop) out[k] = pv;
    }
    return out;
  }
  return obj;
}

const assumptions: CfAssumptions = {
  minCashYen: 80_000_000,
  taxRate: 0.3,
  depreciationYen: null,
  arRatio: null,
  inventoryRatio: null,
  apRatio: null,
  targetRevenueYen: null,
  targetOperatingIncomeYen: null,
  targetYear: null,
};

const domain: FinancePlanDomain = {
  assumptions,
  existingLoans: [],
  newLoans: [
    {
      id: 'n1',
      name: '',
      drawYear: 2027,
      drawMonth: null,
      amountYen: 100_000_000,
      annualRate: 0.015,
      termYears: 5,
      graceYears: null,
      method: 'EQUAL_PRINCIPAL',
    },
  ],
  dividendsYen: { 2026: null, 2027: 5_000_000 },
};

const financePL: FinancePLRow[] = [
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
        skillPlans: [
          { id: 'sk1', skillName: '設備', cost: 30_000_000, spend: { category: 'CAPEX', recurrence: 'ONE_TIME', amountBasis: 'TOTAL', paymentYm: '2027-03' } },
        ],
      },
    ],
  },
] as unknown as Department[];

function savedAfterStorePrune(companyId = COMPANY) {
  const c = computeStage6FinancePlan({
    financePL,
    financeBS,
    departments,
    fiscalYearEnd: '3',
    domain,
    currentYear: NOW.getFullYear(),
  });
  const meta: CalcSnapshotMeta = {
    calcVersion: FINANCE_PLAN_CALC_VERSION,
    companyId,
    baseYear: c.basePlan.baseYear,
    bsBaseYear: c.basePlan.bsBaseYear,
    assumptionsHash: c.assumptionsHash,
    sourceHash: c.sourceHash,
    unconfirmed: {
      unapprovedReadyYen: c.investment.unapprovedReadyYen,
      unclassifiedYen: c.investment.unclassifiedYen,
      unscheduledYen: c.investment.unscheduledYen,
      candidateYen: c.investment.candidateYen,
      basisPendingYen: c.investment.basisPendingYen,
    },
    computedAt: NOW.toISOString(),
  };
  const inMemory = buildStoredFinancePlan({ domain, companyId, meta, savedAt: NOW.toISOString() });
  const persisted = JSON.parse(JSON.stringify(storePrune(inMemory)));
  return { meta, persisted };
}

describe('保存・再読込を経た財務前提の識別子', () => {
  it('ストアの保存処理で null・空文字が落ちても、読込後の識別子は保存時と一致する', () => {
    const { meta, persisted } = savedAfterStorePrune();
    expect(persisted.cashFlow).not.toHaveProperty('depreciationYen');
    const read = readStoredFinancePlan(persisted, COMPANY);
    expect(read.kind).toBe('OK');
    if (read.kind !== 'OK') return;
    expect(read.meta.assumptionsHash).toBe(meta.assumptionsHash);
  });

  it('銀行向け計画書の財務データは、保存済みの前提から CURRENT として数値を返す', () => {
    const { persisted } = savedAfterStorePrune();
    const block = bankFinancialPlanForRow({
      row: {
        id: STRATEGY,
        company_id: COMPANY,
        departments,
        finance_pl: financePL,
        company_targets: [],
        fiscal_year_end: '3',
        csv_finance_data: { financeBS, financePlanAssumptions: persisted },
      },
      companyId: COMPANY,
      now: NOW,
    });
    expect(block.status).toBe('CURRENT');
    expect(block.sections).not.toBeNull();
    expect(block.reproducibility.savedAssumptionsHash).toBe(block.reproducibility.currentAssumptionsHash);
    expect(block.reproducibility.savedSourceHash).toBe(block.reproducibility.currentSourceHash);
  });

  it('会社IDが一致しない保存データは、再読込しても使用しない', () => {
    const { persisted } = savedAfterStorePrune('22222222-2222-4222-8222-222222222222');
    const block = bankFinancialPlanForRow({
      row: {
        id: STRATEGY,
        company_id: COMPANY,
        departments,
        finance_pl: financePL,
        company_targets: [],
        fiscal_year_end: '3',
        csv_finance_data: { financeBS, financePlanAssumptions: persisted },
      },
      companyId: COMPANY,
      now: NOW,
    });
    expect(block.status).toBe('DIFFERENT_COMPANY');
    expect(block.sections).toBeNull();
  });

  it('保存後に前提の値を書き換えられた場合は INVALID のままにする（検出を弱めない）', () => {
    const { persisted } = savedAfterStorePrune();
    const tampered = JSON.parse(JSON.stringify(persisted));
    tampered.newLoans[0].amountYen = 1;
    const block = bankFinancialPlanForRow({
      row: {
        id: STRATEGY,
        company_id: COMPANY,
        departments,
        finance_pl: financePL,
        company_targets: [],
        fiscal_year_end: '3',
        csv_finance_data: { financeBS, financePlanAssumptions: tampered },
      },
      companyId: COMPANY,
      now: NOW,
    });
    expect(block.status).toBe('INVALID');
  });
});
