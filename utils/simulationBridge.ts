// /utils/stage6Bridge.ts

/* =========================================================
 * OKR・域ｧ矩蛹厄ｼ・竊・荳ｻ隕゜PI縺ｮ譛域ｬ｡繝・Ν繧ｿ縺ｸ繝悶Μ繝・ず・磯ｲ蛹也沿・・
 * ---------------------------------------------------------
 * - KRKind 縺斐→縺ｫ ACQ/ARPU/CHURN/雋ｻ逕ｨ/謚戊ｳ・逶ｸ荵・謌仙粥邇・螢ｲ荳・繧呈怦谺｡蠅玲ｸ帙∈螟画鋤
 * - ACTIVITY 縺ｯ elasticity 縺ｨ lagMonths 繧堤畑縺・※荳ｻ隕゜PI縺ｸ螟画鋤
 * - ・・腰菴阪・蟆乗焚縺ｸ豁｣隕丞喧・・% => 0.05・・
 * - COST_VARIABLE 縺ｯ縲碁≡鬘阪腔r縲檎紫・・ogsRate・峨阪ｒ蜊倅ｽ阪〒閾ｪ蜍募愛螳・
 * - 譛滄俣縺ｯ 'YYYY-MM'・・m・峨〒謇ｱ縺・《tartYm縲彳ndYm 繧貞性繧
 * - financeSimulation.ts 蛛ｴ縺ｫ貂｡縺励※PL繧堤ｮ怜・
 *
 * 笘・ｻ雁屓縺ｮ驥崎ｦ√・繧､繝ｳ繝遺・
 * - OKR・・rs・峨′ 0 莉ｶ縺ｮ縺ｨ縺阪・縲悟・鬆・岼0縺ｮ deltas縲阪ｒ縺昴・縺ｾ縺ｾ霑斐☆縲・
 *   竊・simulateMonthlyPL 蛛ｴ縺ｮ hasAnyDelta 縺・false 縺ｫ縺ｪ繧翫√・繝ｼ繧ｹPL縺昴・縺ｾ縺ｾ縺ｫ縺ｪ繧九・
 * ========================================================= */

import type { StrategyData } from '@/types/strategy';

export type Ym = string; // 'YYYY-MM'

// 荳ｻ隕゜PI豈肴焚・亥ｿ・ｦ√↓蠢懊§縺ｦ諡｡蠑ｵ蜿ｯ・・
export type BaseFigures = {
  revenue?: number;        // 螢ｲ荳奇ｼ亥盾閠・ｼ・
  acq?: number;            // 譛域ｬ｡譁ｰ隕冗佐蠕励・蝓ｺ貅・
  arpu?: number;           // 蝓ｺ貅門腰萓｡
  churn?: number;          // 譛域ｬ｡隗｣邏・紫・・.02=2%・・
  fixed_cost?: number;     // 蝗ｺ螳夊ｲｻ
  variable_cost?: number;  // 螟牙虚雋ｻ・医・繝ｼ繧ｹ驥鷹｡搾ｼ・
  personnel_cost?: number; // 莠ｺ莉ｶ雋ｻ
  invest?: number;         // 謚戊ｳ・｡・
  success_rate?: number;   // 謌仙粥邇・
  synergy?: number;        // 逶ｸ荵嶺ｿよ焚
};

export type ActivityMapping = 'ACQ' | 'ARPU' | 'CHURN';

// 逕ｻ髱｢繝ｻ莨夂､ｾ蛻･縺ｮ繝・ヵ繧ｩ繝ｫ繝域嫌蜍・
export type BridgeConfig = {
  // ACTIVITY 縺ｮ繝・ヵ繧ｩ繝ｫ繝亥､画鋤蜈茨ｼ育怐逡･譎ゅ・ 'ACQ'・・
  activityDefault?: ActivityMapping;
  // 繝ｩ繝吶Ν繧・baseKey 縺斐→縺ｫ螟画鋤蜈医ｒ荳頑嶌縺搾ｼ井ｾ具ｼ嘴 '險ｪ蝠丈ｻｶ謨ｰ': 'ACQ' }・・
  activityRoute?: Record<string, ActivityMapping>;
  // 蟆・擂諡｡蠑ｵ逕ｨ
};

