/**
 * /components/export/Stage2StrategyPreview.tsx
 *
 * STAGE2 全社戦略書プレビュー用コンポーネント
 * /report/stage2-strategy ページで表示
 * PDF化も対応（id="stage2-strategy-report"でキャプチャ対象）
 */

'use client';

import React from 'react';
import type { Stage2ReportData } from '@/utils/export/buildStage2ReportData';

interface Stage2StrategyPreviewProps {
  data: Stage2ReportData;
}

export function Stage2StrategyPreview({ data }: Stage2StrategyPreviewProps) {
  return (
    <div
      id="stage2-strategy-report"
      style={{
        backgroundColor: '#ffffff',
        boxShadow: '0 1px 3px rgba(0,0,0,0.1)',
        borderRadius: '0.375rem',
        overflow: 'hidden',
      }}
    >
      {/* A4用紙のサイズ設定 */}
      <div
        style={{
          width: '100%',
          maxWidth: '794px',
          margin: '0 auto',
          backgroundColor: '#ffffff',
          padding: '40px',
          fontSize: '11pt',
          lineHeight: '1.6',
          color: '#1f2937',
        }}
      >
        {/* ===== 表紙 ===== */}
        <div
          style={{
            textAlign: 'center',
            paddingTop: '80px',
            paddingBottom: '80px',
            borderBottom: '2px solid #e5e7eb',
            marginBottom: '40px',
          }}
        >
          <div
            style={{
              fontSize: '12px',
              color: '#9ca3af',
              letterSpacing: '0.2em',
              marginBottom: '20px',
              fontWeight: '600',
            }}
          >
            GROWTH SHIFT
          </div>
          <h1
            style={{
              fontSize: '40px',
              fontWeight: '700',
              color: '#0f172a',
              margin: '20px 0',
              letterSpacing: '0.05em',
            }}
          >
            全社戦略書
          </h1>
          <div
            style={{
              fontSize: '24px',
              fontWeight: '600',
              color: '#1f2937',
              margin: '40px 0',
            }}
          >
            {data.companyName}
          </div>
          <div
            style={{
              fontSize: '13px',
              color: '#0f766e',
              fontWeight: '600',
              backgroundColor: '#e0f2f1',
              display: 'inline-block',
              padding: '6px 12px',
              borderRadius: '4px',
              margin: '20px 0',
            }}
          >
            ✓ 確定済み
          </div>
          <div
            style={{
              fontSize: '12px',
              color: '#9ca3af',
              marginTop: '40px',
            }}
          >
            STAGE 2：全社戦略
          </div>
          <div
            style={{
              fontSize: '12px',
              color: '#9ca3af',
              marginTop: '8px',
            }}
          >
            出力日：{data.generatedDate}
          </div>
        </div>

        {/* ===== 戦略ストーリーの結論 ===== */}
        {data.storyChapters.length > 0 && data.storyChapters[0]?.content && (
          <>
            <div style={{ pageBreakBefore: 'always', marginBottom: '40px' }} />
            <div
              style={{
                marginBottom: '40px',
                pageBreakInside: 'avoid',
              }}
            >
              <div
                style={{
                  fontSize: '11px',
                  color: '#9ca3af',
                  letterSpacing: '0.2em',
                  fontWeight: '600',
                  marginBottom: '8px',
                }}
              >
                STRATEGIC FOUNDATION
              </div>
              <h2
                style={{
                  fontSize: '28px',
                  fontWeight: '700',
                  color: '#0f172a',
                  margin: '0 0 20px 0',
                }}
              >
                この戦略ストーリーの結論
              </h2>
              <div
                style={{
                  backgroundColor: '#f8fafc',
                  padding: '20px',
                  borderLeft: '4px solid #0f766e',
                  borderRadius: '4px',
                  lineHeight: '1.8',
                  color: '#1f2937',
                  whiteSpace: 'pre-wrap',
                  wordWrap: 'break-word',
                }}
              >
                {data.storyChapters[0].content}
              </div>
            </div>
          </>
        )}

        {/* ===== 数値目標と達成ギャップ ===== */}
        {data.companyTargets.length > 0 && (
          <>
            <div style={{ pageBreakBefore: 'always', marginBottom: '40px' }} />
            <div style={{ marginBottom: '40px', pageBreakInside: 'avoid' }}>
              <div
                style={{
                  fontSize: '11px',
                  color: '#9ca3af',
                  letterSpacing: '0.2em',
                  fontWeight: '600',
                  marginBottom: '8px',
                }}
              >
                FINANCIAL TARGET
              </div>
              <h2
                style={{
                  fontSize: '28px',
                  fontWeight: '700',
                  color: '#0f172a',
                  margin: '0 0 20px 0',
                }}
              >
                数値目標と達成ギャップ
              </h2>
              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns: '1fr 1fr',
                  gap: '16px',
                }}
              >
                {data.companyTargets.slice(0, 4).map((target, idx) => (
                  <div
                    key={idx}
                    style={{
                      backgroundColor: '#f8fafc',
                      padding: '16px',
                      borderLeft: '4px solid #0f766e',
                      borderRadius: '4px',
                      pageBreakInside: 'avoid',
                    }}
                  >
                    <div
                      style={{
                        fontWeight: '700',
                        color: '#0f172a',
                        marginBottom: '8px',
                        fontSize: '12px',
                      }}
                    >
                      {target.label}
                    </div>
                    {target.baseValue !== undefined && (
                      <div
                        style={{
                          fontSize: '11px',
                          color: '#4b5563',
                          marginBottom: '4px',
                        }}
                      >
                        <span style={{ fontWeight: '600' }}>目標:</span> {target.baseValue}
                        {target.unit && ` ${target.unit}`}
                      </div>
                    )}
                    {target.rationale && (
                      <div
                        style={{
                          fontSize: '10px',
                          color: '#6b7280',
                          fontStyle: 'italic',
                          marginTop: '8px',
                        }}
                      >
                        {target.rationale}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          </>
        )}

        {/* ===== 成長への基本方針 ===== */}
        {data.storyChapters.length > 1 && (
          <>
            <div style={{ pageBreakBefore: 'always', marginBottom: '40px' }} />
            <div style={{ marginBottom: '40px', pageBreakInside: 'avoid' }}>
              <div
                style={{
                  fontSize: '11px',
                  color: '#9ca3af',
                  letterSpacing: '0.2em',
                  fontWeight: '600',
                  marginBottom: '8px',
                }}
              >
                GROWTH STRATEGY
              </div>
              <h2
                style={{
                  fontSize: '28px',
                  fontWeight: '700',
                  color: '#0f172a',
                  margin: '0 0 20px 0',
                }}
              >
                成長への基本方針
              </h2>
              {data.storyChapters.slice(1, 4).map((chapter, idx) => (
                <div
                  key={idx}
                  style={{
                    marginBottom: '20px',
                    pageBreakInside: 'avoid',
                  }}
                >
                  <h3
                    style={{
                      fontSize: '14px',
                      fontWeight: '700',
                      color: '#0f766e',
                      margin: '0 0 12px 0',
                    }}
                  >
                    {chapter.title}
                  </h3>
                  <div
                    style={{
                      fontSize: '11px',
                      lineHeight: '1.7',
                      color: '#4b5563',
                      whiteSpace: 'pre-wrap',
                      wordWrap: 'break-word',
                    }}
                  >
                    {chapter.content}
                  </div>
                </div>
              ))}
            </div>
          </>
        )}

        {/* ===== 重点戦略 ===== */}
        {data.winPatterns.length > 0 && (
          <>
            <div style={{ pageBreakBefore: 'always', marginBottom: '40px' }} />
            <div style={{ marginBottom: '40px', pageBreakInside: 'avoid' }}>
              <div
                style={{
                  fontSize: '11px',
                  color: '#9ca3af',
                  letterSpacing: '0.2em',
                  fontWeight: '600',
                  marginBottom: '8px',
                }}
              >
                WINNING PATTERNS
              </div>
              <h2
                style={{
                  fontSize: '28px',
                  fontWeight: '700',
                  color: '#0f172a',
                  margin: '0 0 20px 0',
                }}
              >
                重点戦略と優先順位
              </h2>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px' }}>
                {data.winPatterns.map((wp, idx) => (
                  <div
                    key={idx}
                    style={{
                      backgroundColor: '#f8fafc',
                      padding: '16px',
                      borderRadius: '4px',
                      pageBreakInside: 'avoid',
                    }}
                  >
                    <h3
                      style={{
                        fontSize: '12px',
                        fontWeight: '700',
                        color: '#0f172a',
                        margin: '0 0 12px 0',
                      }}
                    >
                      {wp.name}
                    </h3>
                    {wp.valueDrivers && wp.valueDrivers.length > 0 && (
                      <div>
                        <div
                          style={{
                            fontSize: '10px',
                            fontWeight: '600',
                            color: '#6b7280',
                            marginBottom: '6px',
                          }}
                        >
                          バリュードライバー
                        </div>
                        <ul
                          style={{
                            fontSize: '10px',
                            color: '#4b5563',
                            margin: '0',
                            paddingLeft: '16px',
                          }}
                        >
                          {wp.valueDrivers.slice(0, 3).map((vd, vdIdx) => (
                            <li key={vdIdx} style={{ marginBottom: '4px' }}>
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
        <div style={{ pageBreakBefore: 'always', marginBottom: '40px' }} />
        <div style={{ marginBottom: '40px', pageBreakInside: 'avoid' }}>
          <div
            style={{
              fontSize: '11px',
              color: '#9ca3af',
              letterSpacing: '0.2em',
              fontWeight: '600',
              marginBottom: '8px',
            }}
          >
            EXECUTION ROADMAP
          </div>
          <h2
            style={{
              fontSize: '28px',
              fontWeight: '700',
              color: '#0f172a',
              margin: '0 0 20px 0',
            }}
          >
            実行への接続
          </h2>
          <div
            style={{
              backgroundColor: '#f8fafc',
              padding: '20px',
              borderLeft: '4px solid #0f766e',
              borderRadius: '4px',
              lineHeight: '1.7',
            }}
          >
            <p style={{ margin: '0 0 12px 0', fontSize: '11px', color: '#4b5563' }}>
              本戦略は以下のプロセスを通じて実行に展開されます。
            </p>
            <div style={{ fontSize: '11px', color: '#4b5563' }}>
              <div style={{ margin: '6px 0' }}>
                <strong>STAGE3：</strong>事業・部門別戦略への展開
              </div>
              <div style={{ margin: '6px 0' }}>
                <strong>STAGE4：</strong>KPI・実行計画の策定
              </div>
              <div style={{ margin: '6px 0' }}>
                <strong>STAGE5：</strong>実行支援・進捗管理
              </div>
              <div style={{ margin: '6px 0' }}>
                <strong>STAGE6：</strong>業績シミュレーション・最適化
              </div>
            </div>
          </div>
        </div>

        {/* ===== フッター ===== */}
        <div
          style={{
            marginTop: '60px',
            paddingTop: '20px',
            borderTop: '1px solid #e5e7eb',
            fontSize: '10px',
            color: '#9ca3af',
            textAlign: 'center',
          }}
        >
          <p style={{ margin: 0 }}>
            © GROWTH SHIFT - Confidential
          </p>
          <p style={{ margin: '4px 0 0 0' }}>
            {data.generatedDate}
          </p>
        </div>
      </div>
    </div>
  );
}
