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
                      {resolution.linkedTargets.length > 0 ? (
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
                      ) : (projectIssueLinks && projectIssueLinks.length > 0) ? (
                        <div className="mt-3 border-t border-slate-200 pt-2">
                          <div className="text-xs text-slate-500">
                            注：北星メトリクスの紐付けはSTAGE2で定義。解決度はプロジェクト強度から計算しています。
                          </div>
                        </div>
                      ) : (
                        <div className="mt-3 border-t border-slate-200 pt-2">
                          <div className="text-xs font-medium text-amber-700">
                            ⚠ 未接続：North Starと紐づけが無いため、解決度が計算できません
                          </div>
                          <div className="mt-2">
                            <div className="text-xs text-slate-600 mb-2">
                              このIssueを解決するために寄与するNorth Starメトリクスを STAGE2 で定義してください。
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
                          {expandedIssue === resolution.issueTitle ? '閉じる' : 'プロジェクト紐付け編集'}
                        </button>

                        {expandedIssue === resolution.issueTitle && (
                          <div className="mt-3 space-y-2 bg-slate-50 p-3 rounded">
                            <div className="text-xs font-semibold text-slate-900">プロジェクトと強度を設定</div>
                            {(allProjectKeys ?? []).map((projectKey) => {
                              const link = (projectIssueLinks ?? []).find(
                                (l) => l.projectId === projectKey && l.issueId === resolution.issueTitle
                              );

                              return (
                                <div key={projectKey} className="flex items-center gap-3">
                                  <div className="w-48 text-xs text-slate-700">{projectKey}</div>
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

                  {/* I-1: Top3 Contributors display */}
                  {resolution.breakdown && resolution.breakdown.length > 0 && (
                    <div className="mt-3 pt-3 border-t border-slate-200">
                      <div className="text-xs font-semibold text-slate-900 mb-2">
                        効いているプロジェクト（Top3）
                      </div>
                      <div className="space-y-1">
                        {resolution.breakdown.slice(0, 3).map((item, idx) => {
                          const parts = item.projectId.split('::');
                          const deptName = parts[0] ?? '';
                          const projName = parts[1] ?? item.projectId;
                          const strengthLabel = item.strength === 1 ? '弱' : item.strength === 2 ? '中' : '強';

                          return (
                            <div key={idx} className="text-xs text-slate-600">
                              <span className="font-medium">{deptName}</span>
                              <span>：</span>
                              <span>{projName}</span>
                              {/* I-2: Show strength coefficient */}
                              <span className="text-slate-500 ml-1">
                                strength {strengthLabel}({item.strengthCoef}) × weight {(item.executionWeight * 100).toFixed(0)}% = {item.score.toFixed(1)}
                              </span>
                            </div>
                          );
                        })}
                      </div>
                      <div className="mt-2 text-xs text-slate-500">
                        弱=0.6 / 中=1.0 / 強=1.3 の係数で計算
                      </div>
                    </div>
                  )}
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
