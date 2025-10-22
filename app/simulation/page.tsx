'use client';

import React, { useEffect, useMemo, useState, useCallback, useRef } from 'react';
import dynamic from 'next/dynamic';
import { useStrategyStore } from '@/store/strategyStore';
import { useUserStore } from '@/store/userStore';
import {
  ResponsiveContainer,
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  Legend,
  CartesianGrid,
} from 'recharts';

// 成功確率（既存ロジックは流用）
import { KRStruct, successProbability } from '@/utils/financeModel';

// 保存・履歴API（strategy_data.simulation_results 配列を使う）
import {
  appendSimulationResultToStrategy,
  getSimulationResults,
} from '@/utils/supabase/strategy';

// 既存エンジン：OKR→3年プロジェクション
import { runThreeYearFromStrategy } from '@/utils/financeAdapter';

// 会社スコープ・初期ロード
import { useAccess } from '@/utils/access';
import { hardResetForCompanySwitch } from '@/utils/resetAll';
import { loadAndHydrate } from '@/utils/loader';
import { useAutoSave } from '@/hooks/useAutoSave';

// Ver4：OKR→PL
import type { Department, KRStructured } from '@/types/strategy';
import { buildBridgeDeltas, type BridgeInput, type BaseFigures, type Ym } from '@/utils/simulationBridge';
import { simulateMonthlyPL, aggregateYearly, type BaseTrajectory } from '@/utils/financeSimulation';

// 遅延読み込み
const CoreInsightPanel = dynamic(() => import('@/components/insight/CoreInsightPanel'), {
  ssr: false,
  loading: () => null,
});

/* ============ 小物 ============ */
function fmtNum(n: any) {
  const v = Number(n);
  if (!Number.isFinite(v)) return '-';
  return v.toLocaleString();
}
function fmtJPY(n: number) {
  return n.toLocaleString('ja-JP', { style: 'currency', currency: 'JPY', maximumFractionDigits: 0 });
}

/** 履歴の最小型（サーバ側の実体に過度に依存しない） */
type SimulationLogRowLite = {
  id: string;
  created_at: string;
  category?: string;
  title?: string;
  payload?: any;
  log?: any;
  data?: any;
};

/* ============ Ver4ユーティリティ ============ */
function pad(n: number) { return n < 10 ? `0${n}` : String(n); }
function nextYm(y: Ym): Ym {
  const [Y, M] = y.split('-').map(Number);
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
function collectAllKRs(departments: Department[] | undefined): KRStructured[] {
  if (!Array.isArray(departments)) return [];
  const out: KRStructured[] = [];
  for (const d of departments) {
    const projs = Array.isArray(d?.projects) ? d.projects : [];
    for (const p of projs) {
      const krs = Array.isArray(p?.okrsV2) ? p.okrsV2 : [];
      for (const k of krs) if (k && typeof k.kind === 'string') out.push(k);
    }
  }
  return out;
}
function mkFlatTrajectory(
  startYm: Ym,
  endYm: Ym,
  v: { qty: number; arpu: number; churn: number; fixed: number; variable: number; personnel: number }
): BaseTrajectory {
  const months = ymRange(startYm, endYm);
  const fill = (x: number) => months.reduce((a, m) => (a[m] = x, a), {} as Record<Ym, number>);
  return {
    startYm, endYm,
    qtyMonthly: fill(v.qty),
    arpuMonthly: fill(v.arpu),
    churnMonthly: fill(v.churn),
    fixedCostMonthly: fill(v.fixed),
    variableCostMonthly: fill(v.variable),
    personnelCostMonthly: fill(v.personnel),
  };
}

/* ============ “クライアント側で実質空”かを簡易判定 ============ */
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
    (!s?.simulationResult || emptyArr(s?.simulationResult?.projection?.points));

  const metaAllEmpty =
    [s?.companyName, s?.mission, s?.vision, s?.value, s?.thought]
      .filter((v) => v !== undefined)
      .every(emptyStr);

  return allEmpty && metaAllEmpty;
}

/* =========================================================
 * コンポーネント
 * ========================================================= */
