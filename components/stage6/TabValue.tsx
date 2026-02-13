'use client';

import type { IssueResolution } from '@/utils/stage6';

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
}

export function TabValue({ vaCards, issueResolutions, companyTargets }: TabValueProps) {
  return (
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
                    </div>
                    <div className="min-w-fit text-right">
                      <div className="text-xs font-medium text-slate-600">解決度</div>
                      <div className={`mt-1 text-lg font-bold ${resolutionColor}`}>{resolutionLabel}</div>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </section>
  );
}
