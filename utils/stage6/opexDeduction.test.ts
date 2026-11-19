import type { Department, ExecutionHumanInvestment, FinanceEffect, SpendSchedule } from '@/types/strategy';
import { buildFinanceEffectTrial, type FinanceEffectProjectRow } from './financeEffectPlan';
import { addCostConfirmedOf } from '@/lib/financeEffect';
import { opexDeductionOfProjects, opexDeductionYearly } from './opexDeduction';

const FY = [2026, 2027, 2028];
const FY_END = '3';
const confirmed = { confirmed: true, sourceNote: '見積書（架空）' };

const addCost: FinanceEffect = {
  ...confirmed,
  kind: 'COST_INCREASE',
  method: 'DIRECT_AMOUNT',
  directAmountYen: 3_000_000,
  amountBasis: 'TOTAL',
  startYm: '2026-10',
  endYm: '2027-03',
} as FinanceEffect;

const opex = (id: string, amount: number, spend: Partial<SpendSchedule>): ExecutionHumanInvestment => ({
  id,
  type: 'OTHER',
  name: `外注費${id}`,
  amount,
  spend: { category: 'OPEX', recurrence: 'ONE_TIME', amountBasis: 'TOTAL', paymentYm: '2026-10', ...spend },
});

const deptWith = (projects: Array<{ title: string; financeEffect?: FinanceEffect; items?: ExecutionHumanInvestment[] }>): Department[] =>
  [
    {
      id: 'd1',
      name: '宅配事業',
      projects: projects.map((p, i) => ({
        id: `p${i}`,
        title: p.title,
        financeEffect: p.financeEffect,
        executionHumanInvestments: p.items ?? [],
      })),
    },
  ] as unknown as Department[];

const trialOf = (departments: Department[]) => buildFinanceEffectTrial({ departments, fiscalYearEnd: FY_END, fiscalYears: FY });

const costIncreaseOf = (t: ReturnType<typeof trialOf>, fy: number) => t.years.find((y) => y.fiscalYear === fy)?.costIncreaseYen;

describe('OPEXの営業利益控除（施策ごと）', () => {
  it('営業利益に含まれないOPEXは、支出年度の会計年度に一度だけ差し引く', () => {
    const departments = deptWith([{ title: '少量配送', items: [opex('a', 1_000_000, { opexRelation: 'NOT_IN_PLAN' })] }]);
    const list = opexDeductionOfProjects(departments, FY_END, addCostConfirmedOf);
    expect(list).toMatchObject([{ deptIndex: 0, projectIndex: 0, byFiscalYear: [{ fiscalYear: 2027, amountYen: 1_000_000 }], held: [] }]);
    expect(opexDeductionYearly(list)).toEqual([{ fiscalYear: 2027, amountYen: 1_000_000 }]);

    const t = trialOf(departments);
    expect([costIncreaseOf(t, 2026), costIncreaseOf(t, 2027), costIncreaseOf(t, 2028)]).toEqual([0, 1_000_000, 0]);
    expect(t.years.find((y) => y.fiscalYear === 2027)?.operatingEffectYen).toBe(-1_000_000);
    const row = t.projects.find((r) => r.source === 'OPEX');
    expect(row).toMatchObject({ status: 'REFLECTED', projectTitle: '少量配送', startFiscalYear: 2027, endFiscalYear: 2027 });
    expect(row?.years.find((y) => y.fiscalYear === 2027)).toMatchObject({ costIncreaseYen: 1_000_000, operatingIncomeYen: -1_000_000 });
  });

  it('営業利益に既に含まれるOPEX、営業利益との関係が無い既存の明細、未確定の明細は差し引かない', () => {
    const departments = deptWith([
      { title: '含まれる', items: [opex('a', 1_000_000, { opexRelation: 'IN_PLAN' })] },
      { title: '既存', items: [opex('b', 1_000_000, {})] },
      { title: '未確定', items: [opex('c', 1_000_000, { opexRelation: 'NOT_IN_PLAN', paymentYm: undefined })] },
    ]);
    expect(opexDeductionOfProjects(departments, FY_END, addCostConfirmedOf)).toEqual([]);
    expect(trialOf(departments).projects.some((r) => r.source === 'OPEX')).toBe(false);
  });

  it('決算月が無いときは差し引かない', () => {
    const departments = deptWith([{ title: '少量配送', items: [opex('a', 1_000_000, { opexRelation: 'NOT_IN_PLAN' })] }]);
    expect(opexDeductionOfProjects(departments, undefined, addCostConfirmedOf)).toEqual([]);
  });
});

