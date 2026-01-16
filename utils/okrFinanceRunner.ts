// /utils/okrFinanceRunner.ts
// ----------------------------------------------------------
// 逶ｮ逧・ｼ售trategyData 蜀・・縲梧ｧ矩蛹飽KR(KRStructured)縲阪ｒ縲・
//       迴ｾ蝨ｨ縺ｮ繝輔ぃ繧､繝翫Φ繧ｹ繝・・繧ｿ・・inanceSummary・峨ｒ繝吶・繧ｹ縺ｫ
//       simulationBridge + financeSimulation 縺ｸ縺､縺ｪ縺弱・
//       譛域ｬ｡ / 蟷ｴ谺｡縺ｮPL繧ｷ繝溘Η繝ｬ繝ｼ繧ｷ繝ｧ繝ｳ邨先棡繧定ｿ斐☆縲・
// ----------------------------------------------------------

import type { StrategyData, KRStructured } from '@/types/strategy';
import {
  buildBridgeDeltas,
  type BridgeKR,
  type BaseFigures,
  type BridgeInput,
  type DeltasByMonth,
  type Ym,
} from '@/utils/stage6Bridge';
import {
  simulateMonthlyPL,
  aggregateYearly,
  type BaseTrajectory,
  type MonthlyPL,
  type YearlyPL,
} from '@/utils/financeSimulation';

/* =========================================================
 * 蝙句ｮ夂ｾｩ
 * =======================================================*/

export type OkrFinanceOptions = {
  /** 繧ｷ繝溘Η繝ｬ繝ｼ繧ｷ繝ｧ繝ｳ髢句ｧ戯m・井ｾ・ '2026-01'・峨よ悴謖・ｮ壹↑繧臥樟蝨ｨ蟷ｴ縺ｮ1譛亥ｧ九∪繧翫・*/
  startYm?: Ym;
  /** 繧ｷ繝溘Η繝ｬ繝ｼ繧ｷ繝ｧ繝ｳ邨ゆｺ・m・井ｾ・ '2028-12'・峨よ悴謖・ｮ壹↑繧蛾幕蟋句ｹｴ+2蟷ｴ縺ｮ12譛医・*/
  endYm?: Ym;
  /** 逶ｸ荵怜柑譫懊ｒ螢ｲ荳翫□縺代↓謗帙￠繧九°縲√さ繧ｹ繝医↓繧よ寺縺代ｋ縺・*/
  applySynergyTo?: Array<'revenue' | 'cost'>;
  /** 謚戊ｳ・ｒ菴募牡蠖捺悄雋ｻ逕ｨ蛹悶☆繧九°・・縲・・峨ゅョ繝輔か繝ｫ繝・.0・亥・鬘崎ｲｻ逕ｨ謇ｱ縺・ｼ峨・*/
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
    /** 菴輔°縺励ｉ繧ｷ繝溘Η繝ｬ繝ｼ繧ｷ繝ｧ繝ｳ縺ｧ縺阪↑縺九▲縺溷ｴ蜷医・逅・罰繝｡繝｢・医≠繧後・・・*/
    warning?: string;
  };
};

