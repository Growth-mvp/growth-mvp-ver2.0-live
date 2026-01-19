// /utils/financeAdapter.ts
// =========================================================
// SimulationBridge（extractBaseAndLevers） + financeSimulation の接着
// ---------------------------------------------------------
// AIが未整備/不完全でも "threeYear" の表示が破綻しないように、
// financeSimulation 側の export 形式が違っていても拾えるようにする Adapter。
// =========================================================

import extractBaseAndLevers, {
  extractBaseAndLevers as namedExtract,
} from '@/utils/extractBaseAndLevers';
import * as financeSim from '@/utils/financeSimulation';
import type { StrategyData } from '@/types/strategy';

export type ProjectionPoint = {
  year: string; // 'Y1' | 'Y2' | 'Y3'
  sales: number; // 売上
  op: number; // 営業利益
  opMargin?: number; // 営業利益率（0..1）
};

export type Projection = { points: ProjectionPoint[] };

export type SimulationPeriod = {
  revenue?: number;
  sales?: number;
  operatingIncome?: number;
  op?: number;
};

export type SimulationResult = {
  periods?: SimulationPeriod[];
  [key: string]: any;
};

export type AdapterOutput = {
  projection: Projection;
  raw: SimulationResult;
};

// ========= 数値ユーティリティ =========
function safeRound(n: any): number {
  const v = Number(n);
  if (!Number.isFinite(v)) return 0;
  return Math.round(v);
}
function safeRatio(numer: any, denom: any, digits = 4): number {
  const a = Number(numer);
  const b = Number(denom);
  if (!Number.isFinite(a) || !Number.isFinite(b) || b === 0) return 0;
  const r = a / b;
  const pow = Math.pow(10, digits);
  return Number((Math.round(r * pow) / pow).toFixed(digits));
}
const toNum = (v: any, d = 0) => (Number.isFinite(Number(v)) ? Number(v) : d);

// ========= ランタイムで function export を拾うユーティリティ =========
type RunFn = (base: any, levers: any[], config: any) => SimulationResult;

function pickRunFn(mod: any): RunFn | null {
  const candidates = [
    'runFinanceSimulation',
    'runSimulation',
    'simulate',
    'run',
    'default',
  ];
  for (const key of candidates) {
    const v = mod?.[key];
    if (typeof v === 'function') return v as RunFn;
  }
  return null;
}

function pickDefaultConfig(mod: any): any {
  const candidates: Array<{ key: string; isFn?: boolean }> = [
    { key: 'defaultConfig', isFn: true },
    { key: 'getDefaultConfig', isFn: true },
    { key: 'createDefaultConfig', isFn: true },
    { key: 'DEFAULT_CONFIG', isFn: false },
    { key: 'defaultConfig', isFn: false },
  ];

  for (const { key, isFn } of candidates) {
    const v = mod?.[key];
    if (v == null) continue;

    if (isFn && typeof v === 'function') {
      try {
        return (v as Function)();
      } catch {
        /* noop */
      }
    } else if (!isFn && typeof v !== 'function') {
      return v;
    }
  }

  // 最終フォールバック
  return {
    periods: 3, // 3年
    periodUnit: 'year',
    treatCapexAsExpense: true,
    linearLevers: true,
  };
}

// ========= 「意味のある入力か」判定 =========
function isMeaningfulBase(base: any): boolean {
  if (!base || typeof base !== 'object') return false;
  const vals = [
    base?.year0Sales,
    base?.year0Op,
    base?.growthRatePct,
    base?.opMarginPct,
  ].map(Number);
  return vals.some((v) => Number.isFinite(v) && v !== 0);
}

function isMeaningfulLevers(levers: any[]): boolean {
  if (!Array.isArray(levers) || levers.length === 0) return false;
  return levers.some((l) =>
    ['deltaSalesPct', 'deltaOpPct', 'capex', 'opex'].some((k) => {
      const v = Number(l?.[k]);
      return Number.isFinite(v) && v !== 0;
    }),
  );
}

