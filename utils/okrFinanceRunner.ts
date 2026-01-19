// /utils/okrFinanceRunner.ts
// ----------------------------------------------------------
// StrategyData から OKR（KRStructured）を抽出し、
// simulationBridge（buildBridgeDeltas） + financeSimulation（simulateMonthlyPL）で
// 月次/年次PLシミュレーションを生成するユーティリティ。
// ----------------------------------------------------------

import type { StrategyData, KRStructured } from '@/types/strategy';
import {
  buildBridgeDeltas,
  type BridgeKR,
  type BaseFigures,
  type BridgeInput,
  type DeltasByMonth,
  type Ym,
} from '@/utils/simulationBridge';
import {
  simulateMonthlyPL,
  aggregateYearly,
  type BaseTrajectory,
  type MonthlyPL,
  type YearlyPL,
} from '@/utils/financeSimulation';

/* =========================================================
 * Options / Result
 * =======================================================*/

export type OkrFinanceOptions = {
  /** シミュレーション開始Ym（例: '2026-01'）。未指定なら「当年-01」 */
  startYm?: Ym;
  /** シミュレーション終了Ym（例: '2028-12'）。未指定なら「当年+2年-12」 */
  endYm?: Ym;
  /** シナジー適用先 */
  applySynergyTo?: Array<'revenue' | 'cost'>;
  /** INVEST を固定費側に反映する係数（financeSimulation 側のオプション） */
  investEffectAlpha?: number;
};

export type OkrFinanceResult = {
  monthly: MonthlyPL[];
  yearly: YearlyPL[];
  meta: {
    startYm: Ym;
    endYm: Ym;
    krsCount: number;
    hasFinanceSummary: boolean;
    baseFigures: BaseFigures;
    warning?: string;
  };
};

/* =========================================================
 * YM utils
 * =======================================================*/

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

/* =========================================================
 * FinanceSummary -> BaseFigures / BaseTrajectory
 * ---------------------------------------------------------
 * financeSummary があればそれをベースに月次の簡易ベースを構築。
 * financeSummary が無い場合は、UIを破綻させないためのダミー前提を使う。
 * =======================================================*/

type FinanceRow = {
  yearLabel?: string;
  sales?: number;
  revenue?: number;
  cogs?: number;
  sga?: number;
  operatingProfit?: number;
  op?: number;
};

const toNum = (v: any, d = 0) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : d;
};

function buildBaseFromFinanceSummary(
  strategy: StrategyData,
  startYm: Ym,
  endYm: Ym,
): { baseFigures: BaseFigures; trajectory: BaseTrajectory; hasFinanceSummary: boolean } {
  const fs: FinanceRow[] = Array.isArray((strategy as any)?.financeSummary)
    ? ((strategy as any).financeSummary as FinanceRow[])
    : [];

  const row0: FinanceRow | undefined = fs[0];

  const hasFinanceSummary = Boolean(row0 && (row0.sales ?? row0.revenue));

  // 年次売上（financeSummary が無ければダミー）
  const annualRevenue = hasFinanceSummary
    ? toNum(row0!.sales ?? row0!.revenue ?? 0, 0)
    : 120_000_000; // 例: 年商1.2億（UIが動くための仮値）

  // 年次営業利益（financeSummary が無ければ売上の10%）
  const annualOp = hasFinanceSummary
    ? toNum(row0!.operatingProfit ?? row0!.op ?? 0, 0)
    : annualRevenue * 0.1;

  // 年次COGS/SGA（無ければ 50/40/10 を仮置き）
  let annualCogs = toNum(row0?.cogs ?? 0, 0);
  let annualSga = toNum(row0?.sga ?? 0, 0);

  if (!annualCogs && !annualSga) {
    annualCogs = annualRevenue * 0.5;
    annualSga = annualRevenue * 0.4;
  } else if (!annualSga) {
    annualSga = Math.max(0, annualRevenue - annualCogs - annualOp);
  } else if (!annualCogs) {
    annualCogs = Math.max(0, annualRevenue - annualSga - annualOp);
  }

  const months = ymRange(startYm, endYm);

  const monthlyRevenue = annualRevenue / 12;
  const monthlyCogs = annualCogs / 12;
  const monthlySga = annualSga / 12;

  // SGA を固定費/人件費へ（簡易 6:4）
  const monthlyFixed = monthlySga * 0.6;
  const monthlyPersonnel = monthlySga * 0.4;

  // financeSimulation の簡易モデルに合わせ、qty=1 / arpu=月次売上 とする
  const qtyMonthly: Record<Ym, number> = {};
  const arpuMonthly: Record<Ym, number> = {};
  const churnMonthly: Record<Ym, number> = {};
  const fixedCostMonthly: Record<Ym, number> = {};
  const variableCostMonthly: Record<Ym, number> = {};
  const personnelCostMonthly: Record<Ym, number> = {};
  const revenueMonthly: Record<Ym, number> = {};

  for (const ym of months) {
    qtyMonthly[ym] = 1;
    arpuMonthly[ym] = monthlyRevenue;
    churnMonthly[ym] = 0.02; // 仮の月次解約率2%
    fixedCostMonthly[ym] = monthlyFixed;
    variableCostMonthly[ym] = monthlyCogs;
    personnelCostMonthly[ym] = monthlyPersonnel;
    revenueMonthly[ym] = monthlyRevenue;
  }

  const trajectory: BaseTrajectory = {
    startYm,
    endYm,
    qtyMonthly,
    arpuMonthly,
    churnMonthly,
    fixedCostMonthly,
    variableCostMonthly,
    personnelCostMonthly,
    revenueMonthly,
  };

  // simulationBridge が参照する「基準値」
  const baseFigures: BaseFigures = {
    revenue: monthlyRevenue,
    acq: 100, // 仮の月次獲得数
    arpu: monthlyRevenue,
    churn: 0.02,
    fixed_cost: monthlyFixed,
    variable_cost: monthlyCogs,
    personnel_cost: monthlyPersonnel,
    invest: 0,
    success_rate: 0.5,
    synergy: 0,
  };

  return { baseFigures, trajectory, hasFinanceSummary };
}