/* =========================================================
 * YM繝ｦ繝ｼ繝・ぅ繝ｪ繝・ぅ
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
 * FinanceSummary 縺九ｉ繝吶・繧ｹ霆碁％/BaseFigures繧堤ｵ・∩遶九※
 * ---------------------------------------------------------
 * 蜑肴署・嘖trategy.financeSummary 縺ｯ YearRow[] 逶ｸ蠖・
 *   { yearLabel: string; sales: number; cogs?: number; sga?: number; operatingProfit?: number }
 * 辟｡縺・ｴ蜷医・縲後＃縺冗ｰ｡譏薙↑繝・ヵ繧ｩ繝ｫ繝医阪ｒ菴懊ｋ縲・
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

  // 蝓ｺ貅冶｡鯉ｼ壹→繧翫≠縺医★譛蛻昴・陦後ｒ蝓ｺ貅悶→縺吶ｋ・・0諠ｳ螳夲ｼ・
  const row0: FinanceRow | undefined = fs[0];

  // 螢ｲ荳翫・繧ｳ繧ｹ繝医′縺ｪ縺代ｌ縺ｰ邁｡譏薙ョ繝輔か繝ｫ繝茨ｼ亥ｰ上＆繧√・謨ｰ蛟､縺ｧ蜍輔°縺呻ｼ・
  const hasFinanceSummary: boolean = Boolean(row0 && (row0.sales ?? row0.revenue));
  const annualRevenue = hasFinanceSummary
    ? Number(row0!.sales ?? row0!.revenue ?? 0) || 0
    : 120_000_000; // 蟷ｴ髢・.2蜆・ｒ莉ｮ螳夲ｼ・0M/譛茨ｼ・

  // 蝟ｶ讌ｭ蛻ｩ逶翫′縺ゅｌ縺ｰ縺昴％縺九ｉ邊怜茜・剰ｲｩ邂｡雋ｻ繧定ｿ台ｼｼ
  const annualOp = hasFinanceSummary
    ? Number(row0!.operatingProfit ?? row0!.op ?? 0) || 0
    : annualRevenue * 0.1; // 蛻ｩ逶顔紫10%諠ｳ螳・

  // cogs, sga 縺後≠繧後・縺昴ｌ繧剃ｽｿ縺・ら┌縺代ｌ縺ｰ驕ｩ蠖薙↓ 50/40/10 縺ｮ豈皮紫縺ｫ蛻・ｧ｣縲・
  let annualCogs = Number(row0?.cogs ?? 0);
  let annualSga = Number(row0?.sga ?? 0);

  if (!annualCogs && !annualSga) {
    // 邊怜茜=螢ｲ荳翫・50%縲∬ｲｩ邂｡雋ｻ=螢ｲ荳翫・40%縲∝霧讌ｭ蛻ｩ逶・谿九ｊ10%縺上ｉ縺・・邁｡譏薙Δ繝・Ν
    annualCogs = annualRevenue * 0.5;
    annualSga = annualRevenue * 0.4;
  } else if (!annualSga) {
    // cogs縺縺代≠繧句ｴ蜷茨ｼ嗤p繧定・・縺励※雋ｩ邂｡雋ｻ繧帝・ｮ・
    annualSga = Math.max(0, annualRevenue - annualCogs - annualOp);
  } else if (!annualCogs) {
    // sga縺縺代≠繧句ｴ蜷茨ｼ壼酔讒倥↓騾・ｮ・
    annualCogs = Math.max(0, annualRevenue - annualSga - annualOp);
  }

  const months = ymRange(startYm, endYm);
  const monthsPerYear = 12;

  // 蜊倡ｴ斐↓蟷ｴ髢灘､繧・2縺ｧ蜑ｲ縺｣縺ｦ譛域ｬ｡縺ｸ螻暮幕
  const monthlyRevenue = annualRevenue / monthsPerYear;
  const monthlyCogs = annualCogs / monthsPerYear;
  const monthlySga = annualSga / monthsPerYear;

  // SG&A 繧貞崋螳夊ｲｻ・丈ｺｺ莉ｶ雋ｻ縺ｫ縺悶▲縺上ｊ蛻・牡・・:4・・
  const monthlyFixed = monthlySga * 0.6;
  const monthlyPersonnel = monthlySga * 0.4;

  // qty 縺ｨ arpu 縺ｯ縲繋ty=1縲∥rpu=螢ｲ荳翫阪→縺・≧蜊倡ｴ斐Δ繝・Ν
  const qtyMonthly: Record<Ym, number> = {};
  const arpuMonthly: Record<Ym, number> = {};
  const churnMonthly: Record<Ym, number> = {};
  const fixedCostMonthly: Record<Ym, number> = {};
  const variableCostMonthly: Record<Ym, number> = {};
  const personnelCostMonthly: Record<Ym, number> = {};
  const revenueMonthly: Record<Ym, number> = {};

  for (const ym of months) {
    qtyMonthly[ym] = 1;
    arpuMonthly[ym] = monthlyRevenue;   // qty(=1)ﾃ預rpu 縺ｧ螢ｲ荳翫↓蜷医≧
    churnMonthly[ym] = 0.02;            // 譛域ｬ｡隗｣邏・紫2%縺上ｉ縺・・繝・ヵ繧ｩ繝ｫ繝・
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
    revenue: monthlyRevenue,          // 1繝ｶ譛亥・
    acq: 100,                         // 譛域ｬ｡縺ｮ蝓ｺ貅匁眠隕冗佐蠕玲焚・井ｻｮ: 100・峨・
    arpu: monthlyRevenue,             // qty=1蜑肴署縺ｮ蟷ｳ蝮・腰萓｡
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
 * StrategyData 竊・BridgeKR[] 謚ｽ蜃ｺ
 * ---------------------------------------------------------
 * departments[].projects[].okrs[].structuredKrs[] 繧呈Φ螳壹・
 * types/strategy.ts 縺ｮ KRStructured 縺ｨ simulationBridge.BridgeKR 繧・
 * 1蟇ｾ1縺ｫ繝槭ャ繝斐Φ繧ｰ縺吶ｋ縲・
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
 * 繝｡繧､繝ｳ・售trategyData 竊・OKR騾｣蜍姫L繧ｷ繝溘Η繝ｬ繝ｼ繧ｷ繝ｧ繝ｳ
 * =======================================================*/

