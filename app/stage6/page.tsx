'use client';

import Link from 'next/link';
import StrategyGuard from '@/app/StrategyGuard';
import { AlertCircle } from 'lucide-react';

import { useAutoSave } from '@/hooks/useAutoSave';

import { TabImpact } from '@/components/stage6/TabImpact';
import { TabValueDashboard } from '@/components/stage6/TabValue.dashboard';
import { useProjectFilters } from '@/components/stage6/hooks/useProjectFilters';
import { useStage6Data } from '@/components/stage6/hooks/useStage6Data';

type ReviewCandidate = {
  key: string;
  dept: string;
  proj: string;
  reason: string;
  targetRevenueMJPY?: number;
  targetOpMJPY?: number;
  revenueContributionMJPY?: number;
  opContributionMJPY?: number;
  deltaRevenueMJPY?: number;
  deltaOpMJPY?: number;
  revenueAchievementRate?: number | null;
  opAchievementRate?: number | null;
  deptId?: string;
  projectId?: string;
};

function fmtMJPY(value?: number | null) {
  if (!Number.isFinite(value as any)) return '-';
  return `${Math.round(value as number).toLocaleString()} 百万円`;
}

function fmtPct(value?: number | null) {
  if (!Number.isFinite(value as any)) return '-';
  return `${Math.round(value as number)}%`;
}

function ReviewCandidatesSection({ reviewCandidates }: { reviewCandidates?: ReviewCandidate[] }) {
  const rows = Array.isArray(reviewCandidates) ? reviewCandidates.slice(0, 5) : [];

  if (rows.length === 0) {
    return (
      <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
        <div className="mb-2">
          <h2 className="text-lg font-bold text-slate-900">優先的に見直すプロジェクト</h2>
          <p className="mt-1 text-sm text-slate-600">
            目標額と寄与額の差、未入力項目、達成率から見直し候補を表示します。
          </p>
        </div>
        <div className="rounded-xl border border-slate-200 bg-slate-50 p-4 text-sm text-slate-600">
          現時点で優先的な見直し候補はありません。
        </div>
      </section>
    );
  }

  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
      <div className="mb-4">
        <h2 className="text-lg font-bold text-slate-900">優先的に見直すプロジェクト</h2>
        <p className="mt-1 text-sm text-slate-600">
          目標額に対して寄与が不足している案件や、入力が不足している案件を優先表示します。
        </p>
      </div>

      <div className="overflow-x-auto">
        <div className="min-w-[860px]">
          <div className="grid grid-cols-[1.6fr_1.2fr_1.1fr_1.1fr_1.1fr_160px] gap-3 rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-xs font-semibold text-slate-600">
            <div>プロジェクト</div>
            <div>見直し理由</div>
            <div className="text-right">売上 目標/寄与</div>
            <div className="text-right">営業利益 目標/寄与</div>
            <div className="text-right">達成率</div>
            <div className="text-center">操作</div>
          </div>

          <div className="mt-2 space-y-2">
            {rows.map((row) => {
              const revenueValue = row.revenueContributionMJPY ?? row.deltaRevenueMJPY;
              const opValue = row.opContributionMJPY ?? row.deltaOpMJPY;
              const href = row.projectId
                ? `/okr?projectId=${encodeURIComponent(String(row.projectId))}${row.deptId ? `&deptId=${encodeURIComponent(String(row.deptId))}` : ''}`
                : `/okr?dept=${encodeURIComponent(row.dept)}&project=${encodeURIComponent(row.proj)}`;

              return (
                <div
                  key={row.key}
                  className="grid grid-cols-[1.6fr_1.2fr_1.1fr_1.1fr_1.1fr_160px] gap-3 rounded-xl border border-slate-200 bg-white px-4 py-4 text-sm text-slate-800"
                >
                  <div className="min-w-0">
                    <div className="truncate font-semibold text-slate-900">{row.proj}</div>
                    <div className="mt-1 text-xs text-slate-500">{row.dept}</div>
                  </div>

                  <div className="text-sm text-slate-700">{row.reason}</div>

                  <div className="text-right">
                    <div className="font-medium text-slate-900">
                      {fmtMJPY(row.targetRevenueMJPY)} / {fmtMJPY(revenueValue)}
                    </div>
                    <div className="mt-1 text-xs text-slate-500">売上</div>
                  </div>

                  <div className="text-right">
                    <div className="font-medium text-slate-900">
                      {fmtMJPY(row.targetOpMJPY)} / {fmtMJPY(opValue)}
                    </div>
                    <div className="mt-1 text-xs text-slate-500">営業利益</div>
                  </div>

                  <div className="text-right">
                    <div className="font-medium text-slate-900">売上 {fmtPct(row.revenueAchievementRate)}</div>
                    <div className="mt-1 text-xs text-slate-500">利益 {fmtPct(row.opAchievementRate)}</div>
                  </div>

                  <div className="flex items-center justify-center">
                    <Link
                      href={href}
                      className="inline-flex items-center justify-center rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50"
                    >
                      STAGE4で見直す
                    </Link>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </section>
  );
}

function Stage6PageContent() {
  const stage6 = useStage6Data('base') as any;

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
                会社業績目標に対する進捗と、各プロジェクトの寄与状況を確認します。
              </p>
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
          dashboardSummary={stage6.dashboardSummary}
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
        />

        <ReviewCandidatesSection reviewCandidates={stage6.reviewCandidates} />
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
