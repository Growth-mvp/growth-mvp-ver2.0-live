'use client';

import React from 'react';
import { useParams } from 'next/navigation';
import { useUserStore } from '@/store/userStore';
import StrategyGuard from '@/app/StrategyGuard';
import type { AudienceType } from '@/utils/export/buildPlanData';
import PlanPreview from '@/components/export/PlanPreview';
import PlanStatusBar from '@/components/export/PlanStatusBar';
import PlanSourceNotice from '@/components/export/PlanSourceNotice';
import { usePlanDocument } from '@/hooks/usePlanDocument';
import { usePlanSource } from '@/hooks/usePlanSource';
import { useStrategyStore } from '@/store/strategyStore';
import Link from 'next/link';

/**
 * /app/report/[audience]-plan/page.tsx
 *
 * ステークホルダー別計画書の共通ページ（bank / shareholder / employee）
 * - 元データ（会社・戦略）の読み込み状態に応じた表示
 * - 保存済み計画書の復元、AI本文の生成・再生成（権限に応じて表示）
 * - PlanPreview での統合表示
 */

export default function PlanPreviewPage() {
  const params = useParams();
  const audience = (params?.audience as AudienceType) || 'bank';

  // ✅ Zustand ストア全体を取得（selector が状態の参照を保持）
  const strategyState = useStrategyStore((state) => state);
  const role = useUserStore((state) => state.role);
  const source = usePlanSource(audience);

  const plan = usePlanDocument(
    {
      companyId: strategyState.companyId,
      strategyId: strategyState.strategyId,
      audience,
    },
    role
  );

  if (source.status === 'loading') {
    return (
      <StrategyGuard>
        <div className="flex items-center justify-center min-h-screen">
          <div className="text-center">
            <div className="animate-spin mb-4">⏳</div>
            <p className="text-gray-600">計画書を準備中...</p>
          </div>
        </div>
      </StrategyGuard>
    );
  }

  if (source.status === 'missing' || source.status === 'error') {
    return (
      <StrategyGuard>
        <PlanSourceNotice
          status={source.status}
          message={source.status === 'error' ? source.message : undefined}
        />
      </StrategyGuard>
    );
  }

  return (
    <StrategyGuard>
      <div className="min-h-screen bg-gray-50">
        {/* ツールバー */}
        <div className="bg-white border-b sticky top-0 z-10">
          <div className="max-w-6xl mx-auto px-6 py-4 flex items-center justify-between">
            <div>
              <Link
                href="/report"
                className="text-blue-600 hover:text-blue-700 underline text-sm mb-2 inline-block"
              >
                ← 戻る
              </Link>
              <h1 className="text-2xl font-bold text-gray-900">
                ステークホルダー別計画書
              </h1>
            </div>
            <div className="flex gap-3">
              <button
                onClick={() => window.print()}
                className="bg-gray-600 hover:bg-gray-700 text-white px-4 py-2 rounded font-semibold"
              >
                📥 PDFダウンロード
              </button>
            </div>
          </div>
        </div>

        <div className="max-w-6xl mx-auto px-6 py-6 space-y-5">
          <PlanStatusBar
            doc={plan.doc}
            isRestoring={plan.isRestoring}
            isGenerating={plan.isGenerating}
            error={plan.error}
            canGenerate={plan.canGenerate}
            onGenerate={plan.generate}
            onCopy={plan.copyText}
            onDownload={plan.downloadMarkdown}
          />

          {/* プレビューコンポーネント */}
          <PlanPreview
            data={source.planData}
            audience={audience}
            generatedSections={plan.doc?.sections}
            generatedAt={plan.doc?.generatedAt ?? null}
          />
        </div>
      </div>
    </StrategyGuard>
  );
}
