import type { ConditionalCf, ConditionalCfYear } from '@/utils/stage6/conditionalCf';
import { buildUnifiedPl, type PlTarget } from '@/utils/stage6/unifiedPl';
import type { FinanceEffectTrialYear } from '@/utils/stage6/financeEffectPlan';
import {
  achievementPct,
  buildCashSummary,
  buildFundingStatus,
  buildTargetSummary,
  cashChartOf,
  formatMil,
  formatPct,
  gapText,
} from './financeSummaryModel';

const M = 1_000_000;
const baseline = [2027, 2028].map((fiscalYear) => ({ fiscalYear, revenueYen: 1_000 * M, operatingIncomeYen: 70 * M }));
const noEffects: FinanceEffectTrialYear[] = [];
const target = (overrides: Partial<PlTarget> = {}): PlTarget => ({
  revenueYen: 1_200 * M,
  revenueDueYear: 2028,
  operatingIncomeYen: 80 * M,
  operatingIncomeDueYear: 2028,
  ...overrides,
});

describe('formatMil / gapText', () => {
  it('百万円を小数1桁で表し、UnifiedPlPanel と同じ書式にする', () => {
    expect(formatMil(200 * M)).toBe('200.0');
    expect(formatMil(0)).toBe('0.0');
  });

  it('差額は正を不足、0以下を達成として表す', () => {
    expect(gapText(10 * M)).toBe('不足 10.0 百万円');
    expect(gapText(0)).toBe('目標を達成（0.0 百万円超過）');
    expect(gapText(-5 * M)).toBe('目標を達成（5.0 百万円超過）');
  });
});

describe('buildTargetSummary', () => {
  it('目標と目標年度の試算がそろうとき、試算値と差額を既存の統一PLから読む', () => {
    const unifiedPl = buildUnifiedPl({ baseline, effects: noEffects, target: target() });
    const s = buildTargetSummary({ unifiedPl, target: target() });
    expect(s.revenue).toEqual({ status: 'READY', fiscalYear: 2028, targetYen: 1_200 * M, planYen: 1_000 * M, gapYen: 200 * M });
    expect(s.operatingIncome).toEqual({ status: 'READY', fiscalYear: 2028, targetYen: 80 * M, planYen: 70 * M, gapYen: 10 * M });
  });

  it('試算が0円のときは未算定ではなく0として扱う', () => {
    const zeroBase = [{ fiscalYear: 2028, revenueYen: 0, operatingIncomeYen: 0 }];
    const t = target({ revenueYen: 100 * M, operatingIncomeYen: null, operatingIncomeDueYear: null });
    const unifiedPl = buildUnifiedPl({ baseline: zeroBase, effects: noEffects, target: t });
    const s = buildTargetSummary({ unifiedPl, target: t });
    expect(s.revenue).toEqual({ status: 'READY', fiscalYear: 2028, targetYen: 100 * M, planYen: 0, gapYen: 100 * M });
  });

  it('経営目標が未設定なら、比較せず未設定として扱う', () => {
    const t = target({ revenueYen: null, revenueDueYear: null });
    const unifiedPl = buildUnifiedPl({ baseline, effects: noEffects, target: t });
    expect(buildTargetSummary({ unifiedPl, target: t }).revenue).toEqual({ status: 'NO_TARGET' });
  });

  it('目標年度が未設定なら、値は出さず年度未設定として扱う', () => {
    const t = target({ revenueDueYear: null });
    const unifiedPl = buildUnifiedPl({ baseline, effects: noEffects, target: t });
    expect(buildTargetSummary({ unifiedPl, target: t }).revenue).toEqual({ status: 'NO_DUE_YEAR', targetYen: 1_200 * M });
  });

  it('目標年度が予測期間の外なら、範囲外として扱う', () => {
    const t = target({ revenueDueYear: 2035 });
    const unifiedPl = buildUnifiedPl({ baseline, effects: noEffects, target: t });
    expect(buildTargetSummary({ unifiedPl, target: t }).revenue).toEqual({
      status: 'OUT_OF_RANGE',
      targetYen: 1_200 * M,
      fiscalYear: 2035,
    });
  });

  it('売上増加の効果があると営業利益は未算定になり、その理由を返す。売上は算定できる', () => {
    const effects: FinanceEffectTrialYear[] = [
      { fiscalYear: 2027, revenueYen: 0, costReductionYen: 0, costIncreaseYen: 0, operatingEffectYen: 0 },
      { fiscalYear: 2028, revenueYen: 50 * M, costReductionYen: 0, costIncreaseYen: 0, operatingEffectYen: 0 },
    ] as FinanceEffectTrialYear[];
    const t = target();
    const unifiedPl = buildUnifiedPl({ baseline, effects, target: t });
    const s = buildTargetSummary({ unifiedPl, target: t });
    expect(s.revenue).toMatchObject({ status: 'READY', planYen: 1_050 * M, gapYen: 150 * M });
    expect(s.operatingIncome.status).toBe('PLAN_UNKNOWN');
    if (s.operatingIncome.status === 'PLAN_UNKNOWN') {
      expect(s.operatingIncome.reason).toContain('売上増加');
      expect(s.operatingIncome.targetYen).toBe(80 * M);
    }
  });

  it('目標補間の値は使わず、統一PLの試算だけを参照する', () => {
    const t = target();
    const unifiedPl = buildUnifiedPl({ baseline, effects: noEffects, target: t });
    const s = buildTargetSummary({ unifiedPl, target: t });
    expect(s.revenue.status === 'READY' && s.revenue.planYen).toBe(unifiedPl.years[1].plan.revenueYen);
  });
});

