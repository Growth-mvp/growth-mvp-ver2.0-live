import type { Department } from '@/types/strategy';
import { recordKrActual } from '@/lib/stage5/krActual';
import { guardFinanceEffectConfirmation } from '@/lib/financeEffect';
import { buildFinanceEffectTrial } from './financeEffectPlan';
import { buildUnifiedPl, type BaselineYear } from './unifiedPl';

/* 手計算の前提（架空企業）
 * 基準（B）：直近確定実績 売上 1,000 百万円・営業利益 70 百万円を全年度に横置き
 *   → 営業費用（売上−営業利益）は 930 百万円
 * 年度：FY2026〜FY2029、単位は百万円（テストでは円に換算して入力）
 */
const M = 1_000_000;
const YEARS = [2026, 2027, 2028, 2029];
const BASELINE: BaselineYear[] = YEARS.map((fiscalYear) => ({
  fiscalYear,
  revenueYen: 1_000 * M,
  operatingIncomeYen: 70 * M,
}));

const dept = (name: string, projects: unknown[]) => ({ id: name, name, projects }) as unknown as Department;
const proj = (title: string, financeEffect?: unknown, extra: Record<string, unknown> = {}) => ({
  id: title,
  title,
  financeEffect,
  ...extra,
});
const confirmed = (over: Record<string, unknown>) => ({ confirmed: true, sourceNote: '見積書（架空）', ...over });

const trialOf = (departments: Department[], fiscalYearEnd = '3') =>
  buildFinanceEffectTrial({ departments, fiscalYearEnd, fiscalYears: YEARS });

const plan = (departments: Department[], fiscalYearEnd = '3', target: Parameters<typeof buildUnifiedPl>[0]['target'] = null) => {
  const trial = trialOf(departments, fiscalYearEnd);
  return buildUnifiedPl({ baseline: BASELINE, effects: trial.years, target });
};

const revenueUp60 = confirmed({ kind: 'REVENUE_UP', method: 'DIRECT_AMOUNT', directAmountYen: 60 * M, amountBasis: 'ANNUAL', startYm: '2026-04' });
/* 費用削減：月額 0.5 百万円、2026年10月〜2027年9月（12か月） */
const costReduction6 = confirmed({ kind: 'COST_REDUCTION', method: 'DIRECT_AMOUNT', directAmountYen: 500_000, amountBasis: 'MONTHLY', startYm: '2026-10', endYm: '2027-09' });
/* 追加費用：一回限り 30 百万円、2027年1月〜6月（6か月） */
const costIncrease30 = confirmed({ kind: 'COST_INCREASE', method: 'DIRECT_AMOUNT', directAmountYen: 30 * M, amountBasis: 'TOTAL', startYm: '2027-01', endYm: '2027-06' });

