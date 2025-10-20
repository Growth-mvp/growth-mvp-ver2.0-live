// /utils/financeSimulation.ts

/* =========================================================
 * 主要KPIの月次デルタ → 月次/年次PLの計算
 * ---------------------------------------------------------
 * - 数量×単価×継続率 を基本に 売上 を算出
 * - 機械的な線形近似（まずは最小ルール）で OKR の効果を反映
 * - 相乗効果/成功率/投資 は最小処理（将来拡張で高度化）
 * ========================================================= */

import type { Ym, DeltasByMonth } from './simulationBridge';

/* ========== 入力データ定義 ========== */
// ベースの月次トラック（OKR介入が無かった場合の軌道）
export type BaseTrajectory = {
  startYm: Ym;
  endYm: Ym;
  // 数量（例：有効顧客数 or 販売数量）の月次ベース値
  qtyMonthly: Record<Ym, number>;
  // 単価（円）
  arpuMonthly: Record<Ym, number>;
  // 月次解約率（0.02=2%）
  churnMonthly: Record<Ym, number>;
  // コスト（円）
  fixedCostMonthly: Record<Ym, number>;
  variableCostMonthly: Record<Ym, number>;
  personnelCostMonthly: Record<Ym, number>;
  // 参考：ベース売上（月次）、無くても計算可能
  revenueMonthly?: Record<Ym, number>;
};

// シミュレーションの計算オプション
export type SimulationOptions = {
  // 相乗効果（synergy）の適用先（将来拡張可）
  applySynergyTo?: Array<'revenue' | 'cost'>;
  // 成功率の扱い（投資効果へ掛ける、などの将来拡張用）
  investEffectAlpha?: number; // 投資→収益への影響係数（暫定）
};

// 月次結果
export type MonthlyPL = {
  ym: Ym;
  qty: number;
  arpu: number;
  churn: number;
  // 売上
  revenue: number;
  // コスト
  fixed_cost: number;
  variable_cost: number;
  personnel_cost: number;
  // 計
  cogs: number;         // 変動費を COGS と仮置き
  sga: number;          // 固定＋人件費を SG&A と仮置き
  gross_profit: number;
  op_income: number;
  margin: number;
};

// 年次集計
export type YearlyPL = {
  year: number;
  revenue: number;
  cogs: number;
  sga: number;
  gross_profit: number;
  op_income: number;
  margin: number;
};

function ymToYearMonth(y: Ym) {
  const [Y, M] = y.split('-').map(Number);
  return { Y, M };
}
function pad(n: number) { return n < 10 ? `0${n}` : String(n); }
function nextYm(y: Ym): Ym {
  const { Y, M } = ymToYearMonth(y);
  const nM = M === 12 ? 1 : M + 1;
  const nY = M === 12 ? Y + 1 : Y;
  return `${nY}-${pad(nM)}`;
}
function ymRange(startYm: Ym, endYm: Ym): Ym[] {
  const out: Ym[] = [];
  let cur = startYm;
  while (cur <= endYm) {
    out.push(cur);
    cur = nextYm(cur);
  }
  return out;
}

/**
 * OKRのデルタをベース軌道に反映し、月次PLを生成
 * ルール（最小）:
 * - qty は「前月のqty + acq - churn影響」で近似
 * - arpu はベース arpu + delta.arpu
 * - revenue は（qty * arpu）に “直接revenue加算” と “synergy(%)” を反映
 * - cost は各コスト + delta、synergy(%) が 'cost' に指定ならコストにも反映
 */