// ・・ypes/strategy.ts 縺ｫ蜷医ｏ縺帙ｋ・壼ｿ・ｦ∵怙蟆城剞縺ｮ縺ｿ蜿励￠蜿悶ｊ・・
export type BridgeKR = {
  id: string;
  kind:
    | 'REVENUE'
    | 'ARPU'
    | 'ACQ'
    | 'CHURN'
    | 'COST_FIXED'
    | 'COST_VARIABLE'
    | 'PERSONNEL'
    | 'INVEST'
    | 'SUCCESS_RATE'
    | 'SYNERGY'
    | 'ACTIVITY';
  label: string;
  target: number;
  unit?: '%' | 'ﾂ･' | '莉ｶ' | '莠ｺ' | '豈皮紫' | string;
  scope: 'company' | 'department' | 'project';
  baseKey:
    | 'revenue'
    | 'arpu'
    | 'acq'
    | 'churn'
    | 'fixed_cost'
    | 'variable_cost'
    | 'personnel_cost'
    | 'invest'
    | 'success_rate'
    | 'synergy';
  baseOverride?: number;
  weight?: number;
  elasticity?: number;   // ACTIVITY 竊・荳ｻ隕゜PI 縺ｮ諢溷ｺｦ
  lagMonths?: number;    // 豢ｻ蜍補・謌先棡縺ｾ縺ｧ縺ｮ驕・｡・
  startYm?: Ym;          // 蛟句挨髢句ｧ具ｼ医↑縺代ｌ縺ｰ蜈ｨ菴・startYm・・
  due?: string;          // 'YYYY-MM' or 'YYYY-MM-DD'
  notes?: string;
};

export type BridgeInput = {
  startYm: Ym;     // 繝悶Μ繝・ず險育ｮ励・髢句ｧ具ｼ亥性繧・・
  endYm: Ym;       // 繝悶Μ繝・ず險育ｮ励・邨ゆｺ・ｼ亥性繧・・
  krs: BridgeKR[]; // 讒矩蛹訪R驟榊・
  base: BaseFigures;
  config?: BridgeConfig;
};

// 荳ｻ隕゜PI縺ｫ蟇ｾ縺吶ｋ譛域ｬ｡繝・Ν繧ｿ
export type DeltasByMonth = {
  revenue: Record<Ym, number>;       // +蜀・ｼ医ム繧､繝ｬ繧ｯ繝亥刈邂暦ｼ・
  acq: Record<Ym, number>;           // +莉ｶ
  arpu: Record<Ym, number>;          // +蜀・ｼ亥腰萓｡・・
  churn: Record<Ym, number>;         // +邇・ｼ域が蛹悶・+・乗隼蝟・・-・・
  retention: Record<Ym, number>;     // +邇・ｼ育ｶ咏ｶ夂紫ﾎ斐ｒ逶ｴ謗･菴ｿ縺・◆縺・凾縺ｫ蛻ｩ逕ｨ縲∵悴菴ｿ逕ｨ縺ｪ繧・・・
  fixed_cost: Record<Ym, number>;    // +蜀・
  variable_cost: Record<Ym, number>; // +蜀・ｼ育紫謖・ｮ壹′辟｡縺・→縺阪・縺薙■繧会ｼ・
  cogsRate: Record<Ym, number>;      // +邇・ｼ亥､牙虚雋ｻ邇・費ｼ・縺ｧ謔ｪ蛹厄ｼ・
  personnel_cost: Record<Ym, number>;// +蜀・
  invest: Record<Ym, number>;        // +蜀・
  synergy: Record<Ym, number>;       // +邇・
  success_rate: Record<Ym, number>;  // +邇・
};

/* ========== YM Utils ========== */
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
function initDelta(range: Ym[]): Record<Ym, number> {
  return range.reduce((acc, ym) => {
    acc[ym] = 0;
    return acc;
  }, {} as Record<Ym, number>);
}

/* ========== Helpers ========== */
const nz = (v: any, d = 0) => (typeof v === 'number' && Number.isFinite(v) ? v : d);
const isPercentUnit = (u?: string) => u === '%' || u === '豈皮紫';

/** ・・・蜉帙↑繧牙ｰ乗焚縺ｸ豁｣隕丞喧・・%竊・.05・・*/
function normalizeByUnit(value: number, unit?: string): number {
  const v = nz(value, 0);
  if (isPercentUnit(unit)) return v / 100;
  return v;
}

/** baseOverride 縺後≠繧後・譛蜆ｪ蜈医∫┌縺代ｌ縺ｰ baseFigures 繧貞盾辣ｧ */
function resolveBaseValue(kr: BridgeKR, base: BaseFigures): number | undefined {
  if (typeof kr.baseOverride === 'number') return kr.baseOverride;
  switch (kr.baseKey) {
    case 'revenue': return base.revenue;
    case 'acq': return base.acq;
    case 'arpu': return base.arpu;
    case 'churn': return base.churn;
    case 'fixed_cost': return base.fixed_cost;
    case 'variable_cost': return base.variable_cost;
    case 'personnel_cost': return base.personnel_cost;
    case 'invest': return base.invest;
    case 'success_rate': return base.success_rate;
    case 'synergy': return base.synergy;
    default: return undefined;
  }
}