const cfYear = (overrides: Partial<ConditionalCfYear> & Pick<ConditionalCfYear, 'fiscalYear'>): ConditionalCfYear => ({
  operatingIncomeYen: null,
  operatingCf: { conditionalYen: null, baselineYen: null, deltaYen: null },
  investingCfYen: null,
  financingCfYen: null,
  openingCashYen: null,
  closingCashYen: null,
  baselineClosingCashYen: null,
  unknownReasons: [],
  ...overrides,
});

describe('buildCashSummary', () => {
  it('横ばいと施策反映後の営業CFを年度ごとに返し、未算定は null のままにする', () => {
    const cf: ConditionalCf = {
      debtEnabled: false,
      taxRate: 0.3,
      taxRateBasis: 'USER',
      years: [
        cfYear({
          fiscalYear: 2027,
          operatingCf: { conditionalYen: 12 * M, baselineYen: 10 * M, deltaYen: 2 * M },
        }),
        cfYear({
          fiscalYear: 2028,
          operatingCf: { conditionalYen: null, baselineYen: 9 * M, deltaYen: null },
          unknownReasons: ['営業利益が未算定のため、営業CF・期末現預金は算定しない（売上増加の原価が不明）'],
        }),
      ],
    } as ConditionalCf;
    const s = buildCashSummary(cf);
    expect(s.points).toEqual([
      { fiscalYear: 2027, baselineYen: 10 * M, conditionalYen: 12 * M },
      { fiscalYear: 2028, baselineYen: 9 * M, conditionalYen: null },
    ]);
    expect(s.unknownReason).toContain('売上増加の原価が不明');
  });

  it('すべて算定できるとき、未算定の理由は出さない', () => {
    const cf = {
      debtEnabled: false,
      taxRate: 0.3,
      taxRateBasis: 'USER',
      years: [cfYear({ fiscalYear: 2027, operatingCf: { conditionalYen: 1, baselineYen: 1, deltaYen: 0 } })],
    } as ConditionalCf;
    expect(buildCashSummary(cf).unknownReason).toBeNull();
  });

  it('推計年度がなければ空の点列を返す', () => {
    const cf = { debtEnabled: false, taxRate: null, taxRateBasis: 'UNSET', years: [] } as unknown as ConditionalCf;
    expect(buildCashSummary(cf).points).toEqual([]);
  });
});

describe('buildFundingStatus', () => {
  it('目標補間の前提を使っているときは判定を表示せず、補間の判定だと分かる状態を返す', () => {
    expect(
      buildFundingStatus({ targetPathInUse: true, outlook: { label: '資金不足あり', detail: '2028年', tone: 'warn' } }),
    ).toEqual({ kind: 'TARGET_PATH_IN_USE' });
  });

  it('補間を使っていないとき、既存の返済見通しをそのまま返す。警告の年度は該当年度として明示する', () => {
    expect(
      buildFundingStatus({ targetPathInUse: false, outlook: { label: '資金不足あり', detail: '2028年', tone: 'warn' } }),
    ).toEqual({ kind: 'JUDGED', label: '資金不足あり', detail: '該当年度：2028年', tone: 'warn' });
  });

  it('借入が未入力なら、短く「未入力のため保留」と返す', () => {
    expect(
      buildFundingStatus({ targetPathInUse: false, outlook: { label: '評価保留', detail: '借入・配当が未入力です', tone: 'hold' } }),
    ).toEqual({ kind: 'JUDGED', label: '未入力のため保留', detail: '', tone: 'hold' });
  });
});

