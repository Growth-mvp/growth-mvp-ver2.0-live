import { computeFinanceEffect } from '@/lib/financeEffect';
import { buildFinanceEffectTrial } from '@/utils/stage6/financeEffectPlan';
import { buildInvestmentDemandSummary } from '@/utils/stage6/investmentDemand';
import { stage6PlanDepartments } from './projectLifecycle';

const NOW = '2026-11-17T00:00:00.000Z';
const sales = (projects: Array<Record<string, unknown>>) => ({ id: 'd-sales', name: '営業部', projects });
const project = (id: string, extra: Record<string, unknown> = {}) => ({ id, title: `施策${id}`, ...extra });
const stopped = (stoppedAt: string) => ({ status: 'STOPPED', changedAt: NOW, changedBy: null, stoppedAt });

/* 12か月の総額1,200万円の効果（2026-04〜2027-03）。6か月経過（2026-10に中止）で、残るのは600万円 */
const totalEffect = (over: Record<string, unknown> = {}) => ({
  kind: 'COST_REDUCTION',
  method: 'DIRECT_AMOUNT',
  directAmountYen: 12_000_000,
  amountBasis: 'TOTAL',
  startYm: '2026-04',
  endYm: '2027-03',
  sourceNote: '一回限りの削減',
  source: 'USER_INPUT',
  confirmed: true,
  reductionConfirmed: true,
  ...over,
});

describe('中止時の総額の再配分の防止（財務効果）', () => {
  it('総額の効果は、残る月数の割合の総額にし、月あたりの金額を変えない', () => {
    const original = totalEffect();
    const cut = stage6PlanDepartments([sales([project('p-1', { financeEffect: original, lifecycle: stopped('2026-10-01T00:00:00.000Z') })])])[0]
      .projects as Array<{ financeEffect: Record<string, unknown> }>;
    const effect = cut[0].financeEffect;
    expect(effect.endYm).toBe('2026-09');
    expect(computeFinanceEffect(effect as never).totalYen).toBe(6_000_000);
    const originalMonthly = (computeFinanceEffect(original as never).totalYen as number) / 12;
    const cutMonthly = (computeFinanceEffect(effect as never).totalYen as number) / 6;
    expect(cutMonthly).toBe(originalMonthly);
  });

  it('元の保存済みの計画は変えない（計算のための写しだけを変える）', () => {
    const original = totalEffect();
    const departments = [sales([project('p-1', { financeEffect: original, lifecycle: stopped('2026-10-01T00:00:00.000Z') })])];
    const before = JSON.stringify(departments);
    stage6PlanDepartments(departments);
    expect(JSON.stringify(departments)).toBe(before);
  });

  it('月額・年額の効果は、金額を変えず、終了月だけを中止の前月にする', () => {
    const monthly = { ...totalEffect(), amountBasis: 'MONTHLY', method: 'DIRECT_AMOUNT', directAmountYen: 100_000, endYm: undefined };
    const cut = stage6PlanDepartments([sales([project('p-1', { financeEffect: monthly, lifecycle: stopped('2026-10-01T00:00:00.000Z') })])])[0]
      .projects as Array<{ financeEffect: Record<string, unknown> }>;
    expect(cut[0].financeEffect).toMatchObject({ directAmountYen: 100_000, amountBasis: 'MONTHLY', endYm: '2026-09' });
  });

  it('中止月以降に始まる効果は外し、中止前の効果は残す（期間の終わりが無い総額は開始月の一回分）', () => {
    const oneTime = { ...totalEffect(), startYm: '2026-05', endYm: undefined };
    const later = { ...totalEffect(), startYm: '2026-11', endYm: '2027-03' };
    const cut = stage6PlanDepartments([
      sales([project('p-1', { financeEffect: oneTime, financeEffects: [later], lifecycle: stopped('2026-10-01T00:00:00.000Z') })]),
    ])[0].projects as Array<{ financeEffect: Record<string, unknown>; financeEffects: unknown[] }>;
    expect(cut[0].financeEffect).toEqual(oneTime);
    expect(cut[0].financeEffects).toEqual([]);
  });

  it('年度の集計でも、中止後の総額は残る月数の割合になる（12か月総額の6か月分）', () => {
    const cut = stage6PlanDepartments([sales([project('p-1', { financeEffect: totalEffect(), lifecycle: stopped('2026-10-01T00:00:00.000Z') })])]);
    const trial = buildFinanceEffectTrial({ departments: cut as never, fiscalYearEnd: '3', fiscalYears: [2026, 2027] });
    const row = trial.projects.find((r) => r.projectTitle === '施策p-1');
    expect(row).toBeTruthy();
    const full = buildFinanceEffectTrial({ departments: [sales([project('p-1', { financeEffect: totalEffect() })])] as never, fiscalYearEnd: '3', fiscalYears: [2026, 2027] });
    const fullRow = full.projects.find((r) => r.projectTitle === '施策p-1');
    const sum = (r: typeof row) => (r?.years ?? []).reduce((s, y) => s + (y.costReductionYen ?? 0), 0);
    expect(fullRow?.status).toBe('REFLECTED');
    expect(row?.status).toBe('REFLECTED');
    expect(sum(fullRow)).toBe(12_000_000);
    expect(sum(row)).toBe(6_000_000);
  });
});

