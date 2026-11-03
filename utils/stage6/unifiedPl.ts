import type { FinanceEffectTrialYear } from './financeEffectPlan';

/** B：直近の確定財務実績を横ばいに置いた暫定仮定（円）。成長予測ではない */
export type BaselineYear = { fiscalYear: number; revenueYen: number | null; operatingIncomeYen: number | null };

/** A：STAGE2の経営目標（円）。予測には加算せず、差額の比較に使う */
export type PlTarget = { revenueYen: number | null; operatingIncomeYen: number | null; dueYear: number | null };

export type UnifiedPlYear = {
  fiscalYear: number;
  baseline: { revenueYen: number | null; operatingExpenseYen: number | null; operatingIncomeYen: number | null };
  /** C：確認済み施策効果。算定できた内訳だけを入れる（売上増加・費用削減・追加費用） */
  effect: { revenueUpYen: number; costReductionYen: number; costIncreaseYen: number };
  /** D：条件付きPL試算（B に C を年度ごとに反映）。算定できない項目は null */
  plan: { revenueYen: number | null; operatingExpenseYen: number | null; operatingIncomeYen: number | null };
  unknownReasons: string[];
};

export type UnifiedPlGap = {
  fiscalYear: number;
  /** 経営目標 − 条件付きPL試算（正＝不足）。算定できない場合は null */
  revenueYen: number | null;
  operatingIncomeYen: number | null;
  reasons: string[];
};

export type UnifiedPl = {
  years: UnifiedPlYear[];
  gap: UnifiedPlGap | null;
};

const OP_UNKNOWN_REASON = '売上増加に対応する売上原価・変動費が未確定のため、営業費用と営業利益は未算定';

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

    if (revenueUpYen !== 0) {
      unknownReasons.push(OP_UNKNOWN_REASON);
    } else if (baseOpex !== null && b.operatingIncomeYen !== null) {
      plan.operatingExpenseYen = baseOpex - costReductionYen + costIncreaseYen;
      plan.operatingIncomeYen = b.operatingIncomeYen + costReductionYen - costIncreaseYen;
    }

    return {
      fiscalYear: b.fiscalYear,
      baseline: { revenueYen: b.revenueYen, operatingExpenseYen: baseOpex, operatingIncomeYen: b.operatingIncomeYen },
      effect: { revenueUpYen, costReductionYen, costIncreaseYen },
      plan,
      unknownReasons: Array.from(new Set(unknownReasons)),
    };
  });

  return { years, gap: gapOf(args.target, years) };
}

function gapOf(target: PlTarget | null, years: UnifiedPlYear[]): UnifiedPlGap | null {
  if (!target) return null;
  if (target.dueYear === null) {
    return { fiscalYear: 0, revenueYen: null, operatingIncomeYen: null, reasons: ['経営目標の目標年度が未設定のため、差額は算出していません'] };
  }
  const row = years.find((y) => y.fiscalYear === target.dueYear);
  if (!row) {
    return {
      fiscalYear: target.dueYear,
      revenueYen: null,
      operatingIncomeYen: null,
      reasons: [`目標年度（${target.dueYear}年度）が予測期間に含まれないため、差額は算出していません`],
    };
  }
  const reasons: string[] = [];
  let revenueYen: number | null = null;
  if (target.revenueYen !== null && row.plan.revenueYen !== null) {
    revenueYen = target.revenueYen - row.plan.revenueYen;
  } else {
    reasons.push('売上の目標値または試算値が未算定');
  }
  let operatingIncomeYen: number | null = null;
  if (target.operatingIncomeYen !== null && row.plan.operatingIncomeYen !== null) {
    operatingIncomeYen = target.operatingIncomeYen - row.plan.operatingIncomeYen;
  } else if (row.unknownReasons.includes(OP_UNKNOWN_REASON)) {
    reasons.push('売上増加があるため営業利益は未算定');
  } else {
    reasons.push('営業利益の目標値または試算値が未算定');
  }
  return { fiscalYear: row.fiscalYear, revenueYen, operatingIncomeYen, reasons };
}
