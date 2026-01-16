// /utils/financeAdapter.ts
// 逶ｮ逧・ｼ嘖imulationBridge + financeSimulation 縺ｮ邨先棡繧・
// 譌｢蟄篭I縺梧桶縺・ｄ縺吶＞ "threeYear" 莠呈鋤縺ｮ蠖｢縺ｫ謨ｴ蠖｢縺吶ｋ繧｢繝繝励ち縲・

import extractBaseAndLevers, { extractBaseAndLevers as namedExtract } from '@/utils/stage6Bridge';
// 縺ゅｌ縺ｰ菴ｿ縺・ら┌縺代ｌ縺ｰ繧｢繝繝励ち蜀・ヵ繧ｩ繝ｼ繝ｫ繝舌ャ繧ｯ縺ｧ險育ｮ励☆繧・
import * as financeSim from '@/utils/financeSimulation';
import type { StrategyData } from '@/types/strategy';

export type ProjectionPoint = {
  year: string;        // 'Y1' | 'Y2' | 'Y3'
  sales: number;       // 螢ｲ荳・
  op: number;          // 蝟ｶ讌ｭ蛻ｩ逶・
  opMargin?: number;   // 蝟ｶ讌ｭ蛻ｩ逶顔紫・・..1・・
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

// ========= 荳ｸ繧・& 螳牙・險育ｮ・=========
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

// ========= 繝ｩ繝ｳ繧ｿ繧､繝隗｣豎ｺ繝ｦ繝ｼ繝・ぅ繝ｪ繝・ぅ =========
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
  // 譛菴朱剞縺ｮ繝・ヵ繧ｩ繝ｫ繝・
  return {
    periods: 3,          // 3蟷ｴ
    periodUnit: 'year',  // 蟷ｴ蜊倅ｽ・
    treatCapexAsExpense: true,
    linearLevers: true,
  };
}

// ========= 蜈･蜉帙メ繧ｧ繝・け・育ｩｺ縺ｪ繧画緒逕ｻ縺励↑縺・ｼ・=========
function isMeaningfulBase(base: any): boolean {
  if (!base || typeof base !== 'object') return false;
  const vals = [
    base?.year0Sales, base?.year0Op, base?.growthRatePct, base?.opMarginPct,
  ].map(Number);
  return vals.some((v) => Number.isFinite(v) && v !== 0);
}
function isMeaningfulLevers(levers: any[]): boolean {
  if (!Array.isArray(levers) || levers.length === 0) return false;
  return levers.some((l) =>
    ['deltaSalesPct', 'deltaOpPct', 'capex', 'opex'].some((k) => {
      const v = Number(l?.[k]);
      return Number.isFinite(v) && v !== 0;
    })
  );
}

