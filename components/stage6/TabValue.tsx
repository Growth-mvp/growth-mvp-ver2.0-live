'use client';

import { useState } from 'react';
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
import type { IssueResolution } from '@/utils/stage6';
import type { ProjectIssueLink } from '@/types/strategy';

type LinkSourceLabel = {
  label: string;
  className: string;
};

function sourceLabel(source?: string, locked?: boolean): LinkSourceLabel {
  if (locked) {
    return { label: '固定', className: 'bg-slate-900 text-white' };
  }
  if (source === 'manual') {
    return { label: '手動', className: 'bg-blue-600 text-white' };
  }
  if (source === 'auto') {
    return { label: '推定', className: 'bg-slate-100 text-slate-700' };
  }
  return { label: '不明', className: 'bg-slate-100 text-slate-600' };
}

function strengthLabel(strength?: number) {
  if (strength === 3) return { label: '強', className: 'bg-green-100 text-green-800' };
  if (strength === 2) return { label: '中', className: 'bg-blue-100 text-blue-800' };
  if (strength === 1) return { label: '弱', className: 'bg-amber-100 text-amber-800' };
  return { label: '-', className: 'bg-slate-100 text-slate-600' };
}

function shortProjectName(projectId: string) {
  const parts = projectId.includes('::') ? projectId.split('::') : projectId.split(':');
  const dept = parts[0] ?? '';
  const proj = parts[1] ?? projectId;
  return { dept, proj };
}

interface TabValueProps {
  vaCards: Array<{
    key: string;
    label: string;
    value: string | number;
    unit: string;
  }>;
  issueResolutions: IssueResolution[];
  companyTargets: Array<{
    id: string;
    label: string;
  }>;
  indicatorSeries?: {
    growth: any[];
    margin: any[];
  };
  projectIssueLinks?: ProjectIssueLink[];
  allProjectKeys?: string[];
  onUpdateLink?: (projectId: string, issueId: string, strength: 1 | 2 | 3, notes?: string) => void;
  onRemoveLink?: (projectId: string, issueId: string) => void;
}

