// /utils/simulationBridge.ts
// Bridge: KR(OKR) -> monthly deltas for financeSimulation

import type { StrategyData } from '@/types/strategy';

export type Ym = string; // 'YYYY-MM'

export type BaseFigures = {
  revenue?: number;
  acq?: number;
  arpu?: number;
  churn?: number;
  fixed_cost?: number;
  variable_cost?: number;
  personnel_cost?: number;
  invest?: number;
  success_rate?: number;
  synergy?: number;
};

export type ActivityMapping = 'ACQ' | 'ARPU' | 'CHURN';

export type BridgeConfig = {
  activityDefault?: ActivityMapping;
  activityRoute?: Record<string, ActivityMapping>;
};

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
  unit?: '%' | 'JPY' | 'people' | 'items' | string;
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
  elasticity?: number;
  lagMonths?: number;
  startYm?: Ym;
  due?: string; // 'YYYY-MM' or 'YYYY-MM-DD'
  notes?: string;
  projectKey?: string; // プロジェクトキー（executionWeight 参照用）
};

export type BridgeInput = {
  startYm: Ym;
  endYm: Ym;
  krs: BridgeKR[];
  base: BaseFigures;
  config?: BridgeConfig;
};

export type DeltasByMonth = {
  revenue: Record<Ym, number>;
  acq: Record<Ym, number>;
  arpu: Record<Ym, number>;
  churn: Record<Ym, number>;
  retention: Record<Ym, number>;
  fixed_cost: Record<Ym, number>;
  variable_cost: Record<Ym, number>;
  cogsRate: Record<Ym, number>;
  personnel_cost: Record<Ym, number>;
  invest: Record<Ym, number>;
  synergy: Record<Ym, number>;
  success_rate: Record<Ym, number>;
};

/* ===== YM helpers ===== */
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
function initDelta(range: Ym[]): Record<Ym, number> {
  return range.reduce((acc, ym) => {
    acc[ym] = 0;
    return acc;
  }, {} as Record<Ym, number>);
}

/* ===== helpers ===== */
const nz = (v: any, d = 0) => (typeof v === 'number' && Number.isFinite(v) ? v : d);
const isPercentUnit = (u?: string) => u === '%' || u === 'percent';

function normalizeByUnit(value: number, unit?: string): number {
  const v = nz(value, 0);
  if (isPercentUnit(unit)) return v / 100;
  return v;
}

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

function getApplyMonths(startYm: Ym, endYm: Ym, kr: BridgeKR): Ym[] {
  const rawStart = kr.startYm ?? startYm;
  const rawDue = kr.due ? kr.due.slice(0, 7) : endYm;

  const kStart = rawStart < startYm ? startYm : rawStart;
  const kDueClamped = rawDue > endYm ? endYm : rawDue;
  if (kStart > kDueClamped) return [];

  const lag = kr.lagMonths ?? 0;

  let applyMonths = ymRange(kStart, kDueClamped);
  for (let i = 0; i < lag; i++) {
    applyMonths = applyMonths.map(nextYm).filter((m) => m <= endYm);
  }
  return applyMonths;
}

function applyAdd(bucket: Record<Ym, number>, val: number, applyMonths: Ym[], weight?: number) {
  const w = typeof weight === 'number' ? weight : 1;
  const add = nz(val, 0) * w;

  // ★ BRIDGE-DEBUG-2: applyAdd の入出力
  if (Math.abs(add) > 1e-9) {
    console.log('[BRIDGE-DEBUG-2] applyAdd processing:', {
      val,
      weight,
      w,
      add,
      applyMonthsCount: applyMonths.length,
    });
  }

  if (add === 0) return;
  for (const ym of applyMonths) {
    if (bucket[ym] === undefined) continue;
    bucket[ym] += add;
  }
}