export function simulateMonthlyPL(
  base: BaseTrajectory,
  deltas: DeltasByMonth,
  opt?: SimulationOptions
): MonthlyPL[] {
  const applySynergyTo = opt?.applySynergyTo ?? ['revenue']; // 既定は売上側のみ
  const months = ymRange(base.startYm, base.endYm);

  const out: MonthlyPL[] = [];

  let prevQty: number | undefined = undefined;

  for (const ym of months) {
    const baseQty = base.qtyMonthly[ym] ?? 0;
    const baseArpu = base.arpuMonthly[ym] ?? 0;
    const baseChurn = base.churnMonthly[ym] ?? 0;

    // デルタ（無ければ0）
    const dAcq = deltas.acq[ym] ?? 0;
    const dArpu = deltas.arpu[ym] ?? 0;
    const dChurn = deltas.churn[ym] ?? 0;
    const dRevenue = deltas.revenue[ym] ?? 0;

    const dFixed = deltas.fixed_cost[ym] ?? 0;
    const dVariable = deltas.variable_cost[ym] ?? 0;
    const dPersonnel = deltas.personnel_cost[ym] ?? 0;

    const synergy = deltas.synergy[ym] ?? 0;          // +率
    const successRate = deltas.success_rate[ym] ?? 0; // +率（暫定未使用）
    const invest = deltas.invest[ym] ?? 0;            // +円（暫定：PLに直接は入れない）

    // qty の更新：前月qtyを基に、新規獲得から解約影響を差し引く近似
    //   qty_t ≒ max(0, (qty_base or prev) + dAcq - (qty_base or prev)*(baseChurn + dChurn))
    //   ※ まずは単純近似。より厳密なコホート等は将来拡張。
    const lastQty = prevQty ?? baseQty;
    const churnRate = Math.max(0, baseChurn + dChurn); // 負値なら改善だが、0未満は抑止
    const qty = Math.max(0, lastQty + dAcq - lastQty * churnRate);

    // 単価
    const arpu = Math.max(0, baseArpu + dArpu);

    // 売上（基本）：qty * arpu
    let revenueCore = qty * arpu;

    // 売上へ直接加算（REVENUE KR）
    revenueCore += dRevenue;

    // 相乗効果（+率）
    if (applySynergyTo.includes('revenue')) {
      revenueCore *= (1 + synergy);
    }

    // コスト
    let fixed = (base.fixedCostMonthly[ym] ?? 0) + dFixed + (invest * (opt?.investEffectAlpha ?? 0)); // 投資の一部を当期費用化する場合はalpha>0
    let variable = (base.variableCostMonthly[ym] ?? 0) + dVariable;
    let personnel = (base.personnelCostMonthly[ym] ?? 0) + dPersonnel;

    if (applySynergyTo.includes('cost')) {
      fixed *= (1 + synergy);
      variable *= (1 + synergy);
      personnel *= (1 + synergy);
    }

    const cogs = Math.max(0, variable);
    const sga = Math.max(0, fixed + personnel);
    const revenue = Math.max(0, revenueCore);
    const gross_profit = revenue - cogs;
    const op_income = revenue - (cogs + sga);
    const margin = revenue > 0 ? op_income / revenue : 0;

    out.push({
      ym,
      qty,
      arpu,
      churn: Math.max(0, churnRate),
      revenue,
      fixed_cost: fixed,
      variable_cost: variable,
      personnel_cost: personnel,
      cogs,
      sga,
      gross_profit,
      op_income,
      margin,
    });

    prevQty = qty;
  }

  return out;
}

/**
 * 年次集計（暦年で単純合算）
 * - 12ヶ月未満の端数年は入っている分だけ合算
 */
export function aggregateYearly(monthlies: MonthlyPL[]): YearlyPL[] {
  const byYear = new Map<number, YearlyPL>();

  for (const m of monthlies) {
    const year = Number(m.ym.slice(0, 4));
    const prev = byYear.get(year) ?? {
      year,
      revenue: 0, cogs: 0, sga: 0,
      gross_profit: 0, op_income: 0, margin: 0,
    };

    prev.revenue += m.revenue;
    prev.cogs += m.cogs;
    prev.sga += m.sga;
    prev.gross_profit += m.gross_profit;
    prev.op_income += m.op_income;

    byYear.set(year, prev);
  }

  // margin 再計算
  const out: YearlyPL[] = [];
  for (const y of Array.from(byYear.keys()).sort((a, b) => a - b)) {
    const v = byYear.get(y)!;
    v.margin = v.revenue > 0 ? v.op_income / v.revenue : 0;
    out.push(v);
  }
  return out;
}