export function TabValue({
  vaCards,
  issueResolutions,
  companyTargets,
  indicatorSeries,
  projectIssueLinks,
  allProjectKeys,
  onUpdateLink,
  onRemoveLink,
}: TabValueProps) {
  const [expandedIssue, setExpandedIssue] = useState<string | null>(null);
  return (
    <>
      {/* A. Key performance indicators */}
      {indicatorSeries && (indicatorSeries.growth.length > 0 || indicatorSeries.margin.length > 0) && (
        <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
          <div className="mb-4">
            <h2 className="text-lg font-bold text-slate-900">企業価値につながる指標（最小セット）</h2>
            <p className="mt-1 text-[12px] text-slate-600">売上成長率（成長性）／営業利益率（収益性）</p>
          </div>

          <div className="grid gap-6 md:grid-cols-2">
            {/* Revenue Growth Rate */}
            <div>
              <div className="mb-2 text-sm font-semibold text-slate-800">売上成長率（年次）</div>
              <div className="h-[240px] w-full">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={indicatorSeries.growth}>
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis dataKey="year" />
                    <YAxis tickFormatter={(v) => `${(v * 100).toFixed(0)}%`} />
                    <ReTooltip
                      formatter={(value: any, name: any) => [`${(Number(value) * 100).toFixed(1)}%`, name]}
                    />
                    <Legend />
                    <Line
                      type="monotone"
                      dataKey="baseline"
                      name="Baseline"
                      stroke="#64748b"
                      strokeWidth={2}
                      dot={false}
                    />
                    <Line
                      type="monotone"
                      dataKey="all"
                      name="全プロジェクト"
                      stroke="#0f172a"
                      strokeWidth={2}
                      dot={false}
                    />
                    <Line
                      type="monotone"
                      dataKey="selected"
                      name="選択プロジェクト"
                      stroke="#334155"
                      strokeWidth={2}
                      strokeDasharray="6 3"
                      dot={false}
                    />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            </div>

            {/* Operating Margin */}
            <div>
              <div className="mb-2 text-sm font-semibold text-slate-800">営業利益率（年次）</div>
              <div className="h-[240px] w-full">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={indicatorSeries.margin}>
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis dataKey="year" />
                    <YAxis tickFormatter={(v) => `${(v * 100).toFixed(0)}%`} />
                    <ReTooltip
                      formatter={(value: any, name: any) => [`${(Number(value) * 100).toFixed(1)}%`, name]}
                    />
                    <Legend />
                    <Line
                      type="monotone"
                      dataKey="baseline"
                      name="Baseline"
                      stroke="#64748b"
                      strokeWidth={2}
                      dot={false}
                    />
                    <Line
                      type="monotone"
                      dataKey="all"
                      name="全プロジェクト"
                      stroke="#0f172a"
                      strokeWidth={2}
                      dot={false}
                    />
                    <Line
                      type="monotone"
                      dataKey="selected"
                      name="選択プロジェクト"
                      stroke="#334155"
                      strokeWidth={2}
                      strokeDasharray="6 3"
                      dot={false}
                    />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            </div>
          </div>
        </section>
      )}

      {/* B. Value Analysis & Issue Resolution */}
      <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
        <div className="mb-4">
          <h2 className="text-lg font-bold text-slate-900">価値分析 & 論点解決度</h2>
          <p className="mt-1 text-[12px] text-slate-600">
            STAGE1の5指標分析と、論点ブロック、企業価値への接続を可視化します。
          </p>
        </div>

        <div className="space-y-4">
        {/* Value Analysis Cards */}
        {vaCards.length > 0 ? (
          <div className="rounded-lg border border-slate-200 bg-slate-50 p-4">
            <div className="text-sm font-semibold text-slate-900 mb-2">5指標分析（STAGE1）</div>
            <div className="grid grid-cols-2 gap-3 md:grid-cols-5 text-xs">
              {vaCards.map((card) => (
                <div key={card.key}>
                  <div className="font-medium text-slate-600">{card.label}</div>
                  <div className="mt-1 text-lg font-bold text-slate-900">
                    {card.value}
                    {card.unit}
                  </div>
                </div>
              ))}
            </div>
          </div>
        ) : (
          <div className="rounded-lg bg-slate-50 p-4 text-sm text-slate-600">
            ValueAnalysis がまだ入力されていません。
          </div>
        )}

        {/* Issue Resolutions */}
        {issueResolutions.length === 0 ? (
          <div className="rounded-lg bg-slate-50 p-4 text-sm text-slate-600">
            STAGE1の論点ブロックがまだ設定されていません。
          </div>
        ) : (
          <div className="space-y-3">
            <div className="text-sm font-semibold text-slate-900">論点ブロック & 解決度</div>
            {issueResolutions.map((resolution, idx) => {
              const linksForIssue = (projectIssueLinks ?? []).filter((l) => l.issueId === resolution.issueTitle);
              const linkByProject = new Map<string, ProjectIssueLink>();
              for (const l of linksForIssue) linkByProject.set(l.projectId, l);

              // Resolution status color coding
              let resolutionColor = 'text-slate-500';
              let resolutionLabel = '未接続';

              if (resolution.resolutionStatus === 'achieved') {
                resolutionColor = 'text-green-700';
                resolutionLabel = `達成 (${(resolution.resolutionRate ?? 0).toFixed(0)}%)`;
              } else if (resolution.resolutionStatus === 'in_progress') {
                resolutionColor = 'text-blue-600';
                resolutionLabel = `進捗中 (${(resolution.resolutionRate ?? 0).toFixed(0)}%)`;
              } else if (resolution.resolutionStatus === 'partial') {
                resolutionColor = 'text-amber-600';
                resolutionLabel = `課題あり (${(resolution.resolutionRate ?? 0).toFixed(0)}%)`;
              }

              return (
                <div key={idx} className="rounded-lg border border-slate-200 bg-white p-4">
                  <div className="flex items-start justify-between gap-4">
                    <div className="flex-1">
                      <div className="font-medium text-slate-900">{resolution.issueTitle}</div>
                      <div className="mt-1 text-sm text-slate-600">{resolution.issueDescription}</div>
                      {resolution.linkedMetrics && resolution.linkedMetrics.length > 0 && (
                        <div className="mt-2 text-xs text-slate-500">
                          紐付く指標：{resolution.linkedMetrics.join(', ')}
                        </div>
                      )}
                      {/* I-4: 3-state display logic */}
                      {resolution.linkedTargets.length > 0 ? (
                        // State 1: 紐付く北星メトリクスがある
                        <div className="mt-3 border-t border-slate-200 pt-2">
                          <div className="text-xs font-medium text-slate-700">✓ 紐付く北星メトリクス：</div>
                          <div className="mt-1 space-y-1">
                            {resolution.linkedTargets.map((label, tidx) => (
                              <div key={tidx} className="text-xs text-slate-600">
                                • {label}
                              </div>
                            ))}
                          </div>
                        </div>
                      ) : projectIssueLinks && projectIssueLinks.some(l => l.issueId === resolution.issueTitle) ? (
                        // State 2: projectIssueLinks がこのissueに存在（North Star紐付けなし）
                        <div className="mt-3 border-t border-slate-200 pt-2">
                          <div className="text-xs text-slate-500">
                            注：北星メトリクスの紐付けはSTAGE2で定義。解決度はプロジェクト強度から計算しています。
                          </div>
                        </div>
                      ) : (
                        // State 3: 完全未接続（警告）
                        <div className="mt-3 border-t border-slate-200 pt-2">
                          <div className="text-xs font-medium text-amber-700">
                            ⚠ 未接続：プロジェクト紐付けがまだ設定されていません
                          </div>
                          <div className="mt-2">
                            <div className="text-xs text-slate-600 mb-2">
                              このIssueを解決するプロジェクトと強度を設定してください。
                            </div>
                            <div className="text-xs text-slate-500 space-y-1">
                              <div>利用可能なNorth Star例：</div>
                              {companyTargets.slice(0, 3).map((t) => (
                                <div key={t.id}>• {t.label}</div>
                              ))}
                              {companyTargets.length > 3 && (
                                <div>• ほか {companyTargets.length - 3} 件</div>
                              )}
                            </div>
                          </div>
                        </div>
                      )}

                      <div className="mt-3 border-t border-slate-200 pt-2">
                        <button
                          onClick={() =>
                            setExpandedIssue(expandedIssue === resolution.issueTitle ? null : resolution.issueTitle)
                          }
                          className="text-xs text-blue-600 hover:underline"
                        >
                          {expandedIssue === resolution.issueTitle ? '閉じる' : '根拠／紐付けを確認・編集'}
                        </button>

                        {expandedIssue === resolution.issueTitle && (
                          <div className="mt-3 space-y-2 bg-slate-50 p-3 rounded">
                            <div className="text-xs font-semibold text-slate-900">プロジェクトと強度を設定</div>
                            {(allProjectKeys ?? []).map((projectKey) => {
                              const link = (projectIssueLinks ?? []).find(
                                (l) => l.projectId === projectKey && l.issueId === resolution.issueTitle
                              );

                              const src = sourceLabel((link as any)?.source, (link as any)?.locked);
                              const st = strengthLabel(link?.strength);

                              return (
                                <div key={projectKey} className="flex items-center gap-3">
                                  <div className="w-56">
                                    <div className="text-xs text-slate-700">{projectKey}</div>
                                    {link?.notes && (
                                      <div className="mt-0.5 text-[11px] text-slate-500 line-clamp-1">{link.notes}</div>
                                    )}
                                  </div>
                                  <span className={`px-2 py-1 rounded text-[11px] font-medium ${src.className}`}>{src.label}</span>
                                  <span className={`px-2 py-1 rounded text-[11px] font-medium ${st.className}`}>{st.label}</span>
                                  <div className="flex gap-1">
                                    {[1, 2, 3].map((strength) => (
                                      <button
                                        key={strength}
                                        onClick={() => {
                                          onUpdateLink?.(
                                            projectKey,
                                            resolution.issueTitle,
                                            strength as 1 | 2 | 3
                                          );
                                        }}
                                        className={`px-2 py-1 text-xs border rounded transition-colors ${
                                          link?.strength === strength
                                            ? 'bg-blue-600 text-white border-blue-600'
                                            : 'bg-white text-slate-700 border-slate-300 hover:border-slate-400'
                                        }`}
                                      >
                                        {strength === 1 ? '弱' : strength === 2 ? '中' : '強'}
                                      </button>
                                    ))}
                                  </div>
                                  {link && (
                                    <button
                                      onClick={() => onRemoveLink?.(projectKey, resolution.issueTitle)}
                                      className="text-xs text-red-600 hover:underline"
                                    >
                                      削除
                                    </button>
                                  )}
                                </div>
                              );
                            })}
                          </div>
                        )}
                      </div>
                    </div>
                    <div className="min-w-fit text-right">
                      <div className="text-xs font-medium text-slate-600">解決度</div>
                      <div className={`mt-1 text-lg font-bold ${resolutionColor}`}>{resolutionLabel}</div>
                    </div>
                  </div>

                  {/* I-1: Top3 Contributors display (根拠の要約) */}
                  {(() => {
                    // breakdown から Top3 を生成（score 降順）
                    const top3Items = resolution.breakdown
                      ? [...resolution.breakdown]
                          .sort((a, b) => b.score - a.score)
                          .slice(0, 3)
                      : [];

                    // fallback: topProjects があれば使用
                    const displayItems = top3Items.length > 0 ? top3Items : (resolution.topProjects ?? []);

                    return displayItems.length > 0 ? (
                      <div className="mt-3 pt-3 border-t border-slate-200">
                        <div className="text-xs font-semibold text-slate-900 mb-2">
                          効いているプロジェクト（Top3）
                        </div>
                        <div className="space-y-1">
                          {displayItems.map((item: any, idx: number) => {
                            const pid = item.projectId ?? '';
                            const { dept: deptName, proj: projName } = pid
                              ? shortProjectName(pid)
                              : { dept: (item as any).dept ?? '', proj: (item as any).proj ?? '' };

                            const link = pid ? linkByProject.get(pid) : undefined;
                            const src = sourceLabel((link as any)?.source, (link as any)?.locked);
                            const st = strengthLabel(item.strength ?? link?.strength);
                            const score = item.score ?? 0;
                            const strengthCoef = item.strengthCoef ?? 1;
                            const weight = item.executionWeight ?? 1;

                            return (
                              <div key={idx} className="flex flex-wrap items-center gap-2 text-xs">
                                <span className="font-medium text-slate-900">{deptName}</span>
                                <span className="text-slate-500">：</span>
                                <span className="text-slate-700">{projName}</span>
                                <span className={`px-2 py-0.5 rounded font-medium ${src.className}`}>{src.label}</span>
                                <span className={`px-2 py-0.5 rounded font-medium ${st.className}`}>強度 {st.label}</span>
                                <span className="text-slate-500">
                                  実行度 {(weight * 100).toFixed(0)}%・影響スコア {score.toFixed(2)}
                                </span>
                                {link?.notes && <span className="text-slate-500">— {link.notes}</span>}
                              </div>
                            );
                          })}
                        </div>
                        <div className="mt-2 text-xs text-slate-500">
                          強度係数（内部計算）：弱=0.6 / 中=1.0 / 強=1.3（必要なら「根拠／紐付けを確認・編集」で調整）
                        </div>
                      </div>
                    ) : null;
                  })()}
                </div>
              );
            })}
          </div>
        )}
      </div>
      </section>
    </>
  );
}
