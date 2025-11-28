// /utils/financeSimulation.ts

/* =========================================================
 * 主要KPIの月次デルタ → 月次/年次PLの計算（進化版）
 * ---------------------------------------------------------
 * - 数量×単価×継続率 を基本に 売上 を算出
 * - CHURN(解約)とRETENTION(継続)の両系統に対応
 * - 変動費は「金額」足し込み or 「率（cogsRate）」指定の両対応
 * - 相乗効果/投資の簡易反映（成功率は将来拡張）
 *
 * ★ポイント（今回修正）★
 * - OKRのインパクト（deltas）が完全に 0 のときは、
 *   ベース軌道（BaseTrajectory）そのままのPLを返す。
 *   → OKRを何も入れていないときに、売上が勝手に縮小しない。
 * - deltas があるときでも、
 *   「ベース数量 qtyMonthly はそのまま維持」し、
 *   その上に “増減分 deltaQty” を累積する方式に変更。
 *   → 解約率（churn）の影響は増減分だけに効くため、
 *      OKRの設定が「ベース全体の崩壊」にはならない。
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
  variableCostMonthly: Record<Ym, number>; // 金額でのベース（率指定の場合は参考として使用）
  personnelCostMonthly: Record<Ym, number>;
  // 参考：ベース売上（月次）、あれば率推定に使用
  revenueMonthly?: Record<Ym, number>;
};

// シミュレーションの計算オプション
export type SimulationOptions = {
  // 相乗効果（synergy）の適用先（将来拡張可）
  applySynergyTo?: Array<'revenue' | 'cost'>;
  // 成功率の扱い（投資効果へ掛ける、などの将来拡張用）
  investEffectAlpha?: number; // 投資→当期費用化の割合（0〜1、暫定）
};

// 月次結果
export type MonthlyPL = {
  ym: Ym;
  qty: number;
  arpu: number;
  churn: number; // 実効解約率（0〜1）
  // 売上
  revenue: number;
  // コスト（円）
  fixed_cost: number;
  variable_cost: number;
  personnel_cost: number;
  // 計
  cogs: number;         // 変動費を COGS と仮置き
  sga: number;          // 固定＋人件費を SG&A と仮置き
  gross_profit: number;
  op_income: number;
  margin: number;       // 営業利益率
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

/* ========== ユーティリティ（年月処理） ========== */
function ymToYearMonth(y: Ym) {
  const [Y, M] = y.split('-').map(Number);
  return { Y, M };
}
function pad(n: number) { return n < 10 ? `0${n}` : String(n); }
function nextYm(y: Ym): Ym {
  const { Y, M } = ymToYearMonth(y);
  const nM = M === 12 ? 1 : M + 1;
  const nY = M === 12 ? Y + 1 : Y;
  return `${nY}-${pad(nM)}` as Ym;
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

/* ========== 安全クリップ等 ========== */
const clamp01 = (v: number) => Math.max(0, Math.min(1, v));
const nz = (v?: number) => (typeof v === 'number' && Number.isFinite(v)) ? v : 0;

/* =========================================================
 * OKRのデルタをベース軌道に反映し、月次PLを生成（拡張版）
 * ---------------------------------------------------------
 * - retention/churn 両対応
 * - variable_cost を「金額」or「率（cogsRate）」の両方に対応
 * - synergy（+率）は売上のみ／コストにも適用の指定をサポート
 *
 * ★今回の重要仕様★
 * - deltas が全期間・全項目で 0 の場合は、
 *   BaseTrajectory をそのままPL化して返す（＝ベースラインと同じ）。
 *   → OKRが何も設定されていない状態では「ベース160億のまま／インパクト0」になる。
 * - deltas がある場合でも、ベース数量 qtyMonthly はそのまま残し、
 *   その上に「増減分 deltaQty」を累積していく。
 *   → 解約率の影響は“増減分”にだけ効き、ベースは崩壊しない。
 * ========================================================= */
export function simulateMonthlyPL(
  base: BaseTrajectory,
  deltas: DeltasByMonth & {
    // 追加: 率系（存在すれば使用）
    retention?: Record<Ym, number>;   // +0.01 で継続率1pt改善（実効churnを下げる）
    cogsRate?: Record<Ym, number>;    // 変動費率の増減（+0.01で1pt悪化）
  },
  opt?: SimulationOptions
): MonthlyPL[] {
  const applySynergyTo = opt?.applySynergyTo ?? ['revenue']; // 既定は売上側のみ
  const months = ymRange(base.startYm, base.endYm);

  /* ---------- 1. deltas が完全に 0 かどうかを判定 ---------- */
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
    ];
    return vals.some((v) => typeof v === 'number' && Math.abs(v) > 1e-9);
  });

  /* ---------- 2. デルタなし ⇒ ベース軌道そのままを返す ---------- */
  if (!hasAnyDelta) {
    const out: MonthlyPL[] = [];

    for (const ym of months) {
      const baseQty    = Math.max(0, nz(base.qtyMonthly[ym]));
      const baseArpu   = Math.max(0, nz(base.arpuMonthly[ym]));
      const baseChurn  = clamp01(nz(base.churnMonthly[ym]));
      const baseFixed  = Math.max(0, nz(base.fixedCostMonthly[ym]));
      const baseVarAmt = Math.max(0, nz(base.variableCostMonthly[ym]));
      const basePers   = Math.max(0, nz(base.personnelCostMonthly[ym]));

      const revenue =
        Math.max(0, nz(base.revenueMonthly?.[ym])) ||
        Math.max(0, baseQty * baseArpu);

      const variable = baseVarAmt;
      const fixed = baseFixed;
      const personnel = basePers;

      const cogs = variable;
      const sga = fixed + personnel;
      const gross_profit = revenue - cogs;
      const op_income = revenue - (cogs + sga);
      const margin = revenue > 0 ? op_income / revenue : 0;

      out.push({
        ym,
        qty: baseQty,
        arpu: baseArpu,
        churn: baseChurn,
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

  /* ---------- 3. デルタあり ⇒ ベース＋増減分deltaQtyでシミュレーション ---------- */
  const out: MonthlyPL[] = [];

  // ベースからの「増減分」のみを累積する
  let deltaQtyPrev = 0;

  for (const ym of months) {
    const baseQty    = Math.max(0, nz(base.qtyMonthly[ym]));
    const baseArpu   = Math.max(0, nz(base.arpuMonthly[ym]));
    const baseChurn  = clamp01(nz(base.churnMonthly[ym])); // 情報として保持
    const baseFixed  = Math.max(0, nz(base.fixedCostMonthly[ym]));
    const baseVarAmt = Math.max(0, nz(base.variableCostMonthly[ym])); // 金額ベース
    const basePers   = Math.max(0, nz(base.personnelCostMonthly[ym]));

    // デルタ（なければ0）
    const dAcq      = nz(deltas.acq?.[ym]);
    const dArpu     = nz(deltas.arpu?.[ym]);
    const dChurn    = nz(deltas.churn?.[ym]);       // 率の変化（+で悪化）※ベースからの差分として扱う
    const dRet      = nz(deltas.retention?.[ym]);   // 率の変化（+で継続改善=churn減少）
    const dRevenue  = nz(deltas.revenue?.[ym]);     // 金額
    const dFixed    = nz(deltas.fixed_cost?.[ym]);  // 金額
    const dVarAmt   = nz(deltas.variable_cost?.[ym]);// 金額として扱う分
    const dPers     = nz(deltas.personnel_cost?.[ym]);// 金額
    const dSynergy  = nz(deltas.synergy?.[ym]);     // 率（+0.05で+5%）
    const dCogsRate = nz(deltas.cogsRate?.[ym]);    // 変動費率の増減（+で悪化）
    const invest    = nz(deltas.invest?.[ym]);      // 金額（α一部費用化）

    // 実効churn率（情報用）：baseChurn + 差分
    const churnRate = clamp01(baseChurn + dChurn - dRet);

    // ★重要：数量は「ベース + 増減分」で計算する
    // - baseQty はその月の“素の”軌道（ベース）
    // - deltaQty は OKR 由来の増減分だけを累積
    const prevDeltaQty = deltaQtyPrev;
    const qPrev = baseQty + prevDeltaQty;

    // churn/retention は「ベースからの差分」として、
    // 増減分にだけ効かせるイメージ（ベース自体は崩さない）
    const churnDelta = dChurn - dRet; // >0 で悪化、<0 で改善

    // 増減分の更新：deltaQty_next = deltaQty_prev + 新規獲得 - (qPrev * churnDelta)
    const deltaQtyNext = Math.max(
      0,
      prevDeltaQty + dAcq - qPrev * churnDelta,
    );

    const qty = Math.max(0, baseQty + deltaQtyNext);
    deltaQtyPrev = deltaQtyNext;

    // 単価：ベース＋差分
    const arpu = Math.max(0, baseArpu + dArpu);

    // 売上（基本）：qty * arpu
    let revenueCore = Math.max(0, qty * arpu);

    // 売上へ直接加算（REVENUE KR 等）
    revenueCore += Math.max(0, dRevenue);

    // 相乗効果（+率）を売上に適用
    if (applySynergyTo.includes('revenue')) {
      revenueCore *= (1 + dSynergy);
    }
    const revenue = Math.max(0, revenueCore);

    // 変動費：金額足し込み or 率で計算の両対応
    let variable: number;
    if (dCogsRate !== 0) {
      // ベースの変動費率を推定（可能ならベース売上から、無ければ金額/内生売上で近似）
      const baseSales =
        (base.revenueMonthly?.[ym] ??
          (baseQty * baseArpu)) ||
        (revenueCore - dRevenue);
      const safeSales = Math.max(1, baseSales); // 0割回避
      const estBaseCogsRate = clamp01(baseVarAmt / safeSales);
      const appliedRate = clamp01(estBaseCogsRate + dCogsRate);
      variable = Math.max(0, appliedRate * revenueCore);
    } else {
      variable = Math.max(0, baseVarAmt + dVarAmt);
    }

    // 固定費・人件費（投資の一部当期費用化）
    let fixed = Math.max(
      0,
      baseFixed + dFixed + invest * (opt?.investEffectAlpha ?? 0),
    );
    let personnel = Math.max(0, basePers + dPers);

    // コスト側にも相乗効果を適用する指定なら
    if (applySynergyTo.includes('cost')) {
      fixed *= (1 + dSynergy);
      variable *= (1 + dSynergy);
      personnel *= (1 + dSynergy);
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
