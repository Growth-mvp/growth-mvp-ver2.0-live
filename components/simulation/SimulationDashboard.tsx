// /components/simulation/SimulationDashboard.tsx

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
} from '@/utils/simulationBridge';
import {
  simulateMonthlyPL,
  aggregateYearly,
  type BaseTrajectory,
} from '@/utils/financeSimulation';
import { okrsV2ToKRStruct } from '@/utils/okrToFinance';

// 遅延読み込み（AIインサイト）
const CoreInsightPanel = dynamic(
  () => import('@/components/insight/CoreInsightPanel'),
  {
    ssr: false,
    loading: () => null,
  },
);

/* ============ 小物ユーティリティ ============ */
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

/* ============ YM ユーティリティ ============ */
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

/* ============ OKR / Trajectory ユーティリティ ============ */
/** 部門情報をメタデータとして付与した構造化KR一覧を作る */
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
      (d as any).name ?? (d as any).departmentName ?? `部門${idx + 1}`;

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
 * ベース軌道生成：年率成長率を考慮したフラット＋成長付きトラック
 * annualGrowthRate: 0.05 なら年 +5%、-0.05 なら年 -5%
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
    // idx ヶ月目 → 年換算 idx/12 年後
    const tYears = hasGrowth ? idx / 12 : 0;
    const factor = hasGrowth ? Math.pow(1 + annualGrowthRate, tYears) : 1;

    // ベースでは Qty に成長率を乗せる（ARPU / churn は一定と仮定）
    const qty = v.qty * factor;

    qtyMonthly[m] = qty;
    arpuMonthly[m] = v.arpu;
    churnMonthly[m] = v.churn;
    fixedCostMonthly[m] = v.fixed; // 固定費は一定とする
    variableCostMonthly[m] = v.variable * factor; // 変動費は Qty に比例
    personnelCostMonthly[m] = v.personnel; // 人件費も一定（必要あれば後で拡張）
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

/* ============ 「実質空」判定 ============ */
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

/* ============ 財務サマリー / CSV → ベース軌道の推定 ============ */

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
 * financeSummary / csvFinanceData からベース年度の売上・利益を推定し、
 * 月次売上・コスト・Qty などのベース値を算出する。
 */
