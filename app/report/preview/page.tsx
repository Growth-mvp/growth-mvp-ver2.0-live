/**
 * /app/report/preview/page.tsx
 *
 * 目的：
 * - 戦略実行レポートのプレビュー画面
 * - StrategyStore から data を取得して表示
 * - PDF出力（print）ボタン付き
 * - 既存のSTAGE画面とは独立
 */

'use client';

import React, { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useStrategyStore } from '@/store/strategyStore';
import { useUserStore } from '@/store/userStore';
import {
  buildStrategyReportData,
  type ReportData,
} from '@/utils/export/buildStrategyReportData';
import { StrategyReportView } from '@/components/export/StrategyReportView';
import { StagePdfExportButton } from '@/components/export/StagePdfExportButton';
import { useFullStrategyPdfExport } from '@/hooks/useFullStrategyPdfExport';
import StrategyGuard from '@/app/StrategyGuard';
import { AlertCircle, ArrowLeft } from 'lucide-react';

/**
 * レポートプレビューページ
 */
export default function ReportPreviewPage() {
  // ===== State =====
  const router = useRouter();
  const [reportData, setReportData] = useState<ReportData | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // ===== Store & Hooks =====
  const strategyState = useStrategyStore();
  const companyId = useUserStore((s) => s.companyId);
  const { exportToPdf: fullStrategyExportToPdf } = useFullStrategyPdfExport();

  // ===== Effects =====

  /**
   * Store データからレポートデータを生成
   */
  useEffect(() => {
    const generate = () => {
      try {
        setIsLoading(true);
        setError(null);

        // StrategyStore の状態をスナップショットで取得
        const state = useStrategyStore.getState();

        // データが不足している場合のチェック
        if (!state.companyName && !state.mission) {
          setError(
            'レポートを生成するには、最低限「会社名」と「ミッション」が必要です。',
          );
          setIsLoading(false);
          return;
        }

        // データビルダーを呼び出し
        const data = buildStrategyReportData(state);
        setReportData(data);
        setIsLoading(false);
      } catch (err) {
        const message = err instanceof Error ? err.message : '不明なエラー';
        setError(`レポート生成エラー: ${message}`);
        setIsLoading(false);
      }
    };

    generate();
  }, []);

  // ===== Handlers =====

  const handleBack = () => {
    router.back();
  };

  // ===== Render =====

  return (
    <StrategyGuard>
      <div style={{ backgroundColor: '#f5f5f5', minHeight: '100vh' }}>
        {/* ===== ツールバー ===== */}
        <div
          style={{
            position: 'sticky',
            top: 0,
            backgroundColor: 'white',
            borderBottom: '1px solid #e0e0e0',
            padding: '1rem',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            zIndex: 100,
            boxShadow: '0 2px 4px rgba(0,0,0,0.05)',
          }}
          className="no-print"
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
            <button
              onClick={handleBack}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '0.5rem',
                background: 'none',
                border: 'none',
                cursor: 'pointer',
                color: '#666',
                padding: '0.5rem',
                borderRadius: '4px',
              }}
              onMouseOver={(e) => {
                e.currentTarget.style.backgroundColor = '#f0f0f0';
              }}
              onMouseOut={(e) => {
                e.currentTarget.style.backgroundColor = 'transparent';
              }}
              title="戻る"
            >
              <ArrowLeft size={20} />
            </button>
            <h1
              style={{
                margin: 0,
                fontSize: '1.25rem',
                fontWeight: '600',
                color: '#333',
              }}
            >
              戦略実行レポート プレビュー
            </h1>
          </div>

          <div style={{ display: 'flex', gap: '0.5rem' }}>
            <StagePdfExportButton
              exportToPdf={fullStrategyExportToPdf}
            />
          </div>
        </div>

        {/* ===== コンテンツ ===== */}
        <div
          style={{
            padding: '2rem',
            maxWidth: '900px',
            margin: '0 auto',
          }}
        >
          {/* ローディング */}
          {isLoading && (
            <div
              style={{
                textAlign: 'center',
                padding: '3rem',
                color: '#999',
              }}
            >
              <div
                style={{
                  fontSize: '1.1rem',
                  marginBottom: '1rem',
                }}
              >
                レポートを生成中...
              </div>
              <div
                style={{
                  width: '40px',
                  height: '40px',
                  border: '4px solid #f0f0f0',
                  borderTop: '4px solid #333',
                  borderRadius: '50%',
                  animation: 'spin 1s linear infinite',
                  margin: '0 auto',
                }}
              />
              <style jsx>{`
                @keyframes spin {
                  from {
                    transform: rotate(0deg);
                  }
                  to {
                    transform: rotate(360deg);
                  }
                }
              `}</style>
            </div>
          )}

          {/* エラー */}
          {error && !isLoading && (
            <div
              style={{
                padding: '1.5rem',
                backgroundColor: '#fff3cd',
                border: '1px solid #ffc107',
                borderRadius: '8px',
                display: 'flex',
                gap: '1rem',
                alignItems: 'flex-start',
              }}
            >
              <AlertCircle size={24} color="#ff9800" style={{ flexShrink: 0 }} />
              <div>
                <div
                  style={{
                    fontWeight: '600',
                    color: '#333',
                    marginBottom: '0.25rem',
                  }}
                >
                  レポート生成に失敗しました
                </div>
                <div style={{ color: '#666', fontSize: '0.95rem' }}>
                  {error}
                </div>
                <button
                  onClick={handleBack}
                  style={{
                    marginTop: '1rem',
                    padding: '0.5rem 1rem',
                    backgroundColor: '#ff9800',
                    color: 'white',
                    border: 'none',
                    borderRadius: '4px',
                    cursor: 'pointer',
                    fontSize: '0.9rem',
                  }}
                >
                  戻る
                </button>
              </div>
            </div>
          )}

          {/* レポート表示 */}
          {reportData && !isLoading && (
            <StrategyReportView data={reportData} />
          )}
        </div>
      </div>
    </StrategyGuard>
  );
}