/** 驕ｩ逕ｨ譛磯・蛻励ｒ邂怜・・・agMonths 縺ｧ蠕後ｍ蛟偵＠・・ｯ・峇繧ｯ繝ｩ繝ｳ繝暦ｼ・*/
function getApplyMonths(startYm: Ym, endYm: Ym, kr: BridgeKR): Ym[] {
  // 蛟句挨謖・ｮ壹′縺ゅ▲縺ｦ繧ゅす繝溘Η繝ｬ繝ｼ繧ｷ繝ｧ繝ｳ遽・峇螟悶↓縺ｯ縺ｿ蜃ｺ縺輔↑縺・ｈ縺・け繝ｩ繝ｳ繝・
  const rawStart = kr.startYm ?? startYm;
  const rawDue = kr.due ? kr.due.slice(0, 7) : endYm; // 'YYYY-MM' 譛溷ｾ・

  const kStart = rawStart < startYm ? startYm : rawStart;
  const kDueClamped = rawDue > endYm ? endYm : rawDue;

  // start > end 縺ｫ縺ｪ縺｣縺ｦ縺励∪縺・R縺ｯ辟｡隕・
  if (kStart > kDueClamped) return [];

  const lag = kr.lagMonths ?? 0;

  let applyMonths = ymRange(kStart, kDueClamped);
  for (let i = 0; i < lag; i++) {
    applyMonths = applyMonths.map(m => nextYm(m)).filter(m => m <= endYm);
  }
  return applyMonths;
}

/** 譛域ｬ｡蜉邂暦ｼ磯㍾縺ｿ縺後≠繧後・謗帙￠繧具ｼ・*/
function applyAdd(bucket: Record<Ym, number>, val: number, applyMonths: Ym[], weight?: number) {
  const w = typeof weight === 'number' ? weight : 1;
  const add = nz(val, 0) * w;
  if (add === 0) return;
  for (const ym of applyMonths) {
    if (bucket[ym] === undefined) continue; // 遽・峇螟悶ぎ繝ｼ繝会ｼ亥ｿｵ縺ｮ縺溘ａ・・
    bucket[ym] += add;
  }
}

/* ========== Core Bridge ========== */
/**
 * 讒矩蛹飽KR 竊・荳ｻ隕゜PI縺ｮ譛域ｬ｡繝・Ν繧ｿ縺ｸ螟画鋤
 * - 邇・ｳｻ縺ｯ normalizeByUnit 縺ｧ蟆乗焚蛹・
 * - ACTIVITY 縺ｯ elasticity繝ｻbaseOverride 繧定・・縺励、CQ/ARPU/CHURN 縺ｫ驟榊・
 * - COST_VARIABLE 縺ｯ蜊倅ｽ阪′・・豈皮紫縺ｪ繧・cogsRate・育紫ﾎ費ｼ峨√◎縺・〒縺ｪ縺代ｌ縺ｰ variable_cost・磯≡鬘歳費ｼ・
 *
 * 笘・KR繧ｼ繝ｭ謇ｱ縺・・
 * - krs 縺・0 莉ｶ縺ｮ縺ｨ縺阪・縲∝・譛溷喧縺励◆ deltas・亥・鬆・岼0・峨・縺ｾ縺ｾ return縲・
 *   竊・simulateMonthlyPL 蛛ｴ縺ｧ縲後ョ繝ｫ繧ｿ辟｡縺暦ｼ昴・繝ｼ繧ｹPL縺昴・縺ｾ縺ｾ縲阪→蛻､螳壹＆繧後ｋ縲・
 */
