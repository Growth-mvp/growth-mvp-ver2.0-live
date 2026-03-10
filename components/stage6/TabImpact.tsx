'use client';

import type { ProjectContribution } from '@/utils/stage6';
import { fmtJPY } from '@/utils/stage6';

interface TabImpactProps {
  projectContrib: ProjectContribution[];
  core: any;
  deptFilter: string;
  setDeptFilter: (value: string) => void;
  selectedProjectKeys: string[];
  selectedSet: Set<string>;
  selectedSummary: {
    deltaRev: number;
    deltaOp: number;
    invest: number;
  };
  toggleProject: (key: string) => void;
  selectAllFiltered: () => void;
  clearAllFiltered: () => void;
}

function fmtPctFromWeight(weight?: number) {
  if (!Number.isFinite(weight as any)) return '-';
  return `${Math.round((weight as number) * 100)}%`;
}

function sourceLabel(source?: string) {
  if (source === 'stage4_plan') return 'STAGE4計画';
  if (source === 'manual') return '手入力';
  if (source === 'kr_bridge') return 'KR推定';
  return '推定';
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
}: TabImpactProps) {
  const filtered = projectContrib
    .filter((p) => (deptFilter === 'all' ? true : p.dept === deptFilter))
    .slice()
    .sort((a, b) => Math.abs(b.deltaOpTotal) - Math.abs(a.deltaOpTotal));

  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
      <div className="mb-4 flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
        <div>
          <h2 className="text-lg font-bold text-slate-900">プロジェクト寄与</h2>
          <p className="mt-1 text-[12px] text-slate-600">
            どのプロジェクトが売上・営業利益に効いているかを、最低限の情報で確認します。
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

      {/* Summary */}
      <div className="mb-5 grid gap-3 md:grid-cols-4">
        <div className="rounded-xl bg-slate-50 p-4">
          <div className="text-[11px] font-semibold text-slate-600">選択PJ数</div>
          <div className="mt-1 text-xl font-bold text-slate-900">{selectedProjectKeys.length}件</div>
        </div>

        <div className="rounded-xl bg-slate-50 p-4">
          <div className="text-[11px] font-semibold text-slate-600">投資合計</div>
          <div className="mt-1 text-xl font-bold text-slate-900">{fmtJPY(selectedSummary.invest)}</div>
        </div>

        <div className="rounded-xl bg-slate-50 p-4">
          <div className="text-[11px] font-semibold text-slate-600">売上寄与合計</div>
          <div className="mt-1 text-xl font-bold text-slate-900">{fmtJPY(selectedSummary.deltaRev)}</div>
        </div>

        <div className="rounded-xl bg-slate-50 p-4">
          <div className="text-[11px] font-semibold text-slate-600">営業利益寄与合計</div>
          <div className="mt-1 text-xl font-bold text-slate-900">{fmtJPY(selectedSummary.deltaOp)}</div>
        </div>
      </div>

      {/* List */}
      <div className="space-y-3">
        {filtered.map((p) => {
          const checked = selectedSet.has(p.key);
          const execPct = fmtPctFromWeight(p.executionWeight?.weight);
          const evidence = sourceLabel(p.evidence?.source);
          const note = p.evidence?.notes;

          return (
            <div
              key={p.key}
              className="rounded-xl border border-slate-200 p-4 transition hover:bg-slate-50"
            >
              <div className="flex items-start gap-3">
                <input
                  type="checkbox"
                  checked={checked}
                  onChange={() => toggleProject(p.key)}
                  className="mt-1 h-4 w-4"
                />

                <div className="min-w-0 flex-1">
                  <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                    {/* Left */}
                    <div className="min-w-0">
                      <div className="truncate text-sm font-bold text-slate-900">{p.proj}</div>
                      <div className="mt-1 text-xs text-slate-500">{p.dept}</div>

                      <div className="mt-2 flex flex-wrap items-center gap-2 text-[11px]">
                        <span className="rounded bg-slate-100 px-2 py-1 text-slate-700">{evidence}</span>

                        {execPct !== '-' && (
                          <span className="rounded bg-blue-100 px-2 py-1 text-blue-800">
                            実行 {execPct}
                          </span>
                        )}

                        {Number.isFinite(p.investTotal as any) && (p.investTotal ?? 0) !== 0 && (
                          <span className="rounded bg-amber-100 px-2 py-1 text-amber-800">
                            投資 {fmtJPY(p.investTotal)}
                          </span>
                        )}

                        {note ? <span className="text-slate-500">— {note}</span> : null}
                      </div>
                    </div>

                    {/* Right */}
                    <div className="grid min-w-[260px] grid-cols-2 gap-3 md:min-w-[340px]">
                      <div className="rounded-lg bg-slate-50 p-3">
                        <div className="text-[11px] font-semibold text-slate-600">売上寄与</div>
                        <div className="mt-1 text-base font-bold text-slate-900">
                          {fmtJPY(p.deltaRevenueTotal)}
                        </div>
                      </div>

                      <div className="rounded-lg bg-slate-50 p-3">
                        <div className="text-[11px] font-semibold text-slate-600">営業利益寄与</div>
                        <div className="mt-1 text-base font-bold text-slate-900">
                          {fmtJPY(p.deltaOpTotal)}
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {core.approved.length === 0 && (
        <div className="mt-4 rounded-lg border border-slate-200 bg-slate-50 p-4 text-sm text-slate-700">
          Approved のプロジェクトがありません（planStatus=approved のプロジェクトが対象です）。
        </div>
      )}
    </section>
  );
}