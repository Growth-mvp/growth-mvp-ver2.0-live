// /utils/financeAdapter.ts
// 目的：simulationBridge + financeSimulation の結果を
// 既存UIが扱いやすい "threeYear" 互換の形に整形するアダプタ。

import extractBaseAndLevers, { extractBaseAndLevers as namedExtract } from '@/utils/simulationBridge';
// あれば使う。無ければアダプタ内フォールバックで計算する
import * as financeSim from '@/utils/financeSimulation';
import type { StrategyData } from '@/types/strategy';

export type ProjectionPoint = {
  year: string;        // 'Y1' | 'Y2' | 'Y3'
  sales: number;       // 売上
  op: number;          // 営業利益
  opMargin?: number;   // 営業利益率（0..1）
};

export type Projection = {
  points: ProjectionPoint[];
};

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

// ========= 丸め & 安全計算 =========
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

// ========= ランタイム解決ユーティリティ =========
type RunFn = (base: any, levers: any[], config: any) => SimulationResult;

function pickRunFn(mod: any): RunFn | null {
  const candidates = ['runFinanceSimulation', 'runSimulation', 'simulate', 'run', 'default'];
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
      try { return (v as Function)(); } catch { /* noop */ }
    } else if (!isFn && typeof v !== 'function') {
      return v;
    }
  }
  // 最低限のデフォルト
  return {
    periods: 3,          // 3年
    periodUnit: 'year',  // 年単位
    treatCapexAsExpense: true,
    linearLevers: true,
  };
}

// ========= フォールバック簡易シミュレーター（3年） =========
// extractBaseAndLevers の出力（base/levers）前提で計算
const fallbackRun: RunFn = (base: any, levers: any[], _config: any): SimulationResult => {
  const y0Sales = toNum(base?.year0Sales, 0);
  const y0Op = toNum(base?.year0Op, 0);
  // 入力が % 表記なので 100 で除する
  const growthPct = toNum(base?.growthRatePct, 0) / 100;
  const opMarginPct = toNum(base?.opMarginPct, 0); // %（後で/100）

  // レバーの集約（単純加算）
  const totalDeltaSalesPct = levers.reduce((acc, l) => acc + (toNum(l?.deltaSalesPct, 0) / 100), 0);
  const totalDeltaOpPctPt  = levers.reduce((acc, l) => acc + (toNum(l?.deltaOpPct, 0)), 0);    // 利益率の%pt
  const totalCapex         = levers.reduce((acc, l) => acc + toNum(l?.capex, 0), 0);
  const totalOpex          = levers.reduce((acc, l) => acc + toNum(l?.opex, 0), 0);

  const periods: SimulationPeriod[] = [];
  let salesPrev = y0Sales;
  let marginPct = opMarginPct; // %

  for (let i = 0; i < 3; i++) {
    // 成長 + レバー（売上%）
    const growthFactor = 1 + growthPct;
    const leverFactor = 1 + totalDeltaSalesPct; // 例: +5% → 1.05
    const sales = salesPrev * growthFactor * leverFactor;

    // 利益率（%）にレバーの%pt を加算、0〜100にクリップ
    marginPct = Math.max(0, Math.min(100, marginPct + totalDeltaOpPctPt));
    const opBeforeCosts = sales * (marginPct / 100);

    // capex/opex は営業利益から控除（投資は費用扱いの簡易モデル）
    const op = opBeforeCosts - totalCapex - totalOpex;

    periods.push({
      revenue: sales,
      operatingIncome: op,
    });

    salesPrev = sales; // 次年の基準
  }

  return { periods };
};

/** StrategyData 全体から、3期シミュレーションを返す */
export function runThreeYearFromStrategy(strategy: StrategyData): AdapterOutput {
  // simulationBridge は named/default 両対応
  const bridge = typeof namedExtract === 'function' ? namedExtract : extractBaseAndLevers;
  const { base, levers } = bridge(strategy);

  // financeSimulation が提供されていればそれを使う。無ければフォールバック。
  const run = pickRunFn(financeSim) ?? fallbackRun;
  const cfg = pickDefaultConfig(financeSim);

  const result = run(base, levers, cfg);

  // periods のフィールド名差異に対応（revenue/operatingIncome or sales/op）
  const periods = Array.isArray((result as any)?.periods) ? (result as any).periods : [];

  // threeYear 互換の points に整形（Y1..Y3固定）
  const rawPoints: ProjectionPoint[] = periods.map((p: any, i: number) => {
    const revenue = (p?.revenue ?? p?.sales ?? 0);
    const opInc = (p?.operatingIncome ?? p?.op ?? 0);

    const sales = safeRound(revenue);
    const op = safeRound(opInc);
    const opMargin = safeRatio(opInc, revenue, 4);

    return {
      year: `Y${i + 1}`,
      sales,
      op,
      opMargin,
    };
  });

  // 先頭3年を採用。3年未満なら 0 でパディング
  let points: ProjectionPoint[] = rawPoints.slice(0, 3);
  if (points.length < 3) {
    const paddingCount = 3 - points.length;
    const startIndex = points.length;
    const pads: ProjectionPoint[] = Array.from({ length: paddingCount }).map((_, k) => ({
      year: `Y${startIndex + k + 1}`,
      sales: 0,
      op: 0,
      opMargin: 0,
    }));
    points = [...points, ...pads];
  }

  return {
    projection: { points },
    raw: result,
  };
}

export default runThreeYearFromStrategy;
