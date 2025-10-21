// /utils/simulationBridge.ts

/* =========================================================
 * OKR（構造化） → 主要KPIの月次デルタへブリッジ（進化版）
 * ---------------------------------------------------------
 * - KRKind ごとに ACQ/ARPU/CHURN/費用/投資/相乗/成功率/売上 を月次増減へ変換
 * - ACTIVITY は elasticity と lagMonths を用いて主要KPIへ変換
 * - ％単位は小数へ正規化（5% => 0.05）
 * - COST_VARIABLE は「金額」or「率（cogsRate）」を単位で自動判定
 * - 期間は 'YYYY-MM'（Ym）で扱い、startYm〜endYm を含む
 * - financeSimulation.ts 側に渡してPLを算出
 * ========================================================= */

import type { StrategyData } from '@/types/strategy';

export type Ym = string; // 'YYYY-MM'

// 主要KPI母数（必要に応じて拡張可）
export type BaseFigures = {
  revenue?: number;        // 売上（参考）
  acq?: number;            // 月次新規獲得の基準
  arpu?: number;           // 基準単価
  churn?: number;          // 月次解約率（0.02=2%）
  fixed_cost?: number;     // 固定費
  variable_cost?: number;  // 変動費（ベース金額）
  personnel_cost?: number; // 人件費
  invest?: number;         // 投資額
  success_rate?: number;   // 成功率
  synergy?: number;        // 相乗係数
};

export type ActivityMapping = 'ACQ' | 'ARPU' | 'CHURN';

// 画面・会社別のデフォルト挙動
export type BridgeConfig = {
  // ACTIVITY のデフォルト変換先（省略時は 'ACQ'）
  activityDefault?: ActivityMapping;
  // ラベルや baseKey ごとに変換先を上書き（例：{ '訪問件数': 'ACQ' }）
  activityRoute?: Record<string, ActivityMapping>;
  // 将来拡張用
};

// （types/strategy.ts に合わせる：必要最小限のみ受け取り）
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
  unit?: '%' | '¥' | '件' | '人' | '比率' | string;
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
  elasticity?: number;   // ACTIVITY → 主要KPI の感度
  lagMonths?: number;    // 活動→成果までの遅行
  startYm?: Ym;          // 個別開始（なければ全体 startYm）
  due?: string;          // 'YYYY-MM' or 'YYYY-MM-DD'
  notes?: string;
};

export type BridgeInput = {
  startYm: Ym;     // ブリッジ計算の開始（含む）
  endYm: Ym;       // ブリッジ計算の終了（含む）
  krs: BridgeKR[]; // 構造化KR配列
  base: BaseFigures;
  config?: BridgeConfig;
};

// 主要KPIに対する月次デルタ
export type DeltasByMonth = {
  revenue: Record<Ym, number>;       // +円（ダイレクト加算）
  acq: Record<Ym, number>;           // +件
  arpu: Record<Ym, number>;          // +円（単価）
  churn: Record<Ym, number>;         // +率（悪化は+／改善は-）
  retention: Record<Ym, number>;     // +率（継続率Δを直接使いたい時に利用、未使用なら0）
  fixed_cost: Record<Ym, number>;    // +円
  variable_cost: Record<Ym, number>; // +円（率指定が無いときはこちら）
  cogsRate: Record<Ym, number>;      // +率（変動費率Δ：+で悪化）
  personnel_cost: Record<Ym, number>;// +円
  invest: Record<Ym, number>;        // +円
  synergy: Record<Ym, number>;       // +率
  success_rate: Record<Ym, number>;  // +率
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
  return `${nY}-${pad(nM)}`;
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
  return range.reduce((acc, ym) => { acc[ym] = 0; return acc; }, {} as Record<Ym, number>);
}

/* ========== Helpers ========== */
const nz = (v: any, d = 0) => (typeof v === 'number' && Number.isFinite(v) ? v : d);
const isPercentUnit = (u?: string) => u === '%' || u === '比率';

/** ％入力なら小数へ正規化（5%→0.05） */
function normalizeByUnit(value: number, unit?: string): number {
  const v = nz(value, 0);
  if (isPercentUnit(unit)) return v / 100;
  return v;
}

/** baseOverride があれば最優先、無ければ baseFigures を参照 */
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

/** 適用月配列を算出（lagMonths で後ろ倒し） */
function getApplyMonths(startYm: Ym, endYm: Ym, kr: BridgeKR): Ym[] {
  const kStart = kr.startYm ?? startYm;
  const kDue = kr.due ? kr.due.slice(0, 7) : endYm; // 'YYYY-MM' 期待
  const lag = kr.lagMonths ?? 0;

  let applyMonths = ymRange(kStart, kDue);
  for (let i = 0; i < lag; i++) {
    applyMonths = applyMonths.map(m => nextYm(m)).filter(m => m <= endYm);
  }
  return applyMonths;
}

/** 月次加算（重みがあれば掛ける） */
function applyAdd(bucket: Record<Ym, number>, val: number, applyMonths: Ym[], weight?: number) {
  const w = typeof weight === 'number' ? weight : 1;
  const add = nz(val, 0) * w;
  if (add === 0) return;
  for (const ym of applyMonths) bucket[ym] += add;
}

