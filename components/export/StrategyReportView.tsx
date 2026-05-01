/**
 * /components/export/StrategyReportView.tsx
 *
 * 目的：
 * - GROWTH統合レポートのプレビュー表示
 * - STAGE1〜4の要約を統合表示
 * - 白紙ページなし、章立て明確化
 */

'use client';

import React from 'react';
import type { ReportData } from '@/utils/export/buildStrategyReportData';
import { formatReportDate } from '@/utils/export/buildStrategyReportData';

interface StrategyReportViewProps {
  data: ReportData;
}

export function StrategyReportView({ data }: StrategyReportViewProps) {
  return (
    <div className="report-container">
      <style jsx>{`
        .report-container {
          max-width: 800px;
          margin: 0 auto;
          background: white;
          color: #333;
          font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
          line-height: 1.6;
          font-size: 14px;
        }

        /* ===== 印刷設定 ===== */
        @media print {
          .report-container {
            max-width: 100%;
            margin: 0;
          }

          .no-print {
            display: none !important;
          }

          .page-break {
            page-break-after: always;
          }

          @page {
            size: A4;
            margin: 0;
          }

          body {
            margin: 0;
            padding: 0;
          }
        }

        /* ===== 表紙 ===== */
        .report-cover {
          background: white;
          border-top: 4px solid #000;
          display: flex;
          flex-direction: column;
          justify-content: center;
          align-items: center;
          min-height: auto;
          height: 100vh;
          text-align: center;
          page-break-inside: avoid;
          page-break-after: always;
          padding: 2rem;
          box-sizing: border-box;
        }

        @media print {
          .report-cover {
            height: auto;
            min-height: auto;
            page-break-after: always;
          }
        }

        /* ===== セクション ===== */
        .report-section {
          padding: 2rem;
          margin-bottom: 2rem;
          page-break-inside: avoid;
        }

        @media print {
          .report-section {
            padding: 1.5rem;
            margin-bottom: 1.5rem;
          }
        }

        /* ===== 見出し ===== */
        .report-h1 {
          font-size: 2.5rem;
          font-weight: 600;
          margin: 0 0 1rem 0;
          color: #000;
        }

        .report-h2 {
          font-size: 1.6rem;
          font-weight: 600;
          margin: 2rem 0 1rem 0;
          padding-bottom: 0.5rem;
          border-bottom: 2px solid #e0e0e0;
          color: #000;
        }

        .report-h3 {
          font-size: 1.2rem;
          font-weight: 600;
          margin: 1.5rem 0 0.75rem 0;
          color: #333;
        }

        .report-h4 {
          font-size: 1rem;
          font-weight: 600;
          margin: 1rem 0 0.5rem 0;
          color: #555;
        }

        /* ===== テキスト ===== */
        .report-text {
          margin: 0.5rem 0;
          font-size: 1rem;
          color: #555;
        }

        .report-text-large {
          font-size: 1.1rem;
          color: #333;
        }

        .report-muted {
          color: #999;
          font-style: italic;
        }

        /* ===== リスト ===== */
        .report-list {
          margin: 1rem 0;
          padding-left: 1.5rem;
        }

        .report-list li {
          margin: 0.5rem 0;
          color: #555;
        }

        /* ===== グリッド ===== */
        .report-grid {
          display: grid;
          grid-template-columns: 1fr 1fr;
          gap: 1.5rem;
          margin: 1rem 0;
        }

        @media (max-width: 768px) {
          .report-grid {
            grid-template-columns: 1fr;
          }
        }

        .report-grid-item {
          padding: 1rem;
          border: 1px solid #e0e0e0;
          border-radius: 6px;
          background: white;
        }

        .report-grid-label {
          font-size: 0.85rem;
          font-weight: 600;
          color: #999;
          text-transform: uppercase;
          margin-bottom: 0.5rem;
        }

        .report-grid-value {
          font-size: 1.1rem;
          font-weight: 500;
          color: #333;
        }

        /* ===== カード ===== */
        .report-card {
          padding: 1.5rem;
          margin: 1rem 0;
          border: 1px solid #e0e0e0;
          border-radius: 6px;
          background: #f9f9f9;
          page-break-inside: avoid;
        }

        .report-card-title {
          font-size: 1.1rem;
          font-weight: 600;
          color: #333;
          margin-bottom: 0.5rem;
        }

        /* ===== テーブル ===== */
        .report-table {
          width: 100%;
          border-collapse: collapse;
          margin: 1rem 0;
          font-size: 0.95rem;
        }

        .report-table th,
        .report-table td {
          padding: 0.75rem;
          text-align: left;
          border-bottom: 1px solid #e0e0e0;
        }

        .report-table th {
          background: #f5f5f5;
          font-weight: 600;
          color: #333;
        }

        /* ===== Confidential フッター ===== */
        .report-footer {
          margin-top: 4rem;
          padding-top: 2rem;
          border-top: 1px solid #e0e0e0;
          text-align: center;
          color: #999;
          font-size: 0.85rem;
        }
      `}</style>

      {/* ===== 表紙 ===== */}
      <div className="report-cover page-break">
        <div>
          <div style={{ fontSize: '0.9rem', color: '#999', marginBottom: '2rem', textTransform: 'uppercase' }}>
            GROWTH Strategic Execution Report
          </div>

          <h1 className="report-h1">GROWTH 戦略実行レポート</h1>

          <div style={{ fontSize: '1.8rem', fontWeight: '500', margin: '3rem 0' }}>{data.companyName}</div>

          <div style={{ color: '#999', marginBottom: '2rem' }}>{formatReportDate(data.reportGeneratedAt)}</div>

          <div style={{ fontSize: '0.85rem', color: '#ccc', marginTop: '4rem' }}>
            Confidential - Generated by GROWTH
          </div>
        </div>
      </div>

      {/* ===== 1. エグゼクティブサマリー ===== */}
      <div className="report-section page-break">
        <h2 className="report-h2">1. エグゼクティブサマリー</h2>

        <div className="report-grid">
          <div className="report-grid-item">
            <div className="report-grid-label">ミッション</div>
            <div className="report-grid-value">{data.stage2.mvv.mission}</div>
          </div>
          <div className="report-grid-item">
            <div className="report-grid-label">ビジョン</div>
            <div className="report-grid-value">{data.stage2.mvv.vision}</div>
          </div>
        </div>

        {data.stage2.ceoThought && (
          <div style={{ marginTop: '1.5rem' }}>
            <h3 className="report-h3">経営者の思い</h3>
            <p className="report-text-large">{data.stage2.ceoThought}</p>
          </div>
        )}

        {data.stage2.winPatterns.primary && (
          <div style={{ marginTop: '1.5rem' }}>
            <h3 className="report-h3">勝ち筋（プライマリ）</h3>
            <p className="report-text-large">{data.stage2.winPatterns.primary}</p>
          </div>
        )}

        {data.stage2.winPatterns.secondary && (
          <div style={{ marginTop: '1rem' }}>
            <h3 className="report-h3">勝ち筋（セカンダリ）</h3>
            <p className="report-text-large">{data.stage2.winPatterns.secondary}</p>
          </div>
        )}
      </div>

      {/* ===== 2. STAGE1 企業価値分析 ===== */}
      <div className="report-section page-break">
        <h2 className="report-h2">2. STAGE1：企業価値分析</h2>

        <h3 className="report-h3">企業概要</h3>
        <div className="report-grid">
          <div className="report-grid-item">
            <div className="report-grid-label">業界</div>
            <div className="report-grid-value">{data.stage1.industry}</div>
          </div>
          <div className="report-grid-item">
            <div className="report-grid-label">売上</div>
            <div className="report-grid-value">{data.stage1.revenue}</div>
          </div>
          <div className="report-grid-item">
            <div className="report-grid-label">従業員数</div>
            <div className="report-grid-value">{data.stage1.employees}</div>
          </div>
          <div className="report-grid-item">
            <div className="report-grid-label">事業内容</div>
            <div className="report-grid-value">{data.stage1.businessContent}</div>
          </div>
        </div>

        {data.stage1.businessSegments.length > 0 && (
          <div style={{ marginTop: '1.5rem' }}>
            <h3 className="report-h3">事業セグメント</h3>
            <ul className="report-list">
              {data.stage1.businessSegments.map((seg, idx) => (
                <li key={idx}>{seg.name}</li>
              ))}
            </ul>
          </div>
        )}

        {(data.stage1.swot.strength.length > 0 ||
          data.stage1.swot.weakness.length > 0 ||
          data.stage1.swot.opportunity.length > 0 ||
          data.stage1.swot.threat.length > 0) && (
          <div style={{ marginTop: '1.5rem' }}>
            <h3 className="report-h3">SWOT分析</h3>

            {data.stage1.swot.strength.length > 0 && (
              <div style={{ marginTop: '1rem' }}>
                <h4 className="report-h4">強み（Strength）</h4>
                <ul className="report-list">
                  {data.stage1.swot.strength.map((item, idx) => (
                    <li key={idx}>{item}</li>
                  ))}
                </ul>
              </div>
            )}

            {data.stage1.swot.weakness.length > 0 && (
              <div style={{ marginTop: '1rem' }}>
                <h4 className="report-h4">弱み（Weakness）</h4>
                <ul className="report-list">
                  {data.stage1.swot.weakness.map((item, idx) => (
                    <li key={idx}>{item}</li>
                  ))}
                </ul>
              </div>
            )}

            {data.stage1.swot.opportunity.length > 0 && (
              <div style={{ marginTop: '1rem' }}>
                <h4 className="report-h4">機会（Opportunity）</h4>
                <ul className="report-list">
                  {data.stage1.swot.opportunity.map((item, idx) => (
                    <li key={idx}>{item}</li>
                  ))}
                </ul>
              </div>
            )}

            {data.stage1.swot.threat.length > 0 && (
              <div style={{ marginTop: '1rem' }}>
                <h4 className="report-h4">脅威（Threat）</h4>
                <ul className="report-list">
                  {data.stage1.swot.threat.map((item, idx) => (
                    <li key={idx}>{item}</li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        )}
      </div>

      {/* ===== 3. STAGE2 経営戦略ストーリー ===== */}
      {data.stage2.storyChapters.length > 0 && (
        <div className="report-section page-break">
          <h2 className="report-h2">3. STAGE2：経営戦略ストーリー</h2>

          <h3 className="report-h3">バリュー（価値観）</h3>
          <p className="report-text-large">{data.stage2.mvv.value}</p>

          <div style={{ marginTop: '2rem' }}>
            <h3 className="report-h3">戦略ストーリー</h3>
            {data.stage2.storyChapters.map((chapter) => (
              <div key={chapter.index} className="report-card">
                <div className="report-card-title">
                  第{chapter.index}章 {chapter.title}
                </div>
                <p className="report-text">{chapter.content}</p>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ===== 4. STAGE3 部門戦略 ===== */}
      {data.stage3.departments.length > 0 && (
        <div className="report-section page-break">
          <h2 className="report-h2">4. STAGE3：部門戦略</h2>

          {data.stage3.departments.map((dept, deptIdx) => (
            <div key={deptIdx} className="report-card" style={{ marginBottom: '2rem' }}>
              <h3 className="report-h3">{dept.name}</h3>

              <div style={{ marginTop: '1rem' }}>
                <h4 className="report-h4">ミッション</h4>
                <p className="report-text">{dept.mission}</p>
              </div>

              {dept.missionDescription && (
                <div style={{ marginTop: '1rem' }}>
                  <h4 className="report-h4">説明・再考ポイント</h4>
                  <p className="report-text">{dept.missionDescription}</p>
                </div>
              )}

              {dept.projects.length > 0 && (
                <div style={{ marginTop: '1rem' }}>
                  <h4 className="report-h4">プロジェクト</h4>
                  {dept.projects.map((proj, projIdx) => (
                    <div
                      key={projIdx}
                      style={{
                        marginTop: '0.75rem',
                        paddingLeft: '1rem',
                        borderLeft: '2px solid #e0e0e0',
                      }}
                    >
                      <p style={{ margin: '0 0 0.25rem 0', fontWeight: '500', color: '#333' }}>
                        {proj.title}
                      </p>
                      {proj.hypothesis && (
                        <p className="report-text" style={{ margin: '0.25rem 0' }}>
                          <strong>仮説:</strong> {proj.hypothesis}
                        </p>
                      )}
                      {proj.kpiTargets.length > 0 && (
                        <p className="report-text" style={{ margin: '0.25rem 0' }}>
                          <strong>KPI:</strong> {proj.kpiTargets.join(', ')}
                        </p>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {/* ===== 5. STAGE4 OKR実行計画 ===== */}
      {data.stage4.okrs.length > 0 && (
        <div className="report-section page-break">
          <h2 className="report-h2">5. STAGE4：OKR実行計画</h2>

          {data.stage4.okrs.map((okrItem, idx) => (
            <div key={idx} className="report-card">
              <h3 className="report-h3">{okrItem.departmentName}</h3>
              <p style={{ color: '#999', fontSize: '0.9rem', margin: '0 0 0.75rem 0' }}>
                プロジェクト: {okrItem.projectName}
              </p>

              <div style={{ marginTop: '1rem' }}>
                <h4 className="report-h4">Objective（目標）</h4>
                <p className="report-text-large">{okrItem.objective}</p>
              </div>

              {okrItem.keyResults.length > 0 && (
                <div style={{ marginTop: '1rem' }}>
                  <h4 className="report-h4">Key Results（成果指標）</h4>
                  <ul className="report-list">
                    {okrItem.keyResults.map((kr, krIdx) => (
                      <li key={krIdx}>
                        {kr.statement}
                        {kr.owner && (
                          <span style={{ color: '#999', fontSize: '0.9rem' }}>
                            {' '}
                            (Owner: {kr.owner})
                          </span>
                        )}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {/* ===== 6. 実行に向けた確認事項 ===== */}
      {(data.executionNotes.crossDepartmentalIssues?.length ||
        data.executionNotes.risks?.length) && (
        <div className="report-section">
          <h2 className="report-h2">6. 実行に向けた確認事項</h2>

          {data.executionNotes.crossDepartmentalIssues &&
            data.executionNotes.crossDepartmentalIssues.length > 0 && (
              <div style={{ marginBottom: '1.5rem' }}>
                <h3 className="report-h3">部門横断の確認事項</h3>
                <ul className="report-list">
                  {data.executionNotes.crossDepartmentalIssues.map((issue, idx) => (
                    <li key={idx}>{issue}</li>
                  ))}
                </ul>
              </div>
            )}

          {data.executionNotes.risks && data.executionNotes.risks.length > 0 && (
            <div>
              <h3 className="report-h3">リスク</h3>
              <ul className="report-list">
                {data.executionNotes.risks.map((risk, idx) => (
                  <li key={idx}>{risk}</li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}

      {/* ===== フッター ===== */}
      <div className="report-footer">
        <p>© GROWTH Strategic Execution Platform</p>
        <p>生成日: {formatReportDate(data.reportGeneratedAt)}</p>
      </div>
    </div>
  );
}