describe('確認済みの追加費用（COST_INCREASE）との二重控除の防止', () => {
  it('同じ案件に確認済みの追加費用があるOPEXは、同じ費用か確認するまで保留し、差し引かない', () => {
    const departments = deptWith([{ title: '少量配送', financeEffect: addCost, items: [opex('a', 1_000_000, { opexRelation: 'NOT_IN_PLAN' })] }]);
    const list = opexDeductionOfProjects(departments, FY_END, addCostConfirmedOf);
    expect(list).toMatchObject([{ byFiscalYear: [], held: [{ label: '外注費a' }] }]);
    const t = trialOf(departments);
    expect(costIncreaseOf(t, 2027)).toBe(3_000_000);
    const row = t.projects.find((r) => r.source === 'OPEX') as FinanceEffectProjectRow;
    expect(row).toMatchObject({ status: 'HELD', years: [] });
    expect(row.reason).toContain('確認待ち');
  });

  it('同じ費用と答えた場合は、追加費用に含まれるものとして二重に差し引かない（行も出さない）', () => {
    const departments = deptWith([{ title: '少量配送', financeEffect: addCost, items: [opex('a', 1_000_000, { opexRelation: 'SAME_AS_ADD_COST' })] }]);
    expect(opexDeductionOfProjects(departments, FY_END, addCostConfirmedOf)).toEqual([]);
    const t = trialOf(departments);
    expect(costIncreaseOf(t, 2027)).toBe(3_000_000);
    expect(t.projects.some((r) => r.source === 'OPEX')).toBe(false);
  });

  it('同じ費用と答えたが確認済みの追加費用が無い場合は、保留にする', () => {
    const departments = deptWith([{ title: '少量配送', items: [opex('a', 1_000_000, { opexRelation: 'SAME_AS_ADD_COST' })] }]);
    const t = trialOf(departments);
    expect(costIncreaseOf(t, 2027)).toBe(0);
    expect(t.projects.find((r) => r.source === 'OPEX')).toMatchObject({ status: 'HELD' });
  });

  it('別の費用と答えた場合は、追加費用とは別に差し引く（合計は追加費用＋OPEX）', () => {
    const departments = deptWith([{ title: '少量配送', financeEffect: addCost, items: [opex('a', 1_000_000, { opexRelation: 'DIFFERENT_FROM_ADD_COST' })] }]);
    const t = trialOf(departments);
    expect(costIncreaseOf(t, 2027)).toBe(4_000_000);
    expect(t.years.find((y) => y.fiscalYear === 2027)?.operatingEffectYen).toBe(-4_000_000);
  });

  it('営業利益に既に含まれると答えた場合は、追加費用の有無にかかわらず差し引かない', () => {
    const departments = deptWith([{ title: '少量配送', financeEffect: addCost, items: [opex('a', 1_000_000, { opexRelation: 'IN_PLAN' })] }]);
    expect(costIncreaseOf(trialOf(departments), 2027)).toBe(3_000_000);
  });

  it('施策別の行の合計は、試算の年度合計と一致する（統一PLの入力と同じ値）', () => {
    const departments = deptWith([
      { title: '少量配送', items: [opex('a', 1_000_000, { opexRelation: 'NOT_IN_PLAN' })] },
      { title: '保守', financeEffect: addCost, items: [opex('b', 500_000, { opexRelation: 'NOT_IN_PLAN' })] },
    ]);
    const t = trialOf(departments);
    for (const y of t.years) {
      const fromRows = t.projects
        .filter((r) => r.status === 'REFLECTED')
        .reduce((s, r) => s + (r.years.find((v) => v.fiscalYear === y.fiscalYear)?.costIncreaseYen ?? 0), 0);
      expect(y.costIncreaseYen).toBe(fromRows);
    }
    expect(costIncreaseOf(t, 2027)).toBe(1_000_000 + 3_000_000);
  });
});