/* ========== Core Bridge ========== */
/**
 * 構造化OKR → 主要KPIの月次デルタへ変換
 * - 率系は normalizeByUnit で小数化
 * - ACTIVITY は elasticity・baseOverride を考慮し、ACQ/ARPU/CHURN に配分
 * - COST_VARIABLE は単位が％/比率なら cogsRate（率Δ）、そうでなければ variable_cost（金額Δ）
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

  const activityDefault: ActivityMapping = config?.activityDefault ?? 'ACQ';

  for (const kr of krs) {
    const applyMonths = getApplyMonths(startYm, endYm, kr);
    const baseVal = resolveBaseValue(kr, base);

    switch (kr.kind) {
      case 'REVENUE': {
        // 直接 売上に加算（円）
        applyAdd(deltas.revenue, kr.target, applyMonths, kr.weight);
        break;
      }
      case 'ACQ': {
        // 新規獲得数：％入力なら（母数×割合）、数値ならそのまま
        const isPct = isPercentUnit(kr.unit);
        const delta = isPct && typeof baseVal === 'number'
          ? baseVal * normalizeByUnit(kr.target, kr.unit)
          : kr.target;
        applyAdd(deltas.acq, delta, applyMonths, kr.weight);
        break;
      }
      case 'ARPU': {
        // 単価：％入力なら（ARPU基準×割合）、数値なら金額Δ
        const isPct = isPercentUnit(kr.unit);
        const arpuBase = typeof baseVal === 'number' ? baseVal : nz(base.arpu, 0);
        const delta = isPct ? arpuBase * normalizeByUnit(kr.target, kr.unit) : kr.target;
        applyAdd(deltas.arpu, delta, applyMonths, kr.weight);
        break;
      }
      case 'CHURN': {
        // 解約率：％入力なら小数へ正規化（5%→0.05）。改善は負値で入力する運用。
        const delta = normalizeByUnit(kr.target, kr.unit);
        applyAdd(deltas.churn, delta, applyMonths, kr.weight);
        break;
      }
      case 'COST_FIXED': {
        applyAdd(deltas.fixed_cost, kr.target, applyMonths, kr.weight);
        break;
      }
      case 'COST_VARIABLE': {
        // 単位が％/比率なら「変動費率Δ（cogsRate）」、それ以外は金額Δ
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
        // 成功率（+率）：％入力なら小数化
        const delta = normalizeByUnit(kr.target, kr.unit);
        applyAdd(deltas.success_rate, delta, applyMonths, kr.weight);
        break;
      }
      case 'SYNERGY': {
        // 相乗効果（+率）：％入力なら小数化
        const delta = normalizeByUnit(kr.target, kr.unit);
        applyAdd(deltas.synergy, delta, applyMonths, kr.weight);
        break;
      }
      case 'ACTIVITY': {
        // 活動 → 主要KPIへ（elasticity で感度を掛ける）
        const route: ActivityMapping =
          (config?.activityRoute && config.activityRoute[kr.label]) ?? activityDefault;

        // 入力値の正規化：％なら小数化
        const input = normalizeByUnit(kr.target, kr.unit);
        const e = typeof kr.elasticity === 'number' ? kr.elasticity : 1;

        let delta: number;
        if (isPercentUnit(kr.unit)) {
          // 母数×割合×感度（母数が無ければ“割合×感度”だけ）
          if (typeof baseVal === 'number') delta = baseVal * input * e;
          else delta = input * e;
        } else {
          // 件/人/金額 等は“数量×感度”
          delta = input * e;
        }

        if (route === 'ACQ') applyAdd(deltas.acq, delta, applyMonths, kr.weight);
        if (route === 'ARPU') applyAdd(deltas.arpu, delta, applyMonths, kr.weight);
        if (route === 'CHURN') {
          // CHURN 方向の活動：delta をそのまま解約率Δに加算（改善は負で入力）
          applyAdd(deltas.churn, delta, applyMonths, kr.weight);
        }
        break;
      }
      default:
        // 将来拡張：未知Kindは無視
        break;
    }
  }

  return deltas;
}

/* ========== 補助：合算/集計ユーティリティ ========== */
export function sumDelta(delta: Record<Ym, number>): number {
  return Object.values(delta).reduce((a, b) => a + b, 0);
}

export function monthsBetween(startYm: Ym, endYm: Ym) {
  return ymRange(startYm, endYm).length;
}

/* =========================================================
 * 互換: financeAdapter.ts で利用している「extractBaseAndLevers」を提供
 * ---------------------------------------------------------
 * - 3年シミュレーション用の超軽量抽出器
 * - StrategyData からベース数値と簡易レバー配列を取り出す
 * - 既存コード互換のため default export もこの関数に割り当て
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
 * StrategyData → { base, levers }（安全デフォルト）
 * - financeSummary[0] から売上/営業益/成長率/利益率を推定
 * - departments[].projects[] からレバー候補を抽出（任意の数値があれば反映）
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

  // 部門・プロジェクトから軽量なレバー抽出
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

// 互換のため default もこの関数をエクスポート
export default extractBaseAndLevers;
