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
        stageName="事業・部門別戦略レポート"
        stageNumber={3}
        generatedDate={data.generatedDate}
      />

      {/* ===== 経営戦略ストーリー ===== */}
      {data.storyChapters.length > 0 && (
        <>
          <PageBreak />
          <div className="report-section">
            <h2 className="report-h2">経営戦略ストーリー</h2>

            {data.winPatternPrimary && (
              <div className="report-card">
                <h3 className="report-h3">勝ち筋</h3>
                <p className="report-text">
                  <strong>主勝ち筋:</strong> {data.winPatternPrimary}
                </p>
                {data.winPatternSecondary && (
                  <p className="report-text">
                    <strong>副勝ち筋:</strong> {data.winPatternSecondary}
                  </p>
                )}
              </div>
            )}

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
                </div>

                {/* ===== STEP1: たたき台 ===== */}
                <div style={{ marginTop: '1rem' }}>
                  <h4 className="report-h4">STEP1 たたき台</h4>
                  <div className="report-card">
                    <p style={{ margin: '0 0 0.5rem 0' }}>
                      <strong>ミッション:</strong>
                    </p>
                    <p className="report-text">{dept.step1.missionDraft || '（未入力）'}</p>

                    {dept.step1.missionDescription && (
                      <>
                        <p style={{ margin: '0.5rem 0 0.25rem 0' }}>
                          <strong>ミッション説明:</strong>
                        </p>
                        <p className="report-text">{dept.step1.missionDescription}</p>
                      </>
                    )}

                    {dept.step1.generationMeta && (
                      <>
                        <p style={{ margin: '0.5rem 0 0.25rem 0' }}>
                          <strong>生成内訳:</strong>
                        </p>
                        <p className="report-text" style={{ fontSize: '0.9rem' }}>
                          既存進化: {dept.step1.generationMeta.existingCount || 0} | 新規探索:{' '}
                          {dept.step1.generationMeta.newCount || 0}
                        </p>
                      </>
                    )}
                  </div>

                  {/* 既存進化プロジェクト */}
                  {dept.step1.existingProjects.length > 0 && (
                    <div style={{ marginTop: '0.5rem' }}>
                      <h5 style={{ margin: '0 0 0.25rem 0', fontSize: '0.9rem', fontWeight: '600' }}>
                        既存進化プロジェクト
                      </h5>
                      {dept.step1.existingProjects.map((proj, idx) => (
                        <div key={idx} className="report-card" style={{ padding: '0.5rem' }}>
                          <p style={{ margin: '0 0 0.25rem 0', fontWeight: '600' }}>• {proj.title}</p>
                          {proj.hypothesis && (
                            <p style={{ margin: '0', fontSize: '0.85rem' }}>
                              <strong>仮説:</strong> {proj.hypothesis}
                            </p>
                          )}
                        </div>
                      ))}
                    </div>
                  )}

                  {/* 新規探索プロジェクト */}
                  {dept.step1.newProjects.length > 0 && (
                    <div style={{ marginTop: '0.5rem' }}>
                      <h5 style={{ margin: '0 0 0.25rem 0', fontSize: '0.9rem', fontWeight: '600' }}>
                        新規探索プロジェクト
                      </h5>
                      {dept.step1.newProjects.map((proj, idx) => (
                        <div key={idx} className="report-card" style={{ padding: '0.5rem' }}>
                          <p style={{ margin: '0 0 0.25rem 0', fontWeight: '600' }}>• {proj.title}</p>
                          {proj.hypothesis && (
                            <p style={{ margin: '0', fontSize: '0.85rem' }}>
                              <strong>仮説:</strong> {proj.hypothesis}
                            </p>
                          )}
                        </div>
                      ))}
                    </div>
                  )}

                  {/* 事業部内・間連携 */}
                  {(dept.step1.intraDeptCollab.length > 0 || dept.step1.interDeptCollab.length > 0) && (
                    <div style={{ marginTop: '0.5rem' }}>
                      {dept.step1.intraDeptCollab.length > 0 && (
                        <>
                          <h5 style={{ margin: '0 0 0.25rem 0', fontSize: '0.9rem', fontWeight: '600' }}>
                            事業部内連携
                          </h5>
                          <ul className="report-list" style={{ margin: '0 0 0.5rem 0' }}>
                            {dept.step1.intraDeptCollab.map((item, idx) => (
                              <li key={idx} style={{ fontSize: '0.85rem' }}>
                                {item || '（未入力）'}
                              </li>
                            ))}
                          </ul>
                        </>
                      )}
                      {dept.step1.interDeptCollab.length > 0 && (
                        <>
                          <h5 style={{ margin: '0 0 0.25rem 0', fontSize: '0.9rem', fontWeight: '600' }}>
                            事業部間連携
                          </h5>
                          <ul className="report-list">
                            {dept.step1.interDeptCollab.map((item, idx) => (
                              <li key={idx} style={{ fontSize: '0.85rem' }}>
                                {item || '（未入力）'}
                              </li>
                            ))}
                          </ul>
                        </>
                      )}
                    </div>
                  )}
                </div>

                {/* ===== STEP2: 6テーマ議論 ===== */}
                {dept.step2.answers.length > 0 && (
                  <div style={{ marginTop: '1rem' }}>
                    <h4 className="report-h4">STEP2 6テーマ議論</h4>
                    {dept.step2.answers.map((ans) => (
                      <div key={ans.stepNumber} className="report-card">
                        <p style={{ margin: '0 0 0.25rem 0', fontWeight: '600' }}>
                          Q{ans.stepNumber}: {ans.question}
                        </p>
                        <p className="report-text" style={{ margin: '0.25rem 0' }}>
                          {ans.answer || '（未入力）'}
                        </p>
                        {ans.reason && (
                          <p className="report-text" style={{ margin: '0.25rem 0', fontSize: '0.85rem', color: '#666' }}>
                            <strong>根拠:</strong> {ans.reason}
                          </p>
                        )}
                      </div>
                    ))}
                    {dept.step2.discussionNotes && (
                      <div className="report-card">
                        <p style={{ margin: '0 0 0.25rem 0', fontWeight: '600' }}>議論メモ</p>
                        <p className="report-text">{dept.step2.discussionNotes}</p>
                      </div>
                    )}
                  </div>
                )}

                {/* ===== STEP3: 再生成結果 ===== */}
                <div style={{ marginTop: '1rem' }}>
                  <h4 className="report-h4">STEP3 再生成結果</h4>

                  {dept.step3.projectsAfterRegen.length > 0 && (
                    <div className="report-card">
                      <h5 style={{ margin: '0 0 0.5rem 0', fontSize: '0.9rem', fontWeight: '600' }}>
                        プロジェクト
                      </h5>
                      {dept.step3.projectsAfterRegen.map((proj, idx) => (
                        <div key={idx} style={{ marginBottom: '0.5rem', fontSize: '0.9rem' }}>
                          <p style={{ margin: '0 0 0.25rem 0', fontWeight: '600' }}>• {proj.title}</p>
                          {proj.hypothesis && (
                            <p style={{ margin: '0', fontSize: '0.85rem' }}>
                              仮説: {proj.hypothesis}
                            </p>
                          )}
                        </div>
                      ))}
                    </div>
                  )}

                  {dept.step3.correctedItems.length > 0 && (
                    <div className="report-card">
                      <p style={{ margin: '0 0 0.25rem 0', fontWeight: '600' }}>修正済事項</p>
                      <ul className="report-list">
                        {dept.step3.correctedItems.map((item, idx) => (
                          <li key={idx} style={{ fontSize: '0.85rem' }}>
                            {item}
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}

                  {dept.step3.reconsiderationPoints.length > 0 && (
                    <div className="report-card">
                      <p style={{ margin: '0 0 0.25rem 0', fontWeight: '600' }}>再考ポイント</p>
                      <ul className="report-list">
                        {dept.step3.reconsiderationPoints.map((item, idx) => (
                          <li key={idx} style={{ fontSize: '0.85rem' }}>
                            {item}
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}

                  {dept.step3.riskNotes.length > 0 && (
                    <div className="report-card">
                      <p style={{ margin: '0 0 0.25rem 0', fontWeight: '600' }}>主要リスク</p>
                      <ul className="report-list">
                        {dept.step3.riskNotes.map((item, idx) => (
                          <li key={idx} style={{ fontSize: '0.85rem' }}>
                            {item}
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}

                  {dept.step3.stopList.length > 0 && (
                    <div className="report-card">
                      <p style={{ margin: '0 0 0.25rem 0', fontWeight: '600' }}>やめる・諦める項目</p>
                      <ul className="report-list">
                        {dept.step3.stopList.map((item, idx) => (
                          <li key={idx} style={{ fontSize: '0.85rem' }}>
                            {item}
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}

                  {dept.step3.first90Days.length > 0 && (
                    <div className="report-card">
                      <p style={{ margin: '0 0 0.25rem 0', fontWeight: '600' }}>最初の90日アクション</p>
                      <ul className="report-list">
                        {dept.step3.first90Days.map((item, idx) => (
                          <li key={idx} style={{ fontSize: '0.85rem' }}>
                            {item}
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                </div>

                {/* ===== STEP4: 最終調整 ===== */}
                <div style={{ marginTop: '1rem' }}>
                  <h4 className="report-h4">STEP4 最終調整</h4>

                  <div className="report-card">
                    <p style={{ margin: '0 0 0.25rem 0', fontWeight: '600' }}>最終ミッション</p>
                    <p className="report-text">{dept.step4.finalMission || '（未入力）'}</p>

                    {dept.step4.finalStrategy && (
                      <>
                        <p style={{ margin: '0.5rem 0 0.25rem 0', fontWeight: '600' }}>最終戦略</p>
                        <p className="report-text">{dept.step4.finalStrategy}</p>
                      </>
                    )}
                  </div>

                  {dept.step4.finalProjects.length > 0 && (
                    <div style={{ marginTop: '0.5rem' }}>
                      <h5 style={{ margin: '0 0 0.25rem 0', fontSize: '0.9rem', fontWeight: '600' }}>
                        最終プロジェクト
                      </h5>
                      {dept.step4.finalProjects.map((proj, idx) => (
                        <div key={idx} className="report-card" style={{ padding: '0.5rem' }}>
                          <p style={{ margin: '0 0 0.25rem 0', fontWeight: '600' }}>• {proj.title}</p>
                          {proj.hypothesis && (
                            <p style={{ margin: '0', fontSize: '0.85rem' }}>
                              <strong>仮説:</strong> {proj.hypothesis}
                            </p>
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                {deptIdx < data.departments.length - 1 && (
                  <div style={{ margin: '2rem 0', borderTop: '2px solid #d0d0d0' }} />
                )}
              </div>
            ))}
          </div>
        </>
      )}

      {/* ===== 部門横断的事項 ===== */}
      {data.crossDepartmentIssues.length > 0 && (
        <>
          <PageBreak />
          <div className="report-section">
            <h2 className="report-h2">部門横断的事項</h2>

            <div>
              <h3 className="report-h3">部門間の連携・確認事項</h3>
              <ul className="report-list">
                {data.crossDepartmentIssues.map((issue, idx) => (
                  <li key={idx}>{issue}</li>
                ))}
              </ul>
            </div>
          </div>
        </>
      )}

      {/* ===== フッター ===== */}
      <ConfidentialFooter />
    </PdfReportWrapper>
  );
}