describe('統一PL：売上増加・費用削減・追加費用の符号と年度配分（手計算の期待値）', () => {
  it('S1 売上増加のみ：FY2027以降の売上は +60、営業利益は未算定（0扱いしない）', () => {
    const p = plan([dept('営業部', [proj('新規開拓', revenueUp60)])]);
    // FY2026 は 2026年4月開始の効果が入らない（FY2026 は 2025年4月〜2026年3月）
    expect(p.years[0].plan).toEqual({ revenueYen: 1_000 * M, operatingExpenseYen: 930 * M, operatingIncomeYen: 70 * M });
    // FY2027 は 12 か月分 +60。売上原価が不明なので営業費用・営業利益は null
    expect(p.years[1].plan.revenueYen).toBe(1_060 * M);
    expect(p.years[1].plan.operatingExpenseYen).toBeNull();
    expect(p.years[1].plan.operatingIncomeYen).toBeNull();
    expect(p.years[1].unknownReasons.join('')).toContain('未算定');
    expect(p.years[2].plan.revenueYen).toBe(1_060 * M);
  });

  it('S2 費用削減のみ：FY2027・FY2028 は各 3 百万円（6か月ずつ）、営業費用は減り、営業利益は増える', () => {
    const trial = trialOf([dept('製造部', [proj('工程改善', costReduction6)])]);
    // 手計算：FY2027 は 2026年10〜3月の 6 か月 × 0.5 = 3、FY2028 は 2027年4〜9月の 6 か月 × 0.5 = 3
    expect(trial.years.map((y) => [y.fiscalYear, y.costReductionYen])).toEqual([
      [2026, 0],
      [2027, 3 * M],
      [2028, 3 * M],
      [2029, 0],
    ]);
    const p = buildUnifiedPl({ baseline: BASELINE, effects: trial.years, target: null });
    expect(p.years[1].plan).toEqual({ revenueYen: 1_000 * M, operatingExpenseYen: 927 * M, operatingIncomeYen: 73 * M });
    expect(p.years[3].plan).toEqual({ revenueYen: 1_000 * M, operatingExpenseYen: 930 * M, operatingIncomeYen: 70 * M });
  });

  it('S3 追加費用のみ：FY2027・FY2028 は各 15 百万円、営業費用は増え、営業利益は減る', () => {
    const trial = trialOf([dept('製造部', [proj('設備保守の外注', costIncrease30)])]);
    // 手計算：30 百万円 ÷ 6 か月 = 月 5。FY2027 は 2027年1〜3月の 3 か月 = 15、FY2028 は 2027年4〜6月の 3 か月 = 15
    expect(trial.years.map((y) => [y.fiscalYear, y.costIncreaseYen])).toEqual([
      [2026, 0],
      [2027, 15 * M],
      [2028, 15 * M],
      [2029, 0],
    ]);
    const p = buildUnifiedPl({ baseline: BASELINE, effects: trial.years, target: null });
    expect(p.years[1].plan).toEqual({ revenueYen: 1_000 * M, operatingExpenseYen: 945 * M, operatingIncomeYen: 55 * M });
    expect(p.years[2].plan.operatingIncomeYen).toBe(55 * M);
    expect(p.years[3].plan.operatingIncomeYen).toBe(70 * M);
  });

  it('S4 複数施策の組み合わせ：売上増加のある年度は営業利益を未算定にし、費用の内訳は表示する', () => {
    const p = plan([
      dept('営業部', [proj('新規開拓', revenueUp60)]),
      dept('製造部', [proj('工程改善', costReduction6), proj('設備保守の外注', costIncrease30)]),
    ]);
    const fy27 = p.years[1];
    expect(fy27.plan.revenueYen).toBe(1_060 * M);
    expect(fy27.plan.operatingIncomeYen).toBeNull();
    // 売上増加がなくても算定できる費用の内訳は残る
    expect(fy27.effect).toEqual({ revenueUpYen: 60 * M, costReductionYen: 3 * M, costIncreaseYen: 15 * M });
    expect(p.years[3].effect).toEqual({ revenueUpYen: 60 * M, costReductionYen: 0, costIncreaseYen: 0 });
  });

  it('S5 決算月：12月と3月で同じ効果の年度配分が変わる（2026年1月開始・年額 1.2 百万円）', () => {
    const annual12 = confirmed({ kind: 'COST_REDUCTION', method: 'DIRECT_AMOUNT', directAmountYen: 1_200_000, amountBasis: 'ANNUAL', startYm: '2026-01' });
    const dec = trialOf([dept('製造部', [proj('工程改善', annual12)])], '12');
    // 12月決算：FY2026 は 2026年1〜12月 = 12 か月 → 1.2、FY2027 も 1.2
    expect([dec.years[0].costReductionYen, dec.years[1].costReductionYen]).toEqual([1_200_000, 1_200_000]);
    const mar = trialOf([dept('製造部', [proj('工程改善', annual12)])], '3');
    // 3月決算：FY2026 は 2026年1〜3月 = 3 か月 → 0.3、FY2027 は 12 か月 → 1.2
    expect([mar.years[0].costReductionYen, mar.years[1].costReductionYen]).toEqual([300_000, 1_200_000]);
  });

  it('S6 確認済みと未確認の混在：未確認の追加費用は計算に入らない', () => {
    const cost12 = confirmed({ kind: 'COST_REDUCTION', method: 'DIRECT_AMOUNT', directAmountYen: 1_200_000, amountBasis: 'ANNUAL', startYm: '2026-04' });
    const draft5 = { ...confirmed({ kind: 'COST_INCREASE', method: 'DIRECT_AMOUNT', directAmountYen: 5 * M, amountBasis: 'ANNUAL', startYm: '2026-04' }), confirmed: false };
    const trial = trialOf([dept('製造部', [proj('工程改善', cost12), proj('下書き', draft5)])]);
    expect(trial.excluded.map((e) => e.projectTitle)).toEqual(['下書き']);
    const p = buildUnifiedPl({ baseline: BASELINE, effects: trial.years, target: null });
    // 手計算：FY2027 は 70 + 1.2 = 71.2（未確認の 5 は入れない）
    expect(p.years[1].plan.operatingIncomeYen).toBe(71.2 * M);
  });

  it('S7 旧来の金額とfinanceEffectの共存：旧来の影響額（売上 50・利益 5）は加算されず、参照のみ', () => {
    const cost12 = confirmed({ kind: 'COST_REDUCTION', method: 'DIRECT_AMOUNT', directAmountYen: 1_200_000, amountBasis: 'ANNUAL', startYm: '2026-04' });
    const p = plan([dept('製造部', [proj('工程改善', cost12, { impactRevenueMJPY: 50, impactOpIncomeMJPY: 5 })])]);
    // 手計算：売上は 1,000 のまま、営業利益は 70 + 1.2 = 71.2（旧来の 5 や 50 を足さない）
    expect(p.years[1].plan.revenueYen).toBe(1_000 * M);
    expect(p.years[1].plan.operatingIncomeYen).toBe(71.2 * M);
  });

  it('S8 STAGE4の確認解除：金額を変えて確認が外れた効果は、試算から外れる', () => {
    const prev = confirmed({ kind: 'COST_REDUCTION', method: 'DIRECT_AMOUNT', directAmountYen: 1_200_000, amountBasis: 'ANNUAL', startYm: '2026-04' });
    const next = guardFinanceEffectConfirmation(prev, { ...prev, directAmountYen: 2_400_000 });
    expect(next?.confirmed).toBe(false);
    const p = plan([dept('製造部', [proj('工程改善', next)])]);
    expect(p.years[1].plan.operatingIncomeYen).toBe(70 * M);
  });

  it('S9 STAGE5の実績更新：KRの実績を記録しても、統一PL試算は変わらない', () => {
    const cost12 = confirmed({ kind: 'COST_REDUCTION', method: 'DIRECT_AMOUNT', directAmountYen: 1_200_000, amountBasis: 'ANNUAL', startYm: '2026-04' });
    const kr = { id: 'kr-1', kind: 'SALES', label: '新規受注件数', target: 20, unit: '件', scope: 'company', baseKey: 'sales' };
    const before = plan([dept('製造部', [proj('工程改善', cost12, { okrsV2: [kr] })])]);
    const recorded = recordKrActual([kr] as any, 'kr-1', { value: 25, asOf: '2026-10', recordedAt: '2026-11-03T00:00:00.000Z' });
    expect(recorded.ok).toBe(true);
    const after = plan([dept('製造部', [proj('工程改善', cost12, { okrsV2: recorded.ok ? recorded.next : [] })])]);
    expect(after).toEqual(before);
  });

  it('S10 企業・戦略・施策の切替：切り替えた戦略の効果だけが使われ、戻すと元の結果に戻る', () => {
    const stratA = [dept('製造部', [proj('工程改善', confirmed({ kind: 'COST_REDUCTION', method: 'DIRECT_AMOUNT', directAmountYen: 1_200_000, amountBasis: 'ANNUAL', startYm: '2026-04' }))])];
    const stratB = [dept('製造部', [proj('設備保守の外注', costIncrease30)])];
    const aOi = plan(stratA).years[1].plan.operatingIncomeYen;
    const bOi = plan(stratB).years[1].plan.operatingIncomeYen;
    const emptyOi = plan([dept('製造部', [proj('工程改善')])]).years[1].plan.operatingIncomeYen;
    // 手計算：A は 70 + 1.2 = 71.2、B は FY2027 に 15 の追加費用 → 55、効果なし → 70
    expect(aOi).toBe(71.2 * M);
    expect(bOi).toBe(55 * M);
    expect(emptyOi).toBe(70 * M);
    expect(plan(stratA).years[1].plan.operatingIncomeYen).toBe(aOi);
  });
});

