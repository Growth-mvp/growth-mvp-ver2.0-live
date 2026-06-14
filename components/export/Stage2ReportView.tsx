/**
 * /components/export/Stage2ReportView.tsx
 *
 * 目的：
 * - STAGE2 経営戦略ストーリーレポート
 * - 正式な全社戦略書として、外資系コンサルティングレポートレベルのデザイン
 * - Executive Summary を要約として提示
 * - Appendix で詳細情報を管理
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

// ユーティリティ：テキストを指定文字数でトリミング
function truncateText(text: string, maxLength: number): string {
  if (!text) return '';
  if (text.length <= maxLength) return text;
  return text.substring(0, maxLength) + '...';
}

export function Stage2ReportView({ data }: Stage2ReportViewProps) {
  // Executive Summary 用の短い結論を抽出
  const strategicConclusion = data.storyChapters.length > 0
    ? truncateText(data.storyChapters[0]?.content || '', 400)
    : data.ceoIntent
    ? truncateText(data.ceoIntent, 400)
    : '';

  // 成長方針を抽出（第2〜3章の冒頭を利用）
  const growthStrategies = data.storyChapters
    .slice(1, 3)
    .map(ch => ({
      title: ch.title,
      content: truncateText(ch.content, 200),
    }))
    .slice(0, 3);

  return (
    <PdfReportWrapper stageNumber={2}>
      {/* ===== 表紙 ===== */}
      <ReportCover
        companyName={data.companyName}
        stageName="全社戦略書"
        stageNumber={2}
        generatedDate={data.generatedDate}
        status="確定済み"
      />

      {/* ===== エグゼクティブサマリー ===== */}
      <PageBreak />
      <div className="report-section" style={{ marginTop: '2rem' }}>
        <div style={{ marginBottom: '0.5rem', fontSize: '12px', color: '#666666', letterSpacing: '0.2em', fontWeight: '600' }}>
          EXECUTIVE SUMMARY
        </div>
        <h2 className="report-h2" style={{ fontSize: '26px', marginTop: '0.3rem', marginBottom: '1.5rem' }}>
          戦略の要約
        </h2>

        {/* 戦略結論 */}
        {strategicConclusion && (
          <div className="report-card" style={{ marginBottom: '1.5rem' }}>
            <h3 className="report-h3" style={{ fontSize: '14px', color: '#00796b', marginBottom: '0.8rem' }}>
              戦略結論
            </h3>
            <p className="report-text" style={{ lineHeight: '1.7', color: '#1a1a1a' }}>
              {strategicConclusion}
            </p>
          </div>
        )}

        {/* 基本方針 */}
        {growthStrategies.length > 0 && (
          <div>
            <h3 className="report-h3" style={{ fontSize: '14px', color: '#00796b', marginBottom: '1rem' }}>
              基本方針
            </h3>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr', gap: '1rem' }}>
              {growthStrategies.map((strategy, idx) => (
                <div key={idx} className="report-card" style={{ backgroundColor: '#f5f5f5', borderLeft: '3px solid #00796b' }}>
                  <p style={{ margin: '0 0 0.5rem 0', fontSize: '13px', fontWeight: '700', color: '#1a1a1a' }}>
                    {idx + 1}. {strategy.title}
                  </p>
                  <p className="report-text" style={{ fontSize: '12px', color: '#444444', margin: 0 }}>
                    {strategy.content}
                  </p>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* STAGE接続 */}
        <div style={{ marginTop: '1.5rem', paddingTop: '1rem', borderTop: '1px solid #ddd' }}>
          <p style={{ fontSize: '12px', color: '#666666', margin: 0 }}>
            本戦略は STAGE3〜6 を通じて事業部門での実行計画、KPI、進捗管理、業績検証へ展開します。
          </p>
        </div>
      </div>

      {/* ===== 数値目標と達成ギャップ ===== */}
      {data.companyTargets.length > 0 && (
        <>
          <PageBreak />
          <div className="report-section">
            <div style={{ marginBottom: '0.5rem', fontSize: '12px', color: '#666666', letterSpacing: '0.2em', fontWeight: '600' }}>
              FINANCIAL TARGET
            </div>
            <h2 className="report-h2" style={{ fontSize: '28px', marginTop: '0.3rem' }}>
              数値目標と達成ギャップ
            </h2>

            <div style={{ marginTop: '1.5rem', display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1.5rem' }}>
              {data.companyTargets.slice(0, 4).map((target, idx) => (
                <div
                  key={idx}
                  className="report-card"
                  style={{
                    borderLeft: '4px solid #00796b',
                    paddingLeft: '1.2rem',
                    backgroundColor: '#f5f5f5',
                  }}
                >
                  <p style={{ margin: '0 0 0.8rem 0', fontSize: '14px', fontWeight: '700', color: '#1a1a1a' }}>
                    {target.label}
                  </p>
                  {target.baseValue !== undefined && (
                    <p className="report-text" style={{ margin: '0.4rem 0' }}>
                      <span style={{ color: '#666666' }}>目標:</span> {target.baseValue}
                      {target.unit && ` ${target.unit}`}
                    </p>
                  )}
                  {target.rationale && (
                    <p style={{ fontSize: '11px', color: '#888888', margin: '0.5rem 0 0 0', fontStyle: 'italic' }}>
                      {target.rationale}
                    </p>
                  )}
                </div>
              ))}
            </div>
          </div>
        </>
      )}

      {/* ===== 成長への基本方針 ===== */}
      <PageBreak />
      <div className="report-section">
        <div style={{ marginBottom: '0.5rem', fontSize: '12px', color: '#666666', letterSpacing: '0.2em', fontWeight: '600' }}>
          STRATEGIC FOUNDATION
        </div>
        <h2 className="report-h2" style={{ fontSize: '28px', marginTop: '0.3rem' }}>
          成長への基本方針
        </h2>

        <div style={{ marginTop: '1.5rem' }}>
          {data.storyChapters.length > 1 ? (
            <>
              {data.storyChapters.slice(1, 3).map((chapter) => (
                <div key={chapter.index} className="report-card" style={{ marginBottom: '1.5rem' }}>
                  <h3 className="report-h3" style={{ fontSize: '16px', color: '#00796b' }}>
                    {chapter.title}
                  </h3>
                  <p className="report-text" style={{ lineHeight: '1.8', marginTop: '0.8rem' }}>
                    {chapter.content}
                  </p>
                </div>
              ))}
            </>
          ) : (
            <div className="report-card">
              <p className="report-text" style={{ color: '#888888' }}>
                戦略本文を確定後、ここに表示されます
              </p>
            </div>
          )}
        </div>
      </div>

      {/* ===== 重点戦略と優先順位 ===== */}
      {data.winPatterns.length > 0 && (
        <>
          <PageBreak />
          <div className="report-section">
            <div style={{ marginBottom: '0.5rem', fontSize: '12px', color: '#666666', letterSpacing: '0.2em', fontWeight: '600' }}>
              WINNING PATTERNS
            </div>
            <h2 className="report-h2" style={{ fontSize: '28px', marginTop: '0.3rem' }}>
              重点戦略と優先順位
            </h2>

            <div style={{ marginTop: '1.5rem', display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1.5rem' }}>
              {data.winPatterns.map((wp, idx) => (
                <div key={idx} className="report-card" style={{ backgroundColor: '#fafafa' }}>
                  <h3 className="report-h3" style={{ fontSize: '15px', color: '#1a1a1a', marginBottom: '0.8rem' }}>
                    {wp.name}
                  </h3>
                  {wp.valueDrivers && wp.valueDrivers.length > 0 && (
                    <div>
                      <p style={{ fontSize: '12px', fontWeight: '600', color: '#666666', margin: '0 0 0.4rem 0' }}>
                        バリュードライバー
                      </p>
                      <ul style={{ fontSize: '12px', margin: '0.4rem 0 0 1.2rem', paddingLeft: 0 }}>
                        {wp.valueDrivers.slice(0, 3).map((vd, vdIdx) => (
                          <li key={vdIdx} style={{ marginBottom: '0.3rem', color: '#444444' }}>
                            {vd}
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        </>
      )}

      {/* ===== 実行への接続 ===== */}
      <PageBreak />
      <div className="report-section">
        <div style={{ marginBottom: '0.5rem', fontSize: '12px', color: '#666666', letterSpacing: '0.2em', fontWeight: '600' }}>
          EXECUTION ROADMAP
        </div>
        <h2 className="report-h2" style={{ fontSize: '28px', marginTop: '0.3rem' }}>
          実行への接続
        </h2>

        <div style={{ marginTop: '1.5rem' }}>
          {data.storyChapters.length > 3 ? (
            <div className="report-card">
              <h3 className="report-h3" style={{ fontSize: '16px', color: '#00796b', marginBottom: '1rem' }}>
                {data.storyChapters[3]?.title || '実行戦略'}
              </h3>
              <p className="report-text" style={{ lineHeight: '1.8', marginBottom: '1.2rem' }}>
                {data.storyChapters[3]?.content}
              </p>
              <div style={{ marginTop: '1.2rem', paddingTop: '1.2rem', borderTop: '1px solid #ddd' }}>
                <p style={{ fontSize: '12px', color: '#666666', margin: '0 0 0.5rem 0' }}>
                  <strong>次のステップ:</strong>
                </p>
                <ul style={{ fontSize: '12px', margin: '0.5rem 0 0 1.2rem', paddingLeft: 0 }}>
                  <li style={{ marginBottom: '0.3rem', color: '#444444' }}>
                    ✓ STAGE3：事業・部門別戦略への展開
                  </li>
                  <li style={{ marginBottom: '0.3rem', color: '#444444' }}>
                    ✓ STAGE4：実行計画・KPI設計
                  </li>
                  <li style={{ marginBottom: '0.3rem', color: '#444444' }}>
                    ✓ STAGE5：実行支援・進捗管理
                  </li>
                  <li style={{ color: '#444444' }}>
                    ✓ STAGE6：業績シミュレーション・最適化
                  </li>
                </ul>
              </div>
            </div>
          ) : (
            <div className="report-card">
              <p className="report-text" style={{ color: '#888888' }}>
                実行戦略の詳細は、全4章の確定後に表示されます
              </p>
            </div>
          )}
        </div>
      </div>

      {/* ===== CEO思い（補足） ===== */}
      {data.ceoIntent && (
        <>
          <PageBreak />
          <div className="report-section">
            <div style={{ marginBottom: '0.5rem', fontSize: '12px', color: '#666666', letterSpacing: '0.2em', fontWeight: '600' }}>
              CEO INTENTION
            </div>
            <h2 className="report-h2" style={{ fontSize: '20px', marginTop: '0.3rem' }}>
              経営者の思い
            </h2>

            <div className="report-card" style={{ marginTop: '1.5rem', backgroundColor: '#f9f9f9', borderLeft: '4px solid #1565c0' }}>
              <p className="report-text large" style={{ lineHeight: '1.8', fontStyle: 'italic', color: '#1a1a1a' }}>
                「{data.ceoIntent}」
              </p>
            </div>
          </div>
        </>
      )}

      {/* ===== MVV ===== */}
      {(data.mvv.mission || data.mvv.vision || data.mvv.value) && (
        <>
          <PageBreak />
          <div className="report-section">
            <h2 className="report-h2">経営理念・ビジョン</h2>

            <div style={{ marginTop: '1.5rem', display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1.5rem' }}>
              {data.mvv.mission && (
                <div className="report-card">
                  <h3 className="report-h3" style={{ color: '#d32f2f', marginBottom: '0.8rem' }}>
                    Mission
                  </h3>
                  <p className="report-text" style={{ lineHeight: '1.7' }}>
                    {data.mvv.mission}
                  </p>
                </div>
              )}

              {data.mvv.vision && (
                <div className="report-card">
                  <h3 className="report-h3" style={{ color: '#1976d2', marginBottom: '0.8rem' }}>
                    Vision
                  </h3>
                  <p className="report-text" style={{ lineHeight: '1.7' }}>
                    {data.mvv.vision}
                  </p>
                </div>
              )}
            </div>

            {data.mvv.value && (
              <div className="report-card" style={{ marginTop: '1.5rem' }}>
                <h3 className="report-h3" style={{ color: '#00796b', marginBottom: '0.8rem' }}>
                  Value（企業価値）
                </h3>
                <p className="report-text" style={{ lineHeight: '1.7' }}>
                  {data.mvv.value}
                </p>
              </div>
            )}
          </div>
        </>
      )}

      {/* ===== SWOT分析 ===== */}
      {(data.swot.strength || data.swot.weakness || data.swot.opportunity || data.swot.threat) && (
        <>
          <PageBreak />
          <div className="report-section">
            <h2 className="report-h2">SWOT分析</h2>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1.5rem', marginTop: '1.5rem' }}>
              {data.swot.strength && (
                <div className="report-card" style={{ borderLeft: '4px solid #2e7d32' }}>
                  <h3 className="report-h3" style={{ color: '#2e7d32', marginBottom: '0.8rem' }}>
                    Strength
                  </h3>
                  <p className="report-text">{data.swot.strength}</p>
                </div>
              )}

              {data.swot.weakness && (
                <div className="report-card" style={{ borderLeft: '4px solid #c62828' }}>
                  <h3 className="report-h3" style={{ color: '#c62828', marginBottom: '0.8rem' }}>
                    Weakness
                  </h3>
                  <p className="report-text">{data.swot.weakness}</p>
                </div>
              )}

              {data.swot.opportunity && (
                <div className="report-card" style={{ borderLeft: '4px solid #0277bd' }}>
                  <h3 className="report-h3" style={{ color: '#0277bd', marginBottom: '0.8rem' }}>
                    Opportunity
                  </h3>
                  <p className="report-text">{data.swot.opportunity}</p>
                </div>
              )}

              {data.swot.threat && (
                <div className="report-card" style={{ borderLeft: '4px solid #f57f17' }}>
                  <h3 className="report-h3" style={{ color: '#f57f17', marginBottom: '0.8rem' }}>
                    Threat
                  </h3>
                  <p className="report-text">{data.swot.threat}</p>
                </div>
              )}
            </div>
          </div>
        </>
      )}

      {/* ===== フッター ===== */}
      <ConfidentialFooter />
    </PdfReportWrapper>
  );
}
