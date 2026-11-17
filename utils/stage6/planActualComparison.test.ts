import type { Department, ExecutionHumanInvestment, FinanceActualEntry, FinanceEffect } from '@/types/strategy';
import { parseFiscalYearEndMonth } from './investmentDemand';
import { planActualItemsForMode, planActualProjectsOf, planActualYearRowsOf, type PlanActualItem } from './planActualComparison';

const FY_END = '3';
const END_MONTH = parseFiscalYearEndMonth(FY_END)!;
const confirmed = { confirmed: true, sourceNote: '見積書（架空）', source: 'USER_INPUT' as const };

const actual = (itemKey: string, ym: string, amountYen: number): FinanceActualEntry => ({
  itemKey,
  ym,
  amountYen,
  recordedAt: 't',
  createdAt: 't',
});

const opex = (id: string, spend: Partial<ExecutionHumanInvestment['spend']>, amount: number): ExecutionHumanInvestment => ({
  id,
  type: 'OTHER',
  name: `外注${id}`,
  amount,
  spend: { category: 'OPEX', recurrence: 'ONE_TIME', amountBasis: 'TOTAL', paymentYm: '2026-10', ...spend },
});

const dept = (projects: unknown[]) => [{ id: 'd1', name: '宅配事業', projects }] as unknown as Department[];

function itemOf(items: PlanActualItem[], key: string): PlanActualItem {
  const found = items.find((i) => i.itemKey === key);
  if (!found) throw new Error(`item not found: ${key}`);
  return found;
}

describe('計画と実績の照合（年度別・3月決算）', () => {
  const departments = dept([
    {
      id: 'p1',
      title: '少量配送',
      financeEffect: {
        ...confirmed,
        kind: 'COST_REDUCTION',
        method: 'DIRECT_AMOUNT',
        directAmountYen: 5_000_000,
        amountBasis: 'ANNUAL',
        startYm: '2027-04',
        endYm: '2028-03',
      } as FinanceEffect,
      executionHumanInvestments: [opex('ox1', { opexRelation: 'NOT_IN_PLAN' }, 1_000_000)],
      financeActuals: [actual('EFFECT:COST_REDUCTION', '2026-12', 400_000), actual('OPEX:ox1', '2026-10', 1_000_000)],
    },
  ]);
  const items = planActualProjectsOf(departments, FY_END)[0].items;

  it('費用削減の実績（計画期間外の2026年12月）は、会計年度2027年に期間外として集計し、計画の年度とは分ける', () => {
    const rows = planActualYearRowsOf(itemOf(items, 'EFFECT:COST_REDUCTION'), 'OPERATING', END_MONTH);
    expect(rows).toEqual([
      { fiscalYear: 2027, label: '2027年3月期', planYen: null, actualYen: null, outOfPeriodYen: 400_000, differenceYen: null, status: 'OUT_OF_PERIOD' },
      { fiscalYear: 2028, label: '2028年3月期', planYen: 5_000_000, actualYen: null, outOfPeriodYen: null, differenceYen: null, status: 'NO_ACTUAL' },
    ]);
  });

  it('OPEXは支出年度に計画と実績を並べ、全月の登録があるため差額を出す（営業利益はマイナス）', () => {
    const rows = planActualYearRowsOf(itemOf(items, 'OPEX:ox1'), 'OPERATING', END_MONTH);
    expect(rows).toEqual([
      { fiscalYear: 2027, label: '2027年3月期', planYen: -1_000_000, actualYen: -1_000_000, outOfPeriodYen: null, differenceYen: 0, status: 'COMPLETE' },
    ]);
  });

  it('費用・支出額の表示では、同じOPEXを正の金額で表す', () => {
    const rows = planActualYearRowsOf(itemOf(items, 'OPEX:ox1'), 'COST', END_MONTH);
    expect(rows[0]).toMatchObject({ planYen: 1_000_000, actualYen: 1_000_000 });
  });

  it('売上効果の表示には、費用系の項目を出さない', () => {
    expect(planActualItemsForMode(items, 'REVENUE')).toEqual([]);
    expect(planActualItemsForMode(items, 'OPERATING').map((i) => i.itemKey)).toEqual(['EFFECT:COST_REDUCTION', 'OPEX:ox1']);
  });
});

