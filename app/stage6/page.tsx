'use client';
import StrategyGuard from '@/app/StrategyGuard';

import { useCallback, useState } from 'react';
import { AlertCircle } from 'lucide-react';

import { useAutoSave } from '@/hooks/useAutoSave';
import { useStrategyStore, type StrategyState } from '@/store/strategyStore';
import SaveStatusIndicator from '@/components/SaveStatusIndicator';

import { TabImpact } from '@/components/stage6/TabImpact';
import { TabNorthStar } from '@/components/stage6/TabNorthStar';
import { TabValueDashboard } from '@/components/stage6/TabValue.dashboard';
import { useProjectFilters } from '@/components/stage6/hooks/useProjectFilters';
import { useStage6Data } from '@/components/stage6/hooks/useStage6Data';

function Stage6PageContent() {
  const [scenarioKey, setScenarioKey] = useState<'low' | 'base' | 'high'>('base');
  const [showDetails, setShowDetails] = useState(false);

  const stage6 = useStage6Data(scenarioKey);

  const projectTargetImpacts = useStrategyStore((s: StrategyState) => s.projectTargetImpacts ?? []);
  const {
    addProjectTargetImpact,
    updateProjectTargetImpact,
    removeProjectTargetImpact,
  } = useStrategyStore();

  const handleUpdateImpact = useCallback(
    (projectId: string, targetId: string, delta: number, notes?: string) => {
      const existing = projectTargetImpacts.find(
        (imp: any) => imp.projectId === projectId && imp.targetId === targetId
      );
      if (existing) {
        updateProjectTargetImpact(projectId, targetId, { delta, notes });
      } else {
        addProjectTargetImpact({ projectId, targetId, delta, notes });
      }
    },
    [projectTargetImpacts, updateProjectTargetImpact, addProjectTargetImpact]
  );

  const handleRemoveImpact = useCallback(
    (projectId: string, targetId: string) => {
      removeProjectTargetImpact(projectId, targetId);
    },
    [removeProjectTargetImpact]
  );

  const projectFilters = useProjectFilters({
    core: stage6.core,
    selectedYearly: {
      base: stage6.core.yearlyAll?.base ?? [],
    },
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
          <p className="text-[11px] uppercase tracking-[0.25em] text-slate-400">STAGE 6 / VALUE VALIDATION</p>
          <div className="mt-2 flex flex-col gap-2 md:flex-row md:items-end md:justify-between">
            <div>
              <h1 className="text-3xl font-bold tracking-tight">価値検証（進捗・寄与・次アクション）</h1>
              <p className="mt-1 text-sm text-slate-600">{stage6.companyName}</p>
            </div>
            <div className="flex items-center gap-4">
              <SaveStatusIndicator />
              <div className="flex gap-2">
                {(['low', 'base', 'high'] as const).map((scen) => (
                  <button
                    key={scen}
                    onClick={() => setScenarioKey(scen)}
                    className={`rounded-lg px-3 py-1.5 text-sm font-medium transition ${
                      scenarioKey === scen
                        ? 'bg-slate-900 text-white'
                        : 'border border-slate-300 text-slate-600 hover:bg-slate-50'
                    }`}
                  >
                    {scen === 'low' ? '悲観' : scen === 'base' ? '基準' : '楽観'}
                  </button>
                ))}
              </div>
            </div>
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
          projectContrib={stage6.projectContrib}
          vaCards={stage6.vaCards}
        />

        <TabImpact
          projectContrib={stage6.projectContrib}
          core={stage6.core}
          deptFilter={projectFilters.deptFilter}
          setDeptFilter={projectFilters.setDeptFilter}
          selectedProjectKeys={projectFilters.selectedProjectKeys}
          selectedSet={projectFilters.selectedSet}
          selectedSummary={projectFilters.selectedSummary}
          toggleProject={projectFilters.toggleProject}
          selectAllFiltered={projectFilters.selectAllFiltered}
          clearAllFiltered={projectFilters.clearAllFiltered}
        />

        <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
          <div className="flex items-center justify-between gap-4">
            <div>
              <h2 className="text-lg font-bold text-slate-900">詳細分析（必要な場合のみ）</h2>
              <p className="mt-1 text-[12px] text-slate-600">
                North Star への寄与を詳細に調整したい場合だけ開いてください。
              </p>
            </div>
            <button
              onClick={() => setShowDetails((v) => !v)}
              className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm hover:bg-slate-50"
            >
              {showDetails ? '閉じる' : '詳細を開く'}
            </button>
          </div>

          {showDetails && (
            <div className="mt-4">
              <TabNorthStar
                northStarRows={stage6.northStarRows}
                chartData={stage6.chartData}
                projectTargetImpacts={projectTargetImpacts}
                allProjectKeys={stage6.allProjectKeys}
                onUpdateImpact={handleUpdateImpact}
                onRemoveImpact={handleRemoveImpact}
              />
            </div>
          )}
        </section>
      </div>
    </main>
  );
}

export default function Stage6Page() {
  return (
    <StrategyGuard mode="view">
      <Stage6PageContent />
    </StrategyGuard>
  );
}
