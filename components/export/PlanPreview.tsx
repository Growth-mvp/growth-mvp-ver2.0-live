'use client';

import React, { useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import type { PlanData, AudienceType } from '@/utils/export/buildPlanData';

/**
 * /components/export/PlanPreview.tsx
 *
 * ステークホルダー別計画書のプレビュー表示
 * - audience別に異なる章構成・スタイルで表示
 * - AI生成本文と既存データの統合表示
 * - 不足情報・検証警告の表示
 */

export interface PlanPreviewProps {
  data: PlanData;
  audience: AudienceType;
  generatedSections?: string[];
  generatedAt?: string | null;
  isGenerating?: boolean;
  onGenerate?: () => Promise<void>;
}

/**
 * AI生成のMarkdownを安全に文書表示する。
 * インラインHTMLは有効化しない。GFMにより表・取り消し線等にも対応。
 */
function PlanMarkdown({ content }: { content: string }) {
  return (
    <div className="min-w-0 break-words text-[15px] leading-[1.85] text-slate-800 sm:text-base print:text-[11pt] print:leading-relaxed">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          h1: ({ children }) => (
            <h1 className="mb-6 mt-2 border-b-2 border-slate-800 pb-4 text-2xl font-bold leading-snug text-slate-950 sm:text-3xl print:text-[19pt]">
              {children}
            </h1>
          ),
          h2: ({ children }) => (
            <h2 className="mb-4 mt-10 border-b border-slate-200 pb-2 text-xl font-bold leading-snug text-slate-950 first:mt-0 sm:text-2xl print:mt-7 print:text-[15pt]">
              {children}
            </h2>
          ),
          h3: ({ children }) => (
            <h3 className="mb-3 mt-7 text-lg font-bold leading-snug text-slate-900 print:mt-5 print:text-[13pt]">
              {children}
            </h3>
          ),
          h4: ({ children }) => (
            <h4 className="mb-2 mt-5 text-base font-semibold text-slate-900">{children}</h4>
          ),
          p: ({ children }) => <p className="mb-4 leading-[1.85]">{children}</p>,
          strong: ({ children }) => <strong className="font-bold text-slate-950">{children}</strong>,
          ul: ({ children }) => <ul className="mb-5 list-disc space-y-2 pl-7 marker:text-slate-500">{children}</ul>,
          ol: ({ children }) => <ol className="mb-5 list-decimal space-y-2 pl-7 marker:font-semibold">{children}</ol>,
          li: ({ children }) => <li className="pl-1 leading-[1.8]">{children}</li>,
          hr: () => <hr className="my-9 border-t border-slate-200" />,
          blockquote: ({ children }) => (
            <blockquote className="my-5 border-l-4 border-slate-300 bg-slate-50 px-5 py-3 text-slate-700">{children}</blockquote>
          ),
          table: ({ children }) => (
            <div className="my-6 w-full overflow-x-auto rounded-lg border border-slate-200 print:overflow-visible">
              <table className="w-full min-w-[520px] border-collapse text-left text-sm print:min-w-0 print:text-[9pt]">{children}</table>
            </div>
          ),
          thead: ({ children }) => <thead className="bg-slate-100 text-slate-900">{children}</thead>,
          th: ({ children }) => (
            <th className="border-b border-r border-slate-200 px-3 py-3 font-semibold last:border-r-0">{children}</th>
          ),
          td: ({ children }) => (
            <td className="border-b border-r border-slate-100 px-3 py-2.5 align-top last:border-r-0">{children}</td>
          ),
          tr: ({ children }) => <tr className="even:bg-slate-50">{children}</tr>,
          a: ({ children, href }) => (
            <a href={href} className="text-blue-700 underline underline-offset-2 hover:text-blue-900">{children}</a>
          ),
          code: ({ children }) => <code className="rounded bg-slate-100 px-1 py-0.5 text-[0.9em]">{children}</code>,
          pre: ({ children }) => <pre className="mb-5 overflow-x-auto rounded-lg bg-slate-100 p-4 text-sm">{children}</pre>,
        }}
      >
        {content}
      </ReactMarkdown>
    </div>
  );
}

