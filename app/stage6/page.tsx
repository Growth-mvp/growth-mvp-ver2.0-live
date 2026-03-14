'use client';
import StrategyGuard from '@/app/StrategyGuard';

import { AlertCircle } from 'lucide-react';

import { useAutoSave } from '@/hooks/useAutoSave';
import SaveStatusIndicator from '@/components/SaveStatusIndicator';

import { TabImpact } from '@/components/stage6/TabImpact';
import { TabValueDashboard } from '@/components/stage6/TabValue.dashboard';
import { useProjectFilters } from '@/components/stage6/hooks/useProjectFilters';
import { useStage6Data } from '@/components/stage6/hooks/useStage6Data';

function Stage6PageContent() {
  const stage6 = useStage6Data('base');

  const projectFilters = useProjectFilters({
    core: stage6.core,
    projectContrib: stage6.projectContrib,
  });

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
      <div className="mx-auto max-w-7xl px-4 pb-12 pt-8 md:px-6 md:pt-10 space-y-6">
        <header>

          <div className="mt-2 flex flex-col gap-2 md:flex-row md:items-end md:justify-between">
            <div>
              <h1 className="text-2xl font-bold">STAGE6｜業績シミュレーション</h1>
              <p className="mt-1 text-sm text-slate-600">
                会社業績目標に対する進捗、プロジェクト寄与、次アクションを確認します。
              </p>

            </div>
            <SaveStatusIndicator />
          </div>
        </header>

        {stage6.core.error && (
          <div className="flex gap-3 rounded-lg border border-amber-200 bg-amber-50 p-4">
            <AlertCircle className="mt-0.5 h-5 w-5 flex-shrink-0 text-amber-700" />
            <div className="text-sm text-amber-800">{stage6.core.error}</div>
          </div>
        )}

        <TabValueDashboard
          northStarRows={stage6.northStarRows}
          dashboardSummary={stage6.dashboardSummary}
          fourMetricCards={stage6.fourMetricCards}
        />

        <TabImpact
          projectContrib={stage6.projectContrib as any}
          core={stage6.core}
          deptFilter={projectFilters.deptFilter}
          setDeptFilter={projectFilters.setDeptFilter}
          selectedProjectKeys={projectFilters.selectedProjectKeys}
          selectedSet={projectFilters.selectedSet}
          selectedSummary={projectFilters.selectedSummary}
          toggleProject={projectFilters.toggleProject}
          selectAllFiltered={projectFilters.selectAllFiltered}
          clearAllFiltered={projectFilters.clearAllFiltered}
          revenueGapMJPY={stage6.dashboardSummary?.revenue.gap}
          opGapMJPY={stage6.dashboardSummary?.op.gap}
          topRevenueProjects={stage6.dashboardSummary?.topRevenueProjects as any}
          topOpProjects={stage6.dashboardSummary?.topOpProjects as any}
        />
      </div>
    </main>
  );
}

export default function Stage6Page() {
  return (
    <StrategyGuard>
      <Stage6PageContent />
    </StrategyGuard>
  );
}
