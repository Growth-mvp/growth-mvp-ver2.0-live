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
import { runThreeYearFromStrategy } from '@/utils/financeAdapter';

import type { Department, KRStructured, StrategyData } from '@/types/strategy';
import {
  buildBridgeDeltas,
  type BridgeInput,
  type BaseFigures,
  type Ym,
  extractBaseAndLevers,
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
function collectAllKRs(departments: Department[] | undefined): KRStructured[] {
  if (!Array.isArray(departments)) return [];
  const out: KRStructured[] = [];
  for (const d of departments) {
    const projs = Array.isArray(d?.projects) ? d.projects : [];
    for (const p of projs) {
      const krs = Array.isArray(p?.okrsV2) ? p.okrsV2 : [];
      for (const k of krs) {
        if (k && typeof k.kind === 'string') out.push(k);
      }
    }
  }
  return out;
}

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
): BaseTrajectory {
  const months = ymRange(startYm, endYm);
  const fill = (x: number) =>
    months.reduce(
      (a, m) => {
        a[m] = x;
        return a;
      },
      {} as Record<Ym, number>,
    );
  return {
    startYm,
    endYm,
    qtyMonthly: fill(v.qty),
    arpuMonthly: fill(v.arpu),
    churnMonthly: fill(v.churn),
    fixedCostMonthly: fill(v.fixed),
    variableCostMonthly: fill(v.variable),
    personnelCostMonthly: fill(v.personnel),
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

  const metaAllEmpty = [s?.companyName, s?.mission, s?.vision, s?.value, s?.thought]
    .filter((v) => v !== undefined)
    .every(emptyStr);

  return allEmpty && metaAllEmpty;
}

/* ============ 財務サマリー → ベース軌道の推定 ============ */

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
  signature: string;
};

/**
 * Step3 の financeSummary から OKR→PL 用のベース値をざっくり推定
 * - 一番新しい年度（末尾）を使う
 * - 年次値 → 月次値に割り戻し
 * - 顧客数を仮に 1,000 とおき、ARPU = 月次売上 ÷ 顧客数
 * - SG&A を 固定費:人件費 = 50:50 に分解
 */
