/**
 * /app/report/midterm-plan/page.tsx
 *
 * 中計戦略書プレビュー画面
 * STAGE1〜4のデータを統合し、6章構成で表示する読み取り専用ページ
 */

'use client';

import React, { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useStrategyStore } from '@/store/strategyStore';
import StrategyGuard from '@/app/StrategyGuard';
import { buildMidtermPlanData, type MidtermPlanData } from '@/utils/export/buildMidtermPlanData';
import { MidtermPlanPreview } from '@/components/export/MidtermPlanPreview';
import { AlertCircle, ArrowLeft } from 'lucide-react';

export default function MidtermPlanPage() {
  const router = useRouter();
  const [planData, setPlanData] = useState<MidtermPlanData | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const generate = () => {
      try {
        setIsLoading(true);
        setError(null);

        const state = useStrategyStore.getState();

        // 最低限のデータチェック
        if (!state.companyName && !state.mission) {
          setError(
            '中計戦略書を生成するには、最低限「会社名」と「ミッション」が必要です。STAGE1をご確認ください。'
          );
          setIsLoading(false);
          return;
        }

        const data = buildMidtermPlanData(state);
        setPlanData(data);
        setIsLoading(false);
      } catch (err) {
        const message = err instanceof Error ? err.message : '不明なエラー';
        setError(`中計戦略書生成エラー: ${message}`);
        setIsLoading(false);
      }
    };

    generate();
  }, []);

  const handleBack = () => {
    router.back();
  };

  return (
    <StrategyGuard>
      <div style={{ backgroundColor: '#f5f5f5', minHeight: '100vh' }}>
        {/* ツールバー */}
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
            zIndex: 50,
          }}
        >
          <div>
            <h1 style={{ fontSize: '1.5rem', fontWeight: 'bold', color: '#1f2937' }}>
              中計戦略書プレビュー
            </h1>
            <p style={{ fontSize: '0.875rem', color: '#6b7280', marginTop: '0.25rem' }}>
              STAGE1〜4で整理した内容を統合し、中期経営計画のたたき台として確認します。
            </p>
          </div>
          <button
            onClick={handleBack}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '0.5rem',
              padding: '0.5rem 1rem',
              border: '1px solid #d1d5db',
              borderRadius: '0.375rem',
              backgroundColor: '#f9fafb',
              color: '#374151',
              fontSize: '0.875rem',
              fontWeight: '500',
              cursor: 'pointer',
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.backgroundColor = '#f3f4f6';
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.backgroundColor = '#f9fafb';
            }}
          >
            <ArrowLeft size={16} />
            戻る
          </button>
        </div>

        {/* コンテンツ */}
        <div style={{ padding: '2rem', maxWidth: '900px', margin: '0 auto' }}>
          {isLoading && (
            <div style={{ textAlign: 'center', padding: '2rem' }}>
              <div
                style={{
                  display: 'inline-block',
                  animation: 'spin 1s linear infinite',
                  marginBottom: '1rem',
                }}
              >
                ⏳
              </div>
              <p style={{ color: '#6b7280' }}>中計戦略書を生成中です...</p>
              <style>{`@keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }`}</style>
            </div>
          )}

          {error && (
            <div
              style={{
                backgroundColor: '#fef2f2',
                border: '1px solid #fecaca',
                borderRadius: '0.5rem',
                padding: '1rem',
                display: 'flex',
                gap: '0.75rem',
              }}
            >
              <AlertCircle size={20} style={{ color: '#dc2626', flexShrink: 0, marginTop: '0.125rem' }} />
              <div>
                <h3 style={{ fontSize: '0.875rem', fontWeight: '600', color: '#7f1d1d' }}>
                  中計戦略書を生成できませんでした
                </h3>
                <p style={{ fontSize: '0.875rem', color: '#991b1b', marginTop: '0.25rem' }}>{error}</p>
              </div>
            </div>
          )}

          {!isLoading && !error && planData && (
            <div
              style={{
                backgroundColor: 'white',
                borderRadius: '0.5rem',
                padding: '2rem',
                boxShadow: '0 1px 3px rgba(0,0,0,0.1)',
              }}
            >
              <MidtermPlanPreview data={planData} />
            </div>
          )}
        </div>
      </div>
    </StrategyGuard>
  );
}
