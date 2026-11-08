import { renderToStaticMarkup } from 'react-dom/server';
import type { FinanceEffectProjectRow, FinanceEffectTrialYear } from '@/utils/stage6/financeEffectPlan';
import { FinanceEffectProjectList, signedMil } from './FinanceEffectProjectList';

const M = 1_000_000;

const reflected = (n: number, over: Partial<FinanceEffectProjectRow> = {}): FinanceEffectProjectRow => ({
  deptIndex: 0,
  projectIndex: n,
  effectIndex: 0,
  deptName: '営業部',
  projectTitle: `施策${n}`,
  status: 'REFLECTED',
  kind: 'COST_REDUCTION',
  startFiscalYear: 2026,
  endFiscalYear: null,
  reason: null,
  operatingUnknown: false,
  years: [
    { fiscalYear: 2026, revenueYen: 0, costReductionYen: 12 * M, costIncreaseYen: 0, revenueOperatingIncomeYen: 0, operatingIncomeYen: 12 * M },
    { fiscalYear: 2027, revenueYen: 0, costReductionYen: 12 * M, costIncreaseYen: 0, revenueOperatingIncomeYen: 0, operatingIncomeYen: 12 * M },
  ],
  ...over,
});

const notReflected = (n: number, status: FinanceEffectProjectRow['status'], reason: string): FinanceEffectProjectRow => ({
  deptIndex: 1,
  projectIndex: n,
  effectIndex: 0,
  deptName: '製造部',
  projectTitle: `未反映${n}`,
  status,
  kind: null,
  startFiscalYear: null,
  endFiscalYear: null,
  reason,
  operatingUnknown: false,
  years: [],
});

const yearTotals: FinanceEffectTrialYear[] = [
  { fiscalYear: 2026, revenueYen: 0, costReductionYen: 12 * M, costIncreaseYen: 0, operatingEffectYen: 12 * M, revenueOperatingIncomeYen: 0 },
];

const html = (projects: FinanceEffectProjectRow[]) => renderToStaticMarkup(<FinanceEffectProjectList projects={projects} years={yearTotals} />);

describe('プロジェクト別の財務効果一覧', () => {
  it('試算に反映された施策は金額を、未確認・入力不足は理由だけを表示し、0円とは書かない', () => {
    const out = html([reflected(1), notReflected(2, 'DRAFT', '利用者が未確認（確認すると試算に入ります）'), notReflected(3, 'INCOMPLETE', '入力不足のため未算定：数量')]);
    expect(out).toContain('試算に反映（確認済み）');
    expect(out).toContain('未確認のため未反映');
    expect(out).toContain('入力不足のため未算定');
    expect(out).toContain('利用者が未確認（確認すると試算に入ります）');
    expect(out).toContain('2026年度〜');
  });

  it('営業利益を算定できない年度は「未算定」と表示し、0にしない', () => {
    const out = html([reflected(1, { operatingUnknown: true, years: [{ fiscalYear: 2026, revenueYen: 60 * M, costReductionYen: 0, costIncreaseYen: 0, revenueOperatingIncomeYen: null, operatingIncomeYen: null }] })]);
    expect(out).toContain('未算定');
    expect(out).toContain('営業利益は算定できない年度を含みます');
  });

  it('5件を超えると「全N件を表示」の導線を出し、初期表示は5件まで', () => {
    const rows = [1, 2, 3, 4, 5, 6].map((n) => reflected(n));
    const out = html(rows);
    expect(out).toContain('全6件を表示');
    expect(out.match(/<li class="grid/g)?.length).toBe(5);
  });

  it('施策効果の年度別合計を、一覧と同じ表に示す', () => {
    const out = html([reflected(1)]);
    expect(out).toContain('施策効果の年度別合計');
    expect(out).toContain('2026年度');
  });

  it('旧方式の寄与・旧見込みの語を出さない', () => {
    const out = html([reflected(1), notReflected(2, 'NOT_SET', '財務効果は未登録')]);
    expect(out).not.toContain('寄与');
    expect(out).not.toContain('旧見込み');
    expect(out).not.toContain('目標額');
  });

  it('金額は百万円・符号つきで表示し、0.0は符号を付けない', () => {
    expect(signedMil(60 * M)).toBe('+60.0');
    expect(signedMil(-12 * M)).toBe('−12.0');
    expect(signedMil(0)).toBe('0.0');
  });

  it('施策がなければ案内を出す', () => {
    expect(html([])).toContain('表示するプロジェクトがありません。');
  });
});
