// /components/stage6/SimulationDashboard.tsx

'use client';

import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import dynamic from 'next/dynamic';
import {
  ResponsiveContainer,
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip as ReTooltip,
  Legend,
  CartesianGrid,
} from 'recharts';

import { KRStruct, successProbability } from '@/utils/financeModel';
import {
  appendSimulationResultToStrategy,
  getSimulationResults,
} from '@/utils/supabase/strategy';
import type { Department, KRStructured } from '@/types/strategy';
import {
  buildBridgeDeltas,
  type BridgeInput,
  type BaseFigures,
  type Ym,
} from '@/utils/stage6Bridge';
import {
  simulateMonthlyPL,
  aggregateYearly,
  type BaseTrajectory,
} from '@/utils/financeSimulation';
import { okrsV2ToKRStruct } from '@/utils/okrToFinance';

// 驕・ｻｶ隱ｭ縺ｿ霎ｼ縺ｿ・・I繧､繝ｳ繧ｵ繧､繝茨ｼ・
const CoreInsightPanel = dynamic(
  () => import('@/components/insight/CoreInsightPanel'),
  {
    ssr: false,
    loading: () => null,
  },
);

/* ============ 蟆冗黄繝ｦ繝ｼ繝・ぅ繝ｪ繝・ぅ ============ */
function fmtNum(n: any) {
  const v = Number(n);
  if (!Number.isFinite(v)) return '-';
  return v.toLocaleString();
}
function fmtJPY(n: number) {
  const v = Number(n);
  if (!Number.isFinite(v)) return '-';
  return v.toLocaleString('ja-JP', {
    style: 'currency',
    currency: 'JPY',
    maximumFractionDigits: 0,
  });
}
type SimulationLogRowLite = {
  id: string;
  created_at: string;
  category?: string;
  title?: string;
  payload?: any;
  log?: any;
  data?: any;
};