describe('登録が途中・計画が保留・照合できない場合', () => {
  it('計画期間の一部だけ登録された年度は「途中」とし、差額を出さない（未登録月を0円にしない）', () => {
    const departments = dept([
      {
        id: 'p2',
        title: '保守',
        executionHumanInvestments: [opex('ox2', { recurrence: 'RECURRING', amountBasis: 'MONTHLY', startYm: '2026-04', endYm: '2026-06', opexRelation: 'NOT_IN_PLAN' }, 100_000)],
        financeActuals: [actual('OPEX:ox2', '2026-04', 100_000)],
      },
    ]);
    const item = itemOf(planActualProjectsOf(departments, FY_END)[0].items, 'OPEX:ox2');
    expect(planActualYearRowsOf(item, 'COST', END_MONTH)).toEqual([
      { fiscalYear: 2027, label: '2027年3月期', planYen: 300_000, actualYen: 100_000, outOfPeriodYen: null, differenceYen: null, status: 'PARTIAL' },
    ]);
  });

  it('同じ種類の財務効果が複数あるときは、実績を割り当てず照合保留にする', () => {
    const cost = { ...confirmed, kind: 'COST_REDUCTION', method: 'DIRECT_AMOUNT', directAmountYen: 1, amountBasis: 'ANNUAL', startYm: '2026-04' } as FinanceEffect;
    const departments = dept([{ id: 'p3', title: '重複', financeEffect: cost, financeEffects: [{ ...cost, directAmountYen: 2 }], financeActuals: [actual('EFFECT:COST_REDUCTION', '2026-04', 9)] }]);
    const item = itemOf(planActualProjectsOf(departments, FY_END)[0].items, 'EFFECT:COST_REDUCTION');
    expect(item).toMatchObject({ planState: 'AMBIGUOUS', actuals: [] });
    expect(planActualYearRowsOf(item, 'OPERATING', END_MONTH)).toEqual([]);
  });

  it('確認済みの追加費用がある案件のOPEX（同じ費用か未確認）は差し引かず、営業利益の表示では保留と理由を示す', () => {
    const departments = dept([
      {
        id: 'p4',
        title: '保守',
        financeEffect: { ...confirmed, kind: 'COST_INCREASE', method: 'DIRECT_AMOUNT', directAmountYen: 3_000_000, amountBasis: 'TOTAL', startYm: '2026-10', endYm: '2027-03' } as FinanceEffect,
        executionHumanInvestments: [opex('ox4', { opexRelation: 'NOT_IN_PLAN' }, 1_000_000)],
        financeActuals: [actual('OPEX:ox4', '2026-10', 1_000_000)],
      },
    ]);
    const item = itemOf(planActualProjectsOf(departments, FY_END)[0].items, 'OPEX:ox4');
    expect(item.operatingState).toBe('HELD');
    expect(planActualYearRowsOf(item, 'OPERATING', END_MONTH)).toEqual([]);
    expect(item.operatingNote).toContain('同じ費用か確認');
    expect(planActualYearRowsOf(item, 'COST', END_MONTH)[0]).toMatchObject({ planYen: 1_000_000, actualYen: 1_000_000 });
  });

  it('入力が不足して未算定の効果は、計画額を0円にせず、実績だけを「比較できません」として示す', () => {
    const departments = dept([
      {
        id: 'p5',
        title: '売上',
        financeEffect: { ...confirmed, kind: 'REVENUE_UP', amountBasis: 'ANNUAL', startYm: '2026-06' } as FinanceEffect,
        financeActuals: [actual('EFFECT:REVENUE_UP', '2026-07', 500_000)],
      },
    ]);
    const item = itemOf(planActualProjectsOf(departments, FY_END)[0].items, 'EFFECT:REVENUE_UP');
    expect(item.planState).toBe('NOT_CALCULATED');
    expect(planActualYearRowsOf(item, 'REVENUE', END_MONTH)).toEqual([
      { fiscalYear: 2027, label: '2027年3月期', planYen: null, actualYen: 500_000, outOfPeriodYen: null, differenceYen: null, status: 'NOT_COMPARABLE' },
    ]);
  });

  it('計画期間の終了が未設定の効果は、計画額を示しても差額・達成率は出さない', () => {
    const departments = dept([
      {
        id: 'p6',
        title: '継続',
        financeEffect: { ...confirmed, kind: 'COST_REDUCTION', method: 'DIRECT_AMOUNT', directAmountYen: 120_000, amountBasis: 'MONTHLY', startYm: '2026-04' } as FinanceEffect,
        financeActuals: [actual('EFFECT:COST_REDUCTION', '2026-05', 100_000)],
      },
    ]);
    const item = itemOf(planActualProjectsOf(departments, FY_END)[0].items, 'EFFECT:COST_REDUCTION');
    expect(item.comparable).toBe(false);
    const rows = planActualYearRowsOf(item, 'OPERATING', END_MONTH);
    expect(rows.every((r) => r.differenceYen === null && r.status === 'NOT_COMPARABLE')).toBe(true);
  });

  it('実績はあるが計画が無い項目は、計画なしとして区別する', () => {
    const departments = dept([{ id: 'p7', title: '実績のみ', financeActuals: [actual('EFFECT:COST_INCREASE', '2026-06', 10)] }]);
    const item = itemOf(planActualProjectsOf(departments, FY_END)[0].items, 'EFFECT:COST_INCREASE');
    expect(item.planState).toBe('NO_PLAN');
    expect(planActualYearRowsOf(item, 'COST', END_MONTH)[0]).toMatchObject({ planYen: null, actualYen: 10, status: 'NOT_COMPARABLE' });
  });

  it('決算月が無い場合は、照合を行わない', () => {
    expect(planActualProjectsOf(dept([{ id: 'p8', financeActuals: [actual('EFFECT:COST_REDUCTION', '2026-06', 1)] }]), undefined)).toEqual([]);
  });

  it('主財務効果が空で追加の財務効果だけある場合も、種類で対応づけて計画を取得する（回帰）', () => {
    const extra = { ...confirmed, kind: 'COST_REDUCTION', method: 'DIRECT_AMOUNT', directAmountYen: 5_000_000, amountBasis: 'ANNUAL', startYm: '2027-04', endYm: '2028-03' } as FinanceEffect;
    const departments = dept([
      { id: 'p9', title: '追加のみ', financeEffect: undefined, financeEffects: [extra], financeActuals: [actual('EFFECT:COST_REDUCTION', '2026-12', 400_000)] },
    ]);
    const item = itemOf(planActualProjectsOf(departments, FY_END)[0].items, 'EFFECT:COST_REDUCTION');
    expect(item.planState).toBe('PLANNED');
    expect(item.plan.map((p) => [p.fiscalYear, p.amountYen])).toEqual([[2028, 5_000_000]]);
    expect(planActualYearRowsOf(item, 'OPERATING', END_MONTH)).toEqual([
      { fiscalYear: 2027, label: '2027年3月期', planYen: null, actualYen: null, outOfPeriodYen: 400_000, differenceYen: null, status: 'OUT_OF_PERIOD' },
      { fiscalYear: 2028, label: '2028年3月期', planYen: 5_000_000, actualYen: null, outOfPeriodYen: null, differenceYen: null, status: 'NO_ACTUAL' },
    ]);
  });
});
