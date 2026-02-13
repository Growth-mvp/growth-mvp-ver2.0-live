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
 */
export function mkBaseFigures(strategyState: any): BaseFigures {
  const latestPL = Array.isArray(strategyState?.financePL)
    ? strategyState.financePL[strategyState.financePL.length - 1]
    : null;

  return {
    revenue: latestPL?.revenue ?? 100000000,
    acq: Math.max(1000, (latestPL?.revenue ?? 100000000) / (latestPL?.cogs ?? 100000)),
    arpu: Math.max(
      50000,
      (latestPL?.revenue ?? 100000000) /
        Math.max(1000, (latestPL?.revenue ?? 100000000) / (latestPL?.cogs ?? 100000)),
    ),
    churn: 0.02,
    fixed_cost: (latestPL?.sga ?? 10000000) / 12,
    variable_cost: (latestPL?.cogs ?? 30000000) / 12,
    personnel_cost: (latestPL?.sga ?? 10000000) / 2 / 12,
    invest: 0,
    success_rate: 0.8,
    synergy: 0,
  };
}

/**
 * BaseTrajectory を financePL から生成
 * 3年間の月次予測値をセット
 */
export function mkBaselineTrajectory(strategyState: any): BaseTrajectory | null {
  const pls = Array.isArray(strategyState?.financePL) ? strategyState.financePL : [];
  if (pls.length === 0) {
    console.warn('[STAGE6] financePL is empty -> baseline missing', {
      financePLType: typeof strategyState?.financePL,
      hydrated: (strategyState as any)?.hydrated,
    });
    return null;
  }

  const latestPL = pls[pls.length - 1];
  const year = latestPL?.year ?? new Date().getFullYear();
  const startYm = `${year}-01` as Ym;
  const endYm = `${year + 3}-12` as Ym;

  const months = ymRange(startYm, endYm);
  const monthlyQty = Math.max(1000, (latestPL?.revenue ?? 100000000) / (latestPL?.cogs ?? 100000));
  const monthlyArpu = Math.max(50000, (latestPL?.revenue ?? 100000000) / monthlyQty);

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
    result.fixedCostMonthly[ym] = (latestPL?.sga ?? 10000000) / 12;
    result.variableCostMonthly[ym] = (latestPL?.cogs ?? 30000000) / 12;
    result.personnelCostMonthly[ym] = (latestPL?.sga ?? 10000000) / 2 / 12;
  });

  return result;
}