// ========= フォールバック: periods: [] を返すと UI 側が安定する =========
const fallbackRun: RunFn = (base: any, levers: any[], _config: any): SimulationResult => {
  if (!isMeaningfulBase(base) && !isMeaningfulLevers(levers)) {
    return { periods: [] };
  }

  const y0Sales = toNum(base?.year0Sales, 0);
  const y0Op = toNum(base?.year0Op, 0);

  const growthPct = toNum(base?.growthRatePct, 0) / 100; // %
  const opMarginPct0 = toNum(base?.opMarginPct, 0); // %

  // レバー合算（簡易）
  const totalDeltaSalesPct = levers.reduce(
    (acc, l) => acc + toNum(l?.deltaSalesPct, 0) / 100,
    0,
  );
  const totalDeltaOpPctPt = levers.reduce(
    (acc, l) => acc + toNum(l?.deltaOpPct, 0),
    0,
  ); // 利益率の %pt
  const totalCapex = levers.reduce((acc, l) => acc + toNum(l?.capex, 0), 0);
  const totalOpex = levers.reduce((acc, l) => acc + toNum(l?.opex, 0), 0);

  const periods: SimulationPeriod[] = [];
  let salesPrev = y0Sales;
  // y0Op が入っているが opMarginPct0 がない場合の救済
  let marginPct =
    opMarginPct0 ||
    (y0Sales > 0 ? Math.max(0, Math.min(100, (y0Op / y0Sales) * 100)) : 0);

  for (let i = 0; i < 3; i++) {
    const growthFactor = 1 + growthPct;
    const leverFactor = 1 + totalDeltaSalesPct;
    const sales = salesPrev * growthFactor * leverFactor;

    marginPct = Math.max(0, Math.min(100, marginPct + totalDeltaOpPctPt));
    const opBeforeCosts = sales * (marginPct / 100);

    // capex/opex は費用扱いで控除（超簡易）
    const op = opBeforeCosts - totalCapex - totalOpex;

    periods.push({ revenue: sales, operatingIncome: op });
    salesPrev = sales;
  }

  // すべてゼロなら periods: [] にして UI を安定化
  const allZero = periods.every(
    (p) => !Number.isFinite(Number(p.revenue)) || Number(p.revenue) === 0,
  );
  return allZero ? { periods: [] } : { periods };
};

/**
 * StrategyData から threeYear 用の projection を生成する
 * - extractBaseAndLevers は named / default の両方を許容
 * - financeSimulation 側の export が揺れても pickRunFn で拾う
 */
export function runThreeYearFromStrategy(strategy: StrategyData): AdapterOutput {
  const bridge = typeof namedExtract === 'function' ? namedExtract : extractBaseAndLevers;
  const bridged = bridge(strategy);
  const base = bridged?.base ?? null;
  const levers = Array.isArray(bridged?.levers) ? bridged.levers : [];

  // 入力が無意味なら points: [] にして上位UIを安定化
  if (!isMeaningfulBase(base) && !isMeaningfulLevers(levers)) {
    return { projection: { points: [] }, raw: { periods: [] } };
  }

  const run = pickRunFn(financeSim) ?? fallbackRun;
  const cfg = pickDefaultConfig(financeSim);

  const result = (run(base, levers, cfg) ?? { periods: [] }) as SimulationResult;
  const periods = Array.isArray((result as any)?.periods)
    ? ((result as any).periods as SimulationPeriod[])
    : [];

  if (periods.length === 0) {
    return { projection: { points: [] }, raw: result };
  }

  const points: ProjectionPoint[] = periods.slice(0, 3).map((p: any, i: number) => {
    const revenue = p?.revenue ?? p?.sales ?? 0;
    const opInc = p?.operatingIncome ?? p?.op ?? 0;

    const sales = safeRound(revenue);
    const op = safeRound(opInc);
    const opMargin = safeRatio(opInc, revenue, 4);

    return { year: `Y${i + 1}`, sales, op, opMargin };
  });

  return { projection: { points }, raw: result };
}

export default runThreeYearFromStrategy;