/* ============ YM 繝ｦ繝ｼ繝・ぅ繝ｪ繝・ぅ ============ */
function pad(n: number) {
  return n < 10 ? `0${n}` : String(n);
}
function nextYm(y: Ym): Ym {
  const [Y, M] = y.split('-').map(Number);
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

/* ============ OKR / Trajectory 繝ｦ繝ｼ繝・ぅ繝ｪ繝・ぅ ============ */
/** 驛ｨ髢諠・ｱ繧偵Γ繧ｿ繝・・繧ｿ縺ｨ縺励※莉倅ｸ弱＠縺滓ｧ矩蛹訪R荳隕ｧ繧剃ｽ懊ｋ */
function collectAllKRs(
  departments: Department[] | undefined,
): KRStructured[] {
  if (!Array.isArray(departments)) return [];
  const out: KRStructured[] = [];

  departments.forEach((d, idx) => {
    const deptKey = String(
      (d as any).id ??
        (d as any).departmentId ??
        (d as any).name ??
        (d as any).departmentName ??
        `dept-${idx}`,
    );
    const deptName =
      (d as any).name ?? (d as any).departmentName ?? `驛ｨ髢${idx + 1}`;

    const projs = Array.isArray(d?.projects) ? d.projects : [];
    for (const p of projs) {
      const krs = Array.isArray((p as any)?.okrsV2)
        ? (p as any).okrsV2
        : [];
      for (const k of krs) {
        if (!k || typeof k.kind !== 'string') continue;
        const cloned: any = { ...k };
        cloned._deptKey = deptKey;
        cloned._deptName = deptName;
        out.push(cloned as KRStructured);
      }
    }
  });

  return out;
}

/**
 * 繝吶・繧ｹ霆碁％逕滓・・壼ｹｴ邇・・髟ｷ邇・ｒ閠・・縺励◆繝輔Λ繝・ヨ・区・髟ｷ莉倥″繝医Λ繝・け
 * annualGrowthRate: 0.05 縺ｪ繧牙ｹｴ +5%縲・0.05 縺ｪ繧牙ｹｴ -5%
 */
function mkFlatTrajectory(
  startYm: Ym,
  endYm: Ym,
  v: {
    qty: number;
    arpu: number;
    churn: number;
    fixed: number;
    variable: number;
    personnel: number;
  },
  annualGrowthRate: number = 0,
): BaseTrajectory {
  const months = ymRange(startYm, endYm);

  const qtyMonthly: Record<Ym, number> = {};
  const arpuMonthly: Record<Ym, number> = {};
  const churnMonthly: Record<Ym, number> = {};
  const fixedCostMonthly: Record<Ym, number> = {};
  const variableCostMonthly: Record<Ym, number> = {};
  const personnelCostMonthly: Record<Ym, number> = {};

  const hasGrowth =
    Number.isFinite(annualGrowthRate) && annualGrowthRate !== 0;

  months.forEach((m, idx) => {
    // idx 繝ｶ譛育岼 竊・蟷ｴ謠帷ｮ・idx/12 蟷ｴ蠕・
    const tYears = hasGrowth ? idx / 12 : 0;
    const factor = hasGrowth ? Math.pow(1 + annualGrowthRate, tYears) : 1;

    // 繝吶・繧ｹ縺ｧ縺ｯ Qty 縺ｫ謌宣聞邇・ｒ荵励○繧具ｼ・RPU / churn 縺ｯ荳螳壹→莉ｮ螳夲ｼ・
    const qty = v.qty * factor;

    qtyMonthly[m] = qty;
    arpuMonthly[m] = v.arpu;
    churnMonthly[m] = v.churn;
    fixedCostMonthly[m] = v.fixed; // 蝗ｺ螳夊ｲｻ縺ｯ荳螳壹→縺吶ｋ
    variableCostMonthly[m] = v.variable * factor; // 螟牙虚雋ｻ縺ｯ Qty 縺ｫ豈比ｾ・
    personnelCostMonthly[m] = v.personnel; // 莠ｺ莉ｶ雋ｻ繧ゆｸ螳夲ｼ亥ｿ・ｦ√≠繧後・蠕後〒諡｡蠑ｵ・・
  });

  return {
    startYm,
    endYm,
    qtyMonthly,
    arpuMonthly,
    churnMonthly,
    fixedCostMonthly,
    variableCostMonthly,
    personnelCostMonthly,
  };
}

/* ============ 縲悟ｮ溯ｳｪ遨ｺ縲榊愛螳・============ */
function isEffectivelyEmptyClient(s: any): boolean {
  const emptyArr = (a: any) => !Array.isArray(a) || a.length === 0;
  const emptyStr = (v: any) => typeof v !== 'string' || v.trim() === '';

  const allEmpty =
    emptyArr(s?.story) &&
    emptyArr(s?.finalStory) &&
    emptyArr(s?.answers2) &&
    emptyArr(s?.departments) &&
    emptyArr(s?.csvFinanceData) &&
    emptyArr(s?.financeSummary) &&
    (!s?.businessPortfolio || emptyArr(s?.businessPortfolio?.units)) &&
    (!s?.simulationResult ||
      emptyArr(s?.simulationResult?.projection?.points));

  const metaAllEmpty = [
    s?.companyName,
    s?.mission,
    s?.vision,
    s?.value,
    s?.thought,
  ]
    .filter((v) => v !== undefined)
    .every(emptyStr);

  return allEmpty && metaAllEmpty;
}

/* ============ 雋｡蜍吶し繝槭Μ繝ｼ / CSV 竊・繝吶・繧ｹ霆碁％縺ｮ謗ｨ螳・============ */

type DerivedBase = {
  monthlyRevenue: number;
  monthlyCogs: number;
  monthlySga: number;
  defaultQty: number;
  defaultArpu: number;
  defaultChurn: number;
  defaultFixed: number;
  defaultVariable: number;
  defaultPersonnel: number;
  baseYearSales: number;
  baseYearOp: number;
  signature: string;
};

/**
 * financeSummary / csvFinanceData 縺九ｉ繝吶・繧ｹ蟷ｴ蠎ｦ縺ｮ螢ｲ荳翫・蛻ｩ逶翫ｒ謗ｨ螳壹＠縲・
 * 譛域ｬ｡螢ｲ荳翫・繧ｳ繧ｹ繝医・Qty 縺ｪ縺ｩ縺ｮ繝吶・繧ｹ蛟､繧堤ｮ怜・縺吶ｋ縲・
 */
function deriveBaseFromStrategy(strategy: any): DerivedBase {
  // 笘・繧ｫ繝ｳ繝樔ｻ倥″譁・ｭ怜・繧・夊ｲｨ險伜捷繧貞ｮ牙・縺ｫ謨ｰ蛟､蛹・
  const num = (v: any): number => {
    if (v === undefined || v === null || v === '') return 0;
    if (typeof v === 'number') {
      return Number.isFinite(v) ? v : 0;
    }
    if (typeof v === 'string') {
      const trimmed = v.trim();
      if (!trimmed) return 0;
      // 繧ｫ繝ｳ繝槭・遨ｺ逋ｽ繝ｻ蜀・ｨ伜捷縺ｪ縺ｩ繧帝勁蜴ｻ
      const normalized = trimmed.replace(/[,\s・･ﾂ･]/g, '');
      const n = Number(normalized);
      return Number.isFinite(n) ? n : 0;
    }
    const n = Number(v);
    return Number.isFinite(n) ? n : 0;
  };

  /* ---------- financeSummary 縺ｮ豁｣隕丞喧 ---------- */
  const normalizeFinanceSummaryRows = (src: any): any[] => {
    if (!src) return [];

    const fs = src.financeSummary ?? src.finance_summary ?? src;

    if (Array.isArray(fs)) return fs;
    if (Array.isArray(fs?.baseline)) return fs.baseline;
    if (Array.isArray(fs?.rows)) return fs.rows;

    return [];
  };

  const getYearKey = (row: any): string | null => {
    const raw =
      row.year ??
      row.yearLabel ??
      row.fiscalYear ??
      row.fy ??
      row['蟷ｴ蠎ｦ'] ??
      row['year'];

    if (raw === undefined || raw === null) return null;
    const s = String(raw).trim();
    if (!s) return null;

    // "FY2024" / "2024/03" 縺ｪ縺ｩ縺九ｉ 4譯∝ｹｴ繧貞━蜈医＠縺ｦ謚ｽ蜃ｺ
    const m = s.match(/\d{4}/);
    return m ? m[0] : s;
  };

  const isYearTotalRow = (row: any): boolean => {
    if (row.isTotal || row.is_total || row.isYearTotal) return true;

    const kind = String(row.kind ?? row.rowType ?? '').trim().toUpperCase();
    if (kind === 'TOTAL' || kind === '蟷ｴ蠎ｦ蜷郁ｨ・) return true;

    const unitName = String(
      row.unitName ??
        row.unit ??
        row.segment ??
        row.businessName ??
        row.label ??
        '',
    ).trim();

    if (!unitName) return false;
    // 縲悟ｹｴ蠎ｦ蜷郁ｨ医阪悟・遉ｾ蜷郁ｨ医阪悟粋險医阪↑縺ｩ繧・TOTAL 縺ｨ縺ｿ縺ｪ縺・
    if (
      unitName.includes('蟷ｴ蠎ｦ蜷郁ｨ・) ||
      unitName.includes('蜈ｨ遉ｾ蜷郁ｨ・) ||
      (unitName.includes('蜷郁ｨ・) && !unitName.includes('蟆剰ｨ・))
    ) {
      return true;
    }

    return false;
  };

  let annualSales = 0;
  let annualOp = 0;
  let annualCogs = 0;
  let annualSga = 0;

  const fsRows = normalizeFinanceSummaryRows(strategy);

  if (fsRows.length) {
    // 蟷ｴ蠎ｦ縺斐→縺ｫ繧ｰ繝ｫ繝ｼ繝斐Φ繧ｰ
    const byYear = new Map<string, { all: any[]; totals: any[] }>();

    for (const r of fsRows) {
      const y = getYearKey(r);
      if (!y) continue;

      const revenue = num(
        r.revenue ??
          r.sales ??
          r.netSales ??
          r['螢ｲ荳企ｫ・] ??
          r['螢ｲ荳・] ??
          r['螢ｲ荳雁庶逶・],
      );
      const op = num(
        r.operatingIncome ??
          r.operating_profit ??
          r.operatingProfit ??
          r.op ??
          r['蝟ｶ讌ｭ蛻ｩ逶・],
      );

      if (!byYear.has(y)) {
        byYear.set(y, { all: [], totals: [] });
      }
      const bucket = byYear.get(y)!;
      const enriched = { ...r, _revenue: revenue, _op: op };
      bucket.all.push(enriched);
      if (isYearTotalRow(r)) bucket.totals.push(enriched);
    }

    if (byYear.size) {
      // 譛譁ｰ蟷ｴ蠎ｦ繧呈ｱｺ繧√ｋ・域焚蟄励′縺ゅｌ縺ｰ謨ｰ蛟､縺ｨ縺励※豈碑ｼ・ｼ・
      const years = Array.from(byYear.keys());
      const withNum = years.map((y) => ({
        year: y,
        num: Number(y.match(/\d{4}/)?.[0] ?? y) || 0,
      }));
      withNum.sort((a, b) => a.num - b.num);
      const latest = withNum[withNum.length - 1]?.year;
      const group = latest ? byYear.get(latest) : undefined;

      if (group) {
        const rowsForCalc =
          group.totals.length > 0 ? group.totals : group.all;

        const sumSales = rowsForCalc.reduce(
          (acc, r) => acc + num(r._revenue),
          0,
        );
        const sumOp = rowsForCalc.reduce(
          (acc, r) => acc + num(r._op),
          0,
        );

        if (sumSales > 0) {
          annualSales = sumSales;
          // 蝟ｶ讌ｭ蛻ｩ逶翫′ 0 縺ｮ蝣ｴ蜷医・ 10% 繝槭・繧ｸ繝ｳ繧剃ｻｮ鄂ｮ縺・
          annualOp = sumOp || annualSales * 0.1;
        }
      }
    }
  }

  /* ---------- financeSummary 縺九ｉ蜿悶ｌ縺ｪ縺九▲縺溷ｴ蜷茨ｼ咾SV 縺ｫ繝輔か繝ｼ繝ｫ繝舌ャ繧ｯ ---------- */
  if (!annualSales) {
    const csv: any[] = Array.isArray(strategy?.csvFinanceData)
      ? strategy.csvFinanceData
      : [];

    if (csv.length > 0) {
      // 笘・CSV 繧ゅ梧怙譁ｰ蟷ｴ蠎ｦ ﾃ・蜈ｨ莠区･ｭ蜷郁ｨ医阪〒髮・ｨ・
      const numCsv = (v: any) => num(v);

      const getYearFromCsv = (row: any): string | null => {
        const raw =
          row.year ?? row.fiscalYear ?? row.fy ?? row['蟷ｴ蠎ｦ'] ?? row['year'];
        if (raw === undefined || raw === null) return null;
        const s = String(raw).trim();
        if (!s) return null;
        const m = s.match(/\d{4}/);
        return m ? m[0] : s;
      };

      const byYear = new Map<string, any[]>();
      for (const r of csv) {
        const y = getYearFromCsv(r);
        if (!y) continue;
        if (!byYear.has(y)) byYear.set(y, []);
        byYear.get(y)!.push(r);
      }

      let csvSales = 0;
      let csvOp = 0;

      if (byYear.size) {
        const years = Array.from(byYear.keys()).map((y) => ({
          year: y,
          num: Number(y.match(/\d{4}/)?.[0] ?? y) || 0,
        }));
        years.sort((a, b) => a.num - b.num);
        const latest = years[years.length - 1]!.year;
        const rows = byYear.get(latest)!;

        for (const row of rows) {
          const rev =
            numCsv(row.sales) ||
            numCsv(row.revenue) ||
            numCsv(row['螢ｲ荳企ｫ・]) ||
            numCsv(row['螢ｲ荳・]) ||
            numCsv(row['螢ｲ荳雁庶逶・]);
          csvSales += rev;

          const op =
            numCsv(row.operatingProfit) ||
            numCsv(row.op) ||
            numCsv(row['蝟ｶ讌ｭ蛻ｩ逶・]) ||
            0;
          csvOp += op;
        }
      } else {
        // 蟷ｴ蠎ｦ諠・ｱ縺檎┌縺・ｴ蜷医・蜈ｨ陦悟粋險医ｒ菴ｿ逕ｨ
        for (const row of csv) {
          const rev =
            numCsv(row.sales) ||
            numCsv(row.revenue) ||
            numCsv(row['螢ｲ荳企ｫ・]) ||
            numCsv(row['螢ｲ荳・]) ||
            numCsv(row['螢ｲ荳雁庶逶・]);
          csvSales += rev;

          const op =
            numCsv(row.operatingProfit) ||
            numCsv(row.op) ||
            numCsv(row['蝟ｶ讌ｭ蛻ｩ逶・]) ||
            0;
          csvOp += op;
        }
      }

      if (csvSales > 0) {
        annualSales = csvSales;
        annualOp = csvOp || annualSales * 0.1;
      }
    }
  }

  /* ---------- 譛邨ら噪縺ｫ annualSales 縺後∪縺 0 縺ｮ蝣ｴ蜷医・繧ｼ繝ｭ繝吶・繧ｹ ---------- */
  if (!annualSales) {
    const monthlyRevenue = 0;
    const monthlyCogs = 0;
    const monthlySga = 0;

    const defaultChurn = 0.02;
    const defaultArpu = 12_000;
    const defaultQty = 5_000;

    const defaultFixed = 0;
    const defaultPersonnel = 0;
    const defaultVariable = 0;

    return {
      monthlyRevenue,
      monthlyCogs,
      monthlySga,
      defaultQty,
      defaultArpu,
      defaultChurn,
      defaultFixed,
      defaultVariable,
      defaultPersonnel,
      baseYearSales: 0,
      baseYearOp: 0,
      signature: '0-0-0-0',
    };
  }

  /* ---------- annualCogs / annualSga 縺ｮ蛻・ｧ｣・・0:50・・---------- */
  const grossForCogsAndSga = annualSales - annualOp;
  if (grossForCogsAndSga > 0) {
    annualCogs = grossForCogsAndSga / 2;
    annualSga = grossForCogsAndSga / 2;
  } else {
    // 蝟ｶ讌ｭ蛻ｩ逶翫′螢ｲ荳翫ｒ雜・∴縺ｦ縺・ｋ縺ｪ縺ｩ縲∫焚蟶ｸ縺ｪ繧ｱ繝ｼ繧ｹ縺ｧ縺ｯ縺ｨ繧翫≠縺医★ 40:40:20 縺ｫ蛻・ｧ｣
    annualCogs = annualSales * 0.4;
    annualSga = annualSales * 0.4;
    annualOp = annualSales - annualCogs - annualSga;
  }

  const monthlyRevenue = annualSales / 12;
  const monthlyCogs = annualCogs / 12;
  const monthlySga = annualSga / 12;

  const defaultChurn = 0.02; // 譛域ｬ｡ 2% 繧偵ョ繝輔か繝ｫ繝・
  const defaultArpu = 12_000;
  const defaultQty = Math.max(
    1_000,
    Math.round(monthlyRevenue / defaultArpu),
  );

  const defaultFixed = monthlySga * 0.5;
  const defaultPersonnel = monthlySga * 0.5;
  const defaultVariable = monthlyCogs;

  const baseYearSales = annualSales;
  const baseYearOp = annualOp;

  const signature = `${annualSales}-${annualCogs}-${annualSga}-${annualOp}`;

  return {
    monthlyRevenue,
    monthlyCogs,
    monthlySga,
    defaultQty,
    defaultArpu,
    defaultChurn,
    defaultFixed,
    defaultVariable,
    defaultPersonnel,
    baseYearSales,
    baseYearOp,
    signature,
  };
}

/* ============ 莠区･ｭ繝昴・繝医ヵ繧ｩ繝ｪ繧ｪ 竊・繝吶・繧ｹ謌宣聞邇・============ */

/**
 * businessPortfolio.units 縺ｮ縲後す繧ｧ繧｢ ﾃ・謌宣聞邇・阪・蜉驥榊ｹｳ蝮・°繧峨・
 * 莨夂､ｾ蜈ｨ菴薙・蟷ｴ邇・・髟ｷ邇・ｼ井ｽ輔ｂ縺励↑縺九▲縺溷ｴ蜷医・繝吶・繧ｹ繝ｩ繧､繝ｳ・峨ｒ謗ｨ螳壹☆繧九・
 * - 謌宣聞邇・・ -0.05 繧・0.1 縺ｮ繧医≧縺ｪ豈皮紫縲√≠繧九＞縺ｯ -5, +10 縺ｮ繧医≧縺ｪ・・｡ｨ險倥ｒ諠ｳ螳・
 * - 蜊倅ｽ阪・豺ｷ蝨ｨ縺ｫ繧り舌∴繧九ｈ縺・－g| <= 1 縺ｯ縺昴・縺ｾ縺ｾ豈皮紫縲－g| > 1 縺ｯ 100 縺ｧ蜑ｲ縺｣縺ｦ・・→縺ｿ縺ｪ縺・
 */
function derivePortfolioGrowth(strategy: any): number {
  const units: any[] = Array.isArray(strategy?.businessPortfolio?.units)
    ? strategy.businessPortfolio.units
    : [];

  if (!units.length) return 0;

  const num = (v: any): number => {
    if (v === undefined || v === null || v === '') return 0;
    if (typeof v === 'number') return Number.isFinite(v) ? v : 0;
    if (typeof v === 'string') {
      const normalized = v.replace(/[,\s・・]/g, '');
      const n = Number(normalized);
      return Number.isFinite(n) ? n : 0;
    }
    const n = Number(v);
    return Number.isFinite(n) ? n : 0;
  };

  const normalized = units
    .map((u) => {
      const share =
        num(
          u.share ??
            u.weight ??
            u.revenueShare ??
            u.salesShare ??
            u['豈皮紫'],
        ) || 0;

      let g = num(
        u.growthRate ??
          u.growth ??
          u.growthPct ??
          u.expectedGrowth ??
          u['謌宣聞邇・],
      );

      // |g| <= 1 縺ｪ繧峨◎縺ｮ縺ｾ縺ｾ豈皮紫縲－g| > 1 縺ｪ繧・・・｡ｨ險倥→縺ｿ縺ｪ縺励※ 100 縺ｧ蜑ｲ繧・
      if (Math.abs(g) > 1) {
        g = g / 100;
      }

      return { share, g };
    })
    .filter((x) => x.share > 0);

  if (!normalized.length) return 0;

  const totalShare = normalized.reduce((acc, x) => acc + x.share, 0) || 1;
  const weightedGrowth =
    normalized.reduce((acc, x) => acc + x.share * x.g, 0) / totalShare;

  return weightedGrowth; // 萓・ -0.05 = -5%/year
}

/* ============ 繝√Ε繝ｼ繝育畑繝・・繝ｫ繝√ャ繝・============ */
function ImpactTooltip({ active, payload }: any) {
  if (!active || !payload || !payload.length) return null;
  const p = payload[0].payload as {
    yearLabel: string;
    sales?: number;
    op?: number;
    probPct?: number;
  };

  return (
    <div className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-[11px] text-slate-800 shadow-lg">
      <div className="mb-1 font-medium text-slate-900">
        {p.yearLabel}
      </div>
      {typeof p.sales === 'number' && (
        <div>螢ｲ荳奇ｼ嘴fmtJPY(p.sales)}</div>
      )}
      {typeof p.op === 'number' && (
        <div>蝟ｶ讌ｭ蛻ｩ逶奇ｼ嘴fmtJPY(p.op)}</div>
      )}
      {typeof p.probPct === 'number' && (
        <div>謌仙粥遒ｺ邇・ｼ嘴p.probPct.toFixed(0)}%</div>
      )}
    </div>
  );
}

/* ============ 蟆上＆縺・焚蛟､蜈･蜉・============ */
function Num({
  label,
  value,
  setValue,
  step,
}: {
  label: string;
  value: number;
  setValue: (n: number) => void;
  step?: string;
}) {
  return (
    <div>
      <div className="text-[11px] text-slate-500">{label}</div>
      <input
        className="mt-1 h-9 w-full rounded-xl border border-slate-300 bg-white px-3 text-[13px] text-slate-900 shadow-inner"
        inputMode="decimal"
        step={step ?? '1'}
        value={String(Number.isFinite(value) ? value : '')}
        onChange={(e) => setValue(Number(e.target.value || 0))}
      />
    </div>
  );
}

/* =========================================================
 * SimulationDashboard
 * ========================================================= */

type Props = {
  strategy: any;
  userId?: string;
  isHydrating: boolean;
};

export default function SimulationDashboard({
  strategy,
  userId,
  isHydrating,
}: Props) {
  const s: any = strategy;
  const hasAnyServerBackedContent = useMemo(
    () => !isEffectivelyEmptyClient(s),
    [s],
  );

  /* ---------------- 蜈ｱ騾夲ｼ夐Κ髢 & 讒矩蛹訪R・・krsV2・・---------------- */

  const departments: Department[] = Array.isArray(s?.departments)
    ? s.departments
    : [];

  const allKRs = useMemo(
    () => collectAllKRs(departments),
    [departments],
  );

  /* ---------------- Ver4・唹KR竊単L 繧ｷ繝溘Η繝ｬ繝ｼ繧ｷ繝ｧ繝ｳ譛ｬ菴・---------------- */

  const derivedBase = useMemo(
    () => deriveBaseFromStrategy(s),
    [s],
  );

  // 笘・霑ｽ蜉・壻ｺ区･ｭ繝昴・繝医ヵ繧ｩ繝ｪ繧ｪ縺九ｉ蟷ｴ邇・・髟ｷ邇・ｒ謗ｨ螳・
  const portfolioGrowth = useMemo(
    () => derivePortfolioGrowth(s),
    [s],
  );

  // 繝・ヰ繝・げ逕ｨ繝ｭ繧ｰ
  console.log('[SIM] derivedBase', derivedBase);
  console.log('[SIM] portfolioGrowth (annual)', portfolioGrowth);

  // 譛滄俣・医ョ繝輔か繝ｫ繝医・ 3蟷ｴ蛻・ｼ・025-04 縲・2028-03・・
  const [startYm, setStartYm] = useState<Ym>('2025-04');
  const [endYm, setEndYm] = useState<Ym>('2028-03');

  // 繝吶・繧ｹ蛟､・亥・譛溷､縺ｯ雋｡蜍吶し繝槭Μ繝ｼ/CSV縺九ｉ謗ｨ螳夲ｼ・
  const [baseQty, setBaseQty] = useState<number>(
    derivedBase.defaultQty,
  );
  const [baseArpu, setBaseArpu] = useState<number>(
    derivedBase.defaultArpu,
  );
  const [baseChurn, setBaseChurn] = useState<number>(
    derivedBase.defaultChurn,
  );
  const [baseFixed, setBaseFixed] = useState<number>(
    derivedBase.defaultFixed,
  );
  const [baseVariable, setBaseVariable] = useState<number>(
    derivedBase.defaultVariable,
  );
  const [basePersonnel, setBasePersonnel] = useState<number>(
    derivedBase.defaultPersonnel,
  );

  // 雋｡蜍吝渕貅悶′螟峨ｏ縺｣縺溘ｉ繝吶・繧ｹ蛟､繧呈峩譁ｰ・井ｼ夂､ｾ蛻・崛譎ゅ↑縺ｩ・・
  useEffect(() => {
    setBaseQty(derivedBase.defaultQty);
    setBaseArpu(derivedBase.defaultArpu);
    setBaseChurn(derivedBase.defaultChurn);
    setBaseFixed(derivedBase.defaultFixed);
    setBaseVariable(derivedBase.defaultVariable);
    setBasePersonnel(derivedBase.defaultPersonnel);
  }, [
    derivedBase.signature,
    derivedBase.defaultQty,
    derivedBase.defaultArpu,
    derivedBase.defaultChurn,
    derivedBase.defaultFixed,
    derivedBase.defaultVariable,
    derivedBase.defaultPersonnel,
  ]);

  const baseFigures = useMemo<BaseFigures>(
    () => ({
      // ACQ繝吶・繧ｹ・夂樟迥ｶ邯ｭ謖√↓蠢・ｦ√↑譁ｰ隕冗佐蠕玲焚縺ｨ縺励※ Churn ﾃ・Qty
      acq: baseQty * baseChurn,
      arpu: baseArpu,
      churn: baseChurn,
      fixed_cost: baseFixed,
      variable_cost: baseVariable,
      personnel_cost: basePersonnel,
      revenue: baseQty * baseArpu,
    }),
    [baseQty, baseArpu, baseChurn, baseFixed, baseVariable, basePersonnel],
  );

  const baseTrajectory = useMemo(
    () =>
      mkFlatTrajectory(
        startYm,
        endYm,
        {
          qty: baseQty,
          arpu: baseArpu,
          churn: baseChurn,
          fixed: baseFixed,
          variable: baseVariable,
          personnel: basePersonnel,
        },
        portfolioGrowth, // 笘・繝昴・繝医ヵ繧ｩ繝ｪ繧ｪ縺ｮ蟷ｴ邇・・髟ｷ繧偵・繝ｼ繧ｹ繝ｩ繧､繝ｳ縺ｫ蜿肴丐
      ),
    [
      startYm,
      endYm,
      baseQty,
      baseArpu,
      baseChurn,
      baseFixed,
      baseVariable,
      basePersonnel,
      portfolioGrowth,
    ],
  );

  const bridgeInput = useMemo<BridgeInput>(
    () => ({
      startYm,
      endYm,
      krs: allKRs.map((k) => ({
        id: k.id,
        kind: k.kind,
        label: k.label,
        target: k.target,
        unit: k.unit,
        scope: k.scope,
        baseKey: k.baseKey,
        baseOverride: (k as any).baseOverride,
        weight: k.weight,
        elasticity: (k as any).elasticity,
        lagMonths: k.lagMonths,
        startYm: (k as any).startYm,
        due: (k as any).due,
        notes: (k as any).notes,
      })),
      base: baseFigures,
      config: { activityDefault: 'ACQ', activityRoute: {} },
    }),
    [allKRs, startYm, endYm, baseFigures],
  );

  const deltas = useMemo(
    () => buildBridgeDeltas(bridgeInput),
    [bridgeInput],
  );

  // 笘・繝・ヰ繝・げ・唹KR縺九ｉ縺ｮ繝・Ν繧ｿ・域怙蛻昴・謨ｰ繝ｶ譛医□縺醍｢ｺ隱搾ｼ・
  console.log('[SIM] deltas sample', {
    revenue: Object.values(deltas.revenue || {}).slice(0, 3),
    acq: Object.values(deltas.acq || {}).slice(0, 3),
    arpu: Object.values(deltas.arpu || {}).slice(0, 3),
    churn: Object.values(deltas.churn || {}).slice(0, 3),
  });

  const monthly = useMemo(() => {
    if (!hasAnyServerBackedContent) return [] as any[];
    return simulateMonthlyPL(baseTrajectory, deltas, {
      applySynergyTo: ['revenue'],
    });
  }, [baseTrajectory, deltas, hasAnyServerBackedContent]);

  const yearly = useMemo(
    () => (monthly.length ? aggregateYearly(monthly) : []),
    [monthly],
  );

  // 笘・繝・ヰ繝・げ・壼ｹｴ谺｡PL・・1縲弸3縺ｮ螢ｲ荳翫・蝟ｶ讌ｭ蛻ｩ逶奇ｼ・
  console.log('[SIM] yearly', yearly);

  /* ---------------- 讒矩蛹訪R 竊・謌仙粥遒ｺ邇・畑縺ｮKRStruct ---------------- */

  const krsForProb: KRStruct[] = useMemo(
    () => okrsV2ToKRStruct(allKRs),
    [allKRs],
  );

  /* ---------------- 荳企Κ・・蟷ｴ・・r 譛滄俣・我ｺ域ｸｬ ・・謌仙粥遒ｺ邇・---------------- */

  const { projection, finalProb, baseForDelta } = useMemo(() => {
    if (!hasAnyServerBackedContent) {
      return {
        projection: { points: [] as any[] },
        finalProb: 0,
        baseForDelta: { year0Sales: 0, year0Op: 0 },
      };
    }

    if (!yearly.length) {
      return {
        projection: { points: [] as any[] },
        finalProb: 0,
        baseForDelta: {
          year0Sales: derivedBase.baseYearSales,
          year0Op: derivedBase.baseYearOp,
        },
      };
    }

    // 笘・菫ｮ豁｣・・蟷ｴ蛻・ｼ・1縲弸3・峨↓髯仙ｮ壹＠縺､縺､縲∝ｹｴ繝ｩ繝吶Ν縺ｯ逶ｸ蟇ｾ逧・↓ Y1, Y2, Y3 縺ｨ縺励※謇ｱ縺・
    const limitedYearly = yearly.slice(0, 3);
    const points = limitedYearly.map((y: any, idx: number) => ({
      year: (`Y${idx + 1}` as 'Y1' | 'Y2' | 'Y3'),
      sales: y.revenue,
      op: y.op_income,
      opMargin: y.revenue > 0 ? y.op_income / y.revenue : 0,
    }));

    const projectionForProb = {
      points: points.map((p, idx) => ({
        year: (`Y${idx + 1}` as 'Y1' | 'Y2' | 'Y3'),
        sales: p.sales,
        op: p.op,
        opMargin: p.opMargin,
      })),
    };

    const alignAvg =
      krsForProb.length > 0
        ? krsForProb.reduce(
            (a, b) => a + (b.alignmentScore ?? 70),
            0,
          ) / krsForProb.length
        : 0;

    const prob = successProbability({
      projections: projectionForProb,
      alignmentScoreAvg: alignAvg || 0,
    });

    return {
      projection: { points },
      finalProb: prob,
      baseForDelta: {
        year0Sales: derivedBase.baseYearSales,
        year0Op: derivedBase.baseYearOp,
      },
    };
  }, [hasAnyServerBackedContent, yearly, derivedBase, krsForProb]);

  const chartData = useMemo(() => {
    const probPct = (finalProb || 0) * 100;
    return (projection.points || []).map((p: any, idx: number) => ({
      yearLabel: p.year ?? `Y${idx + 1}`,
      sales: Math.round(p.sales),
      op: Math.round(p.op),
      probPct,
    }));
  }, [projection, finalProb]);

  const y3 = (projection.points || []).at(-1) as
    | { sales: number; op: number; opMargin?: number; year?: string }
    | undefined;

  const deltaVsBase = useMemo(() => {
    if (!y3) return { deltaSales: 0, deltaOp: 0 };
    const baseSales = Number(baseForDelta.year0Sales) || 0;
    const baseOp = Number(baseForDelta.year0Op) || 0;
    return {
      deltaSales: baseSales ? y3.sales - baseSales : y3.sales,
      deltaOp: baseOp ? y3.op - baseOp : y3.op,
    };
  }, [y3, baseForDelta]);

  /* ---------------- 驛ｨ髢蛻･繧ｷ繝溘Η繝ｬ繝ｼ繧ｷ繝ｧ繝ｳ逕ｨ ---------------- */

  const deptOptions = useMemo(
    () =>
      departments.map((d, idx) => {
        const key = String(
          (d as any).id ??
            (d as any).departmentId ??
            (d as any).name ??
            (d as any).departmentName ??
            `dept-${idx}`,
        );
        const label =
          (d as any).name ?? (d as any).departmentName ?? `驛ｨ髢${idx + 1}`;
        return { key, label };
      }),
    [departments],
  );

  const [selectedDeptKey, setSelectedDeptKey] = useState<string>('');

  useEffect(() => {
    if (!deptOptions.length) {
      setSelectedDeptKey('');
      return;
    }
    setSelectedDeptKey((prev) =>
      prev && deptOptions.some((o) => o.key === prev)
        ? prev
        : deptOptions[0].key,
    );
  }, [deptOptions]);

  const selectedDeptLabel = useMemo(
    () =>
      deptOptions.find((o) => o.key === selectedDeptKey)?.label ?? '',
    [deptOptions, selectedDeptKey],
  );

  const deptKRs = useMemo(() => {
    if (!selectedDeptKey) return [] as KRStructured[];
    return allKRs.filter(
      (k) => (k as any)._deptKey === selectedDeptKey,
    );
  }, [allKRs, selectedDeptKey]);

  const deptBridgeInput = useMemo<BridgeInput | null>(() => {
    if (!selectedDeptKey || !deptKRs.length) return null;
    return {
      startYm,
      endYm,
      krs: deptKRs.map((k) => ({
        id: k.id,
        kind: k.kind,
        label: k.label,
        target: k.target,
        unit: k.unit,
        scope: k.scope,
        baseKey: k.baseKey,
        baseOverride: (k as any).baseOverride,
        weight: k.weight,
        elasticity: (k as any).elasticity,
        lagMonths: k.lagMonths,
        startYm: (k as any).startYm,
        due: (k as any).due,
        notes: (k as any).notes,
      })),
      base: baseFigures,
      config: { activityDefault: 'ACQ', activityRoute: {} },
    };
  }, [selectedDeptKey, deptKRs, startYm, endYm, baseFigures]);

  const deptDeltas = useMemo(
    () => (deptBridgeInput ? buildBridgeDeltas(deptBridgeInput) : null),
    [deptBridgeInput],
  );

  const deptMonthly = useMemo(() => {
    if (!hasAnyServerBackedContent || !deptDeltas)
      return [] as any[];
    return simulateMonthlyPL(baseTrajectory, deptDeltas, {
      applySynergyTo: ['revenue'],
    });
  }, [baseTrajectory, deptDeltas, hasAnyServerBackedContent]);

  const deptYearly = useMemo(
    () => (deptMonthly.length ? aggregateYearly(deptMonthly) : []),
    [deptMonthly],
  );

  /* ---------------- 莠区･ｭ繝昴・繝医ヵ繧ｩ繝ｪ繧ｪ・・TEP2・牙挨繧､繝ｳ繝代け繝・---------------- */

  type BusinessUnitView = {
    key: string;
    label: string;
    share: number;
  };

  const businessUnits: BusinessUnitView[] = useMemo(() => {
    const raw: any[] = Array.isArray(s?.businessPortfolio?.units)
      ? (s.businessPortfolio.units as any[])
      : [];
    return raw.map((u, idx) => ({
      key: String(
        u.id ?? u.key ?? u.code ?? u.businessId ?? `biz-${idx}`,
      ),
      label: String(
        u.label ?? u.name ?? u.businessName ?? `莠区･ｭ${idx + 1}`,
      ),
      share:
        Number(
          u.share ??
            u.weight ??
            u.revenueShare ??
            u.salesShare ??
            0,
        ) || 0,
    }));
  }, [s]);

  const businessImpactY3 = useMemo(() => {
    if (!yearly.length || !businessUnits.length) return [] as any[];

    const yLast: any = yearly[yearly.length - 1];
    const baseRevenue = yLast.revenue || 0;
    const baseOp = yLast.op_income || 0;

    if (!baseRevenue && !baseOp) return [] as any[];

    // 繧ｷ繧ｧ繧｢縺ｮ豁｣隕丞喧・亥・驛ｨ0縺ｪ繧牙插遲牙牡繧奇ｼ・
    const totalShare = businessUnits.reduce(
      (sum, u) => sum + (u.share > 0 ? u.share : 0),
      0,
    );
    const denom = totalShare > 0 ? totalShare : businessUnits.length || 1;

    return businessUnits.map((u) => {
      const raw = u.share > 0 ? u.share : totalShare > 0 ? 0 : 1;
      const factor = raw / denom;
      const revenue = baseRevenue * factor;
      const op = baseOp * factor;
      const margin = baseRevenue
        ? (baseOp / baseRevenue) * 100
        : 0;

      return {
        key: u.key,
        label: u.label,
        shareDisplay:
          totalShare > 0
            ? `${((u.share / totalShare) * 100).toFixed(1)}%`
            : `${(100 / (businessUnits.length || 1)).toFixed(1)}%`,
        revenue,
        op,
        margin,
      };
    });
  }, [yearly, businessUnits]);

  /* ---------------- 菫晏ｭ假ｼ・ｱ･豁ｴ ---------------- */

  const [saving, setSaving] = useState(false);
  const [history, setHistory] = useState<SimulationLogRowLite[]>([]);
  const [loadingHist, setLoadingHist] = useState(false);
  const [notice, setNotice] = useState<string>('');

  const loadHistory = useCallback(async () => {
    if (!userId) return;
    if (!hasAnyServerBackedContent) {
      setHistory([]);
      return;
    }
    setLoadingHist(true);
    try {
      const { rows, error } = await getSimulationResults(
        userId,
        null,
        { limit: 20 },
      );
      if (error) throw error;
      setHistory((rows || []) as SimulationLogRowLite[]);
    } catch (e) {
      console.error('getSimulationResults error:', e);
      setNotice('笶・繧ｷ繝溘Η繝ｬ繝ｼ繧ｷ繝ｧ繝ｳ螻･豁ｴ縺ｮ蜿門ｾ励↓螟ｱ謨励＠縺ｾ縺励◆');
    } finally {
      setLoadingHist(false);
    }
  }, [userId, hasAnyServerBackedContent]);

  useEffect(() => {
    if (!isHydrating) loadHistory();
  }, [isHydrating, loadHistory]);

  const handleSave = async () => {
    if (!userId) {
      setNotice('笞・・繝ｭ繧ｰ繧､繝ｳ縺悟ｿ・ｦ√〒縺・);
      return;
    }
    if (isHydrating) {
      setNotice(
        '笞・・繝・・繧ｿ隱ｭ縺ｿ霎ｼ縺ｿ荳ｭ縺ｧ縺吶ょｮ御ｺ・ｾ後↓菫晏ｭ倥＠縺ｦ縺上□縺輔＞縲・,
      );
      return;
    }
    if (
      !hasAnyServerBackedContent ||
      (projection.points || []).length === 0
    ) {
      setNotice('笞・・菫晏ｭ伜ｯｾ雎｡縺ｮ繧ｷ繝溘Η繝ｬ繝ｼ繧ｷ繝ｧ繝ｳ邨先棡縺後≠繧翫∪縺帙ｓ');
      return;
    }
    setSaving(true);
    try {
      const payload = {
        projection: {
          points: (projection.points || []).map((p: any) => ({
            year: String(p.year),
            sales: Math.round(p.sales),
            op: Math.round(p.op),
            opMargin: Number(
              (
                typeof p.opMargin === 'number'
                  ? p.opMargin
                  : p.sales > 0
                  ? p.op / p.sales
                  : 0
              ).toFixed(4),
            ),
          })),
        },
        finalProb,
        meta: {
          label: new Date().toLocaleString(),
          note: 'auto-saved from /stage6',
        },
      } as const;

      const { error } = await appendSimulationResultToStrategy(
        userId,
        payload,
        null,
        {
          title: payload.meta?.label,
        },
      );
      if (error) throw error;

      setNotice('笨・繧ｷ繝溘Η繝ｬ繝ｼ繧ｷ繝ｧ繝ｳ邨先棡繧剃ｿ晏ｭ倥＠縺ｾ縺励◆');
      await loadHistory();
    } catch (e) {
      console.error('appendSimulationResultToStrategy error:', e);
      setNotice('笶・繧ｷ繝溘Η繝ｬ繝ｼ繧ｷ繝ｧ繝ｳ邨先棡縺ｮ菫晏ｭ倥↓螟ｱ謨励＠縺ｾ縺励◆');
    } finally {
      setSaving(false);
      setTimeout(() => setNotice(''), 3500);
    }
  };

  const mounted = useRef(false);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  /* =========================================================
   * JSX
   * ========================================================= */

  return (
    <>
      {/* Hydration 迥ｶ諷・*/}
      {isHydrating && (
        <div className="mb-4 rounded-2xl border border-zinc-200 bg-white px-3 py-2 text-[13px] text-zinc-600 shadow-sm">
          繧ｵ繝ｼ繝舌・縺ｮ繝・・繧ｿ繧定ｪｭ縺ｿ霎ｼ縺ｿ荳ｭ縺ｧ縺吮ｦ
        </div>
      )}

      {/* 繝｡繝・そ繝ｼ繧ｸ */}
      {notice && (
        <div
          role="alert"
          className={`mb-4 rounded-2xl border px-3 py-2 text-[13px] shadow-sm ${
            notice.includes('笶・)
              ? 'border-rose-200 bg-rose-50 text-rose-700'
              : 'border-emerald-200 bg-emerald-50 text-emerald-700'
          }`}
        >
          {notice}
        </div>
      )}

      {/* 繝・・繧ｿ辟｡縺励・譏守､ｺ */}
      {!isHydrating && !hasAnyServerBackedContent && (
        <div className="mb-6 rounded-2xl border border-amber-200 bg-amber-50 px-3 py-2 text-[13px] text-amber-900">
          縺薙・莨夂､ｾ縺ｮ謌ｦ逡･繝・・繧ｿ縺ｯ縺ｾ縺菴懈・縺輔ｌ縺ｦ縺・∪縺帙ｓ・医∪縺溘・蜈ｨ蜑企勁貂医∩・峨〒縺吶・
          STAGE1縲・縺ｧ邱ｨ髮・・菫晏ｭ倥☆繧九→縲√％縺薙↓繧ｷ繝溘Η繝ｬ繝ｼ繧ｷ繝ｧ繝ｳ邨先棡縺瑚｡ｨ遉ｺ縺輔ｌ縺ｾ縺吶・
        </div>
      )}

      {/* 竭 繝偵・繝ｭ繝ｼ・壻ｼ夂､ｾ蜈ｨ菴薙・繧､繝ｳ繝代け繝・*/}
      <section className="mb-8 rounded-3xl bg-gradient-to-br from-white via-slate-50 to-slate-100 p-5 shadow-[0_18px_40px_rgba(15,23,42,0.12)] ring-1 ring-slate-200 md:p-7">
        <div className="flex flex-col gap-6 md:flex-row md:items-end md:justify-between">
          <div className="space-y-3">
            <p className="text-[11px] uppercase tracking-[0.25em] text-slate-400">
              COMPANY IMPACT
            </p>
            <h2 className="text-xl font-semibold text-slate-900 md:text-2xl">
              縺薙・OKR繧偵ｄ繧雁・縺｣縺溘→縺阪∵･ｭ邵ｾ縺ｯ縺ｩ縺薙∪縺ｧ莨ｸ縺ｳ繧九°・・
            </h2>
            <p className="text-[13px] text-slate-600 md:text-sm">
              CSV雋｡蜍吶ョ繝ｼ繧ｿ縺ｨ縲∝推驛ｨ髢縺ｮ繝励Ο繧ｸ繧ｧ繧ｯ繝・/ 讒矩蛹訪R 繧偵▽縺ｪ縺弱・
              <span className="font-medium">螢ｲ荳翫・蝟ｶ讌ｭ蛻ｩ逶翫・謌仙粥遒ｺ邇・/span>
              繧剃ｸ菴薙〒隧ｦ邂励＠縺ｦ縺・∪縺吶・
            </p>
          </div>

          <div className="grid grid-cols-2 gap-3 md:grid-cols-3 md:gap-4">
            <StatCard
              label="Y3 螢ｲ荳翫う繝ｳ繝代け繝・
              value={y3 ? fmtJPY(deltaVsBase.deltaSales) : '窶・}
              caption={
                y3 ? '繝吶・繧ｹ豈斐・蠅怜刈鬘搾ｼ域耳險茨ｼ・ : 'STEP4縺ｮCSV/STEP3縺ｮ雋｡蜍吶し繝槭Μ繝ｼ縺悟ｿ・ｦ√〒縺・
              }
            />
            <StatCard
              label="Y3 蝟ｶ讌ｭ蛻ｩ逶翫う繝ｳ繝代け繝・
              value={y3 ? fmtJPY(deltaVsBase.deltaOp) : '窶・}
              caption={
                y3 ? '繝吶・繧ｹ豈斐・蠅怜刈鬘搾ｼ域耳險茨ｼ・ : 'STEP4縺ｮCSV/STEP3縺ｮ雋｡蜍吶し繝槭Μ繝ｼ縺悟ｿ・ｦ√〒縺・
              }
            />
            <StatCard
              label="謌仙粥遒ｺ邇・
              value={
                Number.isFinite(finalProb)
                  ? `${Math.round(finalProb * 100)}%`
                  : '窶・
              }
              caption={
                krsForProb.length
                  ? '讒矩蛹訪R縺ｮ謨ｴ蜷域ｧ繝ｻ髮｣譏灘ｺｦ繧貞刈蜻ｳ縺励◆謌仙粥遒ｺ邇・
                  : '讒矩蛹訪R縺ｮ險ｭ螳壹′蠢・ｦ√〒縺・
              }
            />
          </div>
        </div>
      </section>

      {/* 竭｡ 3蟷ｴ莠域ｸｬ・壽欠讓吶＃縺ｨ縺ｫ繧ｰ繝ｩ繝輔ｒ蛻・牡 */}
      <section className="mb-8 grid gap-6 md:grid-cols-[minmax(0,2.1fr)_minmax(0,1.1fr)]">
        <div className="rounded-3xl border border-slate-200 bg-white p-4 shadow-md">
          <div className="mb-3 flex items-center justify-between">
            <h3 className="text-[15px] font-medium text-slate-900">
              螢ｲ荳翫・蝟ｶ讌ｭ蛻ｩ逶翫・謌仙粥遒ｺ邇・ｼ・蟷ｴ莠域ｸｬ・・
            </h3>
            <span className="text-[11px] text-slate-400">
              STEP4 CSV + STEP3 雋｡蜍吶し繝槭Μ繝ｼ + STEP4 讒矩蛹訪R
            </span>
          </div>
          {hasAnyServerBackedContent && chartData.length > 0 ? (
            <div className="grid gap-3 md:grid-cols-3">
              {/* 螢ｲ荳・*/}
              <div>
                <div className="mb-1 text-[12px] font-medium text-slate-700">
                  螢ｲ荳奇ｼ亥ｹｴ谺｡・・
                </div>
                <div className="h-40">
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart
                      data={chartData}
                      margin={{
                        top: 8,
                        right: 12,
                        bottom: 8,
                        left: 40,
                      }}
                    >
                      <CartesianGrid
                        strokeDasharray="3 3"
                        stroke="#e5e7eb"
                      />
                      <XAxis
                        dataKey="yearLabel"
                        stroke="#6b7280"
                        tick={{ fontSize: 11 }}
                      />
                      <YAxis
                        stroke="#6b7280"
                        tick={{ fontSize: 11 }}
                        tickFormatter={(v) => fmtNum(v)}
                      />
                      <ReTooltip content={<ImpactTooltip />} />
                      <Line
                        type="monotone"
                        dataKey="sales"
                        name="螢ｲ荳・
                        dot={false}
                        stroke="#0ea5e9"
                      />
                    </LineChart>
                  </ResponsiveContainer>
                </div>
              </div>

              {/* 蝟ｶ讌ｭ蛻ｩ逶・*/}
              <div>
                <div className="mb-1 text-[12px] font-medium text-slate-700">
                  蝟ｶ讌ｭ蛻ｩ逶奇ｼ亥ｹｴ谺｡・・
                </div>
                <div className="h-40">
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart
                      data={chartData}
                      margin={{
                        top: 8,
                        right: 12,
                        bottom: 8,
                        left: 40,
                      }}
                    >
                      <CartesianGrid
                        strokeDasharray="3 3"
                        stroke="#e5e7eb"
                      />
                      <XAxis
                        dataKey="yearLabel"
                        stroke="#6b7280"
                        tick={{ fontSize: 11 }}
                      />
                      <YAxis
                        stroke="#6b7280"
                        tick={{ fontSize: 11 }}
                        tickFormatter={(v) => fmtNum(v)}
                      />
                      <ReTooltip content={<ImpactTooltip />} />
                      <Line
                        type="monotone"
                        dataKey="op"
                        name="蝟ｶ讌ｭ蛻ｩ逶・
                        dot={false}
                        stroke="#22c55e"
                      />
                    </LineChart>
                  </ResponsiveContainer>
                </div>
              </div>

              {/* 謌仙粥遒ｺ邇・*/}
              <div>
                <div className="mb-1 text-[12px] font-medium text-slate-700">
                  謌仙粥遒ｺ邇・ｼ・・・
                </div>
                <div className="h-40">
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart
                      data={chartData}
                      margin={{
                        top: 8,
                        right: 12,
                        bottom: 8,
                        left: 40,
                      }}
                    >
                      <CartesianGrid
                        strokeDasharray="3 3"
                        stroke="#e5e7eb"
                      />
                      <XAxis
                        dataKey="yearLabel"
                        stroke="#6b7280"
                        tick={{ fontSize: 11 }}
                      />
                      <YAxis
                        stroke="#6b7280"
                        tick={{ fontSize: 11 }}
                        tickFormatter={(v) => `${v}%`}
                      />
                      <ReTooltip content={<ImpactTooltip />} />
                      <Line
                        type="monotone"
                        dataKey="probPct"
                        name="謌仙粥遒ｺ邇・
                        dot={false}
                        stroke="#f97316"
                      />
                    </LineChart>
                  </ResponsiveContainer>
                </div>
              </div>
            </div>
          ) : (
            <div className="grid h-64 place-items-center text-sm text-slate-400">
              陦ｨ遉ｺ縺ｧ縺阪ｋ莠域ｸｬ繝・・繧ｿ縺後≠繧翫∪縺帙ｓ縲・
              <br />
              STEP4 縺ｮCSV繝ｻSTEP3縺ｮ雋｡蜍吶し繝槭Μ繝ｼ繝ｻ蜷・Κ髢縺ｮ讒矩蛹訪R繧定ｨｭ螳壹☆繧九→陦ｨ遉ｺ縺輔ｌ縺ｾ縺吶・
            </div>
          )}
        </div>

        {/* 隧ｦ邂励・隕∫ｴ・*/}
        <div className="flex flex-col justify-between gap-4 rounded-3xl border border-slate-200 bg-white p-4 shadow-md">
          <div>
            <h3 className="mb-2 text-[15px] font-medium text-slate-900">
              隧ｦ邂励・隕∫ｴ・
            </h3>
            {hasAnyServerBackedContent && y3 ? (
              <ul className="space-y-1 text-[13px] text-slate-700">
                <li>
                  Y3 螢ｲ荳奇ｼ・<b>{fmtNum(Math.round(y3.sales))}</b>
                  {baseForDelta.year0Sales ? (
                    <>
                      {' '}
                      ・医・繝ｼ繧ｹ{' '}
                      {fmtNum(
                        Math.round(baseForDelta.year0Sales),
                      )}
                      竊・
                      {Math.round(
                        (y3.sales /
                          (baseForDelta.year0Sales || 1)) *
                          100,
                      )}
                      %・・
                    </>
                  ) : null}
                </li>
                <li>
                  Y3 蝟ｶ讌ｭ蛻ｩ逶奇ｼ嘴' '}
                  <b>{fmtNum(Math.round(y3.op))}</b>
                  {baseForDelta.year0Op ? (
                    <>
                      {' '}
                      ・医・繝ｼ繧ｹ{' '}
                      {fmtNum(Math.round(baseForDelta.year0Op))}
                      竊・
                      {Math.round(
                        (y3.op /
                          (baseForDelta.year0Op || 1)) *
                          100,
                      )}
                      %・・
                    </>
                  ) : null}
                </li>
                <li>
                  謌仙粥遒ｺ邇・ｼ域怙邨ゑｼ会ｼ嘴' '}
                  <b>{Math.round(finalProb * 100)}%</b>
                </li>
              </ul>
            ) : (
              <p className="text-[13px] text-slate-400">
                隧ｦ邂励し繝槭Μ繝ｼ繧定｡ｨ遉ｺ縺ｧ縺阪ｋ繝・・繧ｿ縺後≠繧翫∪縺帙ｓ縲・
              </p>
            )}
          </div>

          <div className="mt-2 flex flex-col gap-2">
            <button
              onClick={() => {
                if (isHydrating) {
                  setNotice(
                    '笞・・隱ｭ縺ｿ霎ｼ縺ｿ荳ｭ縺ｯ蜀崎ｨ育ｮ励Γ繝・そ繝ｼ繧ｸ縺ｮ縺ｿ陦ｨ遉ｺ縺励∪縺吶・,
                  );
                  setTimeout(() => setNotice(''), 2500);
                  return;
                }
                setNotice(
                  '邃ｹ・・STEP1縲・ 縺ｮ蜈･蜉帶峩譁ｰ縺斐→縺ｫ縲・蟷ｴ莠域ｸｬ縺ｯ閾ｪ蜍慕噪縺ｫ蜀崎ｨ育ｮ励＆繧後※縺・∪縺吶・,
                );
                setTimeout(() => setNotice(''), 3000);
              }}
              disabled={isHydrating}
              className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-[13px] text-slate-800 shadow-sm hover:bg-slate-50 disabled:opacity-60"
            >
              譁ｽ遲門ｽｱ髻ｿ繧貞・遒ｺ隱・
            </button>
            <button
              disabled={saving || !userId || isHydrating}
              onClick={handleSave}
              className="w-full rounded-xl border border-emerald-300 bg-emerald-50 px-3 py-2 text-[13px] text-emerald-800 shadow-sm hover:bg-emerald-100 disabled:opacity-60"
            >
              {saving ? '菫晏ｭ倅ｸｭ窶ｦ' : '縺薙・隧ｦ邂励ｒ螻･豁ｴ縺ｫ菫晏ｭ・}
            </button>
            {!userId && (
              <p className="text-[11px] text-slate-500">
                繝ｭ繧ｰ繧､繝ｳ縺吶ｋ縺ｨ縲√す繝溘Η繝ｬ繝ｼ繧ｷ繝ｧ繝ｳ螻･豁ｴ繧剃ｿ晏ｭ倥〒縺阪∪縺吶・
              </p>
            )}
          </div>
        </div>
      </section>

      {/* 竭｢ OKR 竊・PL・亥・遉ｾ繝ｻ譁ｰ繧ｨ繝ｳ繧ｸ繝ｳ・・*/}
      <section className="mb-8 rounded-3xl border border-slate-200 bg-white p-5 shadow-md md:p-6">
        <div className="mb-4 flex flex-col gap-2 md:flex-row md:items-end md:justify-between">
          <div>
            <h2 className="text-[15px] font-semibold text-slate-900 md:text-[16px]">
              OKR 竊・PL・域焚驥・ﾃ・蜊倅ｾ｡ ﾃ・邯咏ｶ夂紫 繝吶・繧ｹ・・
            </h2>
            <p className="mt-1 text-[13px] text-slate-600">
              STEP4 縺ｧ險ｭ螳壹＠縺・
              <span className="font-medium">讒矩蛹訪R</span>
              繧剃ｿよ焚縺ｫ螟画鋤縺励√・繝ｼ繧ｹ縺ｨ縺ｪ繧・PL 霆碁％縺ｫ驥阪・縺ｦ縲・
              <span className="font-medium">
                螢ｲ荳翫・COGS繝ｻSG&A繝ｻ蝟ｶ讌ｭ蛻ｩ逶・
              </span>
              縺ｮ螟牙喧繧定ｩｦ邂励＠縺ｾ縺吶・
            </p>
          </div>
          <div className="text-[12px] text-slate-500">
            讒矩蛹訪R 莉ｶ謨ｰ・嘴' '}
            <span className="font-semibold text-slate-900">
              {allKRs.length}
            </span>
          </div>
        </div>

        {!hasAnyServerBackedContent ? (
          <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4 text-[13px] text-slate-600">
            謌ｦ逡･繝・・繧ｿ縺後∪縺辟｡縺・◆繧√￣L繧ｷ繝溘Η繝ｬ繝ｼ繧ｷ繝ｧ繝ｳ縺ｯ陦ｨ遉ｺ縺ｧ縺阪∪縺帙ｓ縲・
            STEP3 縺ｮ雋｡蜍吶し繝槭Μ繝ｼ / STEP4 縺ｮCSV 縺ｨ 讒矩蛹訪R 繧定ｨｭ螳壹＠縺ｦ縺上□縺輔＞縲・
          </div>
        ) : (
          <>
            {/* 繝吶・繧ｹ譚｡莉ｶ */}
            <div className="mb-4 rounded-2xl border border-slate-200 bg-slate-50 p-4">
              <div className="mb-3 flex items-center justify-between gap-2">
                <div>
                  <h3 className="text-[14px] font-medium text-slate-900">
                    繝吶・繧ｹ譚｡莉ｶ・育樟蝨ｨ縺ｮ莠区･ｭ縺ｮ迥ｶ諷具ｼ・
                  </h3>
                  <p className="mt-1 text-[12px] text-slate-500">
                    STEP4 縺ｮCSV / STEP3 縺ｮ雋｡蜍吶し繝槭Μ繝ｼ縺九ｉ謗ｨ螳壹＠縺滓怦谺｡繝吶・繧ｹ繧貞・譛溷､縺ｫ縺励※縺・∪縺吶・
                    蠢・ｦ√↓蠢懊§縺ｦ蠕ｮ隱ｿ謨ｴ縺励※縺上□縺輔＞縲・
                  </p>
                </div>
                <div className="text-right text-[11px] text-slate-500">
                  繝吶・繧ｹ譛域ｬ｡螢ｲ荳奇ｼ域耳螳夲ｼ会ｼ・
                  <br />
                  <span className="font-semibold text-slate-900">
                    {fmtJPY(derivedBase.monthlyRevenue)}
                  </span>
                </div>
              </div>

              <div className="grid gap-3 md:grid-cols-3">
                <div>
                  <div className="text-[11px] text-slate-500">
                    譛滄俣・・YYY-MM・・
                  </div>
                  <div className="mt-1 grid grid-cols-[1.1fr_1.1fr_auto] gap-2">
                    <input
                      className="h-9 rounded-xl border border-slate-300 bg-white px-3 text-[13px] text-slate-900"
                      value={startYm}
                      onChange={(e) =>
                        setStartYm(e.target.value as Ym)
                      }
                    />
                    <input
                      className="h-9 rounded-xl border border-slate-300 bg-white px-3 text-[13px] text-slate-900"
                      value={endYm}
                      onChange={(e) =>
                        setEndYm(e.target.value as Ym)
                      }
                    />
                    <span className="flex items-center text-[11px] text-slate-500">
                      {ymRange(startYm, endYm).length} 繝ｶ譛・
                    </span>
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <Num
                    label="Base 鬘ｧ螳｢謨ｰ・・ty・・
                    value={baseQty}
                    setValue={setBaseQty}
                  />
                  <Num
                    label="Base ARPU・亥・・・
                    value={baseArpu}
                    setValue={setBaseArpu}
                  />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <Num
                    label="Base Churn・育紫・・
                    value={baseChurn}
                    setValue={setBaseChurn}
                    step="0.001"
                  />
                  <Num
                    label="讒矩KR縺ｮ譛滄俣・磯≦陦悟性繧・・
                    value={ymRange(startYm, endYm).length}
                    setValue={() => {
                      /* readonly */
                    }}
                  />
                </div>
              </div>

              <div className="mt-4 grid gap-3 md:grid-cols-3">
                <Num
                  label="蝗ｺ螳夊ｲｻ・亥・・乗怦・・
                  value={baseFixed}
                  setValue={setBaseFixed}
                />
                <Num
                  label="螟牙虚雋ｻ・亥・・乗怦・・
                  value={baseVariable}
                  setValue={setBaseVariable}
                />
                <Num
                  label="莠ｺ莉ｶ雋ｻ・亥・・乗怦・・
                  value={basePersonnel}
                  setValue={setBasePersonnel}
                />
              </div>
            </div>

            {/* 蜈ｨ遉ｾPL繧ｵ繝槭Μ繝ｼ・亥ｹｴ谺｡繝ｻ譛域ｬ｡・・*/}
            <div className="grid gap-5 md:grid-cols-2">
              <section className="rounded-2xl border border-slate-200 bg-white p-4">
                <h3 className="mb-2 text-[14px] font-medium text-slate-900">
                  蟷ｴ谺｡PL・・KR蜿肴丐蠕後・蜈ｨ遉ｾ・・
                </h3>
                {yearly.length ? (
                  <table className="w-full text-[12px] text-slate-800">
                    <thead>
                      <tr className="text-left text-slate-500">
                        <th className="py-2">蟷ｴ蠎ｦ</th>
                        <th className="py-2">螢ｲ荳・/th>
                        <th className="py-2">COGS</th>
                        <th className="py-2">SG&A</th>
                        <th className="py-2">蝟ｶ讌ｭ蛻ｩ逶・/th>
                        <th className="py-2">蛻ｩ逶顔紫</th>
                      </tr>
                    </thead>
                    <tbody>
                      {yearly.map((y: any, idx: number) => {
                        const yearLabel =
                          typeof y.year === 'number'
                            ? Number.isFinite(y.year)
                              ? String(y.year)
                              : `Y${idx + 1}`
                            : typeof y.year === 'string' &&
                              y.year.trim() !== ''
                            ? y.year
                            : `Y${idx + 1}`;

                        return (
                          <tr
                            key={idx}
                            className="border-t border-slate-200"
                          >
                            <td className="py-2">{yearLabel}</td>
                            <td className="py-2">
                              {fmtJPY(y.revenue)}
                            </td>
                            <td className="py-2">
                              {fmtJPY(y.cogs)}
                            </td>
                            <td className="py-2">
                              {fmtJPY(y.sga)}
                            </td>
                            <td className="py-2">
                              {fmtJPY(y.op_income)}
                            </td>
                            <td className="py-2">
                              {(y.margin * 100).toFixed(1)}%
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                ) : (
                  <div className="text-[13px] text-slate-500">
                    陦ｨ遉ｺ縺ｧ縺阪ｋ蟷ｴ谺｡PL縺後≠繧翫∪縺帙ｓ縲・
                    讒矩蛹訪R・・krsV2・峨ｒ險ｭ螳壹☆繧九→陦ｨ遉ｺ縺輔ｌ縺ｾ縺吶・
                  </div>
                )}
              </section>

              <section className="rounded-2xl border border-slate-200 bg-white p-4">
                <h3 className="mb-2 text-[14px] font-medium text-slate-900">
                  譛域ｬ｡繝上う繝ｩ繧､繝茨ｼ育峩霑・繝ｶ譛医・蜈ｨ遉ｾ・・
                </h3>
                {monthly.length ? (
                  <table className="w-full text-[12px] text-slate-800">
                    <thead>
                      <tr className="text-left text-slate-500">
                        <th className="py-2">譛・/th>
                        <th className="py-2">Qty</th>
                        <th className="py-2">ARPU</th>
                        <th className="py-2">螢ｲ荳・/th>
                        <th className="py-2">COGS</th>
                        <th className="py-2">SG&A</th>
                        <th className="py-2">蝟ｶ讌ｭ蛻ｩ逶・/th>
                      </tr>
                    </thead>
                    <tbody>
                      {monthly.slice(-3).map((m: any) => (
                        <tr
                          key={m.ym}
                          className="border-t border-slate-200"
                        >
                          <td className="py-2">{m.ym}</td>
                          <td className="py-2">
                            {m.qty.toLocaleString()}
                          </td>
                          <td className="py-2">
                            {fmtJPY(m.arpu)}
                          </td>
                          <td className="py-2">
                            {fmtJPY(m.revenue)}
                          </td>
                          <td className="py-2">
                            {fmtJPY(m.cogs)}
                          </td>
                          <td className="py-2">
                            {fmtJPY(m.sga)}
                          </td>
                          <td className="py-2">
                            {fmtJPY(m.op_income)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                ) : (
                  <div className="text-[13px] text-slate-500">
                    陦ｨ遉ｺ縺ｧ縺阪ｋ譛域ｬ｡繝・・繧ｿ縺後≠繧翫∪縺帙ｓ縲・
                  </div>
                )}
              </section>
            </div>

            {/* 驛ｨ髢蛻･繧ｷ繝溘Η繝ｬ繝ｼ繧ｷ繝ｧ繝ｳ・医・繝ｼ繧ｿ・・*/}
            <div className="mt-6 rounded-2xl border border-slate-200 bg-slate-50 p-4">
              <div className="mb-3 flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
                <div>
                  <h3 className="text-[14px] font-medium text-slate-900">
                    驛ｨ髢蛻･繧ｷ繝溘Η繝ｬ繝ｼ繧ｷ繝ｧ繝ｳ・郁ｩｦ鬨鍋沿・・
                  </h3>
                  <p className="mt-1 text-[12px] text-slate-500">
                    驕ｸ謚槭＠縺滄Κ髢縺ｮ讒矩蛹訪R縺ｮ縺ｿ繧帝←逕ｨ縺励◆蝣ｴ蜷医・
                    PL繧､繝ｳ繝代け繝医ｒ陦ｨ遉ｺ縺励∪縺呻ｼ亥・遉ｾ繝吶・繧ｹ縺ｫ蟇ｾ縺吶ｋ蟇・ｸ弱・讎らｮ励〒縺呻ｼ峨・
                  </p>
                </div>
                <div className="flex items-center gap-2 text-[12px] text-slate-600">
                  <span>蟇ｾ雎｡驛ｨ髢・・/span>
                  <select
                    className="h-8 rounded-xl border border-slate-300 bg-white px-2 text-[12px]"
                    value={selectedDeptKey}
                    onChange={(e) =>
                      setSelectedDeptKey(e.target.value)
                    }
                  >
                    {deptOptions.map((opt) => (
                      <option key={opt.key} value={opt.key}>
                        {opt.label}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              {!deptOptions.length ? (
                <p className="text-[13px] text-slate-500">
                  驛ｨ髢繝・・繧ｿ縺悟ｭ伜惠縺励↑縺・◆繧√・Κ髢蛻･繧ｷ繝溘Η繝ｬ繝ｼ繧ｷ繝ｧ繝ｳ縺ｯ陦ｨ遉ｺ縺ｧ縺阪∪縺帙ｓ縲・
                </p>
              ) : !deptKRs.length ? (
                <p className="text-[13px] text-slate-500">
                  驕ｸ謚樔ｸｭ縺ｮ驛ｨ髢縲鶏selectedDeptLabel}
                  縲阪↓縺ｯ讒矩蛹訪R縺瑚ｨｭ螳壹＆繧後※縺・∪縺帙ｓ縲・
                </p>
              ) : !deptYearly.length ? (
                <p className="text-[13px] text-slate-500">
                  陦ｨ遉ｺ縺ｧ縺阪ｋPL繝・・繧ｿ縺後≠繧翫∪縺帙ｓ縲・
                </p>
              ) : (
                <div className="grid gap-4 md:grid-cols-2">
                  <section className="rounded-2xl border border-slate-200 bg-white p-3">
                    <h4 className="mb-2 text-[13px] font-medium text-slate-900">
                      蟷ｴ谺｡PL・磯Κ髢蟇・ｸ主・縺ｮ讎らｮ暦ｼ・
                    </h4>
                    <table className="w-full text-[11px] text-slate-800">
                      <thead>
                        <tr className="text-left text-slate-500">
                          <th className="py-1">蟷ｴ蠎ｦ</th>
                          <th className="py-1">螢ｲ荳・/th>
                          <th className="py-1">COGS</th>
                          <th className="py-1">SG&A</th>
                          <th className="py-1">蝟ｶ讌ｭ蛻ｩ逶・/th>
                          <th className="py-1">蛻ｩ逶顔紫</th>
                        </tr>
                      </thead>
                      <tbody>
                        {deptYearly.map((y: any, idx: number) => {
                          const yearLabel =
                            typeof y.year === 'number'
                              ? Number.isFinite(y.year)
                                ? String(y.year)
                                : `Y${idx + 1}`
                              : typeof y.year === 'string' &&
                                y.year.trim() !== ''
                              ? y.year
                              : `Y${idx + 1}`;

                          return (
                            <tr
                              key={idx}
                              className="border-t border-slate-200"
                            >
                              <td className="py-1">{yearLabel}</td>
                              <td className="py-1">
                                {fmtJPY(y.revenue)}
                              </td>
                              <td className="py-1">
                                {fmtJPY(y.cogs)}
                              </td>
                              <td className="py-1">
                                {fmtJPY(y.sga)}
                              </td>
                              <td className="py-1">
                                {fmtJPY(y.op_income)}
                              </td>
                              <td className="py-1">
                                {(y.margin * 100).toFixed(1)}%
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </section>

                  <section className="rounded-2xl border border-slate-200 bg-white p-3">
                    <h4 className="mb-2 text-[13px] font-medium text-slate-900">
                      譛域ｬ｡繝上う繝ｩ繧､繝茨ｼ育峩霑・繝ｶ譛医・驛ｨ髢・・
                    </h4>
                    <table className="w-full text-[11px] text-slate-800">
                      <thead>
                        <tr className="text-left text-slate-500">
                          <th className="py-1">譛・/th>
                          <th className="py-1">螢ｲ荳・/th>
                          <th className="py-1">COGS</th>
                          <th className="py-1">SG&A</th>
                          <th className="py-1">蝟ｶ讌ｭ蛻ｩ逶・/th>
                        </tr>
                      </thead>
                      <tbody>
                        {deptMonthly.slice(-3).map((m: any) => (
                          <tr
                            key={m.ym}
                            className="border-t border-slate-200"
                          >
                            <td className="py-1">{m.ym}</td>
                            <td className="py-1">
                              {fmtJPY(m.revenue)}
                            </td>
                            <td className="py-1">
                              {fmtJPY(m.cogs)}
                            </td>
                            <td className="py-1">
                              {fmtJPY(m.sga)}
                            </td>
                            <td className="py-1">
                              {fmtJPY(m.op_income)}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </section>
                </div>
              )}

              <p className="mt-2 text-[11px] text-slate-500">
                窶ｻ 驛ｨ髢蛻･繧ｷ繝溘Η繝ｬ繝ｼ繧ｷ繝ｧ繝ｳ縺ｯ縲∵欠螳夐Κ髢縺ｮ讒矩蛹訪R縺縺代ｒ驕ｩ逕ｨ縺励◆蝣ｴ蜷医・
                縲後・繝ｼ繧ｹPL縺ｫ蟇ｾ縺吶ｋ蟇・ｸ主・縲阪・讎らｮ励〒縺吶るΚ髢髢薙・逶ｸ莠剃ｽ懃畑縺ｾ縺ｧ縺ｯ蜿肴丐縺励※縺・∪縺帙ｓ縲・
              </p>
            </div>

            {/* 莠区･ｭ繝昴・繝医ヵ繧ｩ繝ｪ繧ｪ蛻･繧､繝ｳ繝代け繝茨ｼ・TEP2・・*/}
            <div className="mt-6 rounded-2xl border border-slate-200 bg-slate-50 p-4">
              <h3 className="mb-2 text-[14px] font-medium text-slate-900">
                莠区･ｭ繝昴・繝医ヵ繧ｩ繝ｪ繧ｪ蛻･繧､繝ｳ繝代け繝茨ｼ・3 讎らｮ暦ｼ・
              </h3>
              {!businessUnits.length ? (
                <p className="text-[13px] text-slate-500">
                  STEP2 縺ｮ莠区･ｭ繝昴・繝医ヵ繧ｩ繝ｪ繧ｪ縺梧悴險ｭ螳壹・縺溘ａ縲∽ｺ区･ｭ蛻･繧､繝ｳ繝代け繝医・陦ｨ遉ｺ縺ｧ縺阪∪縺帙ｓ縲・
                </p>
              ) : !businessImpactY3.length ? (
                <p className="text-[13px] text-slate-500">
                  Y3縺ｮPL隧ｦ邂励′辟｡縺・◆繧√∽ｺ区･ｭ蛻･繧､繝ｳ繝代け繝医・陦ｨ遉ｺ縺ｧ縺阪∪縺帙ｓ縲・
                </p>
              ) : (
                <>
                  <table className="w-full text-[12px] text-slate-800">
                    <thead>
                      <tr className="text-left text-slate-500">
                        <th className="py-2">莠区･ｭ</th>
                        <th className="py-2">繝昴・繝医ヵ繧ｩ繝ｪ繧ｪ豈皮紫</th>
                        <th className="py-2">Y3 螢ｲ荳・/th>
                        <th className="py-2">Y3 蝟ｶ讌ｭ蛻ｩ逶・/th>
                        <th className="py-2">蛻ｩ逶顔紫</th>
                      </tr>
                    </thead>
                    <tbody>
                      {businessImpactY3.map((b: any) => (
                        <tr
                          key={b.key}
                          className="border-t border-slate-200"
                        >
                          <td className="py-2">{b.label}</td>
                          <td className="py-2">{b.shareDisplay}</td>
                          <td className="py-2">
                            {fmtJPY(b.revenue)}
                          </td>
                          <td className="py-2">
                            {fmtJPY(b.op)}
                          </td>
                          <td className="py-2">
                            {b.margin.toFixed(1)}%
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  <p className="mt-2 text-[11px] text-slate-500">
                    窶ｻ 莠区･ｭ蛻･繧､繝ｳ繝代け繝医・縲ヾTEP2 縺ｮ繝昴・繝医ヵ繧ｩ繝ｪ繧ｪ豈皮紫縺ｧ
                    蜈ｨ遉ｾY3 PL繧呈潔蛻・＠縺滓ｦらｮ励〒縺吶ゆｺ区･ｭ縺斐→縺ｫ逡ｰ縺ｪ繧規R蠑ｷ蠎ｦ繝ｻ
                    繧ｳ繧ｹ繝域ｧ矩縺ｾ縺ｧ縺ｯ縺ｾ縺蜿肴丐縺励※縺・∪縺帙ｓ縲・
                  </p>
                </>
              )}
            </div>

            {/* 髢狗匱閠・髄縺托ｼ壽ｧ矩蛹訪R / Bridge Delta 縺ｮ謚懃ｲ具ｼ域釜繧翫◆縺溘∩・・*/}
            <details className="mt-5 rounded-2xl border border-slate-200 bg-slate-50 p-4 text-[12px] text-slate-700">
              <summary className="cursor-pointer text-[12px] font-medium text-slate-900">
                髢狗匱閠・髄縺題ｩｳ邏ｰ・域ｧ矩蛹訪R / Bridge Deltas 繧堤｢ｺ隱搾ｼ・
              </summary>
              <div className="mt-3 grid gap-4 md:grid-cols-2">
                <div>
                  <div className="text-[11px] text-slate-500">
                    讒矩蛹訪R 萓具ｼ亥・鬆ｭ5莉ｶ・・
                  </div>
                  <pre className="mt-1 max-h-56 overflow-auto rounded-xl bg-white p-3 text-[11px] text-slate-800">
                    {JSON.stringify(allKRs.slice(0, 5), null, 2)}
                  </pre>
                </div>
                <div>
                  <div className="text-[11px] text-slate-500">
                    Bridge Deltas 謚懃ｲ具ｼ域怙蛻昴・謨ｰ繝ｶ譛医・縺ｿ・・
                  </div>
                  <pre className="mt-1 max-h-56 overflow-auto rounded-xl bg-white p-3 text-[11px] text-slate-800">
                    {JSON.stringify(
                      monthly.length
                        ? {
                            arpu: Object.fromEntries(
                              Object.entries(
                                buildBridgeDeltas(bridgeInput).arpu,
                              ).slice(0, 3),
                            ),
                            acq: Object.fromEntries(
                              Object.entries(
                                buildBridgeDeltas(bridgeInput).acq,
                              ).slice(0, 3),
                            ),
                            churn: Object.fromEntries(
                              Object.entries(
                                buildBridgeDeltas(bridgeInput).churn,
                              ).slice(0, 3),
                            ),
                          }
                        : {},
                      null,
                      2,
                    )}
                  </pre>
                </div>
              </div>
            </details>
          </>
        )}
      </section>

      {/* 竭｣ AI繧､繝ｳ繧ｵ繧､繝・*/}
      <section className="mb-8 rounded-3xl border border-slate-200 bg-white p-4 shadow-md">
        <h2 className="mb-2 text-[15px] font-semibold text-slate-900">
          AI 繧､繝ｳ繧ｵ繧､繝・
        </h2>
        <p className="mb-3 text-[13px] text-slate-600">
          迴ｾ蝨ｨ縺ｮ謌ｦ逡･繝ｻ繝昴・繝医ヵ繧ｩ繝ｪ繧ｪ繝ｻOKR繝ｻ繧ｷ繝溘Η繝ｬ繝ｼ繧ｷ繝ｧ繝ｳ邨先棡繧偵ｂ縺ｨ縺ｫ縲・
          AI縺檎捩逵ｼ轤ｹ繧・Μ繧ｹ繧ｯ縲∵ｬ｡縺ｮ荳謇九・繧｢繧､繝・い繧呈署遉ｺ縺励∪縺吶・
        </p>
        <CoreInsightPanel />
      </section>

      {/* 竭､ 螻･豁ｴ */}
      <section className="mb-4 rounded-3xl border border-slate-200 bg-white p-4 shadow-md">
        <div className="mb-2 flex items-center justify-between gap-2">
          <h2 className="text-[15px] font-medium text-slate-900">
            繧ｷ繝溘Η繝ｬ繝ｼ繧ｷ繝ｧ繝ｳ螻･豁ｴ
          </h2>
          <button
            onClick={loadHistory}
            disabled={isHydrating}
            className="rounded-xl border border-slate-200 bg-white px-2 py-1 text-[11px] text-slate-700 hover:bg-slate-50 disabled:opacity-60"
          >
            蜀崎ｪｭ縺ｿ霎ｼ縺ｿ
          </button>
        </div>
        {loadingHist ? (
          <p className="text-[13px] text-slate-500">隱ｭ縺ｿ霎ｼ縺ｿ荳ｭ窶ｦ</p>
        ) : !hasAnyServerBackedContent ? (
          <p className="text-[13px] text-slate-500">
            謌ｦ逡･繝・・繧ｿ縺後↑縺・◆繧√∝ｱ･豁ｴ縺ｯ縺ｾ縺縺ゅｊ縺ｾ縺帙ｓ縲・
          </p>
        ) : history.length === 0 ? (
          <p className="text-[13px] text-slate-500">
            繧ｷ繝溘Η繝ｬ繝ｼ繧ｷ繝ｧ繝ｳ螻･豁ｴ縺後≠繧翫∪縺帙ｓ縲・
          </p>
        ) : (
          <ul className="divide-y divide-slate-200">
            {history.map((row) => {
              const body =
                (row as any).payload ??
                (row as any).log ??
                (row as any).data ??
                {};
              const proj = body?.projection?.points ?? [];
              const last =
                Array.isArray(proj) && proj.length > 0
                  ? proj[proj.length - 1]
                  : null;
              const prob =
                typeof body?.finalProb === 'number'
                  ? Math.round(body.finalProb * 100)
                  : null;

              const label =
                (row as any).title ||
                new Date(row.created_at).toLocaleString();

              return (
                <li key={row.id} className="py-2 text-[13px]">
                  <div className="flex items-center justify-between gap-2">
                    <div>
                      <div className="font-medium text-slate-900">
                        {label}
                        {row.category ? `・・{row.category}・荏 : ''}
                      </div>
                      <div className="text-[12px] text-slate-500">
                        {last
                          ? `Y3: 螢ｲ荳・${fmtNum(
                              last.sales,
                            )} / 蝟ｶ讌ｭ蛻ｩ逶・${fmtNum(last.op)}`
                          : '窶・}
                        {typeof prob === 'number'
                          ? ` 繝ｻ 謌仙粥遒ｺ邇・${prob}%`
                          : ''}
                      </div>
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </>
  );
}

/* ============ 蟆上＆縺ｪ邨ｱ險医き繝ｼ繝・============ */
function StatCard({
  label,
  value,
  caption,
}: {
  label: string;
  value: string;
  caption?: string;
}) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-white/70 px-3 py-3 shadow-inner">
      <div className="text-[11px] text-slate-500">{label}</div>
      <div className="mt-1 text-[17px] font-semibold text-slate-900">
        {value}
      </div>
      {caption && (
        <div className="mt-1 text-[11px] text-slate-500">
          {caption}
        </div>
      )}
    </div>
  );
}