export function buildBridgeDeltas(input: BridgeInput): DeltasByMonth {
  const { startYm, endYm, krs, base, config } = input;
  const months = ymRange(startYm, endYm);

  const deltas: DeltasByMonth = {
    revenue: initDelta(months),
    acq: initDelta(months),
    arpu: initDelta(months),
    churn: initDelta(months),
    retention: initDelta(months),
    fixed_cost: initDelta(months),
    variable_cost: initDelta(months),
    cogsRate: initDelta(months),
    personnel_cost: initDelta(months),
    invest: initDelta(months),
    synergy: initDelta(months),
    success_rate: initDelta(months),
  };

  const safeKrs: BridgeKR[] = Array.isArray(krs) ? krs : [];

  // 笘・％縺薙′莉雁屓霑ｽ蜉縺励◆繧ｬ繝ｼ繝俄・
  // 竊・OKR・域ｧ矩蛹訪R・峨′1莉ｶ繧ら┌縺・ｴ蜷・
  //    = 縲薫KR繧ｼ繝ｭ縺ｮ雋｡蜍吶す繝溘Η繝ｬ繝ｼ繧ｷ繝ｧ繝ｳ縲阪〒縺ｯ
  //    deltas 縺ｯ蜈ｨ縺ｦ 0 縺ｮ縺ｾ縺ｾ霑斐☆縲・
  if (safeKrs.length === 0) {
    return deltas;
  }

  const activityDefault: ActivityMapping = config?.activityDefault ?? 'ACQ';

  for (const kr of safeKrs) {
    const applyMonths = getApplyMonths(startYm, endYm, kr);
    if (!applyMonths.length) continue;

    const baseVal = resolveBaseValue(kr, base);

    switch (kr.kind) {
      case 'REVENUE': {
        // 逶ｴ謗･ 螢ｲ荳翫↓蜉邂暦ｼ亥・・・
        applyAdd(deltas.revenue, kr.target, applyMonths, kr.weight);
        break;
      }
      case 'ACQ': {
        // 譁ｰ隕冗佐蠕玲焚・夲ｼ・・蜉帙↑繧会ｼ域ｯ肴焚ﾃ怜牡蜷茨ｼ峨∵焚蛟､縺ｪ繧峨◎縺ｮ縺ｾ縺ｾ
        const isPct = isPercentUnit(kr.unit);
        const delta = isPct && typeof baseVal === 'number'
          ? baseVal * normalizeByUnit(kr.target, kr.unit)
          : kr.target;
        applyAdd(deltas.acq, delta, applyMonths, kr.weight);
        break;
      }
      case 'ARPU': {
        // 蜊倅ｾ｡・夲ｼ・・蜉帙↑繧会ｼ・RPU蝓ｺ貅姪怜牡蜷茨ｼ峨∵焚蛟､縺ｪ繧蛾≡鬘歳・
        const isPct = isPercentUnit(kr.unit);
        const arpuBase = typeof baseVal === 'number' ? baseVal : nz(base.arpu, 0);
        const delta = isPct ? arpuBase * normalizeByUnit(kr.target, kr.unit) : kr.target;
        applyAdd(deltas.arpu, delta, applyMonths, kr.weight);
        break;
      }
      case 'CHURN': {
        // 隗｣邏・紫・夲ｼ・・蜉帙↑繧牙ｰ乗焚縺ｸ豁｣隕丞喧・・%竊・.05・峨よ隼蝟・・雋蛟､縺ｧ蜈･蜉帙☆繧矩°逕ｨ縲・
        const delta = normalizeByUnit(kr.target, kr.unit);
        applyAdd(deltas.churn, delta, applyMonths, kr.weight);
        break;
      }
      case 'COST_FIXED': {
        applyAdd(deltas.fixed_cost, kr.target, applyMonths, kr.weight);
        break;
      }
      case 'COST_VARIABLE': {
        // 蜊倅ｽ阪′・・豈皮紫縺ｪ繧峨悟､牙虚雋ｻ邇・費ｼ・ogsRate・峨阪√◎繧御ｻ･螟悶・驥鷹｡歳・
        if (isPercentUnit(kr.unit)) {
          const dRate = normalizeByUnit(kr.target, kr.unit);
          applyAdd(deltas.cogsRate, dRate, applyMonths, kr.weight);
        } else {
          applyAdd(deltas.variable_cost, kr.target, applyMonths, kr.weight);
        }
        break;
      }
      case 'PERSONNEL': {
        applyAdd(deltas.personnel_cost, kr.target, applyMonths, kr.weight);
        break;
      }
      case 'INVEST': {
        applyAdd(deltas.invest, kr.target, applyMonths, kr.weight);
        break;
      }
      case 'SUCCESS_RATE': {
        // 謌仙粥邇・ｼ・邇・ｼ会ｼ夲ｼ・・蜉帙↑繧牙ｰ乗焚蛹・
        const delta = normalizeByUnit(kr.target, kr.unit);
        applyAdd(deltas.success_rate, delta, applyMonths, kr.weight);
        break;
      }
      case 'SYNERGY': {
        // 逶ｸ荵怜柑譫懶ｼ・邇・ｼ会ｼ夲ｼ・・蜉帙↑繧牙ｰ乗焚蛹・
        const delta = normalizeByUnit(kr.target, kr.unit);
        applyAdd(deltas.synergy, delta, applyMonths, kr.weight);
        break;
      }
      case 'ACTIVITY': {
        // 豢ｻ蜍・竊・荳ｻ隕゜PI縺ｸ・・lasticity 縺ｧ諢溷ｺｦ繧呈寺縺代ｋ・・
        const route: ActivityMapping =
          (config?.activityRoute && config.activityRoute[kr.label]) ?? activityDefault;

        // 蜈･蜉帛､縺ｮ豁｣隕丞喧・夲ｼ・↑繧牙ｰ乗焚蛹・
        const inputVal = normalizeByUnit(kr.target, kr.unit);
        const e = typeof kr.elasticity === 'number' ? kr.elasticity : 1;

        let delta: number;
        if (isPercentUnit(kr.unit)) {
          // 豈肴焚ﾃ怜牡蜷暗玲─蠎ｦ・域ｯ肴焚縺檎┌縺代ｌ縺ｰ窶懷牡蜷暗玲─蠎ｦ窶昴□縺托ｼ・
          if (typeof baseVal === 'number') delta = baseVal * inputVal * e;
          else delta = inputVal * e;
        } else {
          // 莉ｶ/莠ｺ/驥鷹｡・遲峨・窶懈焚驥湘玲─蠎ｦ窶・
          delta = inputVal * e;
        }

        if (route === 'ACQ') applyAdd(deltas.acq, delta, applyMonths, kr.weight);
        if (route === 'ARPU') applyAdd(deltas.arpu, delta, applyMonths, kr.weight);
        if (route === 'CHURN') {
          // CHURN 譁ｹ蜷代・豢ｻ蜍包ｼ單elta 繧偵◎縺ｮ縺ｾ縺ｾ隗｣邏・紫ﾎ斐↓蜉邂暦ｼ域隼蝟・・雋縺ｧ蜈･蜉幢ｼ・
          applyAdd(deltas.churn, delta, applyMonths, kr.weight);
        }
        break;
      }
      default:
        // 蟆・擂諡｡蠑ｵ・壽悴遏･Kind縺ｯ辟｡隕・
        break;
    }
  }

  return deltas;
}

