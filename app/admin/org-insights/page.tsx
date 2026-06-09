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
  LineChart,
  Line,
  ScatterChart,
  Scatter,
} from 'recharts';

const COLORS = ['#0088FE', '#00C49F', '#FFBB28', '#FF8042', '#8884D8'];

export default function OrgAlignmentAdminInsightsPage() {
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [insight, setInsight] = useState<OrgAlignmentInsightRow | null>(null);
  const [error, setError] = useState<string>('');
  const [expandedInsight, setExpandedInsight] = useState<number | null>(null);
  const [sharingInsightIndex, setSharingInsightIndex] = useState<number | null>(null);
  const [sharedDrafts, setSharedDrafts] = useState<{ [key: number]: boolean }>({});

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
      setExpandedInsight(null);
    } catch (err: any) {
      console.error('handleGenerate error:', err);
      setError(err.message || 'AI集計の実行に失敗しました。');
    } finally {
      setGenerating(false);
    }
  };

  // ===== 共有用下書き作成 =====
  const handleCreateSharedDraft = async (insightIndex: number) => {
    setSharingInsightIndex(insightIndex);
    setError('');

    try {
      const { ok, data: sessionData } = await safeGetSession();
      if (!ok || !sessionData?.session?.access_token) {
        setError('ログインセッションが無効です。再ログインしてください。');
        setSharingInsightIndex(null);
        return;
      }

      const res = await fetch('/api/org-alignment/admin/shared-topics', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${sessionData.session.access_token}`,
        },
        body: JSON.stringify({ insightIndex }),
      });

      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        throw new Error(errData.error || `API error: ${res.status}`);
      }

      // 下書き作成済みとしてマーク
      setSharedDrafts((prev) => ({
        ...prev,
        [insightIndex]: true,
      }));
    } catch (err: any) {
      console.error('handleCreateSharedDraft error:', err);
      setError(err.message || '共有用下書きの作成に失敗しました。');
    } finally {
      setSharingInsightIndex(null);
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

  // 優先度ランキング
  const priorityRanking = insight
    ? [...insight.insights]
        .filter((ins) => ins.priorityScore !== undefined)
        .sort((a, b) => (b.priorityScore ?? 0) - (a.priorityScore ?? 0))
        .slice(0, 5)
    : [];

  // STAGE3/4反映候補数
  const stage3Candidates = insight
    ? insight.insights.filter((ins) => ins.strategyReflection?.stage3Status === '反映候補')
        .length
    : 0;
  const stage4Candidates = insight
    ? insight.insights.filter((ins) => ins.strategyReflection?.stage4Status === 'OKR化候補')
        .length
    : 0;

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
              会社全体の「認識のズレ」を論点化し、意思決定と実行接続をサポートします。
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

          {/* ===== 全体サマリーと主要指標 ===== */}
          {!loading && insight && (
            <>
              <section className="grid grid-cols-1 gap-6 md:grid-cols-4">
                <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
                  <p className="text-xs font-semibold text-slate-500">対象投稿件数</p>
                  <p className="mt-2 text-3xl font-bold text-slate-950">
                    {insight.source_case_count}
                  </p>
                  <p className="mt-1 text-xs text-slate-500">件</p>
                </div>

                <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
                  <p className="text-xs font-semibold text-slate-500">AI抽出論点数</p>
                  <p className="mt-2 text-3xl font-bold text-slate-950">
                    {insight.insights.length}
                  </p>
                  <p className="mt-1 text-xs text-slate-500">個</p>
                </div>

                <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
                  <p className="text-xs font-semibold text-slate-500">STAGE3反映候補</p>
                  <p className="mt-2 text-3xl font-bold text-slate-950">
                    {stage3Candidates}
                  </p>
                  <p className="mt-1 text-xs text-slate-500">件</p>
                </div>

                <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
                  <p className="text-xs font-semibold text-slate-500">STAGE4 OKR化候補</p>
                  <p className="mt-2 text-3xl font-bold text-slate-950">
                    {stage4Candidates}
                  </p>
                  <p className="mt-1 text-xs text-slate-500">件</p>
                </div>
              </section>

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

                {/* リスクレベル別件数 */}
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

              {/* ===== 優先度ランキング ===== */}
              {priorityRanking.length > 0 && (
                <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
                  <h2 className="text-xl font-bold text-slate-950">優先度ランキング（トップ5）</h2>
                  <div className="mt-4 space-y-3">
                    {priorityRanking.map((ins, idx) => (
                      <div key={idx} className="flex items-center justify-between rounded-lg bg-slate-50 p-4">
                        <div className="flex-1">
                          <p className="text-sm font-semibold text-slate-950">{idx + 1}. {ins.title}</p>
                          <div className="mt-1 flex gap-4">
                            {ins.priorityScore !== undefined && (
                              <span className="text-xs text-slate-600">
                                スコア: {ins.priorityScore}
                              </span>
                            )}
                            {ins.importance && (
                              <span className="text-xs text-slate-600">
                                重要度: {ins.importance}
                              </span>
                            )}
                            {ins.urgency && (
                              <span className="text-xs text-slate-600">
                                緊急度: {ins.urgency}
                              </span>
                            )}
                          </div>
                        </div>
                        <div className="h-8 w-16 rounded-full bg-gradient-to-r from-blue-400 to-blue-600 flex items-center justify-center text-white text-xs font-bold">
                          {Math.round((ins.priorityScore ?? 0) / 10)}
                        </div>
                      </div>
                    ))}
                  </div>
                </section>
              )}

              {/* ===== 論点カード（詳細表示対応） ===== */}
              <section className="space-y-4">
                <h2 className="text-xl font-bold text-slate-950">論点・インサイト（詳細表示）</h2>
                {insight.insights.length > 0 ? (
                  insight.insights.map((ins, idx) => (
                    <article
                      key={idx}
                      className="rounded-2xl border border-slate-200 bg-white shadow-sm"
                    >
                      {/* カードヘッダー */}
                      <div
                        onClick={() => setExpandedInsight(expandedInsight === idx ? null : idx)}
                        className="cursor-pointer p-6"
                      >
                        <div className="flex items-start justify-between">
                          <div className="flex-1">
                            <h3 className="text-lg font-bold text-slate-950">{ins.title}</h3>
                            <p className="mt-2 text-sm leading-7 text-slate-700">{ins.description}</p>

                            <div className="mt-4 flex flex-wrap gap-3">
                              {ins.priorityScore !== undefined && (
                                <div className="rounded-lg bg-blue-50 px-3 py-1">
                                  <p className="text-xs font-semibold text-blue-700">
                                    優先度: {ins.priorityScore}
                                  </p>
                                </div>
                              )}
                              {ins.importance && (
                                <div className={`rounded-lg px-3 py-1 ${
                                  ins.importance === '高'
                                    ? 'bg-red-50'
                                    : ins.importance === '中'
                                    ? 'bg-yellow-50'
                                    : 'bg-green-50'
                                }`}>
                                  <p className={`text-xs font-semibold ${
                                    ins.importance === '高'
                                      ? 'text-red-700'
                                      : ins.importance === '中'
                                      ? 'text-yellow-700'
                                      : 'text-green-700'
                                  }`}>
                                    重要度: {ins.importance}
                                  </p>
                                </div>
                              )}
                              {ins.urgency && (
                                <div className={`rounded-lg px-3 py-1 ${
                                  ins.urgency === '高'
                                    ? 'bg-red-50'
                                    : ins.urgency === '中'
                                    ? 'bg-yellow-50'
                                    : 'bg-green-50'
                                }`}>
                                  <p className={`text-xs font-semibold ${
                                    ins.urgency === '高'
                                      ? 'text-red-700'
                                      : ins.urgency === '中'
                                      ? 'text-yellow-700'
                                      : 'text-green-700'
                                  }`}>
                                    緊急度: {ins.urgency}
                                  </p>
                                </div>
                              )}
                            </div>
                          </div>
                          <div className="text-slate-400 ml-4">
                            {expandedInsight === idx ? '▼' : '▶'}
                          </div>
                        </div>
                      </div>

                      {/* 展開コンテンツ */}
                      {expandedInsight === idx && (
                        <div className="border-t border-slate-200 p-6 space-y-6">
                          {/* 基本情報 */}
                          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
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

                          {/* 影響範囲 */}
                          {ins.impactScope && (
                            <div>
                              <p className="text-xs font-semibold text-slate-500">影響範囲</p>
                              <p className="mt-1 text-sm text-slate-700">{ins.impactScope}</p>
                            </div>
                          )}

                          {/* 認識のズレ構造 */}
                          {ins.recognitionGap && (
                            <div className="rounded-lg bg-slate-50 p-4 space-y-3">
                              <p className="text-xs font-semibold text-slate-500">認識のズレ構造</p>
                              <div>
                                <p className="text-xs font-semibold text-slate-600">現場の認識</p>
                                <p className="mt-1 text-sm text-slate-700">{ins.recognitionGap.fieldView}</p>
                              </div>
                              <div>
                                <p className="text-xs font-semibold text-slate-600">会社としての認識</p>
                                <p className="mt-1 text-sm text-slate-700">{ins.recognitionGap.companyView}</p>
                              </div>
                              <div>
                                <p className="text-xs font-semibold text-slate-600">ズレの本質</p>
                                <p className="mt-1 text-sm text-slate-700">{ins.recognitionGap.gapEssence}</p>
                              </div>
                            </div>
                          )}

                          {/* 会社としての判断軸 */}
                          {ins.companyAxis && (
                            <div>
                              <p className="text-xs font-semibold text-slate-500">会社としての判断軸</p>
                              <p className="mt-1 text-sm text-slate-700">{ins.companyAxis}</p>
                            </div>
                          )}

                          {/* すり合わせ形式 */}
                          {ins.sessionType && (
                            <div>
                              <p className="text-xs font-semibold text-slate-500">推奨すり合わせ形式</p>
                              <p className="mt-1 text-sm text-slate-700">{ins.sessionType}</p>
                            </div>
                          )}

                          {/* 推奨アクション */}
                          <div>
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

                          {/* 次アクション（詳細） */}
                          {ins.nextActions && ins.nextActions.length > 0 && (
                            <div className="border-t border-slate-200 pt-6">
                              <p className="text-xs font-semibold text-slate-500">次アクション</p>
                              <div className="mt-2 space-y-2">
                                {ins.nextActions.map((action, i) => (
                                  <div key={i} className="rounded-lg bg-slate-50 p-3 text-xs">
                                    <p className="font-semibold text-slate-700">{action.title}</p>
                                    <div className="mt-1 flex gap-4 text-slate-600">
                                      <span>責任: {action.owner}</span>
                                      <span>期限: {action.dueDate}</span>
                                      <span className={`font-semibold ${
                                        action.status === '完了' ? 'text-green-600' :
                                        action.status === '対応中' ? 'text-yellow-600' : 'text-slate-600'
                                      }`}>
                                        {action.status}
                                      </span>
                                    </div>
                                  </div>
                                ))}
                              </div>
                            </div>
                          )}

                          {/* STAGE3/4反映候補 */}
                          {ins.strategyReflection && (
                            <div className="border-t border-slate-200 pt-6 rounded-lg bg-slate-50 p-4 space-y-3">
                              <p className="text-xs font-semibold text-slate-500">STAGE3/4への還流候補</p>
                              <div className="grid grid-cols-2 gap-4 text-xs">
                                <div>
                                  <p className="font-semibold text-slate-600">STAGE3状態</p>
                                  <p className="mt-1 text-slate-700">{ins.strategyReflection.stage3Status}</p>
                                </div>
                                <div>
                                  <p className="font-semibold text-slate-600">STAGE4 OKR化状態</p>
                                  <p className="mt-1 text-slate-700">{ins.strategyReflection.stage4Status}</p>
                                </div>
                              </div>

                              {ins.strategyReflection.generatedProjects && ins.strategyReflection.generatedProjects.length > 0 && (
                                <div>
                                  <p className="text-xs font-semibold text-slate-600">関連プロジェクト案</p>
                                  <div className="mt-1 space-y-1">
                                    {ins.strategyReflection.generatedProjects.map((proj, i) => (
                                      <div key={i} className="text-xs text-slate-700 pl-2 border-l-2 border-slate-300">
                                        <p className="font-semibold">{proj.projectTitle} ({proj.departmentName})</p>
                                        <p>{proj.projectSummary}</p>
                                      </div>
                                    ))}
                                  </div>
                                </div>
                              )}

                              {ins.strategyReflection.generatedOkrs && ins.strategyReflection.generatedOkrs.length > 0 && (
                                <div>
                                  <p className="text-xs font-semibold text-slate-600">関連OKR案</p>
                                  <div className="mt-1 space-y-2">
                                    {ins.strategyReflection.generatedOkrs.map((okr, i) => (
                                      <div key={i} className="text-xs text-slate-700 pl-2 border-l-2 border-blue-300">
                                        <p className="font-semibold">{okr.objective}</p>
                                        <p className="text-slate-600 mt-1">責任: {okr.owner}</p>
                                        <ul className="mt-1 space-y-0.5 list-inside list-disc">
                                          {okr.keyResults.map((kr, j) => (
                                            <li key={j} className="text-slate-700">{kr}</li>
                                          ))}
                                        </ul>
                                      </div>
                                    ))}
                                  </div>
                                </div>
                              )}
                            </div>
                          )}

                          <p className="text-xs text-slate-500 border-t border-slate-200 pt-4">
                            {ins.stage3Stage4Relevance}
                          </p>

                          {/* ===== 共有用下書き作成ボタン ===== */}
                          <div className="flex gap-3 border-t border-slate-200 pt-4">
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                handleCreateSharedDraft(idx);
                              }}
                              disabled={sharedDrafts[idx] || sharingInsightIndex === idx}
                              className={`rounded-lg px-4 py-2 text-sm font-semibold transition ${
                                sharedDrafts[idx]
                                  ? 'bg-green-50 text-green-700 ring-1 ring-green-200 cursor-default'
                                  : 'bg-blue-50 text-blue-700 ring-1 ring-blue-200 hover:bg-blue-100'
                              } ${sharingInsightIndex === idx ? 'opacity-50' : ''}`}
                            >
                              {sharingInsightIndex === idx ? '作成中...' : sharedDrafts[idx] ? '共有下書き作成済み' : '共有用に下書き作成'}
                            </button>
                          </div>
                        </div>
                      )}
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
