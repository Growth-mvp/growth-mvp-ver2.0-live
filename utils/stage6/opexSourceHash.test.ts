import type { CfAssumptions } from './cashflow';
import type { Department, FinanceBSRow, FinancePLRow } from '@/types/strategy';
import { computeStage6FinancePlan } from './financePlanPipeline';
import { sourceHashOf, type FinancePlanDomain } from './financePlanSnapshot';
import { opexHashInputOf } from './opexDeduction';

const financePL: FinancePLRow[] = [
  { year: 2024, revenue: 900_000_000, operatingIncome: 40_000_000, netIncome: 25_000_000, depreciation: 18_000_000, interest: 6_000_000, tax: 8_000_000 },
  { year: 2025, revenue: 1_000_000_000, operatingIncome: 50_000_000, netIncome: 30_000_000, depreciation: 20_000_000, interest: 5_000_000, tax: 10_000_000 },
];
const financeBS: FinanceBSRow[] = [
  { year: 2025, cash: 100_000_000, ar: 150_000_000, inventory: 80_000_000, ap: 60_000_000, interestBearingDebt: 300_000_000 },
];
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
const domain: FinancePlanDomain = { assumptions, existingLoans: [], newLoans: [], dividendsYen: {} };

const project = (opexRelation?: 'NOT_IN_PLAN' | 'IN_PLAN') => ({
  id: 'p-1',
  title: '少量配送',
  executionHumanInvestments: [
    {
      id: 'ox1',
      type: 'OTHER',
      name: '外注費（検証用）',
      amount: 1_000_000,
      spend: {
        category: 'OPEX',
        recurrence: 'ONE_TIME',
        amountBasis: 'TOTAL',
        paymentYm: '2026-10',
        ...(opexRelation ? { opexRelation } : {}),
      },
    },
  ],
});

const departmentsWith = (p: ReturnType<typeof project>): Department[] => [{ id: 'd1', name: '宅配', projects: [p] }] as unknown as Department[];

const compute = (departments: Department[]) =>
  computeStage6FinancePlan({ financePL, financeBS, departments, fiscalYearEnd: '3', domain, currentYear: 2026 });

describe('銀行向け計画書と保存側の鮮度の識別子（OPEX控除）', () => {
  it('営業利益から差し引くOPEXがあると、保存側と同じ識別子になる', () => {
    const departments = departmentsWith(project('NOT_IN_PLAN'));
    const computed = compute(departments);
    const saved = sourceHashOf({
      financePL,
      financeBS,
      investment: {
        approvedReadyYen: computed.investment.approvedReadyYen,
        unapprovedReadyYen: computed.investment.unapprovedReadyYen,
        unclassifiedYen: computed.investment.unclassifiedYen,
        unscheduledYen: computed.investment.unscheduledYen,
        candidateYen: computed.investment.candidateYen,
        basisPendingYen: computed.investment.basisPendingYen,
        yearlyByCategory: computed.investment.yearlyByCategory,
        opexNotInPlanYearly: opexHashInputOf(departments, '3'),
      },
      fiscalYearEnd: '3',
    });
    expect(opexHashInputOf(departments, '3')).toEqual([{ fiscalYear: 2027, amountYen: 1_000_000 }]);
    expect(computed.sourceHash).toBe(saved);
  });

  it('営業利益に既に含まれるOPEXは差し引かないため、控除の項目を識別子に加えない（従来の作り方のまま）', () => {
    const departments = departmentsWith(project('IN_PLAN'));
    const computed = compute(departments);
    expect(opexHashInputOf(departments, '3')).toBeUndefined();
    const legacy = sourceHashOf({
      financePL,
      financeBS,
      investment: {
        approvedReadyYen: computed.investment.approvedReadyYen,
        unapprovedReadyYen: computed.investment.unapprovedReadyYen,
        unclassifiedYen: computed.investment.unclassifiedYen,
        unscheduledYen: computed.investment.unscheduledYen,
        candidateYen: computed.investment.candidateYen,
        basisPendingYen: computed.investment.basisPendingYen,
        yearlyByCategory: computed.investment.yearlyByCategory,
      },
      fiscalYearEnd: '3',
    });
    expect(computed.sourceHash).toBe(legacy);
  });

  it('差し引くOPEXの金額が変わると、鮮度の識別子も変わる（STALEとして判定される）', () => {
    const before = compute(departmentsWith(project('NOT_IN_PLAN')));
    const changed = project('NOT_IN_PLAN');
    changed.executionHumanInvestments[0].amount = 2_000_000;
    const after = compute(departmentsWith(changed));
    expect(after.sourceHash).not.toBe(before.sourceHash);
  });
});