/* ========== 陬懷勧・壼粋邂・髮・ｨ医Θ繝ｼ繝・ぅ繝ｪ繝・ぅ ========== */
export function sumDelta(delta: Record<Ym, number>): number {
  return Object.values(delta).reduce((a, b) => a + b, 0);
}

export function monthsBetween(startYm: Ym, endYm: Ym) {
  return ymRange(startYm, endYm).length;
}

/* =========================================================
 * 莠呈鋤: financeAdapter.ts 縺ｧ蛻ｩ逕ｨ縺励※縺・ｋ縲憩xtractBaseAndLevers縲阪ｒ謠蝉ｾ・
 * ---------------------------------------------------------
 * - 3蟷ｴ繧ｷ繝溘Η繝ｬ繝ｼ繧ｷ繝ｧ繝ｳ逕ｨ縺ｮ雜・ｻｽ驥乗歓蜃ｺ蝎ｨ
 * - StrategyData 縺九ｉ繝吶・繧ｹ謨ｰ蛟､縺ｨ邁｡譏薙Ξ繝舌・驟榊・繧貞叙繧雁・縺・
 * - 譌｢蟄倥さ繝ｼ繝我ｺ呈鋤縺ｮ縺溘ａ default export 繧ゅ％縺ｮ髢｢謨ｰ縺ｫ蜑ｲ繧雁ｽ薙※
 * ========================================================= */

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
 * StrategyData 竊・{ base, levers }・亥ｮ牙・繝・ヵ繧ｩ繝ｫ繝茨ｼ・
 * - financeSummary[0] 縺九ｉ螢ｲ荳・蝟ｶ讌ｭ逶・謌宣聞邇・蛻ｩ逶顔紫繧呈耳螳・
 * - departments[].projects[] 縺九ｉ繝ｬ繝舌・蛟呵｣懊ｒ謚ｽ蜃ｺ・井ｻｻ諢上・謨ｰ蛟､縺後≠繧後・蜿肴丐・・
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
        (row0.sales ? ((toNum(row0.op) / Math.max(1, toNum(row0.sales))) * 100) : 0)
    ),
  };

  // 驛ｨ髢繝ｻ繝励Ο繧ｸ繧ｧ繧ｯ繝医°繧芽ｻｽ驥上↑繝ｬ繝舌・謚ｽ蜃ｺ
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

// 莠呈鋤縺ｮ縺溘ａ default 繧ゅ％縺ｮ髢｢謨ｰ繧偵お繧ｯ繧ｹ繝昴・繝・
export default extractBaseAndLevers;