export default function SimulationPage() {
  // --- store/state hooks ---
  const s = useStrategyStore() as any;
  const { user } = useUserStore();
  const { setSimulationResult } = useStrategyStore() as any;

  // 会社スコープ制御／hydration
  const { companyId: scopeCompanyId, hydrated, setCompanyScope } = useStrategyStore();
  const access = useAccess();
  const accessCompanyId: string | undefined =
    (access as any)?.companyId ?? (useStrategyStore.getState().companyId as string | undefined);

  // スコープ確立＆切替時の完全リセット
  useEffect(() => {
    if (!accessCompanyId) return;
    if (scopeCompanyId && scopeCompanyId !== accessCompanyId) {
      hardResetForCompanySwitch(accessCompanyId);
    } else {
      setCompanyScope(accessCompanyId);
    }
  }, [accessCompanyId, scopeCompanyId, setCompanyScope]);

  // 初期ロード（7秒フェイルセーフは不要に簡略化）
  useEffect(() => {
    if (!accessCompanyId) return;
    let cancelled = false;
    const run = async () => {
      if (hydrated && scopeCompanyId === accessCompanyId) return;
      try { await loadAndHydrate(accessCompanyId); } catch {}
      if (cancelled) return;
    };
    run();
    return () => { cancelled = true; };
  }, [accessCompanyId, hydrated, scopeCompanyId]);

  // AutoSave（このページは store 直接編集は少ないが、念のため companyId を依存に）
  useAutoSave([scopeCompanyId]);

  // Hydration ガード
  const isHydrating = !hydrated || scopeCompanyId !== accessCompanyId;

  // ====== データ有無の根本判定（ローカル残骸で描画しない） ======
  const hasAnyServerBackedContent = useMemo(() => !isEffectivelyEmptyClient(s), [s]);

  /* ---------------- 入力（成功確率で使用） ---------------- */
  // ❌ ダミーKRの注入は一切しない。データが無い時は空配列のまま。
  const krs: KRStruct[] = useMemo(() => {
    const out: KRStruct[] = [];
    try {
      const depts = Array.isArray(s?.departments) ? s.departments : [];
      for (const d of depts) {
        const projects = Array.isArray(d?.projects) ? d.projects : [];
        for (const p of projects) {
          const okrs = Array.isArray(p?.okrs) ? p.okrs : [];
          for (const okr of okrs) {
            const krList = Array.isArray(okr?.keyResults) ? okr.keyResults : [];
            for (const kr of krList) {
              if (typeof kr === 'string') continue;
              out.push({
                baseline: Number((kr as any)?.baseline ?? 0) || 0,
                target: Number((kr as any)?.target ?? 0) || 0,
                unit: String((kr as any)?.unit ?? ''),
                variable: (kr as any)?.variable,
                weight: typeof (kr as any)?.weight === 'number' ? (kr as any).weight : undefined,
                alignmentScore: typeof (kr as any)?.alignmentScore === 'number'
                  ? (kr as any).alignmentScore
                  : undefined,
              });
            }
          }
        }
      }
    } catch {}
    return out; // ← ダミーは入れない
  }, [s?.departments]);

  /* ---------------- 計算（OKR→3年プロジェクション＆成功確率） ---------------- */
  const { projection, finalProb } = useMemo(() => {
    if (!hasAnyServerBackedContent) {
      return { projection: { points: [] as any[] }, finalProb: 0 };
    }

    const { projection: proj } = runThreeYearFromStrategy(s);
    if (!proj?.points?.length) return { projection: { points: [] }, finalProb: 0 };

    // ✅ 型整合：financeModel 側の year 型（'Y1'|'Y2'|'Y3'）に合わせる
    const projectionForProb = {
      points: (proj.points || []).map((p: any, i: number) => ({
        year: (`Y${i + 1}` as 'Y1' | 'Y2' | 'Y3'),
        sales: p.sales,
        op: p.op,
        opMargin: typeof p.opMargin === 'number' ? p.opMargin : p.sales > 0 ? p.op / p.sales : 0,
      })),
    };

    const alignAvg =
      krs.length > 0 ? krs.reduce((a, b) => a + (b.alignmentScore ?? 70), 0) / krs.length : 0;

    const prob = successProbability({
      projections: projectionForProb,
      alignmentScoreAvg: alignAvg || 0,
    });

    return { projection: proj, finalProb: prob };
  }, [s, krs, hasAnyServerBackedContent]);

  const chartData = useMemo(() => {
    return (projection.points || []).map((p: any) => ({
      year: p.year,
      sales: Math.round(p.sales),
      op: Math.round(p.op),
      prob: Math.round(finalProb * 100) / 100,
    }));
  }, [projection, finalProb]);

  const y3 = (projection.points || []).at(-1);

  /* ---------------- 保存＆履歴 ---------------- */
  const [saving, setSaving] = useState(false);
  const [history, setHistory] = useState<SimulationLogRowLite[]>([]);
  const [loadingHist, setLoadingHist] = useState(false);
  const [notice, setNotice] = useState<string>('');

  const loadHistory = useCallback(async () => {
    if (!user?.id) return;
    if (!hasAnyServerBackedContent) {
      setHistory([]); // サーバにデータ無い時は履歴も空
      return;
    }
    setLoadingHist(true);
    try {
      const { rows, error } = await getSimulationResults(user.id, null, { limit: 20 });
      if (error) throw error;
      setHistory((rows || []) as SimulationLogRowLite[]);
    } catch (e) {
      console.error('getSimulationResults error:', e);
      setNotice('❌ 履歴の取得に失敗しました');
    } finally {
      setLoadingHist(false);
    }
  }, [user?.id, hasAnyServerBackedContent]);

  useEffect(() => {
    if (!isHydrating) loadHistory();
  }, [isHydrating, loadHistory]);

  const handleSave = async () => {
    if (!user?.id) {
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
                typeof p.opMargin === 'number' ? p.opMargin : p.sales > 0 ? p.op / p.sales : 0
              ).toFixed(4),
            ),
          })),
        },
        finalProb,
        meta: { label: new Date().toLocaleString(), note: 'auto-saved from /simulation' },
      } as const;

      const { error } = await appendSimulationResultToStrategy(user.id, payload, null, {
        title: payload.meta?.label,
      });
      if (error) throw error;

      if (typeof setSimulationResult === 'function') {
        setSimulationResult(payload);
      }

      setNotice('✅ シミュレーション結果を保存しました');
      await loadHistory();
    } catch (e) {
      console.error('appendSimulationResultToStrategy error:', e);
      setNotice('❌ 保存に失敗しました');
    } finally {
      setSaving(false);
      setTimeout(() => setNotice(''), 3500);
    }
  };

  /* ---------------- 新エンジン（Ver4）：OKR→PL ---------------- */
  const departments: Department[] = Array.isArray(s?.departments) ? s.departments : [];
  const allKRs = useMemo(() => collectAllKRs(departments), [departments]);

  // 期間・ベース値（UI可変）
  const [startYm, setStartYm] = useState<Ym>('2025-04');
  const [endYm, setEndYm] = useState<Ym>('2026-03');
  const [baseQty, setBaseQty] = useState(5000);
  const [baseArpu, setBaseArpu] = useState(12000);
  const [baseChurn, setBaseChurn] = useState(0.02);
  const [baseFixed, setBaseFixed] = useState(8_000_000);
  const [baseVariable, setBaseVariable] = useState(3_000_000);
  const [basePersonnel, setBasePersonnel] = useState(6_000_000);

  const baseFigures = useMemo<BaseFigures>(() => ({
    acq: 0,
    arpu: baseArpu,
    churn: baseChurn,
    fixed_cost: baseFixed,
    variable_cost: baseVariable,
    personnel_cost: basePersonnel,
    revenue: baseQty * baseArpu,
  }), [baseQty, baseArpu, baseChurn, baseFixed, baseVariable, basePersonnel]);

  const baseTrajectory = useMemo(
    () => mkFlatTrajectory(startYm, endYm, {
      qty: baseQty,
      arpu: baseArpu,
      churn: baseChurn,
      fixed: baseFixed,
      variable: baseVariable,
      personnel: basePersonnel,
    }),
    [startYm, endYm, baseQty, baseArpu, baseChurn, baseFixed, baseVariable, basePersonnel]
  );

  const bridgeInput = useMemo<BridgeInput>(() => ({
    startYm, endYm,
    krs: allKRs.map(k => ({
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
  }), [allKRs, startYm, endYm, baseFigures]);

  const deltas = useMemo(() => buildBridgeDeltas(bridgeInput), [bridgeInput]);
  const monthly = useMemo(() => {
    if (!hasAnyServerBackedContent) return [] as any[];
    return simulateMonthlyPL(baseTrajectory, deltas, { applySynergyTo: ['revenue'] });
  }, [baseTrajectory, deltas, hasAnyServerBackedContent]);
  const yearly = useMemo(() => (monthly.length ? aggregateYearly(monthly) : []), [monthly]);

  const mounted = useRef(false);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);

  return (
    <main className="min-h-screen p-6 md:p-10">
      <h1 className="text-2xl md:text-3xl font-semibold tracking-tight mb-2">
        STAGE 6：業績シミュレーション
      </h1>
      <p className="text-gray-600 mb-6">
        既存の3年予測（成功確率付き）に加えて、Ver4の<strong>OKR→PLシミュレーション</strong>を同一画面で確認できます。
      </p>

      {isHydrating && (
        <div className="mb-4 rounded-xl border border-zinc-200 bg-white/80 px-3 py-2 text-sm text-zinc-600">
          サーバーのデータを読み込み中です…
        </div>
      )}

      {notice && (
        <div
          role="alert"
          className={`mb-4 text-[13px] rounded-xl border px-3 py-2 shadow-sm ${
            notice.includes('❌')
              ? 'border-rose-200 bg-rose-50 text-rose-700'
              : 'border-emerald-200 bg-emerald-50 text-emerald-700'
          }`}
        >
          {notice}
        </div>
      )}

      {/* ===== “データ無し” の明示 ===== */}
      {!isHydrating && !hasAnyServerBackedContent && (
        <div className="mb-6 rounded-xl border border-amber-200 bg-amber-50 text-amber-900 px-3 py-2 text-sm">
          この会社の戦略データは未作成（または全削除済み）です。編集・保存するとここに反映されます。
        </div>
      )}

      {/* ===== 既存：3年予測 & 成功確率 ===== */}
      <section className="grid grid-cols-1 xl:grid-cols-3 gap-6">
        <div className="xl:col-span-2 rounded-2xl border border-gray-200 bg-white p-4 shadow-sm">
          <h2 className="text-lg font-medium mb-2">売上・営業利益・成功確率（予測：既存）</h2>
          {hasAnyServerBackedContent && chartData.length > 0 ? (
            <div className="h-72">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={chartData}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="year" />
                  <YAxis yAxisId="left" />
                  <YAxis yAxisId="right" orientation="right" />
                  <Tooltip />
                  <Legend />
                  <Line type="monotone" dataKey="sales" name="売上" yAxisId="left" />
                  <Line type="monotone" dataKey="op" name="営業利益" yAxisId="left" />
                  <Line type="monotone" dataKey="prob" name="成功確率(0-1)" yAxisId="right" />
                </LineChart>
              </ResponsiveContainer>
            </div>
          ) : (
            <div className="h-72 grid place-items-center text-sm text-zinc-500">
              表示できる予測データがありません
            </div>
          )}
        </div>

        <div className="rounded-2xl border border-gray-200 bg-white p-4 shadow-sm">
          <h2 className="text-lg font-medium mb-2">試算の要約（既存）</h2>
          {hasAnyServerBackedContent && y3 ? (
            <>
              <ul className="text-sm text-gray-700 space-y-1">
                <li>売上（Y3）：<b>{Math.round(y3.sales).toLocaleString()}</b></li>
                <li>営業利益（Y3）：<b>{Math.round(y3.op).toLocaleString()}</b></li>
                <li>成功確率（最終）：<b>{Math.round(finalProb * 100)}%</b></li>
              </ul>
              <div className="mt-4 flex gap-2">
                <button
                  className="px-3 py-2 rounded-lg border border-gray-200 shadow-sm bg-white hover:bg-gray-50 text-sm"
                  onClick={() => {
                    setNotice('ℹ️ 既存エンジンは入力更新ごとに即時再計算されています');
                    setTimeout(() => setNotice(''), 2500);
                  }}
                  disabled={isHydrating}
                  title={isHydrating ? '読み込み中は操作できません' : undefined}
                >
                  施策影響を再計算
                </button>
                <button
                  disabled={saving || !user?.id || isHydrating}
                  onClick={handleSave}
                  className={[
                    'px-3 py-2 rounded-lg border border-gray-200 shadow-sm bg-white hover:bg-gray-50 text-sm',
                    saving || isHydrating ? 'opacity-60 cursor-not-allowed' : '',
                  ].join(' ')}
                  title={!user?.id ? 'ログインしてください' : isHydrating ? '読み込み中は保存できません' : undefined}
                >
                  {saving ? '保存中…' : '結果を保存'}
                </button>
              </div>
            </>
          ) : (
            <div className="text-sm text-zinc-500">試算サマリーを表示できるデータがありません</div>
          )}
        </div>
      </section>

      {/* ===== 新：OKR→PL（Ver4） ===== */}
      <section className="mt-8 rounded-2xl border border-gray-200 bg-white p-4 shadow-sm">
        <h2 className="text-lg font-semibold mb-2">OKR→PL（Ver4 新エンジン）</h2>
        <p className="text-sm text-gray-600 mb-4">
          STAGE4の<strong>構造化KR</strong>（okrsV2）を係数化して、ベース軌道に反映したPLを試算します。
        </p>

        {!hasAnyServerBackedContent ? (
          <div className="rounded-xl border border-zinc-200 bg-zinc-50 p-4 text-sm text-zinc-600">
            OKRデータが未設定のため、PLシミュレーションは表示できません。
          </div>
        ) : (
          <>
            {/* 入力パネル */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              <div>
                <div className="text-[11px] text-zinc-600">開始（YYYY-MM）</div>
                <input className="h-9 w-full rounded-xl border border-zinc-200 px-3 text-[14px]"
                  value={startYm} onChange={(e) => setStartYm(e.target.value as Ym)} />
              </div>
              <div>
                <div className="text-[11px] text-zinc-600">終了（YYYY-MM）</div>
                <input className="h-9 w-full rounded-xl border border-zinc-200 px-3 text-[14px]"
                  value={endYm} onChange={(e) => setEndYm(e.target.value as Ym)} />
              </div>
              <div className="flex items-end">
                <span className="text-[12px] text-zinc-600">期間：{ymRange(startYm, endYm).length} ヶ月</span>
              </div>
            </div>

            <div className="mt-4 grid grid-cols-1 md:grid-cols-6 gap-3">
              <Num label="Base 顧客Qty" value={baseQty} setValue={setBaseQty} />
              <Num label="Base ARPU(円)" value={baseArpu} setValue={setBaseArpu} />
              <Num label="Base Churn(率)" value={baseChurn} setValue={setBaseChurn} step="0.001" />
              <Num label="固定費(円)" value={baseFixed} setValue={setBaseFixed} />
              <Num label="変動費(円)" value={baseVariable} setValue={setBaseVariable} />
              <Num label="人件費(円)" value={basePersonnel} setValue={setBasePersonnel} />
            </div>

            {/* サマリー */}
            <div className="mt-6 grid grid-cols-1 xl:grid-cols-2 gap-6">
              <section className="rounded-2xl border border-zinc-200 bg-white p-4">
                <h3 className="text-[15px] font-medium mb-2">年次PL（OKR反映後）</h3>
                {yearly.length ? (
                  <table className="w-full text-[13px]">
                    <thead>
                      <tr className="text-left text-zinc-600">
                        <th className="py-2">年度</th>
                        <th className="py-2">売上</th>
                        <th className="py-2">COGS</th>
                        <th className="py-2">SG&A</th>
                        <th className="py-2">営業利益</th>
                        <th className="py-2">利益率</th>
                      </tr>
                    </thead>
                    <tbody>
                      {yearly.map(y => (
                        <tr key={y.year} className="border-t border-zinc-200">
                          <td className="py-2">{y.year}</td>
                          <td className="py-2">{fmtJPY(y.revenue)}</td>
                          <td className="py-2">{fmtJPY(y.cogs)}</td>
                          <td className="py-2">{fmtJPY(y.sga)}</td>
                          <td className="py-2">{fmtJPY(y.op_income)}</td>
                          <td className="py-2">{(y.margin * 100).toFixed(1)}%</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                ) : (
                  <div className="text-sm text-zinc-500">表示できる年次PLがありません</div>
                )}
              </section>

              <section className="rounded-2xl border border-zinc-200 bg白 p-4">
                <h3 className="text-[15px] font-medium mb-2">月次ハイライト（直近3ヶ月）</h3>
                {monthly.length ? (
                  <table className="w-full text-[13px]">
                    <thead>
                      <tr className="text-left text-zinc-600">
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
                      {monthly.slice(-3).map(m => (
                        <tr key={m.ym} className="border-t border-zinc-200">
                          <td className="py-2">{m.ym}</td>
                          <td className="py-2">{m.qty.toLocaleString()}</td>
                          <td className="py-2">{fmtJPY(m.arpu)}</td>
                          <td className="py-2">{fmtJPY(m.revenue)}</td>
                          <td className="py-2">{fmtJPY(m.cogs)}</td>
                          <td className="py-2">{fmtJPY(m.sga)}</td>
                          <td className="py-2">{fmtJPY(m.op_income)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                ) : (
                  <div className="text-sm text-zinc-500">表示できる月次データがありません</div>
                )}
              </section>
            </div>

            {/* デバッグ（必要に応じて） */}
            <div className="mt-6 grid grid-cols-1 xl:grid-cols-2 gap-6">
              <section className="rounded-2xl border border-zinc-200 bg-white p-4">
                <h3 className="text-[15px] font-medium mb-2">OKR（構造化）件数 / 例</h3>
                <div className="text-[13px] text-zinc-800">合計 {allKRs.length} 件</div>
                <pre className="mt-2 max-h-64 overflow-auto rounded-xl bg-zinc-50 p-3 text-[12px] text-zinc-700">
                  {JSON.stringify(allKRs.slice(0, 5), null, 2)}
                </pre>
              </section>
              <section className="rounded-2xl border border-zinc-200 bg-white p-4">
                <h3 className="text-[15px] font-medium mb-2">Bridge Deltas 抜粋</h3>
                <pre className="max-h-64 overflow-auto rounded-xl bg-zinc-50 p-3 text-[12px] text-zinc-700">
                  {JSON.stringify(
                    monthly.length
                      ? {
                          // デルタの量が大きいと重いため先頭のみ抜粋
                          // 実運用ではCSV出力などに振るのが良い
                          arpu: Object.fromEntries(Object.entries(buildBridgeDeltas(bridgeInput).arpu).slice(0, 3)),
                          acq: Object.fromEntries(Object.entries(buildBridgeDeltas(bridgeInput).acq).slice(0, 3)),
                          churn: Object.fromEntries(Object.entries(buildBridgeDeltas(bridgeInput).churn).slice(0, 3)),
                        }
                      : {},
                    null,
                    2
                  )}
                </pre>
              </section>
            </div>
          </>
        )}
      </section>

      {/* AIインサイト（遅延読込：既存維持） */}
      <div className="mt-8">
        <CoreInsightPanel />
      </div>

      {/* 履歴 */}
      <section className="mt-6 rounded-2xl border border-gray-200 bg-white p-4 shadow-sm">
        <div className="flex items-center justify-between gap-2 mb-2">
          <h2 className="text-lg font-medium">シミュレーション履歴</h2>
          <button
            onClick={loadHistory}
            disabled={isHydrating}
            className="text-xs px-2 py-1 rounded-lg border border-gray-200 bg-white hover:bg-gray-50 disabled:opacity-50"
            title={isHydrating ? '読み込み中は操作できません' : undefined}
          >
            再読み込み
          </button>
        </div>
        {loadingHist ? (
          <p className="text-sm text-gray-500">読み込み中…</p>
        ) : !hasAnyServerBackedContent ? (
          <p className="text-sm text-gray-500">履歴はありません。</p>
        ) : history.length === 0 ? (
          <p className="text-sm text-gray-500">履歴がありません。</p>
        ) : (
          <ul className="divide-y divide-gray-100">
            {history.map((row) => {
              const body = (row as any).payload ?? (row as any).log ?? (row as any).data ?? {};
              const proj = body?.projection?.points ?? [];
              const last = Array.isArray(proj) && proj.length > 0 ? proj[proj.length - 1] : null;
              const prob =
                typeof body?.finalProb === 'number' ? Math.round(body.finalProb * 100) : null;

              const label =
                (row as any).title ? (row as any).title : new Date(row.created_at).toLocaleString();

              return (
                <li key={row.id} className="py-3 text-sm">
                  <div className="flex items-center justify-between">
                    <div className="flex flex-col">
                      <span className="font-medium">
                        {label}
                        {row.category ? `（${row.category}）` : ''}
                      </span>
                      <span className="text-gray-500">
                        {last
                          ? `Y3: 売上 ${fmtNum(last.sales)} / 営業利益 ${fmtNum(last.op)}`
                          : '—'}
                        {typeof prob === 'number' ? ` ・ 成功確率 ${prob}%` : ''}
                      </span>
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </main>
  );
}

/* ====== 小さな数値入力 ====== */
function Num({
  label, value, setValue, step,
}: { label: string; value: number; setValue: (n: number) => void; step?: string }) {
  return (
    <div>
      <div className="text-[11px] text-zinc-600">{label}</div>
      <input
        className="h-9 w-full rounded-xl border border-zinc-200 px-3 text-[14px]"
        inputMode="decimal"
        step={step ?? '1'}
        value={String(value)}
        onChange={(e) => setValue(Number(e.target.value || 0))}
      />
    </div>
  );
}
