import type { Department } from '@/types/strategy';
import type { FinanceEffectProjectRow } from './financeEffectPlan';
import type { PlanActualProject } from './planActualComparison';
import { projectPerformanceTableOf } from './performanceView';

const M = 1_000_000;
const CURRENT = 2027;

const yearOf = (fiscalYear: number, operatingIncomeYen: number, revenueYen = 0) => ({
  fiscalYear,
  revenueYen,
  costReductionYen: 0,
  costIncreaseYen: 0,
  revenueOperatingIncomeYen: 0,
  grossProfitYen: 0,
  operatingIncomeYen,
});

const trialRow = (over: Partial<FinanceEffectProjectRow> & { deptIndex: number; projectIndex: number; deptName: string; projectTitle: string }) =>
  ({
    effectIndex: 0,
    kind: null,
    status: 'REFLECTED',
    startFiscalYear: 2026,
    endFiscalYear: 2030,
    reason: null,
    operatingUnknown: false,
    years: [],
    ...over,
  }) as unknown as FinanceEffectProjectRow;

const DEPARTMENTS = [
  { name: '新聞販売・配達事業', projects: [{ title: '継続接点' }, { title: '生活支援' }] },
  { name: '宅配事業', projects: [{ title: '地域小口' }, { title: '委託' }, { title: '未算定の施策' }] },
] as unknown as Department[];

/** 継続接点：費用削減2.0（2026〜2030）、2026年11月に10万円の実績（2027年3月期の一部） */
const PROJECTS = [
  {
    deptIndex: 0,
    projectIndex: 0,
    deptName: '新聞販売・配達事業',
    projectTitle: '継続接点',
    items: [
      {
        kind: 'COST_REDUCTION',
        planState: 'PLANNED',
        comparable: true,
        plan: [{ fiscalYear: CURRENT, amountYen: 2 * M, months: ['2026-04', '2026-05', '2026-06', '2026-07', '2026-08', '2026-09', '2026-10', '2026-11', '2026-12', '2027-01', '2027-02', '2027-03'] }],
        actuals: [{ ym: '2026-11', amountYen: 100_000 }],
      },
    ],
  },
] as unknown as PlanActualProject[];

const TRIAL_BASE = [
  trialRow({ deptIndex: 0, projectIndex: 0, deptName: '新聞販売・配達事業', projectTitle: '継続接点', years: [yearOf(CURRENT, 2 * M)] }),
  trialRow({ deptIndex: 0, projectIndex: 1, deptName: '新聞販売・配達事業', projectTitle: '生活支援', startFiscalYear: 2027, endFiscalYear: 2030, years: [yearOf(CURRENT, -0.2 * M)] }),
  // 地域小口は2028年度から：2027年度は計画期間外（0円とは別）
  trialRow({ deptIndex: 1, projectIndex: 0, deptName: '宅配事業', projectTitle: '地域小口', startFiscalYear: 2028, endFiscalYear: 2030, years: [yearOf(CURRENT, 0)] }),
];

const find = (table: ReturnType<typeof projectPerformanceTableOf>, title: string) =>
  table.groups.flatMap((g) => g.rows).find((r) => r.projectTitle === title)!;

describe('当会計年度に統一した一覧（目標・実績・達成率・全社合計）', () => {
  it('計画期間外と0円を区別し、目標が負・0なら達成率を出さない', () => {
    const t = projectPerformanceTableOf({
      metric: 'OPERATING_INCOME',
      currentFiscalYear: CURRENT,
      fiscalYearEnd: '3',
      trialProjects: TRIAL_BASE,
      projects: PROJECTS,
      departments: DEPARTMENTS,
    });
    expect(find(t, '地域小口').targetKind).toBe('OUT_OF_PERIOD');
    expect(find(t, '地域小口').targetLabel).toBe('計画期間外');
    expect(find(t, '地域小口').achievement.text).toBe('計画期間外のため算出しません');
    expect(find(t, '生活支援').targetYen).toBeCloseTo(-0.2 * M, 0);
    expect(find(t, '生活支援').achievement.text).toBe('目標が負の値のため算出しません');
    expect(find(t, '委託').targetLabel).toBe('財務効果なし');
    expect(find(t, '未算定の施策').targetLabel).toBe('財務効果なし');
  });

  it('登録途中の実績は参考値として達成率を出す（2.0の目標に対し0.1＝5.0%・参考）', () => {
    const t = projectPerformanceTableOf({
      metric: 'OPERATING_INCOME',
      currentFiscalYear: CURRENT,
      fiscalYearEnd: '3',
      trialProjects: TRIAL_BASE.slice(0, 1),
      projects: PROJECTS,
      departments: DEPARTMENTS,
    });
    const row = find(t, '継続接点');
    expect(row.targetYen).toBe(2 * M);
    expect(row.actualYen).toBe(100_000);
    expect(row.actualNote).toBe('登録途中（参考値）・費用削減分');
    expect(row.achievement.pct).toBeCloseTo(5, 6);
    expect(row.achievement.reference).toBe(true);
  });

  it('未算定の施策があれば全社合計を出さない（0として足さない）', () => {
    const t = projectPerformanceTableOf({
      metric: 'OPERATING_INCOME',
      currentFiscalYear: CURRENT,
      fiscalYearEnd: '3',
      trialProjects: TRIAL_BASE.concat(trialRow({ deptIndex: 1, projectIndex: 2, deptName: '宅配事業', projectTitle: '未算定の施策', status: 'HELD' })),
      projects: PROJECTS,
      departments: DEPARTMENTS,
    });
    expect(t.total.targetYen).toBeNull();
    expect(t.total.achievement.pct).toBeNull();
    expect(t.total.achievement.text).toBe('未算定の施策を含むため算出しません');
  });

  it('全社合計：目標は確定した施策の合計（2.0 − 0.2 = 1.8）、実績は登録済みの合計（0.1・参考）、達成率は5.6%（参考）', () => {
    const t = projectPerformanceTableOf({
      metric: 'OPERATING_INCOME',
      currentFiscalYear: CURRENT,
      fiscalYearEnd: '3',
      trialProjects: TRIAL_BASE,
      projects: PROJECTS,
      departments: DEPARTMENTS,
    });
    expect(t.total.targetYen).toBeCloseTo(1.8 * M, 0);
    expect(t.total.actualYen).toBe(100_000);
    expect(t.total.actualNote).toBe('登録途中（参考値）');
    expect(t.total.achievement.pct).toBeCloseTo((0.1 / 1.8) * 100, 6);
    expect(t.total.achievement.reference).toBe(true);
  });

  it('売上高：目標0円（当会計年度に売上効果なし）は達成率を出さず、実績は未登録', () => {
    const t = projectPerformanceTableOf({
      metric: 'REVENUE',
      currentFiscalYear: CURRENT,
      fiscalYearEnd: '3',
      trialProjects: TRIAL_BASE,
      projects: PROJECTS,
      departments: DEPARTMENTS,
    });
    expect(find(t, '継続接点').targetYen).toBe(0);
    expect(find(t, '継続接点').achievement.text).toBe('目標が0円のため算出しません');
    expect(find(t, '継続接点').actualLabel).toBe('未登録');
    expect(t.total.targetYen).toBe(0);
    expect(t.total.achievement.text).toBe('目標が0円のため算出しません');
  });
});