// ========= 繝輔か繝ｼ繝ｫ繝舌ャ繧ｯ邁｡譏薙す繝溘Η繝ｬ繝ｼ繧ｿ繝ｼ・・蟷ｴ・・=========
// 窶ｻ 蜈･蜉帙′辟｡諢丞袖縺ｪ繧・periods: [] 繧定ｿ斐☆・・繝代ョ繧｣繝ｳ繧ｰ縺励↑縺・ｼ・
const fallbackRun: RunFn = (base: any, levers: any[], _config: any): SimulationResult => {
  if (!isMeaningfulBase(base) && !isMeaningfulLevers(levers)) {
    return { periods: [] };
  }

  const y0Sales = toNum(base?.year0Sales, 0);
  const y0Op = toNum(base?.year0Op, 0);
  const growthPct = toNum(base?.growthRatePct, 0) / 100; // %
  const opMarginPct0 = toNum(base?.opMarginPct, 0);      // %・亥ｾ後〒/100・・

  // 繝ｬ繝舌・縺ｮ髮・ｴ・ｼ亥腰邏泌刈邂暦ｼ・
  const totalDeltaSalesPct = levers.reduce((acc, l) => acc + (toNum(l?.deltaSalesPct, 0) / 100), 0);
  const totalDeltaOpPctPt  = levers.reduce((acc, l) => acc + (toNum(l?.deltaOpPct, 0)), 0); // 蛻ｩ逶顔紫縺ｮ%pt
  const totalCapex         = levers.reduce((acc, l) => acc + toNum(l?.capex, 0), 0);
  const totalOpex          = levers.reduce((acc, l) => acc + toNum(l?.opex, 0), 0);

  const periods: SimulationPeriod[] = [];
  let salesPrev = y0Sales;
  let marginPct = opMarginPct0; // %

  for (let i = 0; i < 3; i++) {
    const growthFactor = 1 + growthPct;
    const leverFactor = 1 + totalDeltaSalesPct; // 萓・ +5% 竊・1.05
    const sales = salesPrev * growthFactor * leverFactor;

    // 蛻ｩ逶顔紫・・・峨↓繝ｬ繝舌・縺ｮ%pt 繧貞刈邂励・縲・00縺ｫ繧ｯ繝ｪ繝・・
    marginPct = Math.max(0, Math.min(100, marginPct + totalDeltaOpPctPt));
    const opBeforeCosts = sales * (marginPct / 100);

    // capex/opex 縺ｯ蝟ｶ讌ｭ蛻ｩ逶翫°繧画而髯､・域兜雉・・雋ｻ逕ｨ謇ｱ縺・・邁｡譏薙Δ繝・Ν・・
    const op = opBeforeCosts - totalCapex - totalOpex;

    periods.push({ revenue: sales, operatingIncome: op });
    salesPrev = sales;
  }

  // 縺吶∋縺ｦ繧ｼ繝ｭ縺ｪ繧臥ｩｺ謇ｱ縺・ｼ域緒逕ｻ縺励↑縺・ｼ・
  const allZero = periods.every(
    (p) => !Number.isFinite(Number(p.revenue)) || Number(p.revenue) === 0
  );
  return allZero ? { periods: [] } : { periods };
};

/** StrategyData 蜈ｨ菴薙°繧峨・譛溘す繝溘Η繝ｬ繝ｼ繧ｷ繝ｧ繝ｳ繧定ｿ斐☆ */
export function runThreeYearFromStrategy(strategy: StrategyData): AdapterOutput {
  // simulationBridge 縺ｯ named/default 荳｡蟇ｾ蠢・
  const bridge = typeof namedExtract === 'function' ? namedExtract : extractBaseAndLevers;
  const { base, levers } = bridge(strategy) ?? { base: null, levers: [] };

  // 蜈･蜉帙′遨ｺ縺ｪ繧峨梧緒逕ｻ縺励↑縺・阪◆繧√↓ points: [] 繧定ｿ斐☆
  if (!isMeaningfulBase(base) && !isMeaningfulLevers(levers)) {
    return { projection: { points: [] }, raw: { periods: [] } };
  }

  // financeSimulation 縺梧署萓帙＆繧後※縺・ｌ縺ｰ縺昴ｌ繧剃ｽｿ縺・ら┌縺代ｌ縺ｰ繝輔か繝ｼ繝ｫ繝舌ャ繧ｯ縲・
  const run = pickRunFn(financeSim) ?? fallbackRun;
  const cfg = pickDefaultConfig(financeSim);

  const result = run(base, levers, cfg) ?? { periods: [] };
  const periods = Array.isArray((result as any)?.periods) ? (result as any).periods : [];

  // periods 縺檎ｩｺ縺ｪ繧画緒逕ｻ縺励↑縺・
  if (periods.length === 0) {
    return { projection: { points: [] }, raw: result };
  }

  // threeYear 莠呈鋤縺ｮ points 縺ｫ謨ｴ蠖｢・亥ｭ伜惠蛻・・縺ｿ縲・繝代ョ繧｣繝ｳ繧ｰ縺励↑縺・ｼ・
  const points: ProjectionPoint[] = periods.slice(0, 3).map((p: any, i: number) => {
    const revenue = (p?.revenue ?? p?.sales ?? 0);
    const opInc = (p?.operatingIncome ?? p?.op ?? 0);

    const sales = safeRound(revenue);
    const op = safeRound(opInc);
    const opMargin = safeRatio(opInc, revenue, 4);

    return { year: `Y${i + 1}`, sales, op, opMargin };
  });

  return { projection: { points }, raw: result };
}

export default runThreeYearFromStrategy;
