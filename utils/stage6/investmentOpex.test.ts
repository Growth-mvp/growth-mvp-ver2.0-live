import type { Department, ExecutionHumanInvestment } from '@/types/strategy';
import { withNotInPlanOpex, type FinanceEffectTrialYear } from './financeEffectPlan';
import { buildInvestmentDemandSummary, notInPlanOpexByFiscalYear } from './investmentDemand';
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

describe('notInPlanOpexByFiscalYear', () => {
  it('営業利益に含まれないOPEXだけを、支出年月の会計年度に配分する', () => {
    const departments = departmentsWith([
      oneTime('o1', 'OPEX', 1_000_000, '2026-04', 'NOT_IN_PLAN'),
      oneTime('o2', 'OPEX', 500_000, '2026-04', 'IN_PLAN'),
      oneTime('o3', 'OPEX', 200_000, '2026-04'),
      oneTime('c1', 'CAPEX', 3_000_000, '2026-04', 'NOT_IN_PLAN'),
      {
        id: 'o4',
        type: 'OTHER',
        name: '外注（継続）',
        amount: 100_000,
        spend: { category: 'OPEX', recurrence: 'RECURRING', amountBasis: 'MONTHLY', startYm: '2026-04', endYm: '2026-06', opexRelation: 'NOT_IN_PLAN' },
      },
    ]);
    expect(notInPlanOpexByFiscalYear(departments, FY_END)).toEqual([{ fiscalYear: 2027, amountYen: 1_000_000 + 300_000 }]);
  });

  it('会計年度の決算月が無いときは配分しない（未確定を控除しない）', () => {
    expect(notInPlanOpexByFiscalYear(departmentsWith([oneTime('o1', 'OPEX', 1_000_000, '2026-04', 'NOT_IN_PLAN')]), undefined)).toEqual([]);
  });
});

describe('withNotInPlanOpex', () => {
  it('該当年度の追加費用に足し、営業利益への効果も同じ分だけ減らす', () => {
    const years: FinanceEffectTrialYear[] = [
      { fiscalYear: 2027, revenueYen: 0, costReductionYen: 200, costIncreaseYen: 100, operatingEffectYen: 100, revenueOperatingIncomeYen: 0, grossProfitYen: 0 },
      { fiscalYear: 2028, revenueYen: 0, costReductionYen: 0, costIncreaseYen: 0, operatingEffectYen: 0, revenueOperatingIncomeYen: 0, grossProfitYen: 0 },
    ];
    const out = withNotInPlanOpex(years, [{ fiscalYear: 2027, amountYen: 300 }]);
    expect(out[0]).toMatchObject({ costIncreaseYen: 400, operatingEffectYen: -200 });
    expect(out[1]).toBe(years[1]);
  });

  it('控除対象が無ければ元の値をそのまま返す', () => {
    const years: FinanceEffectTrialYear[] = [];
    expect(withNotInPlanOpex(years, [])).toBe(years);
  });
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
