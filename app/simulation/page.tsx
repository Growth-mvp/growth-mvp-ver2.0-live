// /app/simulation/page.tsx
'use client';

import React, { useEffect, useMemo, useState } from 'react';
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
  saveSimulationResult,
  getSimulationResults,
  type SimulationLogRow,
} from '@/utils/supabase/strategy';

export default function SimulationPage() {
  const s = useStrategyStore() as any;
  const { user } = useUserStore();

  /* ---------------- 入力（finance & KR） ---------------- */
  const financeSummary: FinanceSummary = useMemo(() => {
    const baseline = Array.isArray(s?.financeSummary?.baseline)
      ? s.financeSummary.baseline
      : [{ yearLabel: 'Y0', sales: 1000, operatingProfit: 100 }];
    return { baseline };
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
              arr.push({
                baseline: Number(kr?.baseline ?? 0) || 0,
                target: Number(kr?.target ?? 0) || 0,
                unit: String(kr?.unit ?? ''),
                weight: typeof kr?.weight === 'number' ? kr.weight : undefined,
                variable: kr?.variable,
                alignmentScore:
                  typeof kr?.alignmentScore === 'number' ? kr.alignmentScore : undefined,
              });
            }
          }
        }
      }
      if (arr.length > 0) return arr;
    } catch {}

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
      prob: Number((finalProb * 100).toFixed(1)) / 100, // 0..1 をそのまま
    }));
  }, [projection, finalProb]);

  const y3 = projection.points.at(-1);

  /* ---------------- 保存＆履歴 ---------------- */
  const [saving, setSaving] = useState(false);
  const [history, setHistory] = useState<SimulationLogRow[]>([]);
  const [loadingHist, setLoadingHist] = useState(false);
  const [notice, setNotice] = useState<string>('');

  const loadHistory = async () => {
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
  };

  useEffect(() => {
    loadHistory();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id]);

  const handleSave = async () => {
    if (!user?.id) {
      setNotice('⚠️ ログインが必要です');
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

      const { error } = await saveSimulationResult(user.id, payload, null);
      if (error) throw error;

      setNotice('✅ シミュレーション結果を保存しました');
      await loadHistory();
    } catch (e) {
      console.error('saveSimulationResult error:', e);
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
            <li>売上（Y3）：<b>{y3 ? Math.round(y3.sales) : '-'}</b></li>
            <li>営業利益（Y3）：<b>{y3 ? Math.round(y3.op) : '-'}</b></li>
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
            >
              施策影響を再計算
            </button>
            <button
              disabled={saving || !user?.id}
              onClick={handleSave}
              className={[
                'px-3 py-2 rounded-lg border border-gray-200 shadow-sm bg-white hover:bg-gray-50 text-sm',
                saving ? 'opacity-60 cursor-not-allowed' : '',
              ].join(' ')}
              title={!user?.id ? 'ログインしてください' : undefined}
            >
              {saving ? '保存中…' : '結果を保存'}
            </button>
          </div>
        </div>
      </section>

      {/* 履歴 */}
      <section className="mt-6 rounded-2xl border border-gray-200 bg-white p-4 shadow-sm">
        <div className="flex items-center justify-between gap-2 mb-2">
          <h2 className="text-lg font-medium">シミュレーション履歴</h2>
          <button
            onClick={loadHistory}
            className="text-xs px-2 py-1 rounded-lg border border-gray-200 bg-white hover:bg-gray-50"
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
              // 可変列対応：log / payload / data のどれかに保存されている
              const body = (row as any).log ?? (row as any).payload ?? (row as any).data ?? {};
              const proj = body?.projection?.points ?? [];
              const last = Array.isArray(proj) && proj.length > 0 ? proj[proj.length - 1] : null;
              const prob = typeof body?.finalProb === 'number' ? Math.round(body.finalProb * 100) : null;

              return (
                <li key={row.id} className="py-3 text-sm">
                  <div className="flex items-center justify-between">
                    <div className="flex flex-col">
                      <span className="font-medium">
                        {new Date(row.created_at).toLocaleString()} （{row.category || 'simulation'}）
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

/* ============ 小物 ============ */
function fmtNum(n: any) {
  const v = Number(n);
  if (!Number.isFinite(v)) return '-';
  return v.toLocaleString();
}
