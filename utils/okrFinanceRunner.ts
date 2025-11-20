// /utils/okrFinanceRunner.ts
// ----------------------------------------------------------
// 目的：StrategyData 内の「構造化OKR(KRStructured)」を、
//       現在のファイナンスデータ（financeSummary）をベースに
//       simulationBridge + financeSimulation へつなぎ、
//       月次 / 年次のPLシミュレーション結果を返す。
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
 * 型定義
 * =======================================================*/

export type OkrFinanceOptions = {
  /** シミュレーション開始Ym（例: '2026-01'）。未指定なら現在年の1月始まり。 */
  startYm?: Ym;
  /** シミュレーション終了Ym（例: '2028-12'）。未指定なら開始年+2年の12月。 */
  endYm?: Ym;
  /** 相乗効果を売上だけに掛けるか、コストにも掛けるか */
  applySynergyTo?: Array<'revenue' | 'cost'>;
  /** 投資を何割当期費用化するか（0〜1）。デフォルト1.0（全額費用扱い）。 */
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
    /** 何かしらシミュレーションできなかった場合の理由メモ（あれば） */
    warning?: string;
  };
};

/* =========================================================
 * YMユーティリティ
 * =======================================================*/

function ymToYearMonth(y: Ym) {
  const [Y, M] = y.split('-').map(Number);
  return { Y, M };
}
function pad(n: number) {
  return n < 10 ? `0${n}` : String(n);
}
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

/* =========================================================
 * FinanceSummary からベース軌道/BaseFiguresを組み立て
 * ---------------------------------------------------------
 * 前提：strategy.financeSummary は YearRow[] 相当:
 *   { yearLabel: string; sales: number; cogs?: number; sga?: number; operatingProfit?: number }
 * 無い場合は「ごく簡易なデフォルト」を作る。
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

function buildBaseFromFinanceSummary(
  strategy: StrategyData,
  startYm: Ym,
  endYm: Ym,
): { baseFigures: BaseFigures; trajectory: BaseTrajectory; hasFinanceSummary: boolean } {
  const fs: FinanceRow[] = Array.isArray((strategy as any)?.financeSummary)
    ? ((strategy as any).financeSummary as FinanceRow[])
    : [];

  // 基準行：とりあえず最初の行を基準とする（Y0想定）
  const row0: FinanceRow | undefined = fs[0];

  // 売上・コストがなければ簡易デフォルト（小さめの数値で動かす）
  const hasFinanceSummary: boolean = Boolean(row0 && (row0.sales ?? row0.revenue));
  const annualRevenue = hasFinanceSummary
    ? Number(row0!.sales ?? row0!.revenue ?? 0) || 0
    : 120_000_000; // 年間1.2億を仮定（10M/月）

  // 営業利益があればそこから粗利／販管費を近似
  const annualOp = hasFinanceSummary
    ? Number(row0!.operatingProfit ?? row0!.op ?? 0) || 0
    : annualRevenue * 0.1; // 利益率10%想定

  // cogs, sga があればそれを使う。無ければ適当に 50/40/10 の比率に分解。
  let annualCogs = Number(row0?.cogs ?? 0);
  let annualSga = Number(row0?.sga ?? 0);

  if (!annualCogs && !annualSga) {
    // 粗利=売上の50%、販管費=売上の40%、営業利益=残り10%くらいの簡易モデル
    annualCogs = annualRevenue * 0.5;
    annualSga = annualRevenue * 0.4;
  } else if (!annualSga) {
    // cogsだけある場合：opを考慮して販管費を逆算
    annualSga = Math.max(0, annualRevenue - annualCogs - annualOp);
  } else if (!annualCogs) {
    // sgaだけある場合：同様に逆算
    annualCogs = Math.max(0, annualRevenue - annualSga - annualOp);
  }

  const months = ymRange(startYm, endYm);
  const monthsPerYear = 12;

  // 単純に年間値を12で割って月次へ展開
  const monthlyRevenue = annualRevenue / monthsPerYear;
  const monthlyCogs = annualCogs / monthsPerYear;
  const monthlySga = annualSga / monthsPerYear;

  // SG&A を固定費／人件費にざっくり分割（6:4）
  const monthlyFixed = monthlySga * 0.6;
  const monthlyPersonnel = monthlySga * 0.4;

  // qty と arpu は「qty=1、arpu=売上」という単純モデル
  const qtyMonthly: Record<Ym, number> = {};
  const arpuMonthly: Record<Ym, number> = {};
  const churnMonthly: Record<Ym, number> = {};
  const fixedCostMonthly: Record<Ym, number> = {};
  const variableCostMonthly: Record<Ym, number> = {};
  const personnelCostMonthly: Record<Ym, number> = {};
  const revenueMonthly: Record<Ym, number> = {};

  for (const ym of months) {
    qtyMonthly[ym] = 1;
    arpuMonthly[ym] = monthlyRevenue;   // qty(=1)×arpu で売上に合う
    churnMonthly[ym] = 0.02;            // 月次解約率2%くらいのデフォルト
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

  const baseFigures: BaseFigures = {
    revenue: monthlyRevenue,          // 1ヶ月分
    acq: 100,                         // 月次の基準新規獲得数（仮: 100）。
    arpu: monthlyRevenue,             // qty=1前提の平均単価
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
 * StrategyData → BridgeKR[] 抽出
 * ---------------------------------------------------------
 * departments[].projects[].okrs[].structuredKrs[] を想定。
 * types/strategy.ts の KRStructured と simulationBridge.BridgeKR を
 * 1対1にマッピングする。
 * =======================================================*/

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
      const okrs: any[] = Array.isArray(p?.okrs) ? p.okrs : [];

      for (const okr of okrs) {
        const structured: KRStructured[] = Array.isArray(okr?.structuredKrs)
          ? (okr.structuredKrs as KRStructured[])
          : [];

        structured.forEach((kr, idx) => {
          const bridge: BridgeKR = {
            id: kr.id || `${depName}:${projTitle}:${idx}`,
            kind: kr.kind,
            label: kr.label ?? kr.kind,
            target: typeof kr.target === 'number' ? kr.target : Number(kr.target ?? 0) || 0,
            unit: kr.unit,
            scope: kr.scope ?? 'project',
            baseKey: kr.baseKey ?? 'revenue',
            baseOverride:
              typeof kr.baseOverride === 'number'
                ? kr.baseOverride
                : (kr.baseOverride != null ? Number(kr.baseOverride) : undefined),
            weight: typeof kr.weight === 'number' ? kr.weight : undefined,
            elasticity: typeof kr.elasticity === 'number' ? kr.elasticity : undefined,
            lagMonths: typeof kr.lagMonths === 'number' ? kr.lagMonths : undefined,
            startYm: kr.startYm,
            due: kr.due,
            notes: kr.notes,
          };

          out.push(bridge);
        });
      }
    }
  }

  return out;
}

