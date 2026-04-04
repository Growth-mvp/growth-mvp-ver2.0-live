'use client';

import type { ProjectContribution } from '@/utils/stage6';
import { fmtJPY } from '@/utils/stage6';

interface ExtendedProjectContribution extends ProjectContribution {
  targetRevenueMJPY?: number;
  targetOpIncomeMJPY?: number;
}

interface TabImpactProps {
  projectContrib: ExtendedProjectContribution[];
  core: any;
  deptFilter: string;
  setDeptFilter: (value: string) => void;
  selectedProjectKeys: string[];
  selectedSet: Set<string>;
  selectedSummary: {
    deltaRev: number;
    deltaOp: number;
    invest: number;
    targetRevenue?: number;
    targetOp?: number;
  };
  toggleProject: (key: string) => void;
  selectAllFiltered: () => void;
  clearAllFiltered: () => void;
  revenueGapMJPY?: number;
  opGapMJPY?: number;
}

function fmtMJPY(value?: number) {
  if (!Number.isFinite(value as any)) return '-';
  return `${Math.round(value as number).toLocaleString()} 百万円`;
}

function StatBox({
  label,
  value,
  emphasis = false,
}: {
  label: string;
  value: string;
  emphasis?: boolean;
}) {
  return (
    <div className={`rounded-xl border px-4 py-3 ${emphasis ? 'border-slate-300 bg-slate-100' : 'border-slate-200 bg-white'}`}>
      <div className="text-[11px] font-medium text-slate-500">{label}</div>
      <div className={`mt-1 text-xl font-semibold ${emphasis ? 'text-slate-900' : 'text-slate-800'}`}>{value}</div>
    </div>
  );
}

