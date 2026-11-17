import type { Department, ExecutionHumanInvestment } from '@/types/strategy';
import { buildInvestmentDemandSummary } from './investmentDemand';
import { sourceHashOf } from './financePlanSnapshot';

const FY_END = '3';

const departmentsWith = (records: ExecutionHumanInvestment[]): Department[] =>
  [{ name: '営業部', projects: [{ id: 'proj-1', title: '新規開拓', executionHumanInvestments: records }] }] as unknown as Department[];

const oneTime = (
  id: string,
  category: 'CAPEX' | 'OPEX',
  amount: number,
  paymentYm: string,
  opexRelation?: 'IN_PLAN' | 'NOT_IN_PLAN',
): ExecutionHumanInvestment => ({
  id,
  type: 'OTHER',
  name: `${category}-${id}`,
  amount,
  spend: { category, recurrence: 'ONE_TIME', amountBasis: 'TOTAL', paymentYm, ...(opexRelation ? { opexRelation } : {}) },
});

describe('STAGE6の投資集計（既存の計上ルール）', () => {
  it('CAPEXは支出年度の投資額に一度だけ計上し、OPEXは別の区分に分かれる', () => {
    const summary = buildInvestmentDemandSummary(
      departmentsWith([oneTime('c1', 'CAPEX', 3_000_000, '2026-04', undefined), oneTime('o1', 'OPEX', 1_000_000, '2026-04', 'NOT_IN_PLAN')]),
      FY_END,
    );
    expect(summary.yearlyByCategory).toEqual([{ fiscalYear: 2027, CAPEX: 3_000_000, OPEX: 1_000_000, OTHER: 0 }]);
  });
});

describe('鮮度判定の識別子', () => {
  const base = {
    financePL: [],
    financeBS: [],
    investment: {
      approvedReadyYen: 0,
      unapprovedReadyYen: 0,
      unclassifiedYen: 0,
      unscheduledYen: 0,
      candidateYen: 0,
      basisPendingYen: 0,
      yearlyByCategory: [{ fiscalYear: 2027, CAPEX: 3_000_000, OPEX: 0, OTHER: 0 }],
    },
    fiscalYearEnd: FY_END,
  };

  it('控除対象が無いときは、従来と同じ識別子のままになる', () => {
    expect(sourceHashOf({ ...base, investment: { ...base.investment, opexNotInPlanYearly: undefined } })).toBe(sourceHashOf(base));
  });

  it('営業利益に含まれないOPEXの金額が変わると、識別子も変わる', () => {
    const a = sourceHashOf({ ...base, investment: { ...base.investment, opexNotInPlanYearly: [{ fiscalYear: 2027, amountYen: 300_000 }] } });
    const b = sourceHashOf({ ...base, investment: { ...base.investment, opexNotInPlanYearly: [{ fiscalYear: 2027, amountYen: 400_000 }] } });
    expect(a).not.toBe(sourceHashOf(base));
    expect(a).not.toBe(b);
  });
});