/* =========================================================
 * StrategyData -> BridgeKR[]
 * ---------------------------------------------------------
 * departments[].projects[].okrs[].structuredKrs[] を走査し、
 * simulationBridge.BridgeKR にマッピング。
 * =======================================================*/

function normalizeKind(v: any): BridgeKR['kind'] {
  const s = String(v || '').toUpperCase();
  const allow = new Set<BridgeKR['kind']>([
    'REVENUE',
    'ARPU',
    'ACQ',
    'CHURN',
    'COST_FIXED',
    'COST_VARIABLE',
    'PERSONNEL',
    'INVEST',
    'SUCCESS_RATE',
    'SYNERGY',
    'ACTIVITY',
  ]);
  return (allow.has(s as any) ? (s as BridgeKR['kind']) : 'REVENUE');
}

function normalizeBaseKey(v: any): BridgeKR['baseKey'] {
  const s = String(v || '').toLowerCase();
  const allow = new Set<BridgeKR['baseKey']>([
    'revenue',
    'arpu',
    'acq',
    'churn',
    'fixed_cost',
    'variable_cost',
    'personnel_cost',
    'invest',
    'success_rate',
    'synergy',
  ]);
  return (allow.has(s as any) ? (s as BridgeKR['baseKey']) : 'revenue');
}

function collectBridgeKRs(strategy: StrategyData): BridgeKR[] {
  const out: BridgeKR[] = [];

  const departments: any[] = Array.isArray((strategy as any)?.departments)
    ? ((strategy as any).departments as any[])
    : [];

  for (const dep of departments) {
    const depName: string = (dep?.name ?? '').toString();
    const projects: any[] = Array.isArray(dep?.projects) ? dep.projects : [];

    for (const p of projects) {
      const projTitle: string = (p?.title ?? '').toString();

      // 形式1: okrs[].structuredKrs[] （従来形式）
      const okrs: any[] = Array.isArray(p?.okrs) ? p.okrs : [];
      for (const okr of okrs) {
        const structured: KRStructured[] = Array.isArray(okr?.structuredKrs)
          ? (okr.structuredKrs as KRStructured[])
          : [];

        structured.forEach((kr, idx) => {
          const bridge: BridgeKR = {
            id: (kr as any).id || `${depName}:${projTitle}:${idx}`,
            kind: normalizeKind((kr as any).kind),
            label: ((kr as any).label ?? (kr as any).kind ?? 'KR').toString(),
            target:
              typeof (kr as any).target === 'number'
                ? (kr as any).target
                : Number((kr as any).target ?? 0) || 0,
            unit: (kr as any).unit,
            scope: ((kr as any).scope ?? 'project') as BridgeKR['scope'],
            baseKey: normalizeBaseKey((kr as any).baseKey),
            baseOverride:
              typeof (kr as any).baseOverride === 'number'
                ? (kr as any).baseOverride
                : (kr as any).baseOverride != null
                  ? Number((kr as any).baseOverride)
                  : undefined,
            weight: typeof (kr as any).weight === 'number' ? (kr as any).weight : undefined,
            elasticity:
              typeof (kr as any).elasticity === 'number' ? (kr as any).elasticity : undefined,
            lagMonths:
              typeof (kr as any).lagMonths === 'number' ? (kr as any).lagMonths : undefined,
            startYm: (kr as any).startYm,
            due: (kr as any).due,
            notes: (kr as any).notes,
          };

          out.push(bridge);
        });
      }

      // 形式2: okrsV2[] （新形式: KRStructured の直接配列）
      const okrsV2: any[] = Array.isArray(p?.okrsV2) ? p.okrsV2 : [];
      okrsV2.forEach((kr, idx) => {
        // okrsV2 にはすでに kind/baseKey/target が揃っているので直接使用
        if (!kr || typeof kr.kind !== 'string' || typeof kr.baseKey !== 'string') {
          return; // スキップ
        }

        const bridge: BridgeKR = {
          id: (kr as any).id || `${depName}:${projTitle}:${idx}`,
          kind: normalizeKind((kr as any).kind),
          label: ((kr as any).label ?? (kr as any).kind ?? 'KR').toString(),
          target:
            typeof (kr as any).target === 'number'
              ? (kr as any).target
              : Number((kr as any).target ?? 0) || 0,
          unit: (kr as any).unit,
          scope: ((kr as any).scope ?? 'project') as BridgeKR['scope'],
          baseKey: normalizeBaseKey((kr as any).baseKey),
          baseOverride:
            typeof (kr as any).baseOverride === 'number'
              ? (kr as any).baseOverride
              : (kr as any).baseOverride != null
                ? Number((kr as any).baseOverride)
                : undefined,
          weight: typeof (kr as any).weight === 'number' ? (kr as any).weight : undefined,
          elasticity:
            typeof (kr as any).elasticity === 'number' ? (kr as any).elasticity : undefined,
          lagMonths:
            typeof (kr as any).lagMonths === 'number' ? (kr as any).lagMonths : undefined,
          startYm: (kr as any).startYm,
          due: (kr as any).due,
          notes: (kr as any).notes,
        };

        out.push(bridge);
      });
    }
  }

  return out;
}

