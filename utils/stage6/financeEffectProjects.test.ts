import type { Department } from '@/types/strategy';
import { buildFinanceEffectTrial } from './financeEffectPlan';

/* 手計算の前提（架空、百万円）
 * 決算月3月。試算の年度：2026・2027・2028（2026年度 = 2025年4月〜2026年3月）
 * A 売上増加：年額60、営業利益の増分 年額10（2025年4月開始・終了未設定）
 * B 費用削減：月額1（2025年4月〜2026年9月）
 * C 追加費用：一回限り 12（2026年4月〜2026年9月、6か月なので月あたり2）
 */
const M = 1_000_000;
const YEARS = [2026, 2027, 2028];

const eff = (over: Record<string, unknown>) => ({ confirmed: true, sourceNote: '見積書（架空）', source: 'USER_INPUT', ...over });
const dept = (projects: unknown[], name = '営業部') => ({ id: name, name, projects }) as unknown as Department;

const DEPTS = [
  dept([
    { id: 'A', title: '新規開拓', financeEffect: eff({ kind: 'REVENUE_UP', method: 'DIRECT_AMOUNT', directAmountYen: 60 * M, amountBasis: 'ANNUAL', startYm: '2025-04', operatingIncomeEffectYen: 10 * M }) },
    { id: 'B', title: '工程改善', financeEffect: eff({ kind: 'COST_REDUCTION', method: 'DIRECT_AMOUNT', directAmountYen: 1 * M, amountBasis: 'MONTHLY', startYm: '2025-04', endYm: '2026-09' }) },
    { id: 'C', title: '一時費用', financeEffect: eff({ kind: 'COST_INCREASE', method: 'DIRECT_AMOUNT', directAmountYen: 12 * M, amountBasis: 'TOTAL', startYm: '2026-04', endYm: '2026-09' }) },
  ]),
];

const trialOf = (departments: Department[] = DEPTS) => buildFinanceEffectTrial({ departments, fiscalYearEnd: '3', fiscalYears: YEARS });
const rowOf = (trial: ReturnType<typeof trialOf>, title: string) => trial.projects.find((p) => p.projectTitle === title)!;

