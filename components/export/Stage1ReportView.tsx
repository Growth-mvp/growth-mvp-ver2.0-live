/**
 * /components/export/Stage1ReportView.tsx
 *
 * 目的：
 * - STAGE1 現状分析レポートの表示
 * - A4印刷対応
 */

'use client';

import React from 'react';
import type { Stage1ReportData } from '@/utils/export/buildStage1ReportData';
import {
  PdfReportWrapper,
  ReportCover,
  PageBreak,
  ConfidentialFooter,
} from './ReportLayout';

interface Stage1ReportViewProps {
  data: Stage1ReportData;
}

export function Stage1ReportView({ data }: Stage1ReportViewProps) {
  return (
    <PdfReportWrapper stageNumber={1}>
      {/* ===== 表紙 ===== */}
      <ReportCover
        companyName={data.companyName}
        stageName="現状分析レポート"
        stageNumber={1}
        generatedDate={data.generatedDate}
      />

      {/* ===== 企業情報 ===== */}
      <PageBreak />
      <div className="report-section">
        <h2 className="report-h2">企業情報</h2>

        <div className="report-card">
          <div style={{ marginBottom: '1rem' }}>
            <h3 className="report-h3">{data.companyName}</h3>
          </div>

          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <tbody>
              <tr style={{ borderBottom: '1px solid #e0e0e0' }}>
                <td style={{ padding: '0.5rem 0.75rem', fontWeight: '600', width: '30%' }}>
                  業界
                </td>
                <td style={{ padding: '0.5rem 0.75rem' }}>{data.companyInfo.industry}</td>
              </tr>
              <tr style={{ borderBottom: '1px solid #e0e0e0' }}>
                <td style={{ padding: '0.5rem 0.75rem', fontWeight: '600' }}>売上高</td>
                <td style={{ padding: '0.5rem 0.75rem' }}>{data.companyInfo.revenue}</td>
              </tr>
              <tr style={{ borderBottom: '1px solid #e0e0e0' }}>
                <td style={{ padding: '0.5rem 0.75rem', fontWeight: '600' }}>従業員数</td>
                <td style={{ padding: '0.5rem 0.75rem' }}>{data.companyInfo.employees}</td>
              </tr>
              <tr>
                <td style={{ padding: '0.5rem 0.75rem', fontWeight: '600' }}>事業内容</td>
                <td style={{ padding: '0.5rem 0.75rem' }}>{data.companyInfo.businessContent}</td>
              </tr>
            </tbody>
          </table>
        </div>

        {/* 事業セグメント */}
        {data.businessSegments.length > 0 && (
          <div className="report-card" style={{ marginTop: '1rem' }}>
            <h3 className="report-h3">事業セグメント</h3>
            <ul className="report-list">
              {data.businessSegments.map((seg, idx) => (
                <li key={idx}>{seg.name}</li>
              ))}
            </ul>
          </div>
        )}

        {/* 上場情報 */}
        {data.isListed && (
          <div className="report-card" style={{ marginTop: '1rem' }}>
            <h3 className="report-h3">上場情報</h3>
            <p className="report-text">
              <strong>上場企業</strong>
            </p>
            {data.ticker && (
              <p className="report-text">
                <strong>証券コード:</strong> {data.ticker}
              </p>
            )}
            {data.pbrManual && (
              <p className="report-text">
                <strong>PBR:</strong> {data.pbrManual}
              </p>
            )}
          </div>
        )}
      </div>

      {/* ===== 財務指標 ===== */}
      {Object.keys(data.metrics).length > 0 && (
        <>
          <PageBreak />
          <div className="report-section">
            <h2 className="report-h2">財務指標</h2>

            <div className="report-card">
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <tbody>
                  {data.metrics.revenueGrowth && (
                    <tr style={{ borderBottom: '1px solid #e0e0e0' }}>
                      <td style={{ padding: '0.5rem 0.75rem', fontWeight: '600', width: '40%' }}>
                        売上高成長率（CAGR）
                      </td>
                      <td style={{ padding: '0.5rem 0.75rem' }}>{data.metrics.revenueGrowth}</td>
                    </tr>
                  )}
                  {data.metrics.operatingMargin && (
                    <tr style={{ borderBottom: '1px solid #e0e0e0' }}>
                      <td style={{ padding: '0.5rem 0.75rem', fontWeight: '600' }}>営業利益率</td>
                      <td style={{ padding: '0.5rem 0.75rem' }}>{data.metrics.operatingMargin}</td>
                    </tr>
                  )}
                  {data.metrics.roic && (
                    <tr style={{ borderBottom: '1px solid #e0e0e0' }}>
                      <td style={{ padding: '0.5rem 0.75rem', fontWeight: '600' }}>ROIC</td>
                      <td style={{ padding: '0.5rem 0.75rem' }}>{data.metrics.roic}</td>
                    </tr>
                  )}
                  {data.metrics.wacc && (
                    <tr style={{ borderBottom: '1px solid #e0e0e0' }}>
                      <td style={{ padding: '0.5rem 0.75rem', fontWeight: '600' }}>WACC</td>
                      <td style={{ padding: '0.5rem 0.75rem' }}>{data.metrics.wacc}</td>
                    </tr>
                  )}
                  {data.metrics.pbr && (
                    <tr>
                      <td style={{ padding: '0.5rem 0.75rem', fontWeight: '600' }}>PBR</td>
                      <td style={{ padding: '0.5rem 0.75rem' }}>{data.metrics.pbr}</td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>

            {/* ベンチマーク */}
            {data.benchmarks && (
              <div className="report-card" style={{ marginTop: '1rem' }}>
                <h3 className="report-h3">外部ベンチマーク</h3>
                {data.benchmarks.waccManual && (
                  <p className="report-text">
                    <strong>WACC:</strong> {data.benchmarks.waccManual}%
                  </p>
                )}
                {data.benchmarks.waccRationale && (
                  <p className="report-text">
                    <strong>根拠:</strong> {data.benchmarks.waccRationale}
                  </p>
                )}
              </div>
            )}
          </div>
        </>
      )}

      {/* ===== 論点 ===== */}
      {data.issueBlocks.length > 0 && (
        <>
          <PageBreak />
          <div className="report-section">
            <h2 className="report-h2">経営課題と機会</h2>

            {data.issueBlocks.map((issue, idx) => (
              <div key={idx} className="report-card">
                <h3 className="report-h3">{issue.title}</h3>
                <p className="report-text">{issue.description || '（説明未入力）'}</p>
              </div>
            ))}
          </div>
        </>
      )}

      {/* ===== フッター ===== */}
      <ConfidentialFooter />
    </PdfReportWrapper>
  );
}
