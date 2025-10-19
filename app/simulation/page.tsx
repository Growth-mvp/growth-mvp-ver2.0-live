// /app/simulation/page.tsx
'use client';

import React, { useEffect, useMemo, useState, useCallback } from 'react';
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

import {
  FinanceSummary,
  KRStruct,
  impactModel,
  threeYear,
  successProbability,
} from '@/utils/financeModel';

import {
  // B案：strategy_data 内の配列に追記し、そこから履歴を読む
  appendSimulationResultToStrategy,
  getSimulationResults,
  type SimulationLogRow,
} from '@/utils/supabase/strategy';

// ★ 追加：会社スコープ・初期ロードの安定化
import { useAccess } from '@/utils/access';
import { hardResetForCompanySwitch } from '@/utils/resetAll';
import { loadAndHydrate } from '@/utils/loader';
import { useAutoSave } from '@/hooks/useAutoSave';

// 遅延読み込み（サーバ負荷と初期描画軽減）
const CoreInsightPanel = dynamic(() => import('@/components/insight/CoreInsightPanel'), {
  ssr: false,
  loading: () => null,
});

/** store.financeSummary(行配列) → FinanceModel用 baseline(Y0のみ) に整形 */
function toBaselineFromStoreRows(rows: any[] | undefined | null) {
  if (!Array.isArray(rows) || rows.length === 0) return null;

  // 年ごとに合算
  const byYear = new Map<number, { sales: number; op: number }>();
  for (const r of rows) {
    const year = Number(r?.year);
    if (!Number.isFinite(year)) continue;
    const revenue = Number(r?.revenue) || 0;
    const opInc = Number(r?.operating_income) || 0;
    const cur = byYear.get(year) ?? { sales: 0, op: 0 };
    byYear.set(year, { sales: cur.sales + revenue, op: cur.op + opInc });
  }
  if (byYear.size === 0) return null;

  // 最新年＝Y0 として1点抽出
  const latestYear = Math.max(...Array.from(byYear.keys()));
  const total = byYear.get(latestYear)!;

  return [
    {
      yearLabel: 'Y0',
      sales: Math.round(total.sales),
      operatingProfit: Math.round(total.op),
    },
  ];
}

/* ============ 小物 ============ */
function fmtNum(n: any) {
  const v = Number(n);
  if (!Number.isFinite(v)) return '-';
  return v.toLocaleString();
}