export function runOkrFinanceFromStrategy(
  strategy: StrategyData,
  options?: OkrFinanceOptions,
): OkrFinanceResult {
  // 1) 譛滄俣豎ｺ螳夲ｼ医ョ繝輔か繝ｫ繝医・縲御ｻ雁ｹｴ縲・蟷ｴ蛻・搾ｼ・
  const now = new Date();
  const defaultYear = now.getFullYear();
  const startYm: Ym = options?.startYm ?? `${defaultYear}-01`;
  const endYm: Ym =
    options?.endYm ??
    `${defaultYear + 2}-12`; // 繝・ヵ繧ｩ繝ｫ繝医〒3蟷ｴ髢難ｼ・0縲弸2・臥嶌蠖薙ｒ繧ｫ繝舌・

  // 2) FinanceSummary 縺九ｉ繝吶・繧ｹ霆碁％縺ｨBaseFigures繧呈ｧ狗ｯ・
  const { baseFigures, trajectory, hasFinanceSummary } = buildBaseFromFinanceSummary(
    strategy,
    startYm,
    endYm,
  );

  // 3) 讒矩蛹訪R 竊・BridgeKR[] 謚ｽ蜃ｺ
  const krs: BridgeKR[] = collectBridgeKRs(strategy);
  const krsCount = krs.length;

  // KR縺御ｸ縺､繧ゅ↑縺・ｴ蜷医〒繧ゅ∝渕貅鳳L閾ｪ菴薙・蜃ｺ縺帙ｋ縺後・
  // 縲薫KR騾｣蜍輔阪→縺・≧諢丞袖縺ｧ縺ｯ隴ｦ蜻翫ｒ莉倥￠縺ｦ霑斐☆縲・
  if (krsCount === 0) {
    // deltas=0縺ｮ縺ｾ縺ｾ simulate 縺励※繧り憶縺・′縲√％縺薙〒縺ｯ譏守､ｺ逧・↓ baseline 縺ｮ縺ｿ霑斐☆
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
          '讒矩蛹訪R縺・莉ｶ繧ゅ↑縺・◆繧√＾KR縺ｫ繧医ｋ螟牙喧縺ｯ蜿肴丐縺輔ｌ縺ｦ縺・∪縺帙ｓ・医・繝ｼ繧ｹ繝ｩ繧､繝ｳ縺ｮ縺ｿ・峨・,
      },
    };
  }

  // 4) BridgeInput 繧呈ｧ区・縺励※譛域ｬ｡繝・Ν繧ｿ繧堤ｮ怜・
  const bridgeInput: BridgeInput = {
    startYm,
    endYm,
    krs,
    base: baseFigures,
    config: {
      activityDefault: 'ACQ',
      activityRoute: {
        // 繝ｩ繝吶Ν蜷阪↓蠢懊§縺ｦ荳頑嶌縺阪＠縺溘￠繧後・縺薙％縺ｫ險倩ｿｰ
        // 萓・ '險ｪ蝠丈ｻｶ謨ｰ': 'ACQ'
      },
    },
  };

  const deltas = buildBridgeDeltas(bridgeInput);

  // 5) simulateMonthlyPL / aggregateYearly 縺ｧPL險育ｮ・
  const monthly = simulateMonthlyPL(trajectory, deltas, {
    applySynergyTo: options?.applySynergyTo ?? ['revenue'],
    investEffectAlpha: options?.investEffectAlpha ?? 1.0,
  });

  const yearly = aggregateYearly(monthly);

  // 6) 邨先棡繧定ｿ泌唆
  const metaWarning = !hasFinanceSummary
    ? 'financeSummary 縺梧悴險ｭ螳壹・縺溘ａ縲√ョ繝輔か繝ｫ繝医・莉ｮ螳壼､縺ｧ繝吶・繧ｹ繝ｩ繧､繝ｳ繧呈ｧ狗ｯ峨＠縺ｦ縺・∪縺吶・
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
