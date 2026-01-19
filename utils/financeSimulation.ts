// /utils/financeSimulation.ts

/* =========================================================
 * Finance Simulation (PL) Utilities
 * ---------------------------------------------------------
 * BaseTrajectory（ベース前提）と DeltasByMonth（ブリッジ差分）から
 * 月次PLを算出し、年次に集計する。
 *
 * 現行の簡易モデル:
 * - 売上 = qty * arpu (+ revenueDelta)
 * - qty は acq と churn/retention差分を簡易に反映（累積の差分qtyを保持）
 * - COGS = variable_cost、SG&A = fixed_cost + personnel_cost
 * - synergy は revenue/cost へ倍率適用（オプション）
 * - success_rate は売上側レバー（ACQ/ARPU/REVENUE）に掛けてシナリオ差を作る
 * ========================================================= */

import type { Ym, DeltasByMonth } from './simulationBridge';

/* ========== Base Trajectory ========== */
export type BaseTrajectory = {
  startYm: Ym;
  endYm: Ym;

  qtyMonthly: Record<Ym, number>;
  arpuMonthly: Record<Ym, number>;
  churnMonthly: Record<Ym, number>;

  fixedCostMonthly: Record<Ym, number>;
  variableCostMonthly: Record<Ym, number>;
  personnelCostMonthly: Record<Ym, number>;

  revenueMonthly?: Record<Ym, number>;
};

export type SimulationOptions = {
  applySynergyTo?: Array<'revenue' | 'cost'>;
  investEffectAlpha?: number; // INVEST を固定費側に上乗せする係数（0なら無効）
};

export type MonthlyPL = {
  ym: Ym;

  qty: number;
  arpu: number;
  churn: number;

  revenue: number;

  fixed_cost: number;
  variable_cost: number;
  personnel_cost: number;

  cogs: number;
  sga: number;

  gross_profit: number;
  op_income: number;
  margin: number;
};

export type YearlyPL = {
  year: number;
  revenue: number;
  cogs: number;
  sga: number;
  gross_profit: number;
  op_income: number;
  margin: number;
};

