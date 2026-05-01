/**
 * /components/export/Stage2ReportView.tsx
 *
 * 目的：
 * - STAGE2 経営戦略ストーリーレポートの表示
 * - A4印刷対応
 */

'use client';

import React from 'react';
import type { Stage2ReportData } from '@/utils/export/buildStage2ReportData';
import {
  PdfReportWrapper,
  ReportCover,
  PageBreak,
  ConfidentialFooter,
} from './ReportLayout';

interface Stage2ReportViewProps {
  data: Stage2ReportData;
}

export function Stage2ReportView({ data }: Stage2ReportViewProps) {
  return (
    <PdfReportWrapper stageNumber={2}>
      {/* ===== 表紙 ===== */}
      <ReportCover
        companyName={data.companyName}
        stageName="経営戦略ストーリーレポート"
        stageNumber={2}
        generatedDate={data.generatedDate}
      />

      {/* ===== CEO思い ===== */}
      {data.ceoIntent && (
        <>
          <PageBreak />
          <div className="report-section">
            <h2 className="report-h2">経営者の思い</h2>

            <div className="report-card">
              <p className="report-text large">{data.ceoIntent}</p>
            </div>
          </div>
        </>
      )}

      {/* ===== MVV ===== */}
      {(data.mvv.mission || data.mvv.vision || data.mvv.value) && (
        <>
          <PageBreak />
          <div className="report-section">
            <h2 className="report-h2">Mission / Vision / Value</h2>

            {data.mvv.mission && (
              <div className="report-card">
                <h3 className="report-h3">Mission（ミッション）</h3>
                <p className="report-text large">{data.mvv.mission}</p>
              </div>
            )}

            {data.mvv.vision && (
              <div className="report-card">
                <h3 className="report-h3">Vision（ビジョン）</h3>
                <p className="report-text large">{data.mvv.vision}</p>
              </div>
            )}

            {data.mvv.value && (
              <div className="report-card">
                <h3 className="report-h3">Value（バリュー）</h3>
                <p className="report-text large">{data.mvv.value}</p>
              </div>
            )}
          </div>
        </>
      )}

      {/* ===== SWOT ===== */}
      {(data.swot.strength || data.swot.weakness || data.swot.opportunity || data.swot.threat) && (
        <>
          <PageBreak />
          <div className="report-section">
            <h2 className="report-h2">SWOT分析</h2>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
              {data.swot.strength && (
                <div className="report-card">
                  <h3 className="report-h3" style={{ color: '#2e7d32' }}>
                    Strength（強み）
                  </h3>
                  <p className="report-text">{data.swot.strength}</p>
                </div>
              )}

              {data.swot.weakness && (
                <div className="report-card">
                  <h3 className="report-h3" style={{ color: '#c62828' }}>
                    Weakness（弱み）
                  </h3>
                  <p className="report-text">{data.swot.weakness}</p>
                </div>
              )}

              {data.swot.opportunity && (
                <div className="report-card">
                  <h3 className="report-h3" style={{ color: '#0277bd' }}>
                    Opportunity（機会）
                  </h3>
                  <p className="report-text">{data.swot.opportunity}</p>
                </div>
              )}

              {data.swot.threat && (
                <div className="report-card">
                  <h3 className="report-h3" style={{ color: '#f57f17' }}>
                    Threat（脅威）
                  </h3>
                  <p className="report-text">{data.swot.threat}</p>
                </div>
              )}
            </div>
          </div>
        </>
      )}

      {/* ===== ストーリー ===== */}
      {data.storyChapters.length > 0 && (
        <>
          <PageBreak />
          <div className="report-section">
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
        </>
      )}

      {/* ===== 勝ち筋 ===== */}
      {data.winPatterns.length > 0 && (
        <>
          <PageBreak />
          <div className="report-section">
            <h2 className="report-h2">勝ち筋</h2>

            {data.winPatterns.map((wp, idx) => (
              <div key={idx} className="report-card">
                <h3 className="report-h3">{wp.name}</h3>
                {wp.valueDrivers && wp.valueDrivers.length > 0 && (
                  <>
                    <p style={{ margin: '0 0 0.5rem 0', fontWeight: '600' }}>
                      バリュードライバー:
                    </p>
                    <ul className="report-list">
                      {wp.valueDrivers.map((vd, vdIdx) => (
                        <li key={vdIdx}>{vd}</li>
                      ))}
                    </ul>
                  </>
                )}
              </div>
            ))}
          </div>
        </>
      )}

      {/* ===== North Star メトリクス ===== */}
      {data.companyTargets.length > 0 && (
        <>
          <PageBreak />
          <div className="report-section">
            <h2 className="report-h2">業績目標（North Star Metrics）</h2>

            {data.companyTargets.map((target, idx) => (
              <div key={idx} className="report-card">
                <p style={{ margin: '0 0 0.5rem 0', fontWeight: '600' }}>
                  {target.label}
                </p>
                {target.baseValue !== undefined && (
                  <p className="report-text">
                    <strong>目標値:</strong> {target.baseValue}
                    {target.unit && ` ${target.unit}`}
                  </p>
                )}
                {target.rationale && (
                  <p className="report-text">
                    <strong>根拠:</strong> {target.rationale}
                  </p>
                )}
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
