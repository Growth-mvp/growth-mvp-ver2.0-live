/**
 * /components/export/ReportLayout.tsx
 *
 * 目的：
 * - STAGE別レポート共通のレイアウト・スタイル
 * - 印刷用CSS統一
 */

import React, { ReactNode } from 'react';

/**
 * PDF用ラッパー（共通CSS含む）
 */
export function PdfReportWrapper({
  children,
  stageNumber,
}: {
  children: ReactNode;
  stageNumber: number;
}) {
  return (
    <div id={`pdf-stage${stageNumber}`} className="pdf-report-wrapper">
      <style jsx>{`
        .pdf-report-wrapper {
          max-width: 800px;
          margin: 0 auto;
          background: white;
          color: #333;
          font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto,
            sans-serif;
          line-height: 1.6;
          padding: 0;
        }

        /* ===== 印刷設定 ===== */
        @media print {
          .pdf-report-wrapper {
            max-width: 100%;
            margin: 0;
          }

          /* ナビゲーション・ボタンを非表示 */
          .no-print {
            display: none !important;
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

        /* ===== セクション ===== */
        .report-section {
          margin-bottom: 2rem;
          padding: 1.5rem;
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
          padding: 2rem;
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
          margin: 1.5rem 0 1rem 0;
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
          word-wrap: break-word;
        }

        .report-text.large {
          font-size: 1.1rem;
          color: #333;
        }

        .report-text.muted {
          color: #999;
          font-style: italic;
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

        /* ===== グリッド ===== */
        .report-grid {
          display: grid;
          grid-template-columns: 1fr;
          gap: 1rem;
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
          margin-top: 2rem;
          padding-top: 1rem;
          border-top: 1px solid #e0e0e0;
          font-size: 0.75rem;
          color: #999;
          text-align: right;
        }

        /* ===== 印刷用制御 ===== */
        @media print {
          .report-section {
            padding: 1rem;
            margin-bottom: 1.5rem;
            background: none;
            border-radius: 0;
          }

          .report-card,
          .report-grid-item {
            page-break-inside: avoid;
            border-bottom: 1px solid #e0e0e0;
            padding-bottom: 1rem;
          }

          .report-section.cover {
            page-break-after: always;
          }

          .report-divider {
            page-break-after: always;
          }
        }
      `}</style>

      {children}
    </div>
  );
}

/**
 * 表紙
 */
export function ReportCover({
  companyName,
  stageName,
  stageNumber,
  generatedDate,
}: {
  companyName: string;
  stageName: string;
  stageNumber: number;
  generatedDate: string;
}) {
  return (
    <div className="report-section cover">
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

        <h1 className="report-h1">{stageName}</h1>

        <div style={{ fontSize: '1.5rem', fontWeight: '500', margin: '2rem 0' }}>
          {companyName}
        </div>

        <div style={{ color: '#999', marginBottom: '1rem' }}>
          {generatedDate}
        </div>

        <div
          style={{
            fontSize: '0.85rem',
            color: '#ccc',
            marginTop: '4rem',
          }}
        >
          STAGE {stageNumber}
        </div>
      </div>
    </div>
  );
}

/**
 * ページ区切り
 */
export function PageBreak() {
  return <div className="report-divider" style={{ pageBreakAfter: 'always' }} />;
}

/**
 * Confidential フッター
 */
export function ConfidentialFooter() {
  return (
    <div className="report-footer">
      <p>© GROWTH | Confidential - Generated by GROWTH Strategic Platform</p>
    </div>
  );
}
