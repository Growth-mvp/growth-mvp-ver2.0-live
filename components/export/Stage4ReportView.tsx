/**
 * /components/export/Stage4ReportView.tsx
 *
 * 目的：
 * - STAGE4 OKR実行計画書の表示
 * - A4印刷対応
 */

'use client';

import React from 'react';
import type { Stage4ReportData } from '@/utils/export/buildStage4ReportData';
import {
  PdfReportWrapper,
  ReportCover,
  PageBreak,
  ConfidentialFooter,
} from './ReportLayout';

interface Stage4ReportViewProps {
  data: Stage4ReportData;
}

export function Stage4ReportView({ data }: Stage4ReportViewProps) {
  return (
    <PdfReportWrapper stageNumber={4}>
      {/* ===== 表紙 ===== */}
      <ReportCover
        companyName="（会社名）"
        stageName="OKR実行計画書"
        stageNumber={4}
        generatedDate={data.generatedDate}
      />

      {/* ===== サマリー ===== */}
      {data.summary && (
        <>
          <PageBreak />
          <div className="report-section">
            <h2 className="report-h2">実行計画サマリー</h2>

            <div className="report-grid">
              {data.summary.keyMetrics.map((metric, idx) => (
                <div key={idx} className="report-grid-item">
                  <div className="report-grid-item-label">{metric.name}</div>
                  <div className="report-grid-item-value">{metric.value}</div>
                </div>
              ))}
            </div>
          </div>
        </>
      )}

      {/* ===== OKR実行計画 ===== */}
      {data.okrPlans.length > 0 && (
        <>
          <PageBreak />
          <div className="report-section">
            <h2 className="report-h2">OKR実行計画</h2>

            {/* 部門ごとにグループ化 */}
            {groupByDepartment(data.okrPlans).map((deptGroup) => (
              <div key={deptGroup.departmentName}>
                <h3 className="report-h3">{deptGroup.departmentName}</h3>

                {deptGroup.plans.map((plan, planIdx) => (
                  <div key={planIdx} className="report-card">
                    <div className="report-card-header">
                      <span className="report-card-title">
                        {plan.projectName}
                      </span>
                    </div>

                    {/* Objective */}
                    <div style={{ marginBottom: '1rem' }}>
                      <h4 className="report-h4">Objective（目標）</h4>
                      <p className="report-text large">{plan.objective}</p>
                    </div>

                    {/* Key Results */}
                    {plan.keyResults.length > 0 && (
                      <div style={{ marginBottom: '1rem' }}>
                        <h4 className="report-h4">
                          Key Results（成果指標）
                        </h4>
                        <ul className="report-list">
                          {plan.keyResults.map((kr, krIdx) => (
                            <li key={krIdx}>
                              <strong>{kr.statement}</strong>
                              {kr.baseValue && kr.targetValue && (
                                <p
                                  className="report-text"
                                  style={{
                                    margin: '0.25rem 0 0 0',
                                    fontSize: '0.9rem',
                                    color: '#999',
                                  }}
                                >
                                  現状: {kr.baseValue} → 目標: {kr.targetValue}
                                </p>
                              )}
                              {kr.owner && (
                                <p
                                  className="report-text"
                                  style={{
                                    margin: '0.25rem 0 0 0',
                                    fontSize: '0.9rem',
                                    color: '#999',
                                  }}
                                >
                                  Owner: {kr.owner}
                                </p>
                              )}
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}

                    {/* Owner / Due Date */}
                    {(plan.owner || plan.dueDate) && (
                      <div style={{ marginBottom: '1rem' }}>
                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
                          {plan.owner && (
                            <div>
                              <p
                                style={{
                                  margin: '0 0 0.25rem 0',
                                  fontSize: '0.9rem',
                                  fontWeight: '600',
                                  color: '#999',
                                }}
                              >
                                Owner
                              </p>
                              <p className="report-text">{plan.owner}</p>
                            </div>
                          )}
                          {plan.dueDate && (
                            <div>
                              <p
                                style={{
                                  margin: '0 0 0.25rem 0',
                                  fontSize: '0.9rem',
                                  fontWeight: '600',
                                  color: '#999',
                                }}
                              >
                                期限
                              </p>
                              <p className="report-text">{plan.dueDate}</p>
                            </div>
                          )}
                        </div>
                      </div>
                    )}

                    {/* 期待インパクト / 成功確率 */}
                    {(plan.expectedImpactYen || plan.probability) && (
                      <div
                        style={{
                          padding: '1rem',
                          backgroundColor: '#f9f9f9',
                          borderRadius: '4px',
                          marginTop: '1rem',
                        }}
                      >
                        {plan.expectedImpactYen && (
                          <p className="report-text" style={{ margin: '0 0 0.5rem 0' }}>
                            <strong>期待インパクト:</strong>{' '}
                            {(plan.expectedImpactYen / 1000000).toFixed(1)}M円
                          </p>
                        )}
                        {plan.probability && (
                          <p className="report-text" style={{ margin: 0 }}>
                            <strong>成功確率:</strong>{' '}
                            {(plan.probability * 100).toFixed(0)}%
                          </p>
                        )}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            ))}
          </div>
        </>
      )}

      {/* ===== エンプティ状態 ===== */}
      {data.okrPlans.length === 0 && (
        <div className="report-section">
          <p className="report-text muted" style={{ textAlign: 'center', padding: '2rem' }}>
            OKR計画がまだ入力されていません
          </p>
        </div>
      )}

      {/* ===== フッター ===== */}
      <ConfidentialFooter />
    </PdfReportWrapper>
  );
}

/**
 * OKR計画を部門でグループ化
 */
function groupByDepartment(
  plans: any[],
): Array<{ departmentName: string; plans: any[] }> {
  const grouped: Record<string, any[]> = {};

  plans.forEach((plan) => {
    const deptName = plan.departmentName;
    if (!grouped[deptName]) {
      grouped[deptName] = [];
    }
    grouped[deptName].push(plan);
  });

  return Object.entries(grouped).map(([deptName, deptPlans]) => ({
    departmentName: deptName,
    plans: deptPlans,
  }));
}
