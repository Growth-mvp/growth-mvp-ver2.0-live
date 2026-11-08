import type { FinanceEffectTrialYear } from './financeEffectPlan';

/** B：直近の確定財務実績を横ばいに置いた暫定仮定（円）。成長予測ではない */
export type BaselineYear = { fiscalYear: number; revenueYen: number | null; operatingIncomeYen: number | null };

/** A：STAGE2の経営目標（円）。予測には加算せず、差額の比較に使う。指標ごとに期限年度を持つ */
export type PlTarget = {
  revenueYen: number | null;
  revenueDueYear: number | null;
  operatingIncomeYen: number | null;
  operatingIncomeDueYear: number | null;
};

export type UnifiedPlYear = {
  fiscalYear: number;
  baseline: { revenueYen: number | null; operatingExpenseYen: number | null; operatingIncomeYen: number | null };
  /** C：確認済み施策効果。算定できた内訳だけを入れる（売上増加・費用削減・追加費用） */
  effect: { revenueUpYen: number; costReductionYen: number; costIncreaseYen: number; revenueOperatingIncomeYen: number | null };
  /** D：条件付きPL試算（B に C を年度ごとに反映）。算定できない項目は null */
  plan: { revenueYen: number | null; operatingExpenseYen: number | null; operatingIncomeYen: number | null };
  unknownReasons: string[];
};

/** 指標ごとの差額。経営目標 − その指標の期限年度の条件付きPL試算（正＝不足） */
export type UnifiedPlMetricGap = {
  fiscalYear: number | null;
  valueYen: number | null;
  reason: string | null;
};

export type UnifiedPlGap = {
  revenue: UnifiedPlMetricGap;
  operatingIncome: UnifiedPlMetricGap;
};

export type UnifiedPl = {
  years: UnifiedPlYear[];
  gap: UnifiedPlGap | null;
};

const OP_UNKNOWN_REASON = '売上増加の営業利益への効果が未入力のため、営業費用と営業利益は未算定';

export function buildUnifiedPl(args: {
  baseline: BaselineYear[];
  effects: FinanceEffectTrialYear[];
  target: PlTarget | null;
}): UnifiedPl {
  const effectByYear = new Map(args.effects.map((e) => [e.fiscalYear, e]));

  const years: UnifiedPlYear[] = args.baseline.map((b) => {
    const effect = effectByYear.get(b.fiscalYear);
    const revenueUpYen = effect?.revenueYen ?? 0;
    const costReductionYen = effect?.costReductionYen ?? 0;
    const costIncreaseYen = effect?.costIncreaseYen ?? 0;
    const revenueOperatingIncomeYen = effect ? effect.revenueOperatingIncomeYen : 0;

    const baseOpex =
      b.revenueYen !== null && b.operatingIncomeYen !== null ? b.revenueYen - b.operatingIncomeYen : null;
    const unknownReasons: string[] = [];
    if (b.revenueYen === null) unknownReasons.push('基準年度の売上が未確定');
    if (b.operatingIncomeYen === null) unknownReasons.push('基準年度の営業利益が未確定');

    const plan: UnifiedPlYear['plan'] = {
      revenueYen: b.revenueYen === null ? null : b.revenueYen + revenueUpYen,
      operatingExpenseYen: null,
      operatingIncomeYen: null,
    };

    if (revenueOperatingIncomeYen === null) {
      unknownReasons.push(OP_UNKNOWN_REASON);
    } else if (b.revenueYen !== null && b.operatingIncomeYen !== null) {
      const operatingIncomeYen = b.operatingIncomeYen + revenueOperatingIncomeYen + costReductionYen - costIncreaseYen;
      plan.operatingIncomeYen = operatingIncomeYen;
      plan.operatingExpenseYen = plan.revenueYen === null ? null : plan.revenueYen - operatingIncomeYen;
    }

    return {
      fiscalYear: b.fiscalYear,
      baseline: { revenueYen: b.revenueYen, operatingExpenseYen: baseOpex, operatingIncomeYen: b.operatingIncomeYen },
      effect: { revenueUpYen, costReductionYen, costIncreaseYen, revenueOperatingIncomeYen },
      plan,
      unknownReasons: Array.from(new Set(unknownReasons)),
    };
  });

  return { years, gap: args.target ? gapOf(args.target, years) : null };
}

function gapOf(target: PlTarget, years: UnifiedPlYear[]): UnifiedPlGap {
  return {
    revenue: metricGap({
      label: '売上',
      targetYen: target.revenueYen,
      dueYear: target.revenueDueYear,
      years,
      planOf: (row) => row.plan.revenueYen,
      unavailableReason: '売上の試算が未算定のため差額は算出していません',
    }),
    operatingIncome: metricGap({
      label: '営業利益',
      targetYen: target.operatingIncomeYen,
      dueYear: target.operatingIncomeDueYear,
      years,
      planOf: (row) => row.plan.operatingIncomeYen,
      unavailableReason: (row) =>
        row.unknownReasons.includes(OP_UNKNOWN_REASON)
          ? `${OP_UNKNOWN_REASON}（差額は算出していません）`
          : '営業利益の試算が未算定のため差額は算出していません',
    }),
  };
}

function metricGap(args: {
  label: string;
  targetYen: number | null;
  dueYear: number | null;
  years: UnifiedPlYear[];
  planOf: (row: UnifiedPlYear) => number | null;
  unavailableReason: string | ((row: UnifiedPlYear) => string);
}): UnifiedPlMetricGap {
  if (args.targetYen === null) {
    return { fiscalYear: args.dueYear, valueYen: null, reason: `経営目標（${args.label}）が未設定のため差額は算出していません` };
  }
  if (args.dueYear === null) {
    return { fiscalYear: null, valueYen: null, reason: `${args.label}の目標年度が未設定のため、差額は算出していません` };
  }
  const row = args.years.find((y) => y.fiscalYear === args.dueYear);
  if (!row) {
    return {
      fiscalYear: args.dueYear,
      valueYen: null,
      reason: `${args.label}の目標年度（${args.dueYear}年度）が予測期間に含まれないため、差額は算出していません`,
    };
  }
  const plan = args.planOf(row);
  if (plan === null) {
    const reason = typeof args.unavailableReason === 'string' ? args.unavailableReason : args.unavailableReason(row);
    return { fiscalYear: row.fiscalYear, valueYen: null, reason };
  }
  return { fiscalYear: row.fiscalYear, valueYen: args.targetYen - plan, reason: null };
}