/* ========== YM helpers ========== */
function ymToYearMonth(y: Ym) {
  const [Y, M] = y.split('-').map(Number);
  return { Y, M };
}
function pad2(n: number) {
  return n < 10 ? `0${n}` : String(n);
}
function nextYm(y: Ym): Ym {
  const { Y, M } = ymToYearMonth(y);
  const nM = M === 12 ? 1 : M + 1;
  const nY = M === 12 ? Y + 1 : Y;
  return `${nY}-${pad2(nM)}` as Ym;
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

/* ========== numeric helpers ========== */
const clamp01 = (v: number) => Math.max(0, Math.min(1, v));
const nz = (v?: number) => (typeof v === 'number' && Number.isFinite(v) ? v : 0);

/**
 * success_rate の解釈:
 * - 0..1 の値なら「絶対値（成功確率）」として採用（例: 0.8）
 * - それ以外は「1 + delta」方式で解釈（例: +0.1 → 1.1 を clamp）
 */
function resolveSuccessRate(v: unknown): number {
  if (typeof v !== 'number' || !Number.isFinite(v)) return 1;
  if (v >= 0 && v <= 1) return v; // absolute success rate
  return clamp01(1 + v); // delta
}

/* =========================================================
 * simulateMonthlyPL
 * ========================================================= */
export function simulateMonthlyPL(
  base: BaseTrajectory,
  deltas: DeltasByMonth,
  opt?: SimulationOptions,
): MonthlyPL[] {
  const applySynergyTo = opt?.applySynergyTo ?? ['revenue'];
  const investAlpha = nz(opt?.investEffectAlpha);

  const months = ymRange(base.startYm, base.endYm);

  const hasAnyDelta = months.some((ym) => {
    const vals = [
      deltas.acq?.[ym],
      deltas.arpu?.[ym],
      deltas.churn?.[ym],
      deltas.retention?.[ym],
      deltas.revenue?.[ym],
      deltas.fixed_cost?.[ym],
      deltas.variable_cost?.[ym],
      deltas.personnel_cost?.[ym],
      deltas.synergy?.[ym],
      deltas.cogsRate?.[ym],
      deltas.invest?.[ym],
      deltas.success_rate?.[ym],
    ];
    return vals.some((v) => typeof v === 'number' && Math.abs(v) > 1e-9);
  });

  // 差分ゼロなら base をPL化して返す
  if (!hasAnyDelta) {
    const out: MonthlyPL[] = [];
    for (const ym of months) {
      const qty = Math.max(0, nz(base.qtyMonthly[ym]));
      const arpu = Math.max(0, nz(base.arpuMonthly[ym]));
      const churn = clamp01(nz(base.churnMonthly[ym]));

      const fixed = Math.max(0, nz(base.fixedCostMonthly[ym]));
      const variable = Math.max(0, nz(base.variableCostMonthly[ym]));
      const personnel = Math.max(0, nz(base.personnelCostMonthly[ym]));

      const revenue =
        Math.max(0, nz(base.revenueMonthly?.[ym])) || Math.max(0, qty * arpu);

      const cogs = variable;
      const sga = fixed + personnel;

      const gross_profit = revenue - cogs;
      const op_income = revenue - (cogs + sga);
      const margin = revenue > 0 ? op_income / revenue : 0;

      out.push({
        ym,
        qty,
        arpu,
        churn,
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
    }
    return out;
  }

  // 差分あり：qty差分を累積しながら計算
  const out: MonthlyPL[] = [];
  let deltaQtyPrev = 0;

  for (const ym of months) {
    const baseQty = Math.max(0, nz(base.qtyMonthly[ym]));
    const baseArpu = Math.max(0, nz(base.arpuMonthly[ym]));
    const baseChurn = clamp01(nz(base.churnMonthly[ym]));
    const baseFixed = Math.max(0, nz(base.fixedCostMonthly[ym]));
    const baseVarAmt = Math.max(0, nz(base.variableCostMonthly[ym]));
    const basePers = Math.max(0, nz(base.personnelCostMonthly[ym]));

    // success_rate（売上側レバーに掛ける）
    const success = resolveSuccessRate(deltas.success_rate?.[ym]);

    const dAcq = nz(deltas.acq?.[ym]) * success;
    const dArpu = nz(deltas.arpu?.[ym]) * success;
    const dRevenue = nz(deltas.revenue?.[ym]) * success;

    const dChurn = nz(deltas.churn?.[ym]);
    const dRet = nz(deltas.retention?.[ym]);
    const dFixed = nz(deltas.fixed_cost?.[ym]);
    const dVarAmt = nz(deltas.variable_cost?.[ym]);
    const dPers = nz(deltas.personnel_cost?.[ym]);
    const dSynergy = nz(deltas.synergy?.[ym]);
    const dCogsRate = nz(deltas.cogsRate?.[ym]);
    const invest = nz(deltas.invest?.[ym]);

    const churnRate = clamp01(baseChurn + dChurn - dRet);
    const churnDelta = dChurn - dRet;

    const prevDeltaQty = deltaQtyPrev;
    const qPrev = baseQty + prevDeltaQty;

    const deltaQtyNext = Math.max(0, prevDeltaQty + dAcq - qPrev * churnDelta);

    const qty = Math.max(0, baseQty + deltaQtyNext);
    deltaQtyPrev = deltaQtyNext;

    const arpu = Math.max(0, baseArpu + dArpu);

    // revenue
    let revenueCore = Math.max(0, qty * arpu);
    revenueCore += Math.max(0, dRevenue);

    if (applySynergyTo.includes('revenue')) {
      revenueCore *= 1 + dSynergy;
    }
    const revenue = Math.max(0, revenueCore);

    // variable_cost / cogsRate
    let variable: number;
    if (dCogsRate !== 0) {
      const baseSales =
        nz(base.revenueMonthly?.[ym]) || Math.max(0, baseQty * baseArpu);

      const safeSales = Math.max(1, baseSales);
      const estBaseCogsRate = clamp01(baseVarAmt / safeSales);
      const appliedRate = clamp01(estBaseCogsRate + dCogsRate);

      // synergy前の qty*arpu をベースに計算（過度な跳ねを避ける）
      variable = Math.max(0, appliedRate * Math.max(0, qty * arpu));
    } else {
      variable = Math.max(0, baseVarAmt + dVarAmt);
    }

    let fixed = Math.max(0, baseFixed + dFixed + invest * investAlpha);
    let personnel = Math.max(0, basePers + dPers);

    if (applySynergyTo.includes('cost')) {
      fixed *= 1 + dSynergy;
      variable *= 1 + dSynergy;
      personnel *= 1 + dSynergy;
    }

    const cogs = variable;
    const sga = fixed + personnel;

    const gross_profit = revenue - cogs;
    const op_income = revenue - (cogs + sga);
    const margin = revenue > 0 ? op_income / revenue : 0;

    out.push({
      ym,
      qty,
      arpu,
      churn: churnRate,
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
  }

  return out;
}

/* =========================================================
 * aggregateYearly
 * ========================================================= */
export function aggregateYearly(monthlies: MonthlyPL[]): YearlyPL[] {
  const byYear = new Map<number, YearlyPL>();

  for (const m of monthlies) {
    const year = Number(m.ym.slice(0, 4));
    const cur =
      byYear.get(year) ??
      ({
        year,
        revenue: 0,
        cogs: 0,
        sga: 0,
        gross_profit: 0,
        op_income: 0,
        margin: 0,
      } as YearlyPL);

    cur.revenue += nz(m.revenue);
    cur.cogs += nz(m.cogs);
    cur.sga += nz(m.sga);
    cur.gross_profit += nz(m.gross_profit);
    cur.op_income += nz(m.op_income);

    byYear.set(year, cur);
  }

  const out: YearlyPL[] = [];
  for (const y of Array.from(byYear.keys()).sort((a, b) => a - b)) {
    const v = byYear.get(y)!;
    v.margin = v.revenue > 0 ? v.op_income / v.revenue : 0;
    out.push(v);
  }
  return out;
}
