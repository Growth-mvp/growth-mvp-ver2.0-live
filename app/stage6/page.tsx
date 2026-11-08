'use client';

import StrategyGuard from '@/app/StrategyGuard';
import { AlertCircle } from 'lucide-react';

import { useAutoSave } from '@/hooks/useAutoSave';

import { useStage6Data } from '@/components/stage6/hooks/useStage6Data';
import { FinancePlanSection } from '@/components/stage6/FinancePlanSection';

function Stage6PageContent() {
  const stage6 = useStage6Data('base') as any;

  useAutoSave({
    enabled: !stage6.isHydrating,
    requireHydrated: true,
    requireSession: true,
    debounceMs: 1200,
    minIntervalMs: 1500,
    mode: 'payload',
  });

  if (!stage6.hydrated || stage6.isHydrating) {
    return (
      <main className="min-h-screen bg-slate-50 flex items-center justify-center">
        <div className="text-center">
          <div className="text-lg font-semibold text-slate-900">データ読込中...</div>
          <div className="mt-2 text-sm text-slate-600">STAGE6を初期化しています</div>
        </div>
      </main>
    );
  }

  if (!stage6.isReady) {
    return (
      <main className="min-h-screen bg-slate-50 flex items-center justify-center">
        <div className="rounded-lg border border-amber-200 bg-amber-50 p-6 max-w-md">
          <div className="flex gap-3">
            <AlertCircle className="h-5 w-5 flex-shrink-0 text-amber-700 mt-0.5" />
            <div>
              <h2 className="font-semibold text-amber-900">データ準備ができていません</h2>
              <p className="mt-1 text-sm text-amber-800">{stage6.error}</p>
              <p className="mt-2 text-xs text-amber-700">
                STAGE1で財務データを入力し、STAGE4でプロジェクト計画を設定してください。
              </p>
            </div>
          </div>
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-slate-50 text-slate-900">
      <div className="mx-auto max-w-7xl space-y-4 px-4 pb-12 pt-5 md:px-6 md:pt-6">
        <header>
          <h1 className="text-xl font-bold tracking-tight text-gray-900">STAGE6｜成果を確かめる</h1>
          <p className="mt-1 text-sm text-gray-600 break-keep">
            経営目標に対して、施策効果を反映した試算と資金の状況を確認します。
          </p>
        </header>

        {stage6.core.error && (
          <div className="flex gap-3 rounded-lg border border-amber-200 bg-amber-50 p-4">
            <AlertCircle className="mt-0.5 h-5 w-5 flex-shrink-0 text-amber-700" />
            <div className="text-sm text-amber-800">{stage6.core.error}</div>
          </div>
        )}

        <FinancePlanSection />
      </div>
    </main>
  );
}

export default function Stage6Page() {
  return (
    <StrategyGuard mode="view" showReadOnlyBanner={false}>
      <Stage6PageContent />
    </StrategyGuard>
  );
}