function deriveBaseFromStrategy(strategy: any): DerivedBase {
  // ★ カンマ付き文字列や通貨記号を安全に数値化
  const num = (v: any): number => {
    if (v === undefined || v === null || v === '') return 0;
    if (typeof v === 'number') {
      return Number.isFinite(v) ? v : 0;
    }
    if (typeof v === 'string') {
      const trimmed = v.trim();
      if (!trimmed) return 0;
      // カンマ・空白・円記号などを除去
      const normalized = trimmed.replace(/[,\s￥¥]/g, '');
      const n = Number(normalized);
      return Number.isFinite(n) ? n : 0;
    }
    const n = Number(v);
    return Number.isFinite(n) ? n : 0;
  };

  /* ---------- financeSummary の正規化 ---------- */
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
      row['年度'] ??
      row['year'];

    if (raw === undefined || raw === null) return null;
    const s = String(raw).trim();
    if (!s) return null;

    // "FY2024" / "2024/03" などから 4桁年を優先して抽出
    const m = s.match(/\d{4}/);
    return m ? m[0] : s;
  };

  const isYearTotalRow = (row: any): boolean => {
    if (row.isTotal || row.is_total || row.isYearTotal) return true;

    const kind = String(row.kind ?? row.rowType ?? '').trim().toUpperCase();
    if (kind === 'TOTAL' || kind === '年度合計') return true;

    const unitName = String(
      row.unitName ??
        row.unit ??
        row.segment ??
        row.businessName ??
        row.label ??
        '',
    ).trim();

    if (!unitName) return false;
    // 「年度合計」「全社合計」「合計」などを TOTAL とみなす
    if (
      unitName.includes('年度合計') ||
      unitName.includes('全社合計') ||
      (unitName.includes('合計') && !unitName.includes('小計'))
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
    // 年度ごとにグルーピング
    const byYear = new Map<string, { all: any[]; totals: any[] }>();

    for (const r of fsRows) {
      const y = getYearKey(r);
      if (!y) continue;

      const revenue = num(
        r.revenue ??
          r.sales ??
          r.netSales ??
          r['売上高'] ??
          r['売上'] ??
          r['売上収益'],
      );
      const op = num(
        r.operatingIncome ??
          r.operating_profit ??
          r.operatingProfit ??
          r.op ??
          r['営業利益'],
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
      // 最新年度を決める（数字があれば数値として比較）
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
          // 営業利益が 0 の場合は 10% マージンを仮置き
          annualOp = sumOp || annualSales * 0.1;
        }
      }
    }
  }

  /* ---------- financeSummary から取れなかった場合：CSV にフォールバック ---------- */
  if (!annualSales) {
    const csv: any[] = Array.isArray(strategy?.csvFinanceData)
      ? strategy.csvFinanceData
      : [];

    if (csv.length > 0) {
      // ★ CSV も「最新年度 × 全事業合計」で集計
      const numCsv = (v: any) => num(v);

      const getYearFromCsv = (row: any): string | null => {
        const raw =
          row.year ?? row.fiscalYear ?? row.fy ?? row['年度'] ?? row['year'];
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
            numCsv(row['売上高']) ||
            numCsv(row['売上']) ||
            numCsv(row['売上収益']);
          csvSales += rev;

          const op =
            numCsv(row.operatingProfit) ||
            numCsv(row.op) ||
            numCsv(row['営業利益']) ||
            0;
          csvOp += op;
        }
      } else {
        // 年度情報が無い場合は全行合計を使用
        for (const row of csv) {
          const rev =
            numCsv(row.sales) ||
            numCsv(row.revenue) ||
            numCsv(row['売上高']) ||
            numCsv(row['売上']) ||
            numCsv(row['売上収益']);
          csvSales += rev;

          const op =
            numCsv(row.operatingProfit) ||
            numCsv(row.op) ||
            numCsv(row['営業利益']) ||
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

  /* ---------- 最終的に annualSales がまだ 0 の場合はゼロベース ---------- */
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

  /* ---------- annualCogs / annualSga の分解（50:50） ---------- */
  const grossForCogsAndSga = annualSales - annualOp;
  if (grossForCogsAndSga > 0) {
    annualCogs = grossForCogsAndSga / 2;
    annualSga = grossForCogsAndSga / 2;
  } else {
    // 営業利益が売上を超えているなど、異常なケースではとりあえず 40:40:20 に分解
    annualCogs = annualSales * 0.4;
    annualSga = annualSales * 0.4;
    annualOp = annualSales - annualCogs - annualSga;
  }

  const monthlyRevenue = annualSales / 12;
  const monthlyCogs = annualCogs / 12;
  const monthlySga = annualSga / 12;

  const defaultChurn = 0.02; // 月次 2% をデフォルト
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

/* ============ 事業ポートフォリオ → ベース成長率 ============ */

/**
 * businessPortfolio.units の「シェア × 成長率」の加重平均から、
 * 会社全体の年率成長率（何もしなかった場合のベースライン）を推定する。
 * - 成長率は -0.05 や 0.1 のような比率、あるいは -5, +10 のような％表記を想定
 * - 単位の混在にも耐えるよう、|g| <= 1 はそのまま比率、|g| > 1 は 100 で割って％とみなす
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
      const normalized = v.replace(/[,\s％%]/g, '');
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
            u['比率'],
        ) || 0;

      let g = num(
        u.growthRate ??
          u.growth ??
          u.growthPct ??
          u.expectedGrowth ??
          u['成長率'],
      );

      // |g| <= 1 ならそのまま比率、|g| > 1 なら ％表記とみなして 100 で割る
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

  return weightedGrowth; // 例: -0.05 = -5%/year
}

/* ============ チャート用ツールチップ ============ */
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
        <div>売上：{fmtJPY(p.sales)}</div>
      )}
      {typeof p.op === 'number' && (
        <div>営業利益：{fmtJPY(p.op)}</div>
      )}
      {typeof p.probPct === 'number' && (
        <div>成功確率：{p.probPct.toFixed(0)}%</div>
      )}
    </div>
  );
}

