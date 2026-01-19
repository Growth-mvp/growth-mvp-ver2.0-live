// /utils/extractBaseAndLevers.ts
/* =========================================================
 * extractBaseAndLevers
 * ---------------------------------------------------------
 * StrategyData から「3年簡易モデル」用の base と levers を抽出する。
 * 旧: stage6Bridge.ts の末尾に混在していたロジックを分離。
 * ========================================================= */

import type { StrategyData } from '@/types/strategy';

export type BaseForThreeYear = {
  year0Sales: number;
  year0Op: number;
  growthRatePct: number;
  opMarginPct: number;
};

export type LeverForThreeYear = {
  id: string;
  label: string;
  deltaSalesPct?: number;
  deltaOpPct?: number;
  capex?: number;
  opex?: number;
};

const toNum = (v: any, d = 0) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : d;
};

/**
 * StrategyData -> { base, levers }
 * - financeSummary[0] から sales/op 等を抽出
 * - departments[].projects[] から deltaSalesPct 等を抽出（存在すれば）
 */
export function extractBaseAndLevers(strategy: StrategyData): {
  base: BaseForThreeYear;
  levers: LeverForThreeYear[];
} {
  const fs: any[] = Array.isArray((strategy as any)?.financeSummary)
    ? (strategy as any).financeSummary
    : [];

  const row0 = fs[0] ?? {};
  const base: BaseForThreeYear = {
    year0Sales: toNum(row0.sales ?? row0.revenue ?? 0),
    year0Op: toNum(row0.op ?? row0.operatingProfit ?? 0),
    growthRatePct: toNum(row0.growthRatePct ?? row0.growth ?? 0),
    opMarginPct: toNum(
      row0.opMarginPct ??
        (row0.sales
          ? (toNum(row0.op) / Math.max(1, toNum(row0.sales))) * 100
          : 0),
    ),
  };

  const departments: any[] = Array.isArray((strategy as any)?.departments)
    ? (strategy as any).departments
    : [];

  const levers: LeverForThreeYear[] = [];
  for (const dep of departments) {
    const projects: any[] = Array.isArray(dep?.projects) ? dep.projects : [];
    for (const p of projects) {
      const l: LeverForThreeYear = {
        id: p?.id ?? `${dep?.name ?? 'dep'}:${p?.title ?? 'proj'}`,
        label: p?.title ?? dep?.name ?? 'lever',
      };
      if (typeof p?.deltaSalesPct === 'number') l.deltaSalesPct = p.deltaSalesPct;
      if (typeof p?.deltaOpPct === 'number') l.deltaOpPct = p.deltaOpPct;
      if (typeof p?.capex === 'number') l.capex = p.capex;
      if (typeof p?.opex === 'number') l.opex = p.opex;

      levers.push(l);
    }
  }

  return { base, levers };
}

export default extractBaseAndLevers;
