/**
 * /components/export/StrategyReportView.tsx
 *
 * 目的：
 * - レポートデータを表示する React コンポーネント
 * - 印刷(window.print())に対応した CSS
 * - Apple風ミニマルデザイン
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
          font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto,
            sans-serif;
          line-height: 1.6;
        }

        /* ===== 印刷設定 ===== */
        @media print {
          .report-container {
            max-width: 100%;
            margin: 0;
          }

          /* ナビゲーション・ボタンを非表示 */
          .no-print {
            display: none !important;
          }

          /* ページ区切り */
          .page-break {
            page-break-after: always;
          }

          .no-page-break {
            page-break-inside: avoid;
          }

          /* A4サイズ */
          @page {
            size: A4;
            margin: 1cm;
          }

          body {
            margin: 0;
            padding: 0;
          }
        }

        /* ===== セクション =====*/
        .report-section {
          margin-bottom: 3rem;
          padding: 2rem;
          border-radius: 8px;
          background: #fafafa;
          page-break-inside: avoid;
        }

        .report-section.cover {
          background: white;
          border-top: 4px solid #000;
          display: flex;
          flex-direction: column;
          justify-content: center;
          align-items: center;
          min-height: 100vh;
          text-align: center;
          page-break-inside: avoid;
        }

        .report-section.title-only {
          background: white;
          border: none;
          padding: 2rem;
          margin-bottom: 1.5rem;
        }

        /* ===== 見出し ===== */
        .report-h1 {
          font-size: 2.5rem;
          font-weight: 600;
          margin: 0 0 1rem 0;
          color: #000;
        }

        .report-h2 {
          font-size: 1.8rem;
          font-weight: 600;
          margin: 2rem 0 1rem 0;
          padding-bottom: 0.5rem;
          border-bottom: 2px solid #e0e0e0;
          color: #000;
        }

        .report-h3 {
          font-size: 1.2rem;
          font-weight: 600;
          margin: 1.5rem 0 0.5rem 0;
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

        .report-text.large {
          font-size: 1.1rem;
          color: #333;
        }

        .report-text.muted {
          color: #999;
          font-style: italic;
        }

        /* ===== グリッド ===== */
        .report-grid {
          display: grid;
          grid-template-columns: 1fr;
          gap: 1.5rem;
          margin: 1rem 0;
        }

        @media (min-width: 768px) {
          .report-grid {
            grid-template-columns: 1fr 1fr;
          }
        }

        .report-grid-item {
          padding: 1rem;
          border: 1px solid #e0e0e0;
          border-radius: 6px;
          background: white;
          page-break-inside: avoid;
        }

        .report-grid-item-label {
          font-size: 0.85rem;
          font-weight: 600;
          color: #999;
          text-transform: uppercase;
          margin-bottom: 0.5rem;
        }

        .report-grid-item-value {
          font-size: 1.1rem;
          font-weight: 500;
          color: #333;
          word-wrap: break-word;
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

        .report-list li::marker {
          color: #ccc;
        }

        /* ===== カード ===== */
        .report-card {
          padding: 1.5rem;
          border: 1px solid #e0e0e0;
          border-radius: 6px;
          background: white;
          margin: 1rem 0;
          page-break-inside: avoid;
        }

        .report-card-header {
          display: flex;
          justify-content: space-between;
          align-items: baseline;
          margin-bottom: 1rem;
          flex-wrap: wrap;
          gap: 1rem;
        }

        .report-card-title {
          font-size: 1.1rem;
          font-weight: 600;
          color: #333;
        }

        .report-card-badge {
          font-size: 0.75rem;
          padding: 0.3rem 0.6rem;
          background: #f0f0f0;
          border-radius: 4px;
          color: #666;
          font-weight: 500;
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

        .report-table tr:last-child td {
          border-bottom: none;
        }

        /* ===== 余白 ===== */
        .report-spacer {
          height: 2rem;
        }

        .report-divider {
          height: 1px;
          background: #e0e0e0;
          margin: 2rem 0;
        }

        /* ===== 印刷用制御 ===== */
        @media print {
          .report-section {
            padding: 0;
            margin-bottom: 2rem;
            background: none;
            border-radius: 0;
          }

          .report-card,
          .report-grid-item {
            page-break-inside: avoid;
            border: none;
            border-bottom: 1px solid #e0e0e0;
            padding-bottom: 1rem;
          }

          .report-section.cover {
            page-break-after: always;
          }
        }
      `}</style>

      {/* ===== 表紙 ===== */}
      <div className="report-section cover page-break">
        <div>
          <div
            style={{
              fontSize: '0.9rem',
              color: '#999',
              marginBottom: '2rem',
              textTransform: 'uppercase',
            }}
          >
            GROWTH Strategic Execution Report
          </div>

          <h1 className="report-h1">戦略実行レポート</h1>

          <div style={{ fontSize: '1.5rem', fontWeight: '500', margin: '2rem 0' }}>
            {data.companyName}
          </div>

          <div style={{ color: '#999', marginBottom: '1rem' }}>
            {formatReportDate(data.reportGeneratedAt)}
          </div>

          <div
            style={{
              fontSize: '0.85rem',
              color: '#ccc',
              marginTop: '4rem',
            }}
          >
            {data.reportType}
          </div>
        </div>
      </div>

      {/* ===== 経営戦略サマリー ===== */}
      <div className="report-section no-page-break">
        <h2 className="report-h2">経営戦略サマリー</h2>

        <div className="report-grid">
          <div className="report-grid-item">
            <div className="report-grid-item-label">ミッション</div>
            <div className="report-grid-item-value">
              {data.mvv.mission}
            </div>
          </div>
          <div className="report-grid-item">
            <div className="report-grid-item-label">ビジョン</div>
            <div className="report-grid-item-value">
              {data.mvv.vision}
            </div>
          </div>
        </div>

        <div className="report-grid-item">
          <div className="report-grid-item-label">バリュー（価値観）</div>
          <div className="report-grid-item-value">
            {data.mvv.value}
          </div>
        </div>

        {data.mainIssues.length > 0 && (
          <div style={{ marginTop: '1.5rem' }}>
            <h3 className="report-h3">主要課題</h3>
            <ul className="report-list">
              {data.mainIssues.map((issue, idx) => (
                <li key={idx}>{issue}</li>
              ))}
            </ul>
          </div>
        )}

        <div style={{ marginTop: '1.5rem' }}>
          <h3 className="report-h3">戦略方針</h3>
          <p className="report-text large">{data.strategyDirection}</p>
        </div>
      </div>

      {/* ===== 経営戦略ストーリー ===== */}
      {data.storyChapters.length > 0 && (
        <div className="report-section no-page-break page-break">
          <h2 className="report-h2">経営戦略ストーリー</h2>

          {data.storyChapters.map((chapter) => (
            <div key={chapter.index} className="report-card">
              <h3 className="report-h3">
                第{chapter.index}章 {chapter.title}
              </h3>
              <p className="report-text large">{chapter.content}</p>
            </div>
          ))}
        </div>
      )}

      {/* ===== 勝ち筋 ===== */}
      {(data.winPatterns.primary || data.winPatterns.secondary) && (
        <div className="report-section no-page-break">
          <h2 className="report-h2">勝ち筋</h2>

          {data.winPatterns.primary && (
            <div className="report-card">
              <div className="report-card-header">
                <span className="report-card-title">
                  プライマリ勝ち筋
                </span>
                <span className="report-card-badge">Primary</span>
              </div>
              <p className="report-text large">{data.winPatterns.primary}</p>
            </div>
          )}

          {data.winPatterns.secondary && (
            <div className="report-card">
              <div className="report-card-header">
                <span className="report-card-title">
                  セカンダリ勝ち筋
                </span>
                <span className="report-card-badge">Secondary</span>
              </div>
              <p className="report-text large">{data.winPatterns.secondary}</p>
            </div>
          )}
        </div>
      )}

      {/* ===== 部門別戦略 ===== */}
      {data.departments.length > 0 && (
        <div className="report-section no-page-break page-break">
          <h2 className="report-h2">部門別戦略</h2>

          {data.departments.map((dept, idx) => (
            <div key={idx} className="report-card">
              <h3 className="report-h3">{dept.name}</h3>

              <div style={{ marginTop: '1rem' }}>
                <h4 className="report-h4">ミッション</h4>
                <p className="report-text large">{dept.mission}</p>
              </div>

              {dept.missionDescription && (
                <div style={{ marginTop: '1rem' }}>
                  <h4 className="report-h4">説明・再考ポイント</h4>
                  <p className="report-text">{dept.missionDescription}</p>
                </div>
              )}

              {dept.projects.length > 0 && (
                <div style={{ marginTop: '1.5rem' }}>
                  <h4 className="report-h4">プロジェクト</h4>
                  {dept.projects.map((proj, pidx) => (
                    <div
                      key={pidx}
                      style={{
                        marginTop: '0.75rem',
                        paddingLeft: '1rem',
                        borderLeft: '2px solid #e0e0e0',
                      }}
                    >
                      <p
                        style={{
                          margin: '0 0 0.25rem 0',
                          fontWeight: '500',
                          color: '#333',
                        }}
                      >
                        {proj.title}
                      </p>
                      {proj.hypothesis && (
                        <p
                          className="report-text"
                          style={{ margin: '0.25rem 0' }}
                        >
                          <strong>仮説:</strong> {proj.hypothesis}
                        </p>
                      )}
                      {proj.kpiTargets.length > 0 && (
                        <p
                          className="report-text"
                          style={{ margin: '0.25rem 0' }}
                        >
                          <strong>KPI:</strong>{' '}
                          {proj.kpiTargets.join(', ')}
                        </p>
                      )}
                      {proj.expectedImpactYen && (
                        <p
                          className="report-text"
                          style={{ margin: '0.25rem 0', color: '#0066cc' }}
                        >
                          <strong>期待インパクト:</strong>{' '}
                          {(proj.expectedImpactYen / 1000000).toFixed(1)}M円
                        </p>
                      )}
                      {proj.probability && (
                        <p
                          className="report-text"
                          style={{ margin: '0.25rem 0' }}
                        >
                          <strong>成功確率:</strong>{' '}
                          {(proj.probability * 100).toFixed(0)}%
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

      {/* ===== OKR実行計画 ===== */}
      {data.okrs.length > 0 && (
        <div className="report-section no-page-break page-break">
          <h2 className="report-h2">OKR実行計画</h2>

          {data.okrs.map((okrGroup, idx) => (
            <div key={idx} className="report-card">
              <div className="report-card-header">
                <span className="report-card-title">
                  {okrGroup.departmentName}
                </span>
              </div>

              <div style={{ marginTop: '1rem' }}>
                <h4 className="report-h4">Objective（目標）</h4>
                <p className="report-text large">{okrGroup.objective}</p>
              </div>

              {okrGroup.keyResults.length > 0 && (
                <div style={{ marginTop: '1rem' }}>
                  <h4 className="report-h4">Key Results（成果指標）</h4>
                  <ul className="report-list">
                    {okrGroup.keyResults.map((kr, kidx) => (
                      <li key={kidx}>
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

      {/* ===== 実行上の論点 ===== */}
      {(data.executionNotes.crossDepartmentalIssues ||
        data.executionNotes.risks ||
        data.executionNotes.cooperationRequests) && (
        <div className="report-section no-page-break">
          <h2 className="report-h2">実行上の論点</h2>

          {data.executionNotes.crossDepartmentalIssues &&
            data.executionNotes.crossDepartmentalIssues.length > 0 && (
              <div style={{ marginBottom: '1.5rem' }}>
                <h3 className="report-h3">部門横断の確認事項</h3>
                <ul className="report-list">
                  {data.executionNotes.crossDepartmentalIssues.map(
                    (issue, idx) => (
                      <li key={idx}>{issue}</li>
                    ),
                  )}
                </ul>
              </div>
            )}

          {data.executionNotes.risks &&
            data.executionNotes.risks.length > 0 && (
              <div style={{ marginBottom: '1.5rem' }}>
                <h3 className="report-h3">リスク</h3>
                <ul className="report-list">
                  {data.executionNotes.risks.map((risk, idx) => (
                    <li key={idx}>{risk}</li>
                  ))}
                </ul>
              </div>
            )}

          {data.executionNotes.cooperationRequests &&
            data.executionNotes.cooperationRequests.length > 0 && (
              <div>
                <h3 className="report-h3">協力要請</h3>
                <ul className="report-list">
                  {data.executionNotes.cooperationRequests.map(
                    (req, idx) => (
                      <li key={idx}>{req}</li>
                    ),
                  )}
                </ul>
              </div>
            )}
        </div>
      )}

      {/* ===== フッター ===== */}
      <div
        style={{
          marginTop: '4rem',
          paddingTop: '2rem',
          borderTop: '1px solid #e0e0e0',
          textAlign: 'center',
          color: '#999',
          fontSize: '0.85rem',
        }}
      >
        <p>GROWTH by Anthropic</p>
        <p>{formatReportDate(data.reportGeneratedAt)}</p>
      </div>
    </div>
  );
}
