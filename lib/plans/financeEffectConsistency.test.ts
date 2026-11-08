import type { Department } from '@/types/strategy';
import { buildFinanceEffectTrial } from '@/utils/stage6/financeEffectPlan';
import { financeTotals, projectFinanceSummary } from './financeEffectSummary';

const M = 1_000_000;

const effect = (over: Record<string, unknown>) => ({
  kind: 'REVENUE_UP',
  method: 'DIRECT_AMOUNT',
  source: 'USER_INPUT',
  confirmed: true,
  sourceNote: '架空の根拠',
  ...over,
});

/** 会社：年度末は3月。FY2027 = 2026年4月〜2027年3月 */
const departments = [
  {
    id: 'd1',
    name: '営業部',
    projects: [
      {
        id: 'p1',
        title: '新規法人顧客の獲得',
        financeEffect: effect({
          method: 'FUNNEL',
          meetingsPerPeriod: 30,
          winRatePct: 20,
          averageDealYen: 20 * M,
          amountBasis: 'ANNUAL',
          startYm: '2026-04',
          operatingIncomeEffectYen: 30 * M,
        }),
      },
      {
        id: 'p2',
        title: '配送ルート改善（費用削減）',
        financeEffect: effect({
          kind: 'COST_REDUCTION',
          directAmountYen: 12 * M,
          amountBasis: 'ANNUAL',
          startYm: '2026-10',
        }),
      },
      {
        id: 'p3',
        title: '複数効果の施策',
        financeEffect: effect({
          directAmountYen: 50 * M,
          amountBasis: 'TOTAL',
          startYm: '2027-05',
        }),
        financeEffects: [
          effect({
            kind: 'COST_REDUCTION',
            directAmountYen: 1 * M,
            amountBasis: 'MONTHLY',
            startYm: '2026-04',
          }),
        ],
      },
      {
        id: 'p4',
        title: '未確認の売上（集計しない）',
        financeEffect: effect({
          directAmountYen: 100 * M,
          amountBasis: 'ANNUAL',
          startYm: '2026-04',
          confirmed: false,
        }),
      },
      {
        id: 'p5',
        title: '入力不足（集計しない）',
        financeEffect: effect({ kind: 'REVENUE_UP', method: 'DIRECT_AMOUNT', directAmountYen: undefined, amountBasis: 'ANNUAL' }),
      },
    ],
  },
] as unknown as Department[];

const trial = buildFinanceEffectTrial({ departments, fiscalYearEnd: '3', fiscalYears: [2027, 2028] });
const yearOf = (fy: number) => trial.years.find((y) => y.fiscalYear === fy)!;

describe('確認済み財務効果：年度別の全社増分（STAGE6の試算）', () => {
  it('FY2027：売上は年額の新規獲得だけ、費用削減は途中開始の分と複数効果の分を年度内の月数で数える', () => {
    const y = yearOf(2027);
    expect(y.revenueYen).toBe(120 * M);
    expect(y.costReductionYen).toBe(6 * M + 12 * M);
    expect(y.revenueOperatingIncomeYen).toBe(30 * M);
  });

  it('FY2028：一回限りの売上は開始月の年度に1回だけ入り、利益が未入力なら営業利益は未算定（0にしない）', () => {
    const y = yearOf(2028);
    expect(y.revenueYen).toBe(120 * M + 50 * M);
    expect(y.revenueOperatingIncomeYen).toBeNull();
    expect(y.costReductionYen).toBe(12 * M + 12 * M);
  });

  it('未確認・入力不足の効果は、どの年度の金額にも入らない', () => {
    expect(yearOf(2027).revenueYen).not.toBe(220 * M);
    expect(trial.projects.filter((r) => r.status === 'DRAFT').map((r) => r.projectTitle)).toEqual(['未確認の売上（集計しない）']);
    expect(trial.projects.filter((r) => r.status === 'INCOMPLETE').map((r) => r.projectTitle)).toEqual(['入力不足（集計しない）']);
  });

  it('プロジェクト別の年度別値を足すと、全社増分の年度合計と一致する（二重計上なし）', () => {
    for (const fy of [2027, 2028]) {
      const rows = trial.projects.filter((r) => r.status === 'REFLECTED');
      const sumRevenue = rows.reduce((s, r) => s + (r.years.find((v) => v.fiscalYear === fy)?.revenueYen ?? 0), 0);
      const sumCost = rows.reduce((s, r) => s + (r.years.find((v) => v.fiscalYear === fy)?.costReductionYen ?? 0), 0);
      expect(sumRevenue).toBe(yearOf(fy).revenueYen);
      expect(sumCost).toBe(yearOf(fy).costReductionYen);
    }
  });
});

describe('確認済み財務効果：計画書の表示（年額換算・全社試算の内訳）', () => {
  it('プロジェクトの表示は、確認済みの効果だけを金額にし、未確認・未算定は理由を示す', () => {
    const p1 = projectFinanceSummary(departments[0].projects[0] as any);
    expect(p1.revenueText).toBe('年額換算 +120百万円（確認済み）');
    expect(p1.operatingText).toBe('年額換算 +30百万円（確認済み）');

    const p4 = projectFinanceSummary(departments[0].projects[3] as any);
    expect(p4.revenueText).toBe('未確認（財務試算に含まない）');
    expect(p4.confirmedRevenueYen).toBeNull();

    const p5 = projectFinanceSummary(departments[0].projects[4] as any);
    expect(p5.revenueText).toMatch(/^未算定（不足：/);
    expect(p5.confirmedRevenueYen).toBeNull();
  });

  it('複数効果の施策は、効果ごとの表示を並べ、売上の増分と費用削減を混ぜない', () => {
    const p3 = projectFinanceSummary(departments[0].projects[2] as any);
    expect(p3.revenueText).toBe('一回限り +50百万円（確認済み）');
    expect(p3.operatingText).toContain('年額換算 +12百万円（確認済み）');
    expect(p3.operatingText).toContain('売上増の営業利益の増分は未算定');
    expect(p3.confirmedRevenueYen).toBe(50 * M);
  });

  it('全社の確認済み合計は、年額換算の合計（計画書の内訳）と一致し、未確認は含まない', () => {
    const t = financeTotals(departments);
    expect(t.revenueYen).toBe(120 * M + 50 * M);
    expect(t.operatingIncomeYen).toBe(30 * M + 12 * M + 12 * M);
    expect(t.confirmedCount).toBe(4);
    expect(t.pendingCount).toBe(2);
    expect(t.projectCount).toBe(5);
  });
});