describe('中止時の投資・費用（旧データを含む）', () => {
  it('総額の支出条件は、残る期間の割合の金額にする。月額の支出は金額を変えない', () => {
    const total = { id: 'i-total', type: 'OTHER', name: '委託', amount: 12_000_000, spend: { category: 'OPEX', recurrence: 'RECURRING', amountBasis: 'TOTAL', startYm: '2026-04', endYm: '2027-03', opexRelation: 'NOT_IN_PLAN' } };
    const monthly = { id: 'i-month', type: 'OTHER', name: '保守', amount: 100_000, spend: { category: 'OPEX', recurrence: 'RECURRING', amountBasis: 'MONTHLY', startYm: '2026-04', endYm: '2027-03', opexRelation: 'NOT_IN_PLAN' } };
    const cut = stage6PlanDepartments([sales([project('p-1', { executionHumanInvestments: [total, monthly], lifecycle: stopped('2026-10-01T00:00:00.000Z') })])])[0]
      .projects as Array<{ executionHumanInvestments: Array<{ id: string; amount: number; spend: Record<string, unknown> }> }>;
    const [t, m] = cut[0].executionHumanInvestments;
    expect(t.amount).toBe(6_000_000);
    expect(t.spend.endYm).toBe('2026-09');
    expect(m.amount).toBe(100_000);
    expect(m.spend.endYm).toBe('2026-09');
  });

  it('スキルプラン・必要投資額・INVEST KR も、中止月以降を外して、総額を残る割合に縮める', () => {
    const skill = { id: 's1', skillName: '研修', cost: 1_200_000, spend: { category: 'OPEX', recurrence: 'RECURRING', amountBasis: 'TOTAL', startYm: '2026-04', endYm: '2027-03' } };
    const skillLater = { id: 's2', skillName: '後の研修', cost: 500_000, spend: { category: 'OPEX', recurrence: 'ONE_TIME', paymentYm: '2027-01' } };
    const kr = { id: 'k1', kind: 'INVEST', label: '投資KR', target: 1_200, unit: 'JPY', due: '2027-03', spend: { category: 'CAPEX', recurrence: 'RECURRING', amountBasis: 'TOTAL', startYm: '2026-04', endYm: '2027-03' } };
    const cut = stage6PlanDepartments([
      sales([
        project('p-1', {
          skillPlans: [skill, skillLater],
          impactInvestmentMJPY: 12,
          impactInvestmentSpend: { category: 'CAPEX', recurrence: 'RECURRING', amountBasis: 'TOTAL', startYm: '2026-04', endYm: '2027-03' },
          okrsV2: [kr],
          lifecycle: stopped('2026-10-01T00:00:00.000Z'),
        }),
      ]),
    ])[0].projects as Array<Record<string, any>>;
    expect(cut[0].skillPlans.map((s: { id: string }) => s.id)).toEqual(['s1']);
    expect(cut[0].skillPlans[0].cost).toBe(600_000);
    expect(cut[0].impactInvestmentMJPY).toBe(6);
    expect(cut[0].impactInvestmentSpend.endYm).toBe('2026-09');
    expect(cut[0].okrsV2[0].target).toBe(600);
  });

  it('予定だけで支払済みとは判断しない（中止前の支払予定は残す）', () => {
    const paid = { id: 'i-paid', type: 'OTHER', name: '支払済み', amount: 300_000, spend: { category: 'OPEX', recurrence: 'ONE_TIME', paymentYm: '2026-08' } };
    const cut = stage6PlanDepartments([sales([project('p-1', { executionHumanInvestments: [paid], lifecycle: stopped('2026-10-01T00:00:00.000Z') })])])[0]
      .projects as Array<{ executionHumanInvestments: Array<{ id: string; amount: number }> }>;
    expect(cut[0].executionHumanInvestments).toEqual([paid]);
  });
});

describe('除外・中止の写しの位置（投資タブの書き戻しの安全）', () => {
  it('除外した施策は予定を空にし、施策の並びと位置は変えない', () => {
    const departments = [
      sales([
        project('p-1', { executionHumanInvestments: [{ id: 'a', type: 'OTHER', name: 'A', amount: 100, spend: { category: 'CAPEX', recurrence: 'ONE_TIME', paymentYm: '2027-01' } }], lifecycle: { status: 'EXCLUDED', changedAt: NOW, changedBy: null } }),
        project('p-2', { executionHumanInvestments: [{ id: 'b', type: 'OTHER', name: 'B', amount: 200, spend: { category: 'CAPEX', recurrence: 'ONE_TIME', paymentYm: '2027-01' } }] }),
      ]),
    ];
    const planned = stage6PlanDepartments(departments)[0].projects as Array<Record<string, unknown>>;
    expect(planned.map((p) => p.id)).toEqual(['p-1', 'p-2']);
    expect(planned[0]).not.toHaveProperty('executionHumanInvestments');
    expect(planned[1].executionHumanInvestments).toEqual(departments[0].projects[1].executionHumanInvestments);
  });

  it('投資の集計は、写しの位置で項目を作り、保存データの同じ位置の施策を指す（別の施策を更新しない）', () => {
    const investment = (id: string, amount: number) => ({ id, type: 'OTHER', name: id, amount, spend: { category: 'CAPEX', recurrence: 'ONE_TIME', paymentYm: '2027-01' } });
    const departments = [
      sales([
        project('p-1', { executionHumanInvestments: [investment('a', 100)], lifecycle: { status: 'EXCLUDED', changedAt: NOW, changedBy: null } }),
        project('p-2', { executionHumanInvestments: [investment('b', 200)] }),
      ]),
    ];
    const summary = buildInvestmentDemandSummary(stage6PlanDepartments(departments) as never, '3');
    const items = summary.items.filter((i) => i.ref.source === 'HUMAN_INVESTMENT');
    expect(items.map((i) => i.ref.projectIndex)).toEqual([1]);
    expect(items.map((i) => i.amountYen)).toEqual([200]);
  });
});