describe('達成率', () => {
  it('試算 ÷ 目標を小数1桁の%で返す（丹青社の想定値：売上 930/1127、営業利益 52/72.8）', () => {
    const revenue = { status: 'READY' as const, fiscalYear: 2029, targetYen: 1_127 * M, planYen: 930 * M, gapYen: 197 * M };
    const op = { status: 'READY' as const, fiscalYear: 2029, targetYen: 72.8 * M, planYen: 52 * M, gapYen: 20.8 * M };
    expect(formatPct(achievementPct(revenue) as number)).toBe('82.5%');
    expect(formatPct(achievementPct(op) as number)).toBe('71.4%');
  });

  it('目標がゼロ以下・未算定・未設定のときは達成率を出さない', () => {
    expect(achievementPct({ status: 'READY', fiscalYear: 2029, targetYen: 0, planYen: 10 * M, gapYen: -10 * M })).toBeNull();
    expect(achievementPct({ status: 'READY', fiscalYear: 2029, targetYen: -5 * M, planYen: 10 * M, gapYen: 0 })).toBeNull();
    expect(achievementPct({ status: 'PLAN_UNKNOWN', targetYen: 100 * M, fiscalYear: 2029, reason: 'x' })).toBeNull();
    expect(achievementPct({ status: 'NO_TARGET' })).toBeNull();
    expect(achievementPct({ status: 'NO_DUE_YEAR', targetYen: 100 * M })).toBeNull();
  });

  it('試算が0円なら0.0%、マイナスは−表記で表す', () => {
    expect(formatPct(0)).toBe('0.0%');
    expect(formatPct(-12.34)).toBe('-12.3%');
  });
});

describe('cashChartOf（事業CFのグラフ方式）', () => {
  const point = (fiscalYear: number, baselineYen: number | null, conditionalYen: number | null) => ({
    fiscalYear,
    baselineYen,
    conditionalYen,
  });
  const cashOf = (points: ReturnType<typeof point>[]) => ({ points, unknownReason: null });

  it('施策反映前後が全年度で同じなら単一系列にする', () => {
    const chart = cashChartOf(cashOf([point(2027, 53 * M, 53 * M), point(2028, 53 * M, 53 * M)]));
    expect(chart.mode).toBe('SINGLE');
    if (chart.mode === 'SINGLE') expect(chart.rows.map((r) => r.mil)).toEqual([53, 53]);
  });

  it('差がある年度があれば、横ばいと施策反映後を比較表示する', () => {
    const chart = cashChartOf(cashOf([point(2027, 53 * M, 60 * M), point(2028, 53 * M, 45 * M)]));
    expect(chart.mode).toBe('COMPARE');
  });

  it('未算定の年度を含む場合は0扱いせず、比較表示で未算定年度を列挙する', () => {
    const chart = cashChartOf(cashOf([point(2027, 53 * M, 53 * M), point(2028, 53 * M, null)]));
    expect(chart.mode).toBe('COMPARE');
    if (chart.mode === 'COMPARE') {
      expect(chart.unknownYears).toEqual([2028]);
      expect(chart.rows[1].conditional).toBeNull();
      expect(chart.rows[1].conditionalText).toBe('');
    }
  });

  it('施策反映後がすべて未算定なら、グラフを出さず未算定とする', () => {
    expect(cashChartOf(cashOf([point(2027, 53 * M, null)])).mode).toBe('UNCALCULATED');
  });

  it('推計年度がなければ何も出さない', () => {
    expect(cashChartOf(cashOf([])).mode).toBe('NONE');
  });

  it('マイナスの年度は負の値のまま、表示文字も−を保つ', () => {
    const chart = cashChartOf(cashOf([point(2027, -12 * M, -12 * M), point(2028, 5 * M, 5 * M)]));
    expect(chart.mode).toBe('SINGLE');
    if (chart.mode === 'SINGLE') {
      expect(chart.rows[0].mil).toBe(-12);
      expect(chart.rows[0].text).toBe('-12.0');
    }
  });
});
