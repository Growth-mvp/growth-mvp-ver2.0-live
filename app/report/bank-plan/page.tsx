'use client';

import React from 'react';
import { useUserStore } from '@/store/userStore';
import StrategyGuard from '@/app/StrategyGuard';
import PlanPreview from '@/components/export/PlanPreview';
import PlanStatusBar from '@/components/export/PlanStatusBar';
import PlanSourceNotice from '@/components/export/PlanSourceNotice';
import { usePlanDocument } from '@/hooks/usePlanDocument';
import { usePlanSource } from '@/hooks/usePlanSource';
import { useStrategyStore } from '@/store/strategyStore';
import Link from 'next/link';

/**
 * /app/report/bank-plan/page.tsx
 * 銀行向け経営計画書プレビューページ
 */

export default function BankPlanPage() {
  const audience = 'bank' as const;

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
      <div className="min-h-screen bg-slate-100 print:bg-white">
        <div className="sticky top-0 z-10 border-b border-slate-200 bg-white/95 shadow-sm backdrop-blur print:hidden">
          <div className="mx-auto flex w-full max-w-[1480px] flex-wrap items-center justify-between gap-4 px-4 py-4 sm:px-6 lg:px-10">
            <div>
              <Link
                href="/report"
                className="mb-1 inline-block text-sm font-medium text-blue-700 hover:text-blue-900 hover:underline"
              >
                ← 戻る
              </Link>
              <h1 className="text-xl font-bold tracking-tight text-slate-900 sm:text-2xl">
                銀行向け経営計画書
              </h1>
            </div>
            <div className="flex flex-wrap items-center gap-3">
              <button
                onClick={() => window.print()}
                className="rounded-lg bg-slate-800 px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-slate-900"
              >
                📥 PDFダウンロード
              </button>
            </div>
          </div>
        </div>

        <div className="mx-auto w-full max-w-[1240px] min-w-0 space-y-5 px-3 py-5 sm:px-6 sm:py-8 lg:px-8 print:max-w-none print:p-0">
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

          <div className="min-w-0 [&_table]:w-full [&_table]:border-collapse [&_table]:text-sm [&_th]:bg-slate-100 [&_th]:font-semibold [&_th]:text-slate-800 [&_td]:align-top [&_th]:align-top [&_th]:px-3 [&_td]:px-3 [&_th]:py-2 [&_td]:py-2 [&_tr]:border-b [&_tr]:border-slate-200">
            <PlanPreview
              data={source.planData}
              audience={audience}
              generatedSections={plan.doc?.sections}
              generatedAt={plan.doc?.generatedAt ?? null}
            />
          </div>
        </div>
      </div>
    </StrategyGuard>
  );
}