function deriveBaseFromStrategy(strategy: any): DerivedBase {
  const fs: any[] = Array.isArray(strategy?.financeSummary)
    ? strategy.financeSummary
    : [];

  const last = fs.length > 0 ? fs[fs.length - 1] : {};

  const annualSales = Number(last.sales ?? last.revenue ?? 0) || 0;
  const annualCogs = Number(last.cogs ?? 0) || 0;
  const annualSga = Number(last.sga ?? 0) || 0;

  const monthlyRevenue = annualSales > 0 ? annualSales / 12 : 0;
  const monthlyCogs =
    annualCogs > 0 ? annualCogs / 12 : monthlyRevenue * 0.4;
  const monthlySga =
    annualSga > 0 ? annualSga / 12 : monthlyRevenue * 0.4;

  const defaultChurn = 0.02; // 月次 2% をデフォルト

  const defaultArpu = 12_000;
  const defaultQty =
    monthlyRevenue > 0 ? Math.max(1000, Math.round(monthlyRevenue / defaultArpu)) : 5_000;

  const defaultFixed = monthlySga * 0.5;
  const defaultPersonnel = monthlySga * 0.5;
  const defaultVariable = monthlyCogs;

  const signature = `${annualSales}-${annualCogs}-${annualSga}`;

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
    signature,
  };
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

  /* ---------------- 既存：3年予測 & 成功確率 ---------------- */

  // 構造化KR(okrsV2) → KRStruct[] へ変換して成功確率に利用
  const krs: KRStruct[] = useMemo(
    () => okrsV2ToKRStruct(allKRs),
    [allKRs],
  );

  const { projection, finalProb, baseForDelta } = useMemo(() => {
    if (!hasAnyServerBackedContent) {
      return {
        projection: { points: [] as any[] },
        finalProb: 0,
        baseForDelta: { year0Sales: 0, year0Op: 0 },
      };
    }

    const projResult = runThreeYearFromStrategy(
      s as StrategyData,
    );
    const proj = projResult.projection;

    if (!proj?.points?.length) {
      return {
        projection: { points: [] as any[] },
        finalProb: 0,
        baseForDelta: { year0Sales: 0, year0Op: 0 },
      };
    }

    const projectionForProb = {
      points: (proj.points || []).map((p: any, i: number) => ({
        year: (`Y${i + 1}` as 'Y1' | 'Y2' | 'Y3'),
        sales: p.sales,
        op: p.op,
        opMargin:
          typeof p.opMargin === 'number'
            ? p.opMargin
            : p.sales > 0
            ? p.op / p.sales
            : 0,
      })),
    };

    const alignAvg =
      krs.length > 0
        ? krs.reduce((a, b) => a + (b.alignmentScore ?? 70), 0) /
          krs.length
        : 0;

    const prob = successProbability({
      projections: projectionForProb,
      alignmentScoreAvg: alignAvg || 0,
    });

    const { base } = extractBaseAndLevers(
      s as StrategyData,
    ) ?? { base: null, levers: [] };

    return {
      projection: proj,
      finalProb: prob,
      baseForDelta: {
        year0Sales: base?.year0Sales ?? 0,
        year0Op: base?.year0Op ?? 0,
      },
    };
  }, [s, krs, hasAnyServerBackedContent]);

  const chartData = useMemo(() => {
    return (projection.points || []).map((p: any) => ({
      year: p.year,
      sales: Math.round(p.sales),
      op: Math.round(p.op),
      prob: Math.round(finalProb * 100) / 100,
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

  /* ---------------- 保存＆履歴（既存API） ---------------- */

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
      setNotice('⚠️ データ読み込み中です。完了後に保存してください。');
      return;
    }
    if (!hasAnyServerBackedContent || (projection.points || []).length === 0) {
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

  /* ---------------- Ver4：OKR→PL シミュレーション ---------------- */

  const derivedBase = useMemo(
    () => deriveBaseFromStrategy(s),
    [s],
  );

  // 期間
  const [startYm, setStartYm] = useState<Ym>('2025-04');
  const [endYm, setEndYm] = useState<Ym>('2026-03');

  // ベース値（初期値は財務サマリーから推定）
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

  // 財務サマリーが変わったらベース値を更新（会社切替時など）
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
      acq: 0,
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
      mkFlatTrajectory(startYm, endYm, {
        qty: baseQty,
        arpu: baseArpu,
        churn: baseChurn,
        fixed: baseFixed,
        variable: baseVariable,
        personnel: basePersonnel,
      }),
    [
      startYm,
      endYm,
      baseQty,
      baseArpu,
      baseChurn,
      baseFixed,
      baseVariable,
      basePersonnel,
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
        baseOverride: k.baseOverride,
        weight: k.weight,
        elasticity: k.elasticity,
        lagMonths: k.lagMonths,
        startYm: (k as any).startYm,
        due: k.due,
        notes: k.notes,
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

  const mounted = useRef(false);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  /* =========================================================
   * JSX（ライトテーマ）
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
              ベースとなる財務サマリーと、各部門のプロジェクト / 構造化KR
              をつなぎ、
              <span className="font-medium">売上・営業利益・成功確率</span>
              を一体で試算しています。
            </p>
          </div>

          <div className="grid grid-cols-2 gap-3 md:grid-cols-3 md:gap-4">
            <StatCard
              label="Y3 売上インパクト"
              value={y3 ? fmtJPY(deltaVsBase.deltaSales) : '—'}
              caption={y3 ? 'ベース比の増加額（推計）' : 'STAGE3の財務サマリーが必要です'}
            />
            <StatCard
              label="Y3 営業利益インパクト"
              value={y3 ? fmtJPY(deltaVsBase.deltaOp) : '—'}
              caption={y3 ? 'ベース比の増加額（推計）' : 'STAGE3の財務サマリーが必要です'}
            />
            <StatCard
              label="成功確率"
              value={
                Number.isFinite(finalProb)
                  ? `${Math.round(finalProb * 100)}%`
                  : '—'
              }
              caption={
                krs.length
                  ? '構造化KRの整合性・難易度を加味した成功確率'
                  : '構造化KRの設定が必要です'
              }
            />
          </div>
        </div>
      </section>

      {/* ② 3年予測（既存エンジン） */}
      <section className="mb-8 grid gap-6 md:grid-cols-[minmax(0,2.1fr)_minmax(0,1.1fr)]">
        <div className="rounded-3xl border border-slate-200 bg-white p-4 shadow-md">
          <div className="mb-3 flex items-center justify-between">
            <h3 className="text-[15px] font-medium text-slate-900">
              売上・営業利益・成功確率（3年予測）
            </h3>
            <span className="text-[11px] text-slate-400">
              STAGE3 の財務サマリー + プロジェクト / OKR
            </span>
          </div>
          {hasAnyServerBackedContent && chartData.length > 0 ? (
            <div className="h-72">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart
                  data={chartData}
                  margin={{ top: 8, right: 24, bottom: 8, left: 80 }} // 目盛りが隠れないように左余白を確保
                >
                  <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                  <XAxis dataKey="year" stroke="#6b7280" />
                  <YAxis
                    yAxisId="left"
                    stroke="#6b7280"
                    tickMargin={8}
                  />
                  <YAxis
                    yAxisId="right"
                    orientation="right"
                    stroke="#6b7280"
                    tickMargin={8}
                  />
                  <ReTooltip
                    contentStyle={{
                      backgroundColor: '#ffffff',
                      border: '1px solid #e5e7eb',
                      fontSize: 12,
                      color: '#111827',
                    }}
                  />
                  <Legend />
                  <Line
                    type="monotone"
                    dataKey="sales"
                    name="売上"
                    yAxisId="left"
                    dot={false}
                  />
                  <Line
                    type="monotone"
                    dataKey="op"
                    name="営業利益"
                    yAxisId="left"
                    dot={false}
                  />
                  <Line
                    type="monotone"
                    dataKey="prob"
                    name="成功確率(0-1)"
                    yAxisId="right"
                    dot={false}
                  />
                </LineChart>
              </ResponsiveContainer>
            </div>
          ) : (
            <div className="grid h-64 place-items-center text-sm text-slate-400">
              表示できる予測データがありません。
              <br />
              STAGE3 の財務サマリーと、各部門のプロジェクト / OKR を設定すると表示されます。
            </div>
          )}
        </div>

        <div className="flex flex-col justify-between gap-4 rounded-3xl border border-slate-200 bg-white p-4 shadow-md">
          <div>
            <h3 className="mb-2 text-[15px] font-medium text-slate-900">
              試算の要約
            </h3>
            {hasAnyServerBackedContent && y3 ? (
              <ul className="space-y-1 text-[13px] text-slate-700">
                <li>
                  Y3 売上： <b>{fmtNum(Math.round(y3.sales))}</b>
                </li>
                <li>
                  Y3 営業利益： <b>{fmtNum(Math.round(y3.op))}</b>
                </li>
                <li>
                  成功確率（最終）： <b>{Math.round(finalProb * 100)}%</b>
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
                  setNotice('⚠️ 読み込み中は再計算メッセージのみ表示します。');
                  setTimeout(() => setNotice(''), 2500);
                  return;
                }
                setNotice(
                  'ℹ️ STAGE1〜5 の入力更新ごとに、3年予測は自動的に再計算されています。',
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

      {/* ③ OKR → PL（Ver4 新エンジン） */}
      <section className="mb-8 rounded-3xl border border-slate-200 bg-white p-5 shadow-md md:p-6">
        <div className="mb-4 flex flex-col gap-2 md:flex-row md:items-end md:justify-between">
          <div>
            <h2 className="text-[15px] font-semibold text-slate-900 md:text-[16px]">
              OKR → PL（数量 × 単価 × 継続率 ベース）
            </h2>
            <p className="mt-1 text-[13px] text-slate-600">
              STAGE4 で設定した
              <span className="font-medium">構造化KR</span>
              を係数に変換し、ベースとなる PL 軌道に重ねて、
              <span className="font-medium">売上・COGS・SG&A・営業利益</span>
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
            STAGE3 の財務サマリーと STAGE4 の構造化KR を設定してください。
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
                    STAGE3 の財務サマリーから推定した月次ベースを初期値にしています。
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

            {/* サマリー（年次・月次） */}
            <div className="grid gap-5 md:grid-cols-2">
              <section className="rounded-2xl border border-slate-200 bg-white p-4">
                <h3 className="mb-2 text-[14px] font-medium text-slate-900">
                  年次PL（OKR反映後）
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
                      {yearly.map((y) => (
                        <tr
                          key={y.year}
                          className="border-t border-slate-200"
                        >
                          <td className="py-2">{y.year}</td>
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
                      ))}
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
                  月次ハイライト（直近3ヶ月）
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
                      {monthly.slice(-3).map((m) => (
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
        <div className="mt-1 text-[11px] text-slate-500">{caption}</div>
      )}
    </div>
  );
}
