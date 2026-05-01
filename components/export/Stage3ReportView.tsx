/**
 * /components/export/Stage3ReportView.tsx
 *
 * 目的：
 * - STAGE3 部門戦略レポートの表示
 * - A4印刷対応
 */

'use client';

import React from 'react';
import type { Stage3ReportData } from '@/utils/export/buildStage3ReportData';
import {
  PdfReportWrapper,
  ReportCover,
  PageBreak,
  ConfidentialFooter,
} from './ReportLayout';

interface Stage3ReportViewProps {
  data: Stage3ReportData;
}

export function Stage3ReportView({ data }: Stage3ReportViewProps) {
  return (
    <PdfReportWrapper stageNumber={3}>
      {/* ===== 表紙 ===== */}
      <ReportCover
        companyName={data.companyName}
        stageName="部門戦略レポート"
        stageNumber={3}
        generatedDate={data.generatedDate}
      />

      {/* ===== 経営戦略ストーリー ===== */}
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

      {/* ===== 部門別戦略詳細 ===== */}
      {data.departments.length > 0 && (
        <>
          <PageBreak />
          <div className="report-section">
            <h2 className="report-h2">部門別戦略詳細</h2>

            {data.departments.map((dept, deptIdx) => (
              <div key={deptIdx}>
                {/* 部門ヘッダー */}
                <div className="report-card">
                  <h3 className="report-h3">{dept.name}</h3>

                  <div style={{ marginTop: '1rem' }}>
                    <h4 className="report-h4">ミッション</h4>
                    <p className="report-text large">{dept.mission}</p>
                  </div>

                  {dept.missionDescription && (
                    <div style={{ marginTop: '1rem' }}>
                      <h4 className="report-h4">ミッション説明・背景</h4>
                      <p className="report-text">{dept.missionDescription}</p>
                    </div>
                  )}

                  {dept.hypothesis && (
                    <div style={{ marginTop: '1rem' }}>
                      <h4 className="report-h4">戦略仮説</h4>
                      <p className="report-text">{dept.hypothesis}</p>
                    </div>
                  )}
                </div>

                {/* プロジェクト */}
                {dept.projects.length > 0 && (
                  <div style={{ marginTop: '1rem' }}>
                    <h4 className="report-h4">プロジェクト案</h4>
                    {dept.projects.map((proj, projIdx) => (
                      <div key={projIdx} className="report-card">
                        <p
                          style={{
                            margin: '0 0 0.5rem 0',
                            fontWeight: '600',
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
                          <div style={{ marginTop: '0.5rem' }}>
                            <p
                              className="report-text"
                              style={{ margin: '0 0 0.25rem 0' }}
                            >
                              <strong>KPI案:</strong>
                            </p>
                            <ul className="report-list">
                              {proj.kpiTargets.map((kpi, kpiIdx) => (
                                <li key={kpiIdx}>{kpi}</li>
                              ))}
                            </ul>
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                )}

                {/* 6テーマ議論の回答 */}
                {dept.answers.length > 0 && (
                  <div style={{ marginTop: '1rem' }}>
                    <h4 className="report-h4">6テーマ議論の回答</h4>
                    {dept.answers.map((ans) => (
                      <div key={ans.questionIndex} className="report-card">
                        <p
                          style={{
                            margin: '0 0 0.5rem 0',
                            fontWeight: '600',
                            color: '#333',
                          }}
                        >
                          Q{ans.questionIndex}: {ans.question}
                        </p>
                        <p className="report-text">{ans.answer}</p>
                      </div>
                    ))}
                  </div>
                )}

                {/* 再考ポイント */}
                {dept.reconsiderationPoints.length > 0 && (
                  <div style={{ marginTop: '1rem' }}>
                    <h4 className="report-h4">再考ポイント</h4>
                    <ul className="report-list">
                      {dept.reconsiderationPoints.map((point, idx) => (
                        <li key={idx}>{point}</li>
                      ))}
                    </ul>
                  </div>
                )}

                {deptIdx < data.departments.length - 1 && (
                  <div style={{ margin: '2rem 0', borderTop: '1px solid #e0e0e0' }} />
                )}
              </div>
            ))}
          </div>
        </>
      )}

      {/* ===== 部門横断的事項 ===== */}
      {(data.crossDepartmentIssues.length > 0 || data.finalStrategy) && (
        <>
          <PageBreak />
          <div className="report-section">
            <h2 className="report-h2">部門横断的事項</h2>

            {data.crossDepartmentIssues.length > 0 && (
              <div>
                <h3 className="report-h3">部門間の連携・確認事項</h3>
                <ul className="report-list">
                  {data.crossDepartmentIssues.map((issue, idx) => (
                    <li key={idx}>{issue}</li>
                  ))}
                </ul>
              </div>
            )}

            {data.finalStrategy && (
              <div style={{ marginTop: '1.5rem' }}>
                <h3 className="report-h3">最終部門戦略</h3>
                <p className="report-text large">{data.finalStrategy}</p>
              </div>
            )}
          </div>
        </>
      )}

      {/* ===== フッター ===== */}
      <ConfidentialFooter />
    </PdfReportWrapper>
  );
}
