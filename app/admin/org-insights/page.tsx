// /app/admin/org-insights/page.tsx
'use client';

import { useState, useEffect } from 'react';
import AdminGuard from '@/app/admin/AdminGuard';
import { safeGetSession } from '@/utils/supabase/client';
import type { OrgAlignmentInsightRow } from '@/types/org-alignment';
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell,
} from 'recharts';

const COLORS = ['#0088FE', '#00C49F', '#FFBB28', '#FF8042', '#8884D8'];

export default function OrgAlignmentAdminInsightsPage() {
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [insight, setInsight] = useState<OrgAlignmentInsightRow | null>(null);
  const [error, setError] = useState<string>('');

  // ===== 初回データ取得 =====
  useEffect(() => {
    fetchLatestInsight();
  }, []);

  const fetchLatestInsight = async () => {
    setLoading(true);
    setError('');

    try {
      const { ok, data: sessionData } = await safeGetSession();
      if (!ok || !sessionData?.session?.access_token) {
        setError('ログインセッションが無効です。再ログインしてください。');
        setLoading(false);
        return;
      }

      const res = await fetch('/api/org-alignment/admin/insights', {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${sessionData.session.access_token}`,
        },
      });

      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        throw new Error(errData.error || `API error: ${res.status}`);
      }

      const resData = await res.json();
      setInsight(resData.insight || null);
    } catch (err: any) {
      console.error('fetchLatestInsight error:', err);
      setError(err.message || '集計結果の取得に失敗しました。');
    } finally {
      setLoading(false);
    }
  };

  // ===== AI集計実行 =====
  const handleGenerate = async () => {
    setGenerating(true);
    setError('');

    try {
      const { ok, data: sessionData } = await safeGetSession();
      if (!ok || !sessionData?.session?.access_token) {
        setError('ログインセッションが無効です。再ログインしてください。');
        setGenerating(false);
        return;
      }

      const res = await fetch('/api/org-alignment/admin/insights/generate', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${sessionData.session.access_token}`,
        },
      });

      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        throw new Error(errData.error || `API error: ${res.status}`);
      }

      // 再取得して最新データを表示
      await fetchLatestInsight();
    } catch (err: any) {
      console.error('handleGenerate error:', err);
      setError(err.message || 'AI集計の実行に失敗しました。');
    } finally {
      setGenerating(false);
    }
  };

  // ===== グラフデータ整形 =====
  const categoryChartData = insight
    ? Object.entries(insight.category_counts).map(([key, value]) => ({
        name: key,
        count: value,
      }))
    : [];

  const priorityChartData = insight
    ? [
        { name: 'Low', value: insight.priority_counts.low, color: '#00C49F' },
        { name: 'Medium', value: insight.priority_counts.medium, color: '#FFBB28' },
        { name: 'High', value: insight.priority_counts.high, color: '#FF8042' },
      ]
    : [];

  return (
    <AdminGuard>
      <div className="min-h-screen bg-slate-50 px-6 py-8">
        <div className="mx-auto max-w-7xl space-y-8">
          {/* ===== ヘッダー ===== */}
          <header>
            <h1 className="text-3xl font-bold text-slate-950">
              組織論点ダッシュボード
            </h1>
            <p className="mt-2 text-slate-600">
              会社全体の「認識のズレ」を論点化し、STAGE3/4への還流候補を提示します。
            </p>
          </header>

          {/* ===== エラー表示 ===== */}
          {error && (
            <div className="rounded-2xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">
              {error}
            </div>
          )}

          {/* ===== 再集計ボタン ===== */}
          <div className="flex items-center justify-between">
            <div>
              {insight && (
                <p className="text-sm text-slate-500">
                  最終更新: {new Date(insight.generated_at).toLocaleString('ja-JP')} /{' '}
                  集計元ケース数: {insight.source_case_count}件
                </p>
              )}
            </div>
            <button
              type="button"
              onClick={handleGenerate}
              disabled={generating || loading}
              className="rounded-xl bg-slate-900 px-5 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-slate-800 disabled:cursor-not-allowed disabled:bg-slate-400"
            >
              {generating ? 'AI集計中...' : '最新の投稿をもとに再集計'}
            </button>
          </div>

          {/* ===== ローディング ===== */}
          {loading && (
            <div className="rounded-2xl border border-slate-200 bg-white p-6 text-center text-sm text-slate-600">
              読み込み中...
            </div>
          )}

          {/* ===== データがない場合 ===== */}
          {!loading && !insight && (
            <div className="rounded-2xl border border-slate-200 bg-white p-6 text-center">
              <p className="text-sm text-slate-600">
                まだ集計結果がありません。「最新の投稿をもとに再集計」ボタンを押して集計を開始してください。
              </p>
            </div>
          )}

          {/* ===== サマリーカード ===== */}
          {!loading && insight && (
            <>
              <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
                <h2 className="text-xl font-bold text-slate-950">全体サマリー</h2>
                <p className="mt-3 text-sm leading-7 text-slate-700">{insight.summary}</p>
              </section>

              {/* ===== グラフセクション ===== */}
              <section className="grid grid-cols-1 gap-6 md:grid-cols-2">
                {/* カテゴリー別件数 */}
                <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
                  <h3 className="text-lg font-bold text-slate-950">カテゴリー別件数</h3>
                  {categoryChartData.length > 0 ? (
                    <ResponsiveContainer width="100%" height={Math.max(300, categoryChartData.length * 50)}>
                      <BarChart data={categoryChartData} layout="vertical">
                        <CartesianGrid strokeDasharray="3 3" />
                        <XAxis type="number" />
                        <YAxis dataKey="name" type="category" width={150} />
                        <Tooltip />
                        <Bar dataKey="count" fill="#0088FE" />
                      </BarChart>
                    </ResponsiveContainer>
                  ) : (
                    <p className="mt-4 text-sm text-slate-500">データがありません。</p>
                  )}
                </div>

                {/* 優先度別件数 */}
                <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
                  <h3 className="text-lg font-bold text-slate-950">リスクレベル別件数</h3>
                  {priorityChartData.some((d) => d.value > 0) ? (
                    <ResponsiveContainer width="100%" height={300}>
                      <PieChart>
                        <Pie
                          data={priorityChartData}
                          cx="50%"
                          cy="50%"
                          labelLine={false}
                          label={(entry) => entry.value > 0 ? `${entry.name}: ${entry.value}` : ''}
                          outerRadius={80}
                          fill="#8884d8"
                          dataKey="value"
                        >
                          {priorityChartData.map((entry, index) => (
                            <Cell key={`cell-${index}`} fill={entry.color} />
                          ))}
                        </Pie>
                        <Tooltip />
                      </PieChart>
                    </ResponsiveContainer>
                  ) : (
                    <p className="mt-4 text-sm text-slate-500">データがありません。</p>
                  )}
                </div>
              </section>

              {/* ===== 論点カード ===== */}
              <section className="space-y-4">
                <h2 className="text-xl font-bold text-slate-950">論点・インサイト</h2>
                {insight.insights.length > 0 ? (
                  insight.insights.map((ins, idx) => (
                    <article
                      key={idx}
                      className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm"
                    >
                      <h3 className="text-lg font-bold text-slate-950">{ins.title}</h3>
                      <p className="mt-2 text-sm leading-7 text-slate-700">{ins.description}</p>

                      <div className="mt-4 grid grid-cols-1 gap-4 md:grid-cols-2">
                        <div>
                          <p className="text-xs font-semibold text-slate-500">関連カテゴリー</p>
                          <div className="mt-1 flex flex-wrap gap-2">
                            {ins.relatedIssueTypes.map((it) => (
                              <span
                                key={it}
                                className="rounded-full bg-slate-100 px-3 py-1 text-xs font-medium text-slate-700"
                              >
                                {it}
                              </span>
                            ))}
                          </div>
                        </div>

                        <div>
                          <p className="text-xs font-semibold text-slate-500">影響する部門</p>
                          <div className="mt-1 flex flex-wrap gap-2">
                            {ins.affectedDepartments.map((dept) => {
                              const displayDept = dept === 'unknown' ? '全社横断' : dept;
                              return (
                                <span
                                  key={dept}
                                  className="rounded-full bg-blue-100 px-3 py-1 text-xs font-medium text-blue-700"
                                >
                                  {displayDept}
                                </span>
                              );
                            })}
                          </div>
                        </div>
                      </div>

                      <div className="mt-4">
                        <p className="text-xs font-semibold text-slate-500">推奨アクション</p>
                        <ul className="mt-2 space-y-1">
                          {ins.recommendedActions.map((action, i) => (
                            <li key={i} className="flex items-start gap-2 text-sm text-slate-700">
                              <span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-slate-400" />
                              <span>{action}</span>
                            </li>
                          ))}
                        </ul>
                      </div>

                      <div className="mt-4 rounded-xl bg-slate-50 p-4">
                        <p className="text-xs font-semibold text-slate-500">STAGE3/4への還流候補</p>
                        <p className="mt-1 text-sm leading-7 text-slate-700">
                          {ins.stage3Stage4Relevance}
                        </p>
                      </div>
                    </article>
                  ))
                ) : (
                  <p className="text-sm text-slate-500">論点がありません。</p>
                )}
              </section>

              {/* ===== 部門別傾向テーブル ===== */}
              {insight.department_trends && insight.department_trends.length > 0 && (
                <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
                  <h2 className="text-xl font-bold text-slate-950">部門別傾向</h2>
                  <div className="mt-4 overflow-x-auto">
                    <table className="w-full text-left text-sm">
                      <thead className="border-b border-slate-200 text-xs uppercase text-slate-600">
                        <tr>
                          <th className="p-3">部門名</th>
                          <th className="p-3">件数</th>
                          <th className="p-3">主なカテゴリー</th>
                          <th className="p-3">平均リスクレベル</th>
                        </tr>
                      </thead>
                      <tbody>
                        {insight.department_trends.map((trend, idx) => (
                          <tr key={idx} className="border-b border-slate-100">
                            <td className="p-3 font-semibold">{trend.departmentName}</td>
                            <td className="p-3">{trend.caseCount}件</td>
                            <td className="p-3">
                              {trend.topIssueTypes.map((it) => it.issueType).join(', ')}
                            </td>
                            <td className="p-3">
                              <span
                                className={`inline-block rounded-full px-3 py-1 text-xs font-semibold ${
                                  trend.avgRiskLevel === 'high'
                                    ? 'bg-red-100 text-red-700'
                                    : trend.avgRiskLevel === 'medium'
                                    ? 'bg-yellow-100 text-yellow-700'
                                    : 'bg-green-100 text-green-700'
                                }`}
                              >
                                {trend.avgRiskLevel}
                              </span>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </section>
              )}
            </>
          )}
        </div>
      </div>
    </AdminGuard>
  );
}