export default function PlanPreview({
  data,
  audience,
  generatedSections,
  generatedAt,
  isGenerating = false,
  onGenerate,
}: PlanPreviewProps) {
  const [showFullReport, setShowFullReport] = useState(false);

  const audienceLabels = {
    bank: '経営改善・事業計画書',
    shareholder: '中期経営計画書',
    employee: '経営方針・実行計画書',
  };

  const audienceTitles = {
    bank: '銀行向け',
    shareholder: '株主向け',
    employee: '社員向け',
  };

  return (
    <div id="plan-print-area" className="min-w-0 rounded-xl bg-white shadow-sm print:rounded-none print:shadow-none">
      <div className="space-y-8 px-5 py-8 sm:px-8 lg:px-12 print:px-0 print:py-0">
        {/* ===== ヘッダー ===== */}
        <div className="border-b pb-9 pt-7 text-center sm:pt-10 print:pb-5 print:pt-2">
          <p className="text-sm text-gray-500 mb-2">{audienceTitles[audience]}</p>
          <h1 className="mb-3 text-2xl font-bold leading-tight text-gray-900 sm:text-3xl print:text-[18pt]">
            {data.companyName} {audienceLabels[audience]}
          </h1>
          <p className="text-gray-600">
            生成日時: {generatedAt ? new Date(generatedAt).toLocaleString('ja-JP') : '未生成'}
          </p>
        </div>

        {/* ===== 生成ボタン ===== */}
        {onGenerate && !generatedSections && (
          <div className="flex gap-4 justify-center py-6 print:hidden">
            <button
              onClick={onGenerate}
              disabled={isGenerating}
              className="bg-blue-600 hover:bg-blue-700 disabled:bg-gray-400 text-white px-6 py-3 rounded-lg font-semibold"
            >
              {isGenerating ? '生成中...' : 'AI本文を生成'}
            </button>
          </div>
        )}

        {/* ===== 検証パネル ===== */}
        {data.validation.messages.length > 0 && (
          <div
            className={`border-l-4 rounded p-4 print:break-inside-avoid ${
              data.validation.hasErrors
                ? 'border-red-500 bg-red-50'
                : 'border-yellow-500 bg-yellow-50'
            }`}
          >
            <h3 className="font-bold mb-3">
              {data.validation.hasErrors ? '⚠️ エラー' : 'ℹ️ 注意'}
            </h3>
            <ul className="space-y-2 text-sm">
              {data.validation.messages.map((msg, idx) => (
                <li key={idx} className="text-gray-700">
                  <span className="font-semibold">{msg.section}:</span>{' '}
                  {msg.message}
                  {msg.recommendation && (
                    <p className="text-xs text-gray-600 mt-1">
                      💡 {msg.recommendation}
                    </p>
                  )}
                </li>
              ))}
            </ul>
          </div>
        )}

        {/* ===== AI 生成本文（存在する場合）===== */}
        {generatedSections && generatedSections.length > 0 && (
          <article className="min-w-0">
            <h2 className="mb-7 text-lg font-semibold text-slate-500 print:hidden">計画書本体</h2>
            <div className="space-y-9">
              {generatedSections.map((section, idx) => (
                <section key={idx} className="min-w-0 print:break-inside-auto">
                  <PlanMarkdown content={section} />
                </section>
              ))}
            </div>
          </article>
        )}

        {/* ===== データサマリー（生成本文がない場合の代替） ===== */}
        {!generatedSections && (
          <div className="space-y-6">
            {/* 企業情報 */}
            <section className="pb-6 border-b">
              <h2 className="text-2xl font-bold text-gray-900 mb-4">企業情報</h2>
              <dl className="grid grid-cols-2 gap-4 text-sm">
                <div>
                  <dt className="font-semibold text-gray-600">会社名</dt>
                  <dd className="text-gray-900">{data.companyName}</dd>
                </div>
                <div>
                  <dt className="font-semibold text-gray-600">業種</dt>
                  <dd className="text-gray-900">{data.stage1.industry}</dd>
                </div>
                {data.companyMission && (
                  <div className="col-span-2">
                    <dt className="font-semibold text-gray-600">Mission</dt>
                    <dd className="text-gray-900">{data.companyMission}</dd>
                  </div>
                )}
              </dl>
            </section>

            {/* STAGE1: 現状分析 */}
            {(data.stage1.keyIssues?.length ?? 0) > 0 && (
              <section className="pb-6 border-b">
                <h2 className="text-2xl font-bold text-gray-900 mb-4">
                  現状分析
                </h2>
                <div>
                  <h3 className="font-semibold text-gray-700 mb-2">経営課題</h3>
                  <ul className="space-y-1 text-sm text-gray-700">
                    {(data.stage1.keyIssues ?? []).map((issue, idx) => (
                      <li key={idx}>• {issue}</li>
                    ))}
                  </ul>
                </div>
              </section>
            )}

            {/* STAGE2: 全社戦略 */}
            {data.stage2.midtermConcept && (
              <section className="pb-6 border-b">
                <h2 className="text-2xl font-bold text-gray-900 mb-4">
                  全社戦略
                </h2>
                <div className="space-y-4 text-sm text-gray-700">
                  <div>
                    <h3 className="font-semibold mb-1">中計コンセプト</h3>
                    <p>{data.stage2.midtermConcept}</p>
                  </div>
                  {(data.stage2.priorityThemes?.length ?? 0) > 0 && (
                    <div>
                      <h3 className="font-semibold mb-2">重点戦略テーマ</h3>
                      <ul className="space-y-1">
                        {(data.stage2.priorityThemes ?? []).map((theme, idx) => (
                          <li key={idx}>• {theme}</li>
                        ))}
                      </ul>
                    </div>
                  )}
                </div>
              </section>
            )}

            {/* STAGE3: 部門別戦略 */}
            {data.stage3.departments.length > 0 && (
              <section className="pb-6 border-b">
                <h2 className="text-2xl font-bold text-gray-900 mb-4">
                  部門別戦略
                </h2>
                <div className="space-y-4">
                  {data.stage3.departments.slice(0, 5).map((dept, idx) => (
                    <div
                      key={idx}
                      className="border-l-4 border-gray-300 pl-4"
                    >
                      <h3 className="font-semibold text-gray-800 mb-2">
                        {dept.name}
                      </h3>
                      {dept.strategicRole && (
                        <p className="text-sm text-gray-700 mb-1">
                          <span className="font-semibold">役割:</span>{' '}
                          {dept.strategicRole}
                        </p>
                      )}
                      {(dept.keyIssues?.length ?? 0) > 0 && (
                        <div className="text-sm">
                          <span className="font-semibold">課題:</span>
                          <ul className="space-y-1 mt-1">
                            {(dept.keyIssues ?? []).map((issue, i) => (
                              <li key={i}>• {issue}</li>
                            ))}
                          </ul>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </section>
            )}

            {/* STAGE4: 実行計画 */}
            {(data.stage4.projectImpacts?.length ?? 0) > 0 && (
              <section>
                <h2 className="text-2xl font-bold text-gray-900 mb-4">
                  実行計画・期待インパクト
                </h2>
                <div className="space-y-4">
                  {(data.stage4.projectImpacts ?? [])
                    .slice(0, 5)
                    .map((project, idx) => (
                      <div key={idx} className="border rounded p-3 bg-gray-50">
                        <h4 className="font-semibold text-gray-900">
                          {project.title}
                        </h4>
                        <div className="text-sm text-gray-700 mt-2 space-y-1">
                          {project.impactRevenue && (
                            <div>📈 売上寄与: {project.impactRevenue}</div>
                          )}
                          {project.impactOpIncome && (
                            <div>💰 営業利益寄与: {project.impactOpIncome}</div>
                          )}
                          {project.impactInvestment && (
                            <div>💵 投資額: {project.impactInvestment}</div>
                          )}
                        </div>
                      </div>
                    ))}
                </div>
              </section>
            )}
          </div>
        )}

        {/* ===== データ追跡 ===== */}
        {!showFullReport && (
          <div className="text-center pt-6">
            <button
              onClick={() => setShowFullReport(!showFullReport)}
              className="text-sm text-blue-600 hover:text-blue-700 underline"
            >
              {showFullReport ? 'サマリーに戻す' : 'データ詳細を表示'}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
