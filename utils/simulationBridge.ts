// /utils/simulationBridge.ts

/* =========================================================
 * OKR（構造化） → 主要KPIの月次デルタへブリッジ
 * ---------------------------------------------------------
 * - KRKind ごとに ACQ/ARPU/CHURN/費用/投資/相乗/成功率/売上 を月次増減へ変換
 * - ACTIVITY は elasticity と lagMonths を用いて主要KPIへ変換
 * - 期間は 'YYYY-MM'（Ym）で扱い、startYm〜endYm を含む
 * - financeSimulation.ts 側に渡してPLを算出
 * ========================================================= */

import type { StrategyData } from '@/types/strategy';

export type Ym = string; // 'YYYY-MM'

// 主要KPI母数（必要に応じて拡張可）
export type BaseFigures = {
  revenue?: number;        // 売上（ベースの参考値、未使用でも可）
  acq?: number;            // 月次新規獲得の基準（活動→ACQで使うことも）
  arpu?: number;           // 基準単価
  churn?: number;          // 月次解約率（0.02=2%）
  fixed_cost?: number;     // 固定費
  variable_cost?: number;  // 変動費
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
  // 成功率や相乗の扱い拡張余地（将来）
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
  churn: Record<Ym, number>;         // +率（負方向はマイナス）
  fixed_cost: Record<Ym, number>;    // +円
  variable_cost: Record<Ym, number>; // +円
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

/* ========== Core Bridge ========== */
/**
 * 構造化OKR → 主要KPIの月次デルタへ変換（最小ロジック）
 * - target の解釈はシンプルに「加算」前提（率はそのまま率の加算）
 * - より高度な％→金額変換は financeSimulation.ts 側で扱う
 */
export function buildBridgeDeltas(input: BridgeInput): DeltasByMonth {
  const { startYm, endYm, krs, base, config } = input;
  const months = ymRange(startYm, endYm);

  const deltas: DeltasByMonth = {
    revenue: initDelta(months),
    acq: initDelta(months),
    arpu: initDelta(months),
    churn: initDelta(months),
    fixed_cost: initDelta(months),
    variable_cost: initDelta(months),
    personnel_cost: initDelta(months),
    invest: initDelta(months),
    synergy: initDelta(months),
    success_rate: initDelta(months),
  };

  const activityDefault: ActivityMapping = config?.activityDefault ?? 'ACQ';

  const pickBase = (key: BridgeKR['baseKey']): number | undefined => {
    switch (key) {
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
  };

  const applyAdd = (bucket: keyof DeltasByMonth, val: number, applyMonths: Ym[], weight?: number) => {
    const w = typeof weight === 'number' ? weight : 1;
    for (const ym of applyMonths) deltas[bucket][ym] += val * w;
  };

  for (const kr of krs) {
    // 適用期間（個別 startYm / due があればそれを優先）
    const kStart = kr.startYm ?? startYm;
    const kDue = kr.due ? kr.due.slice(0, 7) : endYm; // 'YYYY-MM' 期待
    const lag = kr.lagMonths ?? 0;
    let applyMonths = ymRange(kStart, kDue);

    // 遅行（lag）分だけ先送り（期間外は切り捨て）
    for (let i = 0; i < lag; i++) {
      applyMonths = applyMonths.map(m => nextYm(m)).filter(m => m <= endYm);
    }

    // baseOverride があればそれを優先、無ければ baseFigures を参照
    const baseVal = typeof kr.baseOverride === 'number'
      ? kr.baseOverride
      : pickBase(kr.baseKey);

    switch (kr.kind) {
      case 'REVENUE': {
        // 直接 売上に加算（円）
        applyAdd('revenue', kr.target, applyMonths, kr.weight);
        break;
      }
      case 'ACQ': {
        // 新規獲得数（+件）
        applyAdd('acq', kr.target, applyMonths, kr.weight);
        break;
      }
      case 'ARPU': {
        // 単価（+円）
        applyAdd('arpu', kr.target, applyMonths, kr.weight);
        break;
      }
      case 'CHURN': {
        // 解約率（+率）※ 改善なら負値にする運用
        applyAdd('churn', kr.target, applyMonths, kr.weight);
        break;
      }
      case 'COST_FIXED': {
        applyAdd('fixed_cost', kr.target, applyMonths, kr.weight);
        break;
      }
      case 'COST_VARIABLE': {
        applyAdd('variable_cost', kr.target, applyMonths, kr.weight);
        break;
      }
      case 'PERSONNEL': {
        applyAdd('personnel_cost', kr.target, applyMonths, kr.weight);
        break;
      }
      case 'INVEST': {
        applyAdd('invest', kr.target, applyMonths, kr.weight);
        break;
      }
      case 'SUCCESS_RATE': {
        // 成功率（+率）→ finance側で投資効果と掛け合わせる想定
        applyAdd('success_rate', kr.target, applyMonths, kr.weight);
        break;
      }
      case 'SYNERGY': {
        // 相乗効果（+率）→ finance側で収益やコストへ係数適用
        applyAdd('synergy', kr.target, applyMonths, kr.weight);
        break;
      }
      case 'ACTIVITY': {
        // 活動 → 主要KPIに変換（elasticity を用いて近似）
        // - unit が '%' の場合は baseVal を掛けて“増分”へ
        // - unit が COUNT 系ならそのまま増分値として扱う
        const route: ActivityMapping =
          config?.activityRoute?.[kr.label] ?? activityDefault;

        // 活動の目標量を“数値増分”に正規化
        let delta = kr.target;
        const e = kr.elasticity ?? 1; // 感度（未指定=1）
        if (kr.unit === '%' || kr.unit === '比率') {
          // baseVal があるときは baseVal * 率 * 感度
          if (typeof baseVal === 'number') {
            delta = baseVal * kr.target * e;
          } else {
            // 母数が無ければ“割合”をそのまま主要KPIの率に利用
            delta = kr.target * e;
          }
        } else {
          // COUNT/件/人 など → そのまま感度倍
          delta = kr.target * e;
        }

        if (route === 'ACQ') applyAdd('acq', delta, applyMonths, kr.weight);
        if (route === 'ARPU') applyAdd('arpu', delta, applyMonths, kr.weight);
        if (route === 'CHURN') applyAdd('churn', delta, applyMonths, kr.weight);
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