describe('プロジェクト別の財務効果：試算に入る施策だけを金額として持つ', () => {
  it('確認済みの施策は年度別の金額を持ち、年度の合計は試算の年度値と一致する', () => {
    const trial = trialOf();
    const a = rowOf(trial, '新規開拓');
    expect(a.status).toBe('REFLECTED');
    expect(a.years.map((y) => [y.fiscalYear, y.revenueYen, y.operatingIncomeYen])).toEqual([
      [2026, 60 * M, 10 * M],
      [2027, 60 * M, 10 * M],
      [2028, 60 * M, 10 * M],
    ]);
    const b = rowOf(trial, '工程改善');
    // 2026年度（2025年4月〜2026年3月）は12か月分、2027年度は2026年4月〜9月の6か月分
    expect(b.years.find((y) => y.fiscalYear === 2026)!.costReductionYen).toBe(12 * M);
    expect(b.years.find((y) => y.fiscalYear === 2027)!.costReductionYen).toBe(6 * M);
    expect(b.years.find((y) => y.fiscalYear === 2028)!.costReductionYen).toBe(0);
    expect(trial.years.find((y) => y.fiscalYear === 2026)!.revenueYen).toBe(60 * M);
    expect(trial.years.find((y) => y.fiscalYear === 2026)!.revenueOperatingIncomeYen).toBe(10 * M);
  });

  it('年度の合計は、施策ごとの行の合計と一致する（一覧とグラフの値を同じ計算元から作る）', () => {
    const trial = trialOf();
    for (const t of trial.years) {
      const sum = (pick: (y: { revenueYen: number | null; costReductionYen: number | null; costIncreaseYen: number | null }) => number | null) =>
        trial.projects
          .filter((p) => p.status === 'REFLECTED')
          .reduce((acc, p) => acc + (pick(p.years.find((y) => y.fiscalYear === t.fiscalYear)!) ?? 0), 0);
      expect(sum((y) => y.revenueYen)).toBe(t.revenueYen);
      expect(sum((y) => y.costReductionYen)).toBe(t.costReductionYen);
      expect(sum((y) => y.costIncreaseYen)).toBe(t.costIncreaseYen);
    }
  });

  it('未確認・入力不足・非財務の施策は、金額を持たず（0ではなく）理由だけを持つ', () => {
    const trial = trialOf([
      dept([
        { id: 'D', title: '未確認', financeEffect: eff({ kind: 'REVENUE_UP', method: 'DIRECT_AMOUNT', directAmountYen: 50 * M, amountBasis: 'ANNUAL', startYm: '2025-04', confirmed: false }) },
        { id: 'E', title: '入力不足', financeEffect: eff({ kind: 'REVENUE_UP', method: 'DIRECT_AMOUNT', amountBasis: 'ANNUAL', startYm: '2025-04' }) },
        { id: 'F', title: '非財務', financeEffect: { kind: 'NOT_FINANCIAL', source: 'USER_INPUT', confirmed: false } },
        { id: 'G', title: '未登録' },
      ]),
    ]);
    expect(rowOf(trial, '未確認')).toMatchObject({ status: 'DRAFT', years: [] });
    expect(rowOf(trial, '未確認').reason).toContain('未確認');
    expect(rowOf(trial, '入力不足')).toMatchObject({ status: 'INCOMPLETE', years: [] });
    expect(rowOf(trial, '入力不足').reason).toContain('入力不足');
    expect(rowOf(trial, '非財務')).toMatchObject({ status: 'NOT_FINANCIAL', years: [] });
    expect(rowOf(trial, '未登録')).toMatchObject({ status: 'NOT_SET', years: [] });
    expect(trial.years.every((y) => y.revenueYen === 0)).toBe(true);
  });

  it('営業利益の増分が未入力の売上増加は、その年度の営業利益を未算定にし、売上は算定する', () => {
    const trial = trialOf([dept([{ id: 'A', title: '売上のみ', financeEffect: eff({ kind: 'REVENUE_UP', method: 'DIRECT_AMOUNT', directAmountYen: 60 * M, amountBasis: 'ANNUAL', startYm: '2025-04' }) }])]);
    const row = rowOf(trial, '売上のみ');
    expect(row.status).toBe('REFLECTED');
    expect(row.operatingUnknown).toBe(true);
    expect(row.years.map((y) => [y.revenueYen, y.operatingIncomeYen])).toEqual([
      [60 * M, null],
      [60 * M, null],
      [60 * M, null],
    ]);
    expect(trial.years[0].revenueOperatingIncomeYen).toBeNull();
  });

  it('年度の配分：開始月・終了月・決算月で、効果の入る年度と月数を決める', () => {
    const trial = trialOf([dept([{ id: 'X', title: '途中開始', financeEffect: eff({ kind: 'REVENUE_UP', method: 'DIRECT_AMOUNT', directAmountYen: 1 * M, amountBasis: 'MONTHLY', startYm: '2026-10', endYm: '2027-01', operatingIncomeEffectYen: 0.5 * M }) }])]);
    const row = rowOf(trial, '途中開始');
    // 2026年10月〜2027年1月（4か月）は全て2027年度（2026年4月〜2027年3月）に入る。2026年度・2028年度は0
    expect(row.years.map((y) => y.revenueYen)).toEqual([0, 4 * M, 0]);
    expect(row.years.map((y) => y.operatingIncomeYen)).toEqual([0, 2 * M, 0]);
    expect(row.startFiscalYear).toBe(2027);
    expect(row.endFiscalYear).toBe(2027);
  });

  it('費用削減・追加費用は営業利益を増減させ、売上は変えない', () => {
    const trial = trialOf();
    const b = rowOf(trial, '工程改善');
    const c = rowOf(trial, '一時費用');
    expect(b.years[0].revenueYen).toBe(0);
    expect(b.years[0].operatingIncomeYen).toBe(12 * M);
    // 追加費用は 2026年4月〜9月（6か月・一回限り12）。2026年度（〜2026年3月）には入らず、2027年度に12
    expect(c.years[0].costIncreaseYen).toBe(0);
    expect(c.years[0].operatingIncomeYen).toBe(0);
    expect(c.years[1].costIncreaseYen).toBe(12 * M);
    expect(c.years[1].operatingIncomeYen).toBe(-12 * M);
  });

  it('旧データの見込み（impactRevenueMJPY 等）は、財務効果がなければ金額にしない', () => {
    const trial = trialOf([dept([{ id: 'L', title: '旧見込みのみ', impactRevenueMJPY: 300, impactRevenueProgress: 100, impactOpIncomeMJPY: 30 }])]);
    expect(rowOf(trial, '旧見込みのみ')).toMatchObject({ status: 'NOT_SET', years: [] });
    expect(trial.years.every((y) => y.revenueYen === 0 && y.operatingEffectYen === 0)).toBe(true);
  });

  it('表示の並び：試算に反映された施策を先頭に、未登録を末尾に並べる', () => {
    const trial = trialOf([
      dept([
        { id: 'n', title: '未登録' },
        { id: 'd', title: '未確認', financeEffect: eff({ kind: 'COST_REDUCTION', method: 'DIRECT_AMOUNT', directAmountYen: 1 * M, amountBasis: 'MONTHLY', startYm: '2025-04', confirmed: false }) },
        { id: 'a', title: '反映', financeEffect: eff({ kind: 'COST_REDUCTION', method: 'DIRECT_AMOUNT', directAmountYen: 1 * M, amountBasis: 'MONTHLY', startYm: '2025-04' }) },
      ]),
    ]);
    expect(trial.projects.map((p) => p.status)).toEqual(['REFLECTED', 'DRAFT', 'NOT_SET']);
  });
});
