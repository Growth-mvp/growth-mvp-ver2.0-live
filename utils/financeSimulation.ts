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
 * - INVEST は固定費側に上乗せ（investEffectAlpha 未指定なら 1.0 = 100%計上）
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
  /**
   * INVEST を固定費側に上乗せする係数
   * - 未指定: 1.0（100% 固定費として計上）
   * - 0: 無効（INVESTをPLに反映しない）
   * - 0〜1: 一部計上（例: 0.5）
   */
  investEffectAlpha?: number;
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

  // ✅ FIX: investEffectAlpha が未指定の場合は 1.0（=100%固定費計上）
  // 既存挙動（未指定→0）だと INVEST がPLに反映されず、投資入力が無意味になっていたため。
  const investAlpha =
    opt?.investEffectAlpha === undefined ? 1.0 : nz(opt.investEffectAlpha);

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

  // ★ FIN-DEBUG-0: hasAnyDelta チェック
  console.group('[FIN-DEBUG-0] simulateMonthlyPL delta check');
  console.log({
    hasAnyDelta,
    acqSum: Object.values(deltas.acq ?? {}).reduce((a, b) => a + b, 0),
    revenueSum: Object.values(deltas.revenue ?? {}).reduce((a, b) => a + b, 0),
    firstMonthAcq: deltas.acq?.[months[0]],
    firstMonthRevenue: deltas.revenue?.[months[0]],
    monthsCount: months.length,
  });
  console.groupEnd();

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

      // ★ UNIFIED: 売上は常に qty * arpu（base.revenueMonthly は参考値、使わない）
      const revenue = Math.max(0, qty * arpu);

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

  let firstDeltaYmProcessed = false; // ★ 最初の月のみログ出力用

  for (const ym of months) {
    const baseQty = Math.max(0, nz(base.qtyMonthly[ym]));
    const baseArpu = Math.max(0, nz(base.arpuMonthly[ym]));
    const baseChurn = clamp01(nz(base.churnMonthly[ym]));
    const baseFixed = Math.max(0, nz(base.fixedCostMonthly[ym]));
    const baseVarAmt = Math.max(0, nz(base.variableCostMonthly[ym]));
    const basePers = Math.max(0, nz(base.personnelCostMonthly[ym]));

    // success_rate（売上側レバーに掛ける）
    // ★ FIX: deltas.success_rate が 0 or undefined の場合、デフォルト 1.0（100%成功）を使う
    // プロジェクト固有の SUCCESS_RATE KR がない場合、success_rate は 0 で初期化されているため
    const dSuccessRate = nz(deltas.success_rate?.[ym]);
    const success = dSuccessRate === 0 ? 1.0 : resolveSuccessRate(dSuccessRate);

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

    // ★ FIN-DEBUG-1: ACQ delta が qty に反映されているか（最初の月のみ）
    if (!firstDeltaYmProcessed) {
      console.group('[FIN-DEBUG-1] ACQ delta to QTY conversion (First month)');
      console.log({
        ym,
        baseQty,
        dSuccessRate,
        success,
        'deltas.acq?.[ym]': deltas.acq?.[ym],
        dAcq,
        'Math.abs(dAcq)': Math.abs(dAcq),
        '> 1e-9': Math.abs(dAcq) > 1e-9,
        deltaQtyPrev,
        qPrev: baseQty + deltaQtyPrev,
        churnDelta: dChurn - dRet,
      });
      firstDeltaYmProcessed = true;
    }

    const churnRate = clamp01(baseChurn + dChurn - dRet);
    const churnDelta = dChurn - dRet;

    const prevDeltaQty = deltaQtyPrev;
    const qPrev = baseQty + prevDeltaQty;

    // ★ ACQ UNIT FIX: dAcq は改善率（coefficient 0.0-1.0）として解釈
    // buildBridgeDeltas から：
    //   isPct=true の場合 → normalized = target / 100（例: 18.32% → 0.1832）
    //   isPct=false の場合 → delta = target（絶対値）
    //
    // ここでは改善率（0-1 coefficient）として扱う
    // dAcq > 1 の場合は % 値（例: 18.32）なので /100 してから使う
    const acqCoefficient = dAcq > 1 ? dAcq / 100 : dAcq;  // 正規化して 0-1 range に
    const acqDrivenQtyDelta = baseQty * acqCoefficient;

    // ★ 修正A（必須）：ACQ改善は単月flow、carry しない設計へ統一
    // 従前：deltaQtyNext = prevDeltaQty + acqDrivenQtyDelta - qPrev * churnDelta
    //      prevDeltaQty にACQが累積し、毎月carry されて売上が指数的に膨張
    //
    // 修正後：毎月の delta を独立して計算（flow化）
    // - ACQ由来の増分は「当月のみ」（carry しない）
    // - CHURN由来の減分は baseQty に基づいて計算（carry も行わない）
    // - prevDeltaQty は 0 に統一（全KRが単月 flow として扱われる）
    const deltaQtyNext = acqDrivenQtyDelta - baseQty * churnDelta;
    const qty = Math.max(0, baseQty + deltaQtyNext);

    // ★ 修正A: ACQ/CHURN ともに carry しない（完全flow設計）
    // 毎月を独立した flow として扱う。前月の「超過」は引き継がない。
    deltaQtyPrev = 0;

    const arpu = Math.max(0, baseArpu + dArpu);

    // revenue
    let revenueCore = Math.max(0, qty * arpu);

    // ★修正D：ACQ検証ログ（最初の3ヶ月）
    if (!firstDeltaYmProcessed || months.indexOf(ym) < 3) {
      console.group(`[STAGE6][acq] Month ${ym}`);
      console.log({
        month: ym,
        baseQty,
        acqCoefficient,
        acqDrivenQtyDelta,
        prevDeltaQty,
        churnDelta,
        'baseQty * churnDelta': baseQty * churnDelta,
        deltaQtyNext,
        finalQty: qty,
      });
      console.log({
        '説明': '★修正A: ACQ/CHURN ともに carry なし（完全flow設計）。毎月を独立した flow として計算',
      });
      console.groupEnd();
    }
    revenueCore += Math.max(0, dRevenue);

    if (applySynergyTo.includes('revenue')) {
      revenueCore *= 1 + dSynergy;
    }
    const revenue = Math.max(0, revenueCore);

    // variable_cost / cogsRate
    let variable: number;
    if (dCogsRate !== 0) {
      // ★ UNIFIED: baseSales も qty * arpu で統一（revenueMonthly は参照しない）
      const baseSales = Math.max(0, baseQty * baseArpu);

      const safeSales = Math.max(1, baseSales);
      const estBaseCogsRate = clamp01(baseVarAmt / safeSales);
      const appliedRate = clamp01(estBaseCogsRate + dCogsRate);

      // synergy前の qty*arpu をベースに計算（過度な跳ねを避ける）
      variable = Math.max(0, appliedRate * Math.max(0, qty * arpu));
    } else {
      variable = Math.max(0, baseVarAmt + dVarAmt);
    }

    // ✅ INVEST を固定費に計上（investAlpha は未指定なら 1.0）
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