/* ============ 小さい数値入力 ============ */
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

  /* ---------------- 共通：部門 & 構造化KR（okrsV2） ---------------- */

  const departments: Department[] = Array.isArray(s?.departments)
    ? s.departments
    : [];

  const allKRs = useMemo(
    () => collectAllKRs(departments),
    [departments],
  );

  /* ---------------- Ver4：OKR→PL シミュレーション本体 ---------------- */

  const derivedBase = useMemo(
    () => deriveBaseFromStrategy(s),
    [s],
  );

  // ★ 追加：事業ポートフォリオから年率成長率を推定
  const portfolioGrowth = useMemo(
    () => derivePortfolioGrowth(s),
    [s],
  );

  // デバッグ用ログ
  console.log('[SIM] derivedBase', derivedBase);
  console.log('[SIM] portfolioGrowth (annual)', portfolioGrowth);

  // 期間（デフォルトは 3年分：2025-04 〜 2028-03）
  const [startYm, setStartYm] = useState<Ym>('2025-04');
  const [endYm, setEndYm] = useState<Ym>('2028-03');

  // ベース値（初期値は財務サマリー/CSVから推定）
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

  // 財務基準が変わったらベース値を更新（会社切替時など）
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
      // ACQベース：現状維持に必要な新規獲得数として Churn × Qty
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
        portfolioGrowth, // ★ ポートフォリオの年率成長をベースラインに反映
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

  // ★ デバッグ：OKRからのデルタ（最初の数ヶ月だけ確認）
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

  // ★ デバッグ：年次PL（Y1〜Y3の売上・営業利益）
  console.log('[SIM] yearly', yearly);

  /* ---------------- 構造化KR → 成功確率用のKRStruct ---------------- */

  const krsForProb: KRStruct[] = useMemo(
    () => okrsV2ToKRStruct(allKRs),
    [allKRs],
  );

  /* ---------------- 上部：3年（or 期間）予測 ＆ 成功確率 ---------------- */

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

    // ★ 修正：3年分（Y1〜Y3）に限定しつつ、年ラベルは相対的に Y1, Y2, Y3 として扱う
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

  /* ---------------- 部門別シミュレーション用 ---------------- */

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
          (d as any).name ?? (d as any).departmentName ?? `部門${idx + 1}`;
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

  /* ---------------- 事業ポートフォリオ（STEP2）別インパクト ---------------- */

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
        u.label ?? u.name ?? u.businessName ?? `事業${idx + 1}`,
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

    // シェアの正規化（全部0なら均等割り）
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

  /* ---------------- 保存＆履歴 ---------------- */

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
      setNotice('❌ シミュレーション履歴の取得に失敗しました');
    } finally {
      setLoadingHist(false);
    }
  }, [userId, hasAnyServerBackedContent]);

  useEffect(() => {
    if (!isHydrating) loadHistory();
  }, [isHydrating, loadHistory]);

  const handleSave = async () => {
    if (!userId) {
      setNotice('⚠️ ログインが必要です');
      return;
    }
    if (isHydrating) {
      setNotice(
        '⚠️ データ読み込み中です。完了後に保存してください。',
      );
      return;
    }
    if (
      !hasAnyServerBackedContent ||
      (projection.points || []).length === 0
    ) {
      setNotice('⚠️ 保存対象のシミュレーション結果がありません');
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
          note: 'auto-saved from /simulation',
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

      setNotice('✅ シミュレーション結果を保存しました');
      await loadHistory();
    } catch (e) {
      console.error('appendSimulationResultToStrategy error:', e);
      setNotice('❌ シミュレーション結果の保存に失敗しました');
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
      {/* Hydration 状態 */}
      {isHydrating && (
        <div className="mb-4 rounded-2xl border border-zinc-200 bg-white px-3 py-2 text-[13px] text-zinc-600 shadow-sm">
          サーバーのデータを読み込み中です…
        </div>
      )}

      {/* メッセージ */}
      {notice && (
        <div
          role="alert"
          className={`mb-4 rounded-2xl border px-3 py-2 text-[13px] shadow-sm ${
            notice.includes('❌')
              ? 'border-rose-200 bg-rose-50 text-rose-700'
              : 'border-emerald-200 bg-emerald-50 text-emerald-700'
          }`}
        >
          {notice}
        </div>
      )}

      {/* データ無しの明示 */}
      {!isHydrating && !hasAnyServerBackedContent && (
        <div className="mb-6 rounded-2xl border border-amber-200 bg-amber-50 px-3 py-2 text-[13px] text-amber-900">
          この会社の戦略データはまだ作成されていません（または全削除済み）です。
          STAGE1〜5で編集・保存すると、ここにシミュレーション結果が表示されます。
        </div>
      )}

      {/* ① ヒーロー：会社全体のインパクト */}
      <section className="mb-8 rounded-3xl bg-gradient-to-br from-white via-slate-50 to-slate-100 p-5 shadow-[0_18px_40px_rgba(15,23,42,0.12)] ring-1 ring-slate-200 md:p-7">
        <div className="flex flex-col gap-6 md:flex-row md:items-end md:justify-between">
          <div className="space-y-3">
            <p className="text-[11px] uppercase tracking-[0.25em] text-slate-400">
              COMPANY IMPACT
            </p>
            <h2 className="text-xl font-semibold text-slate-900 md:text-2xl">
              このOKRをやり切ったとき、業績はどこまで伸びるか？
            </h2>
            <p className="text-[13px] text-slate-600 md:text-sm">
              CSV財務データと、各部門のプロジェクト / 構造化KR をつなぎ、
              <span className="font-medium">売上・営業利益・成功確率</span>
              を一体で試算しています。
            </p>
          </div>

          <div className="grid grid-cols-2 gap-3 md:grid-cols-3 md:gap-4">
            <StatCard
              label="Y3 売上インパクト"
              value={y3 ? fmtJPY(deltaVsBase.deltaSales) : '—'}
              caption={
                y3 ? 'ベース比の増加額（推計）' : 'STEP4のCSV/STEP3の財務サマリーが必要です'
              }
            />
            <StatCard
              label="Y3 営業利益インパクト"
              value={y3 ? fmtJPY(deltaVsBase.deltaOp) : '—'}
              caption={
                y3 ? 'ベース比の増加額（推計）' : 'STEP4のCSV/STEP3の財務サマリーが必要です'
              }
            />
            <StatCard
              label="成功確率"
              value={
                Number.isFinite(finalProb)
                  ? `${Math.round(finalProb * 100)}%`
                  : '—'
              }
              caption={
                krsForProb.length
                  ? '構造化KRの整合性・難易度を加味した成功確率'
                  : '構造化KRの設定が必要です'
              }
            />
          </div>
        </div>
      </section>

      {/* ② 3年予測：指標ごとにグラフを分割 */}
      <section className="mb-8 grid gap-6 md:grid-cols-[minmax(0,2.1fr)_minmax(0,1.1fr)]">
        <div className="rounded-3xl border border-slate-200 bg-white p-4 shadow-md">
          <div className="mb-3 flex items-center justify-between">
            <h3 className="text-[15px] font-medium text-slate-900">
              売上・営業利益・成功確率（3年予測）
            </h3>
            <span className="text-[11px] text-slate-400">
              STEP4 CSV + STEP3 財務サマリー + STEP4 構造化KR
            </span>
          </div>
          {hasAnyServerBackedContent && chartData.length > 0 ? (
            <div className="grid gap-3 md:grid-cols-3">
              {/* 売上 */}
              <div>
                <div className="mb-1 text-[12px] font-medium text-slate-700">
                  売上（年次）
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
                        name="売上"
                        dot={false}
                        stroke="#0ea5e9"
                      />
                    </LineChart>
                  </ResponsiveContainer>
                </div>
              </div>

              {/* 営業利益 */}
              <div>
                <div className="mb-1 text-[12px] font-medium text-slate-700">
                  営業利益（年次）
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
                        name="営業利益"
                        dot={false}
                        stroke="#22c55e"
                      />
                    </LineChart>
                  </ResponsiveContainer>
                </div>
              </div>

              {/* 成功確率 */}
              <div>
                <div className="mb-1 text-[12px] font-medium text-slate-700">
                  成功確率（%）
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
                        name="成功確率"
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
              表示できる予測データがありません。
              <br />
              STEP4 のCSV・STEP3の財務サマリー・各部門の構造化KRを設定すると表示されます。
            </div>
          )}
        </div>

        {/* 試算の要約 */}
        <div className="flex flex-col justify-between gap-4 rounded-3xl border border-slate-200 bg-white p-4 shadow-md">
          <div>
            <h3 className="mb-2 text-[15px] font-medium text-slate-900">
              試算の要約
            </h3>
            {hasAnyServerBackedContent && y3 ? (
              <ul className="space-y-1 text-[13px] text-slate-700">
                <li>
                  Y3 売上： <b>{fmtNum(Math.round(y3.sales))}</b>
                  {baseForDelta.year0Sales ? (
                    <>
                      {' '}
                      （ベース{' '}
                      {fmtNum(
                        Math.round(baseForDelta.year0Sales),
                      )}
                      →
                      {Math.round(
                        (y3.sales /
                          (baseForDelta.year0Sales || 1)) *
                          100,
                      )}
                      %）
                    </>
                  ) : null}
                </li>
                <li>
                  Y3 営業利益：{' '}
                  <b>{fmtNum(Math.round(y3.op))}</b>
                  {baseForDelta.year0Op ? (
                    <>
                      {' '}
                      （ベース{' '}
                      {fmtNum(Math.round(baseForDelta.year0Op))}
                      →
                      {Math.round(
                        (y3.op /
                          (baseForDelta.year0Op || 1)) *
                          100,
                      )}
                      %）
                    </>
                  ) : null}
                </li>
                <li>
                  成功確率（最終）：{' '}
                  <b>{Math.round(finalProb * 100)}%</b>
                </li>
              </ul>
            ) : (
              <p className="text-[13px] text-slate-400">
                試算サマリーを表示できるデータがありません。
              </p>
            )}
          </div>

          <div className="mt-2 flex flex-col gap-2">
            <button
              onClick={() => {
                if (isHydrating) {
                  setNotice(
                    '⚠️ 読み込み中は再計算メッセージのみ表示します。',
                  );
                  setTimeout(() => setNotice(''), 2500);
                  return;
                }
                setNotice(
                  'ℹ️ STEP1〜4 の入力更新ごとに、3年予測は自動的に再計算されています。',
                );
                setTimeout(() => setNotice(''), 3000);
              }}
              disabled={isHydrating}
              className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-[13px] text-slate-800 shadow-sm hover:bg-slate-50 disabled:opacity-60"
            >
              施策影響を再確認
            </button>
            <button
              disabled={saving || !userId || isHydrating}
              onClick={handleSave}
              className="w-full rounded-xl border border-emerald-300 bg-emerald-50 px-3 py-2 text-[13px] text-emerald-800 shadow-sm hover:bg-emerald-100 disabled:opacity-60"
            >
              {saving ? '保存中…' : 'この試算を履歴に保存'}
            </button>
            {!userId && (
              <p className="text-[11px] text-slate-500">
                ログインすると、シミュレーション履歴を保存できます。
              </p>
            )}
          </div>
        </div>
      </section>

      {/* ③ OKR → PL（全社・新エンジン） */}
      <section className="mb-8 rounded-3xl border border-slate-200 bg-white p-5 shadow-md md:p-6">
        <div className="mb-4 flex flex-col gap-2 md:flex-row md:items-end md:justify-between">
          <div>
            <h2 className="text-[15px] font-semibold text-slate-900 md:text-[16px]">
              OKR → PL（数量 × 単価 × 継続率 ベース）
            </h2>
            <p className="mt-1 text-[13px] text-slate-600">
              STEP4 で設定した
              <span className="font-medium">構造化KR</span>
              を係数に変換し、ベースとなる PL 軌道に重ねて、
              <span className="font-medium">
                売上・COGS・SG&A・営業利益
              </span>
              の変化を試算します。
            </p>
          </div>
          <div className="text-[12px] text-slate-500">
            構造化KR 件数：{' '}
            <span className="font-semibold text-slate-900">
              {allKRs.length}
            </span>
          </div>
        </div>

        {!hasAnyServerBackedContent ? (
          <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4 text-[13px] text-slate-600">
            戦略データがまだ無いため、PLシミュレーションは表示できません。
            STEP3 の財務サマリー / STEP4 のCSV と 構造化KR を設定してください。
          </div>
        ) : (
          <>
            {/* ベース条件 */}
            <div className="mb-4 rounded-2xl border border-slate-200 bg-slate-50 p-4">
              <div className="mb-3 flex items-center justify-between gap-2">
                <div>
                  <h3 className="text-[14px] font-medium text-slate-900">
                    ベース条件（現在の事業の状態）
                  </h3>
                  <p className="mt-1 text-[12px] text-slate-500">
                    STEP4 のCSV / STEP3 の財務サマリーから推定した月次ベースを初期値にしています。
                    必要に応じて微調整してください。
                  </p>
                </div>
                <div className="text-right text-[11px] text-slate-500">
                  ベース月次売上（推定）：
                  <br />
                  <span className="font-semibold text-slate-900">
                    {fmtJPY(derivedBase.monthlyRevenue)}
                  </span>
                </div>
              </div>

              <div className="grid gap-3 md:grid-cols-3">
                <div>
                  <div className="text-[11px] text-slate-500">
                    期間（YYYY-MM）
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
                      {ymRange(startYm, endYm).length} ヶ月
                    </span>
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <Num
                    label="Base 顧客数（Qty）"
                    value={baseQty}
                    setValue={setBaseQty}
                  />
                  <Num
                    label="Base ARPU（円）"
                    value={baseArpu}
                    setValue={setBaseArpu}
                  />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <Num
                    label="Base Churn（率）"
                    value={baseChurn}
                    setValue={setBaseChurn}
                    step="0.001"
                  />
                  <Num
                    label="構造KRの期間（遅行含む）"
                    value={ymRange(startYm, endYm).length}
                    setValue={() => {
                      /* readonly */
                    }}
                  />
                </div>
              </div>

              <div className="mt-4 grid gap-3 md:grid-cols-3">
                <Num
                  label="固定費（円／月）"
                  value={baseFixed}
                  setValue={setBaseFixed}
                />
                <Num
                  label="変動費（円／月）"
                  value={baseVariable}
                  setValue={setBaseVariable}
                />
                <Num
                  label="人件費（円／月）"
                  value={basePersonnel}
                  setValue={setBasePersonnel}
                />
              </div>
            </div>

            {/* 全社PLサマリー（年次・月次） */}
            <div className="grid gap-5 md:grid-cols-2">
              <section className="rounded-2xl border border-slate-200 bg-white p-4">
                <h3 className="mb-2 text-[14px] font-medium text-slate-900">
                  年次PL（OKR反映後・全社）
                </h3>
                {yearly.length ? (
                  <table className="w-full text-[12px] text-slate-800">
                    <thead>
                      <tr className="text-left text-slate-500">
                        <th className="py-2">年度</th>
                        <th className="py-2">売上</th>
                        <th className="py-2">COGS</th>
                        <th className="py-2">SG&A</th>
                        <th className="py-2">営業利益</th>
                        <th className="py-2">利益率</th>
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
                    表示できる年次PLがありません。
                    構造化KR（okrsV2）を設定すると表示されます。
                  </div>
                )}
              </section>

              <section className="rounded-2xl border border-slate-200 bg-white p-4">
                <h3 className="mb-2 text-[14px] font-medium text-slate-900">
                  月次ハイライト（直近3ヶ月・全社）
                </h3>
                {monthly.length ? (
                  <table className="w-full text-[12px] text-slate-800">
                    <thead>
                      <tr className="text-left text-slate-500">
                        <th className="py-2">月</th>
                        <th className="py-2">Qty</th>
                        <th className="py-2">ARPU</th>
                        <th className="py-2">売上</th>
                        <th className="py-2">COGS</th>
                        <th className="py-2">SG&A</th>
                        <th className="py-2">営業利益</th>
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
                    表示できる月次データがありません。
                  </div>
                )}
              </section>
            </div>

            {/* 部門別シミュレーション（ベータ） */}
            <div className="mt-6 rounded-2xl border border-slate-200 bg-slate-50 p-4">
              <div className="mb-3 flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
                <div>
                  <h3 className="text-[14px] font-medium text-slate-900">
                    部門別シミュレーション（試験版）
                  </h3>
                  <p className="mt-1 text-[12px] text-slate-500">
                    選択した部門の構造化KRのみを適用した場合の
                    PLインパクトを表示します（全社ベースに対する寄与の概算です）。
                  </p>
                </div>
                <div className="flex items-center gap-2 text-[12px] text-slate-600">
                  <span>対象部門：</span>
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
                  部門データが存在しないため、部門別シミュレーションは表示できません。
                </p>
              ) : !deptKRs.length ? (
                <p className="text-[13px] text-slate-500">
                  選択中の部門「{selectedDeptLabel}
                  」には構造化KRが設定されていません。
                </p>
              ) : !deptYearly.length ? (
                <p className="text-[13px] text-slate-500">
                  表示できるPLデータがありません。
                </p>
              ) : (
                <div className="grid gap-4 md:grid-cols-2">
                  <section className="rounded-2xl border border-slate-200 bg-white p-3">
                    <h4 className="mb-2 text-[13px] font-medium text-slate-900">
                      年次PL（部門寄与分の概算）
                    </h4>
                    <table className="w-full text-[11px] text-slate-800">
                      <thead>
                        <tr className="text-left text-slate-500">
                          <th className="py-1">年度</th>
                          <th className="py-1">売上</th>
                          <th className="py-1">COGS</th>
                          <th className="py-1">SG&A</th>
                          <th className="py-1">営業利益</th>
                          <th className="py-1">利益率</th>
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
                      月次ハイライト（直近3ヶ月・部門）
                    </h4>
                    <table className="w-full text-[11px] text-slate-800">
                      <thead>
                        <tr className="text-left text-slate-500">
                          <th className="py-1">月</th>
                          <th className="py-1">売上</th>
                          <th className="py-1">COGS</th>
                          <th className="py-1">SG&A</th>
                          <th className="py-1">営業利益</th>
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
                ※ 部門別シミュレーションは、指定部門の構造化KRだけを適用した場合の
                「ベースPLに対する寄与分」の概算です。部門間の相互作用までは反映していません。
              </p>
            </div>

            {/* 事業ポートフォリオ別インパクト（STEP2） */}
            <div className="mt-6 rounded-2xl border border-slate-200 bg-slate-50 p-4">
              <h3 className="mb-2 text-[14px] font-medium text-slate-900">
                事業ポートフォリオ別インパクト（Y3 概算）
              </h3>
              {!businessUnits.length ? (
                <p className="text-[13px] text-slate-500">
                  STEP2 の事業ポートフォリオが未設定のため、事業別インパクトは表示できません。
                </p>
              ) : !businessImpactY3.length ? (
                <p className="text-[13px] text-slate-500">
                  Y3のPL試算が無いため、事業別インパクトは表示できません。
                </p>
              ) : (
                <>
                  <table className="w-full text-[12px] text-slate-800">
                    <thead>
                      <tr className="text-left text-slate-500">
                        <th className="py-2">事業</th>
                        <th className="py-2">ポートフォリオ比率</th>
                        <th className="py-2">Y3 売上</th>
                        <th className="py-2">Y3 営業利益</th>
                        <th className="py-2">利益率</th>
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
                    ※ 事業別インパクトは、STEP2 のポートフォリオ比率で
                    全社Y3 PLを按分した概算です。事業ごとに異なるKR強度・
                    コスト構造まではまだ反映していません。
                  </p>
                </>
              )}
            </div>

            {/* 開発者向け：構造化KR / Bridge Delta の抜粋（折りたたみ） */}
            <details className="mt-5 rounded-2xl border border-slate-200 bg-slate-50 p-4 text-[12px] text-slate-700">
              <summary className="cursor-pointer text-[12px] font-medium text-slate-900">
                開発者向け詳細（構造化KR / Bridge Deltas を確認）
              </summary>
              <div className="mt-3 grid gap-4 md:grid-cols-2">
                <div>
                  <div className="text-[11px] text-slate-500">
                    構造化KR 例（先頭5件）
                  </div>
                  <pre className="mt-1 max-h-56 overflow-auto rounded-xl bg-white p-3 text-[11px] text-slate-800">
                    {JSON.stringify(allKRs.slice(0, 5), null, 2)}
                  </pre>
                </div>
                <div>
                  <div className="text-[11px] text-slate-500">
                    Bridge Deltas 抜粋（最初の数ヶ月のみ）
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

      {/* ④ AIインサイト */}
      <section className="mb-8 rounded-3xl border border-slate-200 bg-white p-4 shadow-md">
        <h2 className="mb-2 text-[15px] font-semibold text-slate-900">
          AI インサイト
        </h2>
        <p className="mb-3 text-[13px] text-slate-600">
          現在の戦略・ポートフォリオ・OKR・シミュレーション結果をもとに、
          AIが着眼点やリスク、次の一手のアイデアを提示します。
        </p>
        <CoreInsightPanel />
      </section>

      {/* ⑤ 履歴 */}
      <section className="mb-4 rounded-3xl border border-slate-200 bg-white p-4 shadow-md">
        <div className="mb-2 flex items-center justify-between gap-2">
          <h2 className="text-[15px] font-medium text-slate-900">
            シミュレーション履歴
          </h2>
          <button
            onClick={loadHistory}
            disabled={isHydrating}
            className="rounded-xl border border-slate-200 bg-white px-2 py-1 text-[11px] text-slate-700 hover:bg-slate-50 disabled:opacity-60"
          >
            再読み込み
          </button>
        </div>
        {loadingHist ? (
          <p className="text-[13px] text-slate-500">読み込み中…</p>
        ) : !hasAnyServerBackedContent ? (
          <p className="text-[13px] text-slate-500">
            戦略データがないため、履歴はまだありません。
          </p>
        ) : history.length === 0 ? (
          <p className="text-[13px] text-slate-500">
            シミュレーション履歴がありません。
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
                        {row.category ? `（${row.category}）` : ''}
                      </div>
                      <div className="text-[12px] text-slate-500">
                        {last
                          ? `Y3: 売上 ${fmtNum(
                              last.sales,
                            )} / 営業利益 ${fmtNum(last.op)}`
                          : '—'}
                        {typeof prob === 'number'
                          ? ` ・ 成功確率 ${prob}%`
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

/* ============ 小さな統計カード ============ */
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