/* ===== core ===== */
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
  if (safeKrs.length === 0) return deltas;

  const activityDefault: ActivityMapping = config?.activityDefault ?? 'ACQ';

  for (const kr of safeKrs) {
    const applyMonths = getApplyMonths(startYm, endYm, kr);
    if (!applyMonths.length) continue;

    const baseVal = resolveBaseValue(kr, base);

    switch (kr.kind) {
      case 'REVENUE': {
        // ★ ログ：REVENUE 適用
        console.log('[B] REVENUE KR processed:', {
          krLabel: kr.label,
          krTarget: kr.target,
          krWeight: kr.weight,
          applyMonths: applyMonths.slice(0, 3),
          deltaBefore: Object.values(deltas.revenue).slice(0, 3).reduce((a, b) => a + b, 0),
        });
        applyAdd(deltas.revenue, kr.target, applyMonths, kr.weight);
        console.log('[B] REVENUE after add:', {
          deltaAfter: Object.values(deltas.revenue).slice(0, 3).reduce((a, b) => a + b, 0),
        });
        break;
      }
      case 'ACQ': {
        const isPct = isPercentUnit(kr.unit);
        const normalized = normalizeByUnit(kr.target, kr.unit);

        // ★ FIX: ACQ が % の場合は「改善率そのもの」を delta とする
        // （baseVal * normalized は誤り。baseVal=1000 は revenue/cogs の比率で、ACQ母数ではない）
        // 改善率 % を financeSimulation に渡し、そこで baseQty に対して適用する
        const delta = isPct ? normalized : kr.target;

        // ★ BRIDGE-DEBUG-1: ACQ case の詳細
        console.group('[BRIDGE-DEBUG-1] ACQ KR in buildBridgeDeltas (FIXED)');
        console.log({
          krLabel: kr.label,
          krUnit: kr.unit,
          krTarget: kr.target,
          isPct,
          normalized,
          baseVal,
          'baseVal * normalized (old wrong way)': typeof baseVal === 'number' ? baseVal * normalized : 'N/A',
          delta,
          krWeight: kr.weight,
          applyMonthsCount: applyMonths.length,
          applyMonths: applyMonths.slice(0, 3),
        });
        console.log('決定ロジック:', isPct
          ? `isPct=true → delta = normalized (改善率そのもの) = ${delta}`
          : `isPct=false → delta = kr.target = ${delta}`);
        console.groupEnd();

        applyAdd(deltas.acq, delta, applyMonths, kr.weight);
        break;
      }
      case 'ARPU': {
        const isPct = isPercentUnit(kr.unit);
        const arpuBase = typeof baseVal === 'number' ? baseVal : nz(base.arpu, 0);
        const delta = isPct ? arpuBase * normalizeByUnit(kr.target, kr.unit) : kr.target;
        applyAdd(deltas.arpu, delta, applyMonths, kr.weight);
        break;
      }
      case 'CHURN': {
        const delta = normalizeByUnit(kr.target, kr.unit);
        applyAdd(deltas.churn, delta, applyMonths, kr.weight);
        break;
      }
      case 'COST_FIXED': {
        applyAdd(deltas.fixed_cost, kr.target, applyMonths, kr.weight);
        break;
      }
      case 'COST_VARIABLE': {
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
        const delta = normalizeByUnit(kr.target, kr.unit);
        applyAdd(deltas.success_rate, delta, applyMonths, kr.weight);
        break;
      }
      case 'SYNERGY': {
        const delta = normalizeByUnit(kr.target, kr.unit);
        applyAdd(deltas.synergy, delta, applyMonths, kr.weight);
        break;
      }
      case 'ACTIVITY': {
        const route: ActivityMapping =
          (config?.activityRoute && config.activityRoute[kr.label]) ?? activityDefault;

        const inputVal = normalizeByUnit(kr.target, kr.unit);
        const e = typeof kr.elasticity === 'number' ? kr.elasticity : 1;

        let delta: number;
        if (isPercentUnit(kr.unit)) {
          delta = typeof baseVal === 'number' ? baseVal * inputVal * e : inputVal * e;
        } else {
          delta = inputVal * e;
        }

        if (route === 'ACQ') applyAdd(deltas.acq, delta, applyMonths, kr.weight);
        if (route === 'ARPU') applyAdd(deltas.arpu, delta, applyMonths, kr.weight);
        if (route === 'CHURN') applyAdd(deltas.churn, delta, applyMonths, kr.weight);
        break;
      }
      default:
        break;
    }
  }

  // ★ BRIDGE-DEBUG-3: deltas の最終状態（最初のプロジェクト対象）
  const hasAnyAcq = Object.values(deltas.acq).some((v) => Math.abs(v) > 1e-9);
  if (hasAnyAcq) {
    console.group('[BRIDGE-DEBUG-3] buildBridgeDeltas final output (has ACQ delta)');
    console.log('ACQ months sum:', Object.values(deltas.acq).reduce((a, b) => a + b, 0));
    console.log('Revenue months sum:', Object.values(deltas.revenue).reduce((a, b) => a + b, 0));
    console.log('ARPU months sum:', Object.values(deltas.arpu).reduce((a, b) => a + b, 0));
    console.log('First 3 months ACQ:', Object.entries(deltas.acq).slice(0, 3).map(([ym, val]) => ({ ym, acq: val })));
    console.log('First 3 months Revenue:', Object.entries(deltas.revenue).slice(0, 3).map(([ym, val]) => ({ ym, revenue: val })));
    console.groupEnd();
  }

  return deltas;
}

/* ===== small utils ===== */
export function sumDelta(delta: Record<Ym, number>): number {
  return Object.values(delta).reduce((a, b) => a + b, 0);
}

export function monthsBetween(startYm: Ym, endYm: Ym) {
  return ymRange(startYm, endYm).length;
}

/* =========================================================
 * Legacy adapter: extractBaseAndLevers (3-year draft helper)
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

const toNum2 = (v: any, d = 0) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : d;
};

export function extractBaseAndLevers(strategy: StrategyData): {
  base: BaseForThreeYear;
  levers: LeverForThreeYear[];
} {
  const fs: any[] = Array.isArray((strategy as any)?.financeSummary)
    ? (strategy as any).financeSummary
    : [];

  const row0 = fs[0] ?? {};
  const base: BaseForThreeYear = {
    year0Sales: toNum2(row0.sales ?? row0.revenue ?? 0),
    year0Op: toNum2(row0.op ?? row0.operatingProfit ?? 0),
    growthRatePct: toNum2(row0.growthRatePct ?? row0.growth ?? 0),
    opMarginPct: toNum2(
      row0.opMarginPct ??
        (row0.sales ? ((toNum2(row0.op) / Math.max(1, toNum2(row0.sales))) * 100) : 0)
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
