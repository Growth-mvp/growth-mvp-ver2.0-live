/**
 * /app/report/stage2-strategy/page.tsx
 *
 * STAGE2 全社戦略書プレビュー画面
 * STAGE2画面と同じ StrategyStoryPreview コンポーネントを使用
 * mode="pdf" で PDF化可能な形式で表示
 */

'use client';

import React, { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useStrategyStore } from '@/store/strategyStore';
import StrategyGuard from '@/app/StrategyGuard';
import { StrategyStoryPreview } from '@/components/stage2/StrategyStoryPreview';
import { pickFinancialTargets, toConfirmedEdits } from '@/lib/stage2/finalDocument';
import { AlertCircle, ArrowLeft, Download } from 'lucide-react';

const NO_CHAPTERS: never[] = [];

export default function Stage2StrategyPage() {
  const router = useRouter();
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isExporting, setIsExporting] = useState(false);

  // Zustand selector を個別に分ける（無限ループ防止）
  const companyName = useStrategyStore((s: any) => s.companyName);
  const finalStoryFinal = useStrategyStore((s: any) => s.finalStoryFinal);
  const finalStoryEdited = useStrategyStore((s: any) => s.finalStoryEdited);
  const finalStoryDraft = useStrategyStore((s: any) => s.finalStoryDraft);
  const finalStory = useStrategyStore((s: any) => s.finalStory);
  const companyTargets = useStrategyStore((s: any) => s.companyTargets);
  const midtermStrategy = useStrategyStore((s: any) => s.midtermStrategy);
  const stage2FinalDocumentEdits = useStrategyStore((s: any) => s.stage2FinalDocumentEdits);
  const stage2FinalGeneratedConclusion = useStrategyStore((s: any) => s.stage2FinalGeneratedConclusion);
  const strength = useStrategyStore((s: any) => s.strength ?? '');
  const weakness = useStrategyStore((s: any) => s.weakness ?? '');
  const opportunity = useStrategyStore((s: any) => s.opportunity ?? '');
  const threat = useStrategyStore((s: any) => s.threat ?? '');
  const swotSuggestions = useStrategyStore((s: any) => s.swotSuggestions);

  // 優先順位：finalStoryFinal > finalStoryEdited > finalStoryDraft > finalStory
  const finalStoryToUse = [finalStoryFinal, finalStoryEdited, finalStoryDraft, finalStory].find(
    (chapters) => Array.isArray(chapters) && chapters.length > 0,
  ) ?? NO_CHAPTERS;
  const finalized = !!(finalStoryFinal && finalStoryFinal.length > 0);
  // 確定版の表示は確定時のスナップショットを使い、確定後の未確定の編集は含めない
  const documentEdits = finalized ? toConfirmedEdits(stage2FinalDocumentEdits) : stage2FinalDocumentEdits;
  const aiGeneratedConclusion = stage2FinalDocumentEdits?.confirmed ? undefined : stage2FinalGeneratedConclusion;
  const financialTargets = useMemo(() => pickFinancialTargets(companyTargets), [companyTargets]);
  const swotData = useMemo(
    () => ({
      strengths: strength ? [strength] : [],
      weaknesses: weakness ? [weakness] : [],
      opportunities: opportunity ? [opportunity] : [],
      threats: threat ? [threat] : [],
    }),
    [strength, weakness, opportunity, threat],
  );

  useEffect(() => {
    try {
      setError(null);

      // 最低限のデータチェック
      if (!companyName) {
        setError('全社戦略書を表示するには、会社名が必要です。');
        setIsLoading(false);
        return;
      }

      if (!finalStoryToUse || !Array.isArray(finalStoryToUse) || finalStoryToUse.length === 0) {
        setError('全社戦略書を表示するには、STAGE2で最終ストーリーを生成・確定してください。');
        setIsLoading(false);
        return;
      }

      setIsLoading(false);
    } catch (err) {
      const message = err instanceof Error ? err.message : '不明なエラー';
      setError(`全社戦略書の確認に失敗しました: ${message}`);
      setIsLoading(false);
    }
  }, [companyName, finalStoryToUse]);

  const handleBack = () => {
    router.back();
  };

  const handleExportPdf = async () => {
    setIsExporting(true);
    try {
      const { downloadPdfFromElement, generatePdfFileName } = await import(
        '@/utils/export/downloadPdf'
      );

      const fileName = generatePdfFileName(2, '全社戦略書');
      await downloadPdfFromElement('stage2-strategy-report', fileName, {
        margin: [10, 10, 10, 10],
        jsPDF: {
          orientation: 'p',
          unit: 'mm',
          format: 'a4',
        },
        image: { type: 'jpeg', quality: 0.92 },
        avoidBreakSelector: 'p, li, tr, h2, h3',
      });
    } catch (err) {
      console.error('PDF出力エラー:', err);
      alert('PDFの出力に失敗しました');
    } finally {
      setIsExporting(false);
    }
  };

  return (
    <StrategyGuard>
      <div style={{ backgroundColor: '#f3f4f6', minHeight: '100vh', display: 'flex', flexDirection: 'column' }}>
        {/* ツールバー */}
        <div
          style={{
            position: 'sticky',
            top: 0,
            backgroundColor: 'white',
            borderBottom: '1px solid #e5e7eb',
            padding: '1rem 1.5rem',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            zIndex: 50,
          }}
        >
          <div>
            <h1 style={{ fontSize: '1.5rem', fontWeight: 'bold', color: '#0f172a' }}>
              全社戦略書プレビュー
            </h1>
            <p style={{ fontSize: '0.875rem', color: '#6b7280', marginTop: '0.25rem' }}>
              STAGE2で確定した全社戦略の内容を、戦略書として確認・PDF出力できます。
            </p>
          </div>
          <div style={{ display: 'flex', gap: '0.75rem' }}>
            <button
              onClick={handleExportPdf}
              disabled={!finalStoryToUse || isExporting}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '0.5rem',
                padding: '0.75rem 1.25rem',
                border: 'none',
                borderRadius: '0.375rem',
                backgroundColor: isExporting ? '#d1d5db' : '#2563eb',
                color: 'white',
                fontSize: '0.875rem',
                fontWeight: '600',
                cursor: isExporting ? 'not-allowed' : 'pointer',
                opacity: isExporting ? 0.6 : 1,
              }}
            >
              <Download size={16} />
              {isExporting ? '出力中...' : 'PDF出力'}
            </button>
            <button
              onClick={handleBack}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '0.5rem',
                padding: '0.75rem 1.25rem',
                border: '1px solid #d1d5db',
                borderRadius: '0.375rem',
                backgroundColor: '#f9fafb',
                color: '#374151',
                fontSize: '0.875rem',
                fontWeight: '600',
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
        </div>

        {/* メインコンテンツ */}
        <div style={{ flex: 1, display: 'flex', justifyContent: 'center', padding: '2rem 1rem', overflowY: 'auto' }}>
          {isLoading && (
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '1rem', color: '#6b7280' }}>
              <div style={{ fontSize: '1rem' }}>読み込み中...</div>
            </div>
          )}

          {error && (
            <div style={{ maxWidth: '600px', width: '100%' }}>
              <div
                style={{
                  backgroundColor: '#fecaca',
                  border: '1px solid #fca5a5',
                  borderRadius: '0.375rem',
                  padding: '1rem',
                  display: 'flex',
                  gap: '1rem',
                }}
              >
                <AlertCircle size={20} style={{ color: '#dc2626', flexShrink: 0, marginTop: '0.125rem' }} />
                <div>
                  <p style={{ fontWeight: '600', color: '#991b1b', margin: 0 }}>
                    全社戦略書を表示できません
                  </p>
                  <p style={{ color: '#7f1d1d', margin: '0.5rem 0 0 0', fontSize: '0.875rem' }}>
                    {error}
                  </p>
                </div>
              </div>
            </div>
          )}

          {finalStoryToUse && !isLoading && !error && (
            <div
              id="stage2-strategy-report"
              style={{
                width: '100%',
                maxWidth: '794px',
                backgroundColor: 'white',
                boxShadow: '0 1px 3px rgba(0,0,0,0.1)',
                borderRadius: '0.375rem',
              }}
            >
              <div style={{ padding: '40px' }}>
                <StrategyStoryPreview
                  story={finalStoryToUse}
                  finalized={finalized}
                  companyName={companyName}
                  midtermStrategy={documentEdits?.midtermStrategy ?? midtermStrategy}
                  financialTargets={financialTargets}
                  swotSuggestions={swotSuggestions}
                  swotData={swotData}
                  conclusionDraft={documentEdits?.conclusion}
                  assumptionsDraft={documentEdits?.assumptions}
                  aiGeneratedConclusion={aiGeneratedConclusion}
                  mode="pdf"
                />
              </div>
            </div>
          )}
        </div>
      </div>
    </StrategyGuard>
  );
}
