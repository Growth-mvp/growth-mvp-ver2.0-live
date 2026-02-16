/**
 * STAGE6 ベースライン生成ロジック
 * financePL から BaseTrajectory / BaseFigures を生成
 */

import type { BaseFigures, Ym } from '@/utils/simulationBridge';
import type { BaseTrajectory } from '@/utils/financeSimulation';

/**
 * 月を YYYY-MM から次の月へ遷移
 */
function nextYm(y: Ym): Ym {
  const [year, month] = y.split('-').map(Number);
  const next = month === 12 ? [year + 1, 1] : [year, month + 1];
  return `${next[0]}-${String(next[1]).padStart(2, '0')}` as Ym;
}

/**
 * 月の範囲を生成（inclusive）
 */
function ymRange(startYm: Ym, endYm: Ym): Ym[] {
  const result: Ym[] = [];
  let current = startYm;
  while (current <= endYm) {
    result.push(current);
    current = nextYm(current);
  }
  return result;
}

/**
 * BaseFigures を financePL から生成
 * 最新年度のPLを使って、デフォルト値・推定値をセット
 *
 * ★ TASK-C: BaseFigures も baseline と同じ年（2024優先）を使う
 * - financePL が無い場合は null を返す（fallback 金額を禁止）
 * ★ 営業利益は Stage1実績を最優先（負値 -38円を尊重）
 */
export function mkBaseFigures(strategyState: any): (BaseFigures & { operatingIncome?: number }) | null {
  const pls = Array.isArray(strategyState?.financePL) ? strategyState.financePL : [];
  if (pls.length === 0) {
    console.warn('[STAGE6] financePL is empty -> baseFigures=null (no fallback)');
    return null;
  }

  // ★ TASK-C: baseline と同じ優先度で年を選ぶ（2024優先）
  const currentYear = new Date().getFullYear();
  let basePL = pls.find((pl: any) => pl.year === 2024);

  if (!basePL) {
    const resultYears = pls.filter((pl: any) => pl.year <= currentYear).sort((a: any, b: any) => b.year - a.year);
    basePL = resultYears[0] ?? null;
  }

  if (!basePL) {
    console.warn('[STAGE6] No actual year found in financePL for baseFigures');
    return null;
  }

  // ★ 営業利益は Stage1実績を最優先（-38円を尊重）
  const opIncomeYen =
    typeof basePL?.operatingIncome === 'number'
      ? basePL.operatingIncome
      : ((basePL?.revenue ?? 0) - (basePL?.cogs ?? 0) - (basePL?.sga ?? 0));

  const latestPL = basePL;

  return {
    revenue: latestPL.revenue ?? 0,
    acq: Math.max(1000, (latestPL.revenue ?? 1) / (latestPL.cogs ?? 1)),
    arpu: Math.max(
      50000,
      (latestPL.revenue ?? 1) /
        Math.max(1000, (latestPL.revenue ?? 1) / (latestPL.cogs ?? 1)),
    ),
    churn: 0.02,
    fixed_cost: (latestPL.sga ?? 0) / 12,
    variable_cost: (latestPL.cogs ?? 0) / 12,
    personnel_cost: (latestPL.sga ?? 0) / 2 / 12,
    invest: 0,
    success_rate: 0.8,
    synergy: 0,
    // ★ TASK: 営業利益を保存（baselineYearly の計算で使用）
    operatingIncome: opIncomeYen,
  };
}

/**
 * BaseTrajectory を financePL から生成
 * 3年間の月次予測値をセット
 *
 * ★ TASK-C: Baseline年は Stage1実績年（2024優先）に固定
 * - financePL.revenue は yen 永続と仮定（unit 推定なし）
 * - 計画年（2025+）は使わない
 */
export function mkBaselineTrajectory(strategyState: any): BaseTrajectory | null {
  const pls = Array.isArray(strategyState?.financePL) ? strategyState.financePL : [];
  if (pls.length === 0) {
    console.warn('[STAGE6] financePL is empty -> baseline missing');
    return null;
  }

  // ★ TASK-C: baseline年を決定（2024優先、無ければ実績年の最大）
  const currentYear = new Date().getFullYear();

  // 第一優先: 2024年（Stage1実績）
  let baselinePL = pls.find((pl: any) => pl.year === 2024);

  // 第二優先: year <= currentYear の最大値（実績年に限定）
  if (!baselinePL) {
    const resultYears = pls.filter((pl: any) => pl.year <= currentYear).sort((a: any, b: any) => b.year - a.year);
    baselinePL = resultYears[0] ?? null;
  }

  if (!baselinePL) {
    console.warn('[STAGE6] No actual year found in financePL (all years > currentYear or empty)');
    return null;
  }

  // ★ 必須フィールド確認: sga, cogs が無い場合は null を返す
  if (baselinePL.sga === undefined || baselinePL.cogs === undefined) {
    console.warn('[STAGE6] baselinePL missing required fields (sga/cogs) for trajectory');
    return null;
  }

  // ★ 営業利益は Stage1実績を最優先（-38円を尊重）
  const pickedYear = baselinePL.year;
  const opIncomeYen =
    typeof baselinePL?.operatingIncome === 'number'
      ? baselinePL.operatingIncome
      : ((baselinePL?.revenue ?? 0) - (baselinePL?.cogs ?? 0) - (baselinePL?.sga ?? 0));

  // ★ ログ: 採用した baseline 年を出力（DEBUG時のみ）
  const DEBUG_BASELINE = process.env.NODE_ENV === 'development' && process.env.NEXT_PUBLIC_DEBUG_STAGE6;
  if (DEBUG_BASELINE) {
    console.log('[baseline] pickedYear=%s rev=%s opIncome(raw)=%s opIncome(used)=%s cogs=%s sga=%s',
      pickedYear,
      baselinePL?.revenue,
      baselinePL?.operatingIncome,
      opIncomeYen,
      baselinePL?.cogs,
      baselinePL?.sga
    );
  }

  const year = baselinePL.year;
  const startYm = `${year}-01` as Ym;
  const endYm = `${year + 3}-12` as Ym;

  const months = ymRange(startYm, endYm);
  // ★ financePL は yen 永続と仮定（unit 推定なし）
  const monthlyQty = Math.max(1000, (baselinePL.revenue ?? 1) / (baselinePL.cogs ?? 1));
  const monthlyArpu = Math.max(50000, (baselinePL.revenue ?? 1) / monthlyQty);

  const result: BaseTrajectory = {
    startYm,
    endYm,
    qtyMonthly: {},
    arpuMonthly: {},
    churnMonthly: {},
    fixedCostMonthly: {},
    variableCostMonthly: {},
    personnelCostMonthly: {},
  };

  months.forEach((ym) => {
    result.qtyMonthly[ym] = monthlyQty / 12;
    result.arpuMonthly[ym] = monthlyArpu;
    result.churnMonthly[ym] = 0.02;
    result.fixedCostMonthly[ym] = baselinePL.sga / 12;
    result.variableCostMonthly[ym] = baselinePL.cogs / 12;
    result.personnelCostMonthly[ym] = baselinePL.sga / 2 / 12;
  });

  return result;
}