/* =========================================================
 * Main
 * =======================================================*/

function createZeroDeltas(startYm: Ym, endYm: Ym): DeltasByMonth {
  const months = ymRange(startYm, endYm);
  const init = () =>
    months.reduce((acc, ym) => {
      acc[ym] = 0;
      return acc;
    }, {} as Record<Ym, number>);

  return {
    revenue: init(),
    acq: init(),
    arpu: init(),
    churn: init(),
    retention: init(),
    fixed_cost: init(),
    variable_cost: init(),
    cogsRate: init(),
    personnel_cost: init(),
    invest: init(),
    synergy: init(),
    success_rate: init(),
  };
}

export function runOkrFinanceFromStrategy(
  strategy: StrategyData,
  options?: OkrFinanceOptions,
): OkrFinanceResult {
  // 1) 期間（デフォルト: 当年〜当年+2年の3年）
  const now = new Date();
  const y = now.getFullYear();
  const startYm: Ym = options?.startYm ?? (`${y}-01` as Ym);
  const endYm: Ym = options?.endYm ?? (`${y + 2}-12` as Ym);

  // 2) financeSummary から baseFigures / trajectory を構築
  const { baseFigures, trajectory, hasFinanceSummary } = buildBaseFromFinanceSummary(
    strategy,
    startYm,
    endYm,
  );

  // 3) KR 抽出
  const krs = collectBridgeKRs(strategy);
  const krsCount = krs.length;

  // 4) KRが無ければ baseline（deltas=0）だけ返す
  if (krsCount === 0) {
    const deltasZero = createZeroDeltas(startYm, endYm);

    const monthly = simulateMonthlyPL(trajectory, deltasZero, {
      applySynergyTo: options?.applySynergyTo ?? ['revenue'],
      investEffectAlpha: options?.investEffectAlpha ?? 1.0,
    });
    const yearly = aggregateYearly(monthly);

    return {
      monthly,
      yearly,
      meta: {
        startYm,
        endYm,
        krsCount,
        hasFinanceSummary,
        baseFigures,
        warning:
          'structuredKrs が存在しないため、ベースライン（差分なし）のPLのみを表示しています。',
      },
    };
  }

  // 5) ブリッジ差分（deltas）を生成
  const bridgeInput: BridgeInput = {
    startYm,
    endYm,
    krs,
    base: baseFigures,
    config: {
      activityDefault: 'ACQ',
      activityRoute: {
        // 必要なら label->route の明示マップを追加
        // 例: '商談数': 'ACQ'
      },
    },
  };

  const deltas = buildBridgeDeltas(bridgeInput);

  // 6) PL シミュレーション
  const monthly = simulateMonthlyPL(trajectory, deltas, {
    applySynergyTo: options?.applySynergyTo ?? ['revenue'],
    investEffectAlpha: options?.investEffectAlpha ?? 1.0,
  });
  const yearly = aggregateYearly(monthly);

  const metaWarning = !hasFinanceSummary
    ? 'financeSummary が未入力のため、仮のベース前提（ダミー）でシミュレーションしています。'
    : undefined;

  return {
    monthly,
    yearly,
    meta: {
      startYm,
      endYm,
      krsCount,
      hasFinanceSummary,
      baseFigures,
      warning: metaWarning,
    },
  };
}

export default runOkrFinanceFromStrategy;