describe('統一PL：経営目標との差額（経営目標 − 条件付きPL試算、正＝不足）', () => {
  it('G1 目標年度の差額：売上 1,200・営業利益 80 の目標に対し、費用削減のみのFY2028は 売上 200 不足・利益 7 不足', () => {
    const costRed = confirmed({ kind: 'COST_REDUCTION', method: 'DIRECT_AMOUNT', directAmountYen: 500_000, amountBasis: 'MONTHLY', startYm: '2026-10', endYm: '2027-09' });
    const p = plan([dept('製造部', [proj('工程改善', costRed)])], '3', { revenueYen: 1_200 * M, operatingIncomeYen: 80 * M, dueYear: 2028 });
    // 手計算：FY2028 の売上 1,000、営業利益 70 + 3 = 73 → 差額 売上 200、利益 7
    expect(p.gap?.fiscalYear).toBe(2028);
    expect(p.gap?.revenueYen).toBe(200 * M);
    expect(p.gap?.operatingIncomeYen).toBe(7 * M);
  });

  it('G2 売上増加がある年度の利益差額は算出せず、理由を表示する', () => {
    const p = plan([dept('営業部', [proj('新規開拓', revenueUp60)])], '3', { revenueYen: 1_200 * M, operatingIncomeYen: 80 * M, dueYear: 2028 });
    // 手計算：売上は 1,060 → 差額 140。利益は売上増加のため未算定
    expect(p.gap?.revenueYen).toBe(140 * M);
    expect(p.gap?.operatingIncomeYen).toBeNull();
    expect(p.gap?.reasons.join('')).toContain('売上増加があるため営業利益は未算定');
  });

  it('G3 目標年度が未設定・予測期間外のときは差額を出さず、理由を表示する', () => {
    const none = plan([dept('製造部', [proj('工程改善')])], '3', { revenueYen: 1_200 * M, operatingIncomeYen: 80 * M, dueYear: null });
    expect(none.gap?.revenueYen).toBeNull();
    expect(none.gap?.reasons[0]).toContain('目標年度が未設定');
    const outside = plan([dept('製造部', [proj('工程改善')])], '3', { revenueYen: 1_200 * M, operatingIncomeYen: 80 * M, dueYear: 2031 });
    expect(outside.gap?.revenueYen).toBeNull();
    expect(outside.gap?.reasons[0]).toContain('予測期間に含まれない');
  });

  it('G4 基準年度の値が未確定なら、その年度の試算は未算定になる（効果の内訳は残す）', () => {
    const costRed = confirmed({ kind: 'COST_REDUCTION', method: 'DIRECT_AMOUNT', directAmountYen: 1_200_000, amountBasis: 'ANNUAL', startYm: '2026-04' });
    const trial = trialOf([dept('製造部', [proj('工程改善', costRed)])]);
    const p = buildUnifiedPl({
      baseline: BASELINE.map((b) => (b.fiscalYear === 2027 ? { ...b, operatingIncomeYen: null } : b)),
      effects: trial.years,
      target: null,
    });
    expect(p.years[1].plan.operatingIncomeYen).toBeNull();
    expect(p.years[1].effect.costReductionYen).toBe(1_200_000);
    expect(p.years[1].unknownReasons).toContain('基準年度の営業利益が未確定');
  });
});