export default function SimulationPage() {
  // --- store/state hooks ---
  const s = useStrategyStore() as any;
  const { user } = useUserStore();
  const { setSimulationResult } = useStrategyStore() as any;

  // ★ 会社スコープ制御／hydration
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

  // 初期ロード（7秒フェイルセーフ）
  useEffect(() => {
    if (!accessCompanyId) return;
    let cancelled = false;

    const run = async () => {
      if (hydrated && scopeCompanyId === accessCompanyId) return;

      const load = async () => {
        await loadAndHydrate(accessCompanyId);
      };

      const timer = setTimeout(async () => {
        try {
          await loadAndHydrate(accessCompanyId);
        } catch { /* silent */ }
      }, 7000);

      try {
        await load();
      } finally {
        clearTimeout(timer);
      }

      if (cancelled) return;
    };

    run();
    return () => { cancelled = true; };
  }, [accessCompanyId, hydrated, scopeCompanyId]);

  // AutoSave（このページは store 直接編集は少ないが、念のため companyId を依存に）
  useAutoSave([scopeCompanyId]);

  // Hydration ガード
  const isHydrating = !hydrated || scopeCompanyId !== accessCompanyId;

  /* ---------------- 入力（finance & KR） ---------------- */
  const financeSummary: FinanceSummary = useMemo(() => {
    // 1) store.financeSummary（行配列）から生成
    const baselineFromRows = toBaselineFromStoreRows(s?.financeSummary);
    if (baselineFromRows) return { baseline: baselineFromRows };

    // 2) 互換（過去版で s.financeSummary.baseline を直接持っていた場合）
    const legacyBaseline = Array.isArray(s?.financeSummary?.baseline)
      ? s.financeSummary.baseline
      : null;
    if (legacyBaseline) return { baseline: legacyBaseline };

    // 3) フォールバック（ダミー）
    return { baseline: [{ yearLabel: 'Y0', sales: 1000, operatingProfit: 100 }] };
  }, [s?.financeSummary]);

  const krs: KRStruct[] = useMemo(() => {
    try {
      const arr: KRStruct[] = [];
      const depts = Array.isArray(s?.departments) ? s.departments : [];
      for (const d of depts) {
        const projects = Array.isArray(d?.projects) ? d.projects : [];
        for (const p of projects) {
          const okrs = Array.isArray(p?.okrs) ? p.okrs : [];
          for (const okr of okrs) {
            const krList = Array.isArray(okr?.keyResults) ? okr.keyResults : [];
            for (const kr of krList) {
              // KR が string の場合に備えた防御
              const baseline = Number((kr as any)?.baseline ?? 0) || 0;
              const target = Number((kr as any)?.target ?? 0) || 0;
              const unit = String((kr as any)?.unit ?? '');
              const variable = (kr as any)?.variable;
              const weight = typeof (kr as any)?.weight === 'number' ? (kr as any).weight : undefined;
              const alignmentScore =
                typeof (kr as any)?.alignmentScore === 'number' ? (kr as any).alignmentScore : undefined;

              // string KR のときは variable 推定しにくいのでスキップ
              if (typeof kr === 'string') continue;

              arr.push({ baseline, target, unit, weight, variable, alignmentScore });
            }
          }
        }
      }
      if (arr.length > 0) return arr;
    } catch {
      // noop
    }

    // ダミーKR
    return [
      { baseline: 100, target: 120, unit: '%', variable: 'volume',   weight: 0.35, alignmentScore: 78 },
      { baseline: 100, target: 105, unit: '%', variable: 'price',    weight: 0.25, alignmentScore: 78 },
      { baseline: 40,  target: 38,  unit: '%', variable: 'cogsRate', weight: 0.20, alignmentScore: 78 },
      { baseline: 20,  target: 19,  unit: '%', variable: 'opex',     weight: 0.20, alignmentScore: 78 },
    ];
  }, [s?.departments]);

  /* ---------------- 計算（impact → threeYear → prob） ---------------- */
  const { projection, finalProb } = useMemo(() => {
    const impact = impactModel(krs);
    const projection = threeYear(financeSummary, impact);

    const alignAvg =
      krs.length > 0
        ? krs.reduce((a, b) => a + (b.alignmentScore ?? 70), 0) / krs.length
        : 70;

    const prob = successProbability({ projections: projection, alignmentScoreAvg: alignAvg });
    return { projection, finalProb: prob };
  }, [financeSummary, krs]);

  const chartData = useMemo(() => {
    return projection.points.map((p) => ({
      year: p.year,
      sales: Math.round(p.sales),
      op: Math.round(p.op),
      // 0..1 スケールを維持（右軸）
      prob: Math.round(finalProb * 100) / 100,
    }));
  }, [projection, finalProb]);

  const y3 = projection.points.at(-1);

  /* ---------------- 保存＆履歴 ---------------- */
  const [saving, setSaving] = useState(false);
  const [history, setHistory] = useState<SimulationLogRow[]>([]);
  const [loadingHist, setLoadingHist] = useState(false);
  const [notice, setNotice] = useState<string>('');

  const loadHistory = useCallback(async () => {
    if (!user?.id) return;
    setLoadingHist(true);
    try {
      const { rows, error } = await getSimulationResults(user.id, null, { limit: 20 });
      if (error) throw error;
      setHistory(rows);
    } catch (e) {
      console.error('getSimulationResults error:', e);
      setNotice('❌ 履歴の取得に失敗しました');
    } finally {
      setLoadingHist(false);
    }
  }, [user?.id]);

  useEffect(() => {
    if (!isHydrating) {
      // Hydration 完了後に履歴取得
      loadHistory();
    }
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
    setSaving(true);
    try {
      const payload = {
        projection: {
          points: projection.points.map((p) => ({
            year: p.year,
            sales: Math.round(p.sales),
            op: Math.round(p.op),
            opMargin: Number((p.opMargin ?? 0).toFixed(4)),
          })),
        },
        finalProb,
        krsSnapshot: krs, // 現状のKRをスナップショット保存
        meta: { label: new Date().toLocaleString(), note: 'auto-saved from /simulation' },
      } as const;

      // B案：strategy_data.simulation_results 配列に追記 + simulation_result を最新で更新
      const { error } = await appendSimulationResultToStrategy(user.id, payload, null, {
        title: payload.meta?.label,
      });
      if (error) throw error;

      // ★ Zustand にも保持（STAGE6のAIに渡しやすくする）
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

  return (
    <main className="min-h-screen p-6 md:p-10">
      <h1 className="text-2xl md:text-3xl font-semibold tracking-tight mb-2">
        STAGE 6：業績シミュレーション
      </h1>
      <p className="text-gray-600 mb-6">
        戦略（OKR/成果）と財務データから、3年の売上・営業利益・成功確率を試算します。
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

      <section className="grid grid-cols-1 xl:grid-cols-3 gap-6">
        <div className="xl:col-span-2 rounded-2xl border border-gray-200 bg-white p-4 shadow-sm">
          <h2 className="text-lg font-medium mb-2">売上・営業利益・成功確率（予測）</h2>
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
        </div>

        <div className="rounded-2xl border border-gray-200 bg-white p-4 shadow-sm">
          <h2 className="text-lg font-medium mb-2">試算の要約</h2>
          <ul className="text-sm text-gray-700 space-y-1">
            <li>売上（Y3）：<b>{y3 ? Math.round(y3.sales).toLocaleString() : '-'}</b></li>
            <li>営業利益（Y3）：<b>{y3 ? Math.round(y3.op).toLocaleString() : '-'}</b></li>
            <li>成功確率（最終）：<b>{Math.round(finalProb * 100)}%</b></li>
          </ul>
          <div className="mt-4 flex gap-2">
            <button
              className="px-3 py-2 rounded-lg border border-gray-200 shadow-sm bg-white hover:bg-gray-50 text-sm"
              onClick={() => {
                // 現状のモデルは参照透過のため、再計算＝状態変化なし
                // 将来的に係数UIを追加したら、その値をstateに入れて再描画
                setNotice('ℹ️ 係数UI未実装のため、現在は即時再計算済みです');
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
        </div>
      </section>

      {/* AIインサイト（遅延読込） */}
      <div className="mt-6">
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
        ) : history.length === 0 ? (
          <p className="text-sm text-gray-500">履歴がありません。</p>
        ) : (
          <ul className="divide-y divide-gray-100">
            {history.map((row) => {
              // B案：strategy_data の履歴は payload を持つ
              // 互換：progress_logs 的な行も考慮して log/payload/data を順に参照
              const body = (row as any).payload ?? (row as any).log ?? (row as any).data ?? {};
              const proj = body?.projection?.points ?? [];
              const last = Array.isArray(proj) && proj.length > 0 ? proj[proj.length - 1] : null;
              const prob = typeof body?.finalProb === 'number' ? Math.round(body.finalProb * 100) : null;

              const label =
                (row as any).title
                  ? (row as any).title
                  : new Date(row.created_at).toLocaleString();

              return (
                <li key={row.id} className="py-3 text-sm">
                  <div className="flex items-center justify-between">
                    <div className="flex flex-col">
                      <span className="font-medium">
                        {label}
                        {/* category は progress_logs 用。strategy_data では無い可能性が高い */}
                        {row.category ? `（${row.category}）` : ''}
                      </span>
                      <span className="text-gray-500">
                        {last
                          ? `Y3: 売上 ${fmtNum(last.sales)} / 営業利益 ${fmtNum(last.op)}`
                          : '—'}
                        {typeof prob === 'number' ? ` ・ 成功確率 ${prob}%` : ''}
                      </span>
                    </div>
                    {/* ここに「詳細を見る」など後日モーダルを追加可能 */}
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