export function TabImpact({
  projectContrib,
  core,
  deptFilter,
  setDeptFilter,
  selectedProjectKeys,
  selectedSet,
  selectedSummary,
  toggleProject,
  selectAllFiltered,
  clearAllFiltered,
  revenueGapMJPY = 0,
  opGapMJPY = 0,
}: TabImpactProps) {
  const filtered = projectContrib
    .filter((p) => (deptFilter === 'all' ? true : p.dept === deptFilter))
    .slice()
    .sort((a, b) => {
      const aValue = (a.deltaRevenueTotal ?? 0) + (a.deltaOpTotal ?? 0);
      const bValue = (b.deltaRevenueTotal ?? 0) + (b.deltaOpTotal ?? 0);
      return bValue - aValue;
    });

  const filteredTargetRevenue = filtered.reduce((sum, p) => sum + (p.targetRevenueMJPY ?? 0), 0);
  const filteredTargetOp = filtered.reduce((sum, p) => sum + (p.targetOpIncomeMJPY ?? 0), 0);
  const filteredContribRevenue = filtered.reduce((sum, p) => sum + (p.deltaRevenueTotal ?? 0), 0);
  const filteredContribOp = filtered.reduce((sum, p) => sum + (p.deltaOpTotal ?? 0), 0);

  const selectedTargetRevenue = filtered
    .filter((p) => selectedSet.has(p.key))
    .reduce((sum, p) => sum + (p.targetRevenueMJPY ?? 0), 0);
  const selectedTargetOp = filtered
    .filter((p) => selectedSet.has(p.key))
    .reduce((sum, p) => sum + (p.targetOpIncomeMJPY ?? 0), 0);

  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
      <div className="mb-5 flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <h2 className="text-lg font-bold text-slate-900">プロジェクト寄与</h2>
          <p className="mt-1 text-[12px] text-slate-600">
            目標額と現時点の寄与額を、プロジェクトごとに一覧で比較します。
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm text-slate-600">部門</span>
          <select
            className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm"
            value={deptFilter}
            onChange={(e) => setDeptFilter(e.target.value)}
          >
            <option value="all">全社（全部門）</option>
            {core.deptNames.map((n: string) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </select>

          <button
            onClick={selectAllFiltered}
            className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm hover:bg-slate-50"
          >
            表示中を全選択
          </button>
          <button
            onClick={clearAllFiltered}
            className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm hover:bg-slate-50"
          >
            表示中を解除
          </button>
        </div>
      </div>

      <div className="mb-6 space-y-3">
        <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
          <div className="mb-3 text-xs font-semibold text-slate-600">表示中の全体サマリー</div>
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
            <StatBox label="目標売上合計" value={fmtMJPY(filteredTargetRevenue)} />
            <StatBox label="目標営業利益合計" value={fmtMJPY(filteredTargetOp)} />
            <StatBox label="売上寄与合計" value={fmtMJPY(filteredContribRevenue)} emphasis />
            <StatBox label="営業利益寄与合計" value={fmtMJPY(filteredContribOp)} emphasis />
          </div>
        </div>

        <div className="grid gap-3 md:grid-cols-2">
          <div className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3">
            <div className="text-[11px] font-medium text-amber-700">売上不足額</div>
            <div className="mt-1 text-2xl font-bold text-amber-900">
              {revenueGapMJPY > 0 ? `+${fmtMJPY(revenueGapMJPY)}` : '達成済み'}
            </div>
          </div>
          <div className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3">
            <div className="text-[11px] font-medium text-amber-700">営業利益不足額</div>
            <div className="mt-1 text-2xl font-bold text-amber-900">
              {opGapMJPY > 0 ? `+${fmtMJPY(opGapMJPY)}` : '達成済み'}
            </div>
          </div>
        </div>

        <div className="rounded-2xl border border-slate-200 bg-white p-4">
          <div className="mb-3 text-xs font-semibold text-slate-600">選択中のサマリー</div>
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-5">
            <StatBox label="選択PJ数" value={`${selectedProjectKeys.length}件`} />
            <StatBox label="選択中 目標売上合計" value={fmtMJPY(selectedTargetRevenue)} />
            <StatBox label="選択中 目標営業利益合計" value={fmtMJPY(selectedTargetOp)} />
            <StatBox label="選択中 売上寄与合計" value={fmtMJPY(selectedSummary.deltaRev)} emphasis />
            <StatBox label="選択中 営業利益寄与合計" value={fmtMJPY(selectedSummary.deltaOp)} emphasis />
          </div>
          <div className="mt-3 text-[11px] text-slate-500">投資合計：{fmtJPY(selectedSummary.invest)}</div>
        </div>
      </div>

      {filtered.length === 0 ? (
        <div className="rounded-xl border border-slate-200 bg-slate-50 p-6 text-sm text-slate-600">
          該当するプロジェクトがありません。
        </div>
      ) : (
        <div className="overflow-hidden rounded-2xl border border-slate-200">
          <div className="grid grid-cols-[40px_1.5fr_repeat(4,minmax(110px,1fr))] gap-3 bg-slate-50 px-4 py-3 text-[11px] font-semibold text-slate-600">
            <div></div>
            <div>プロジェクト</div>
            <div>目標売上額</div>
            <div>売上寄与額</div>
            <div>目標営業利益額</div>
            <div>営業利益寄与額</div>
          </div>

          <div className="divide-y divide-slate-200 bg-white">
            {filtered.map((p) => {
              const checked = selectedSet.has(p.key);
              return (
                <div
                  key={p.key}
                  className={`grid grid-cols-[40px_1.5fr_repeat(4,minmax(110px,1fr))] gap-3 px-4 py-4 text-sm ${checked ? 'bg-slate-50' : 'bg-white'}`}
                >
                  <div className="flex items-start justify-center pt-1">
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={() => toggleProject(p.key)}
                      className="h-4 w-4"
                    />
                  </div>

                  <div className="min-w-0">
                    <div className="truncate font-semibold text-slate-900">{p.proj}</div>
                    <div className="mt-1 text-[12px] text-slate-500">{p.dept}</div>
                  </div>

                  <div className="font-semibold text-slate-800">{fmtMJPY(p.targetRevenueMJPY)}</div>
                  <div className="font-semibold text-slate-900">{fmtMJPY(p.deltaRevenueTotal)}</div>
                  <div className="font-semibold text-slate-800">{fmtMJPY(p.targetOpIncomeMJPY)}</div>
                  <div className="font-semibold text-slate-900">{fmtMJPY(p.deltaOpTotal)}</div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </section>
  );
}