/* =========================================================
 * メイン：StrategyData → OKR連動PLシミュレーション
 * =======================================================*/

export function runOkrFinanceFromStrategy(
  strategy: StrategyData,
  options?: OkrFinanceOptions,
): OkrFinanceResult {
  // 1) 期間決定（デフォルトは「今年〜3年分」）
  const now = new Date();
  const defaultYear = now.getFullYear();
  const startYm: Ym = options?.startYm ?? `${defaultYear}-01`;
  const endYm: Ym =
    options?.endYm ??
    `${defaultYear + 2}-12`; // デフォルトで3年間（Y0〜Y2）相当をカバー

  // 2) FinanceSummary からベース軌道とBaseFiguresを構築
  const { baseFigures, trajectory, hasFinanceSummary } = buildBaseFromFinanceSummary(
    strategy,
    startYm,
    endYm,
  );

  // 3) 構造化KR → BridgeKR[] 抽出
  const krs: BridgeKR[] = collectBridgeKRs(strategy);
  const krsCount = krs.length;

  // KRが一つもない場合でも、基準PL自体は出せるが、
  // 「OKR連動」という意味では警告を付けて返す。
  if (krsCount === 0) {
    // deltas=0のまま simulate しても良いが、ここでは明示的に baseline のみ返す
    const deltasZero: DeltasByMonth = (() => {
      const months = ymRange(startYm, endYm);
      const init = (ms: Ym[]) =>
        ms.reduce((acc, ym) => {
          acc[ym] = 0;
          return acc;
        }, {} as Record<Ym, number>);
      return {
        revenue: init(months),
        acq: init(months),
        arpu: init(months),
        churn: init(months),
        retention: init(months),
        fixed_cost: init(months),
        variable_cost: init(months),
        cogsRate: init(months),
        personnel_cost: init(months),
        invest: init(months),
        synergy: init(months),
        success_rate: init(months),
      };
    })();

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
          '構造化KRが1件もないため、OKRによる変化は反映されていません（ベースラインのみ）。',
      },
    };
  }

  // 4) BridgeInput を構成して月次デルタを算出
  const bridgeInput: BridgeInput = {
    startYm,
    endYm,
    krs,
    base: baseFigures,
    config: {
      activityDefault: 'ACQ',
      activityRoute: {
        // ラベル名に応じて上書きしたければここに記述
        // 例: '訪問件数': 'ACQ'
      },
    },
  };

  const deltas = buildBridgeDeltas(bridgeInput);

  // 5) simulateMonthlyPL / aggregateYearly でPL計算
  const monthly = simulateMonthlyPL(trajectory, deltas, {
    applySynergyTo: options?.applySynergyTo ?? ['revenue'],
    investEffectAlpha: options?.investEffectAlpha ?? 1.0,
  });

  const yearly = aggregateYearly(monthly);

  // 6) 結果を返却
  const metaWarning = !hasFinanceSummary
    ? 'financeSummary が未設定のため、デフォルトの仮定値でベースラインを構築しています。'
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
