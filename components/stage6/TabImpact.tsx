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
  return (
    <>
      {/* C. Project contribution */}
      <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
        <div className="mb-4 flex flex-col gap-2 md:flex-row md:items-end md:justify-between">
          <div>
            <h2 className="text-lg font-bold text-slate-900">プロジェクト寄与（複数選択）</h2>
            <p className="mt-1 text-[12px] text-slate-600">
              チェックしたプロジェクトだけを合算し、会社推移の中で位置づけます（基準シナリオで寄与一覧を表示）。
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

        {/* Selection Summary */}
        <div className="mb-4 grid gap-3 md:grid-cols-3">
          <div className="rounded-lg bg-slate-50 p-4">
            <div className="text-[12px] font-semibold text-slate-600">選択PJ数</div>
            <div className="mt-1 text-lg font-bold text-slate-900">{selectedProjectKeys.length} 件</div>
          </div>

          <div className="rounded-lg bg-slate-50 p-4">
            <div className="text-[12px] font-semibold text-slate-600">投資合計（選択PJ）</div>
            <div className="mt-1 text-lg font-bold text-slate-900">{fmtJPY(selectedSummary.invest)}</div>
          </div>

          <div className="rounded-lg bg-slate-50 p-4">
            <div className="text-[12px] font-semibold text-slate-600">営業利益差分（概算 / Baseline比）</div>
            <div className="mt-1 text-lg font-bold text-slate-900">{fmtJPY(selectedSummary.deltaOp)}</div>
            <div className="mt-1 text-[12px] text-slate-600">売上差分：{fmtJPY(selectedSummary.deltaRev)}</div>
          </div>
        </div>

        {/* Project Table */}
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-200">
                <th className="px-3 py-2 text-left font-semibold text-slate-700">選択</th>
                <th className="px-3 py-2 text-left font-semibold text-slate-700">部門</th>
                <th className="px-3 py-2 text-left font-semibold text-slate-700">プロジェクト</th>
                <th className="px-3 py-2 text-right font-semibold text-slate-700">投資合計</th>
                <th className="px-3 py-2 text-right font-semibold text-slate-700">売上差分（概算）</th>
                <th className="px-3 py-2 text-right font-semibold text-slate-700">営業利益差分（概算）</th>
                <th className="px-3 py-2 text-right font-semibold text-slate-700">ROI（概算）</th>
                <th className="px-3 py-2 text-left font-semibold text-slate-700">★根拠</th>
                <th className="px-3 py-2 text-left font-semibold text-slate-700">★実行度</th>
              </tr>
            </thead>
            <tbody>
              {projectContrib
                .filter((p) => (deptFilter === 'all' ? true : p.dept === deptFilter))
                .slice()
                .sort((a, b) => Math.abs(b.deltaOpTotal) - Math.abs(a.deltaOpTotal))
                .map((p) => {
                  const checked = selectedSet.has(p.key);
                  return (
                    <tr key={p.key} className="border-b border-slate-100 hover:bg-slate-50">
                      <td className="px-3 py-2">
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={() => toggleProject(p.key)}
                          className="h-4 w-4"
                        />
                      </td>
                      <td className="px-3 py-2 font-medium text-slate-900">{p.dept}</td>
                      <td className="px-3 py-2 text-slate-700">{p.proj}</td>
                      <td className="px-3 py-2 text-right text-slate-700">{fmtJPY(p.investTotal)}</td>
                      <td className="px-3 py-2 text-right text-slate-700">{fmtJPY(p.deltaRevenueTotal)}</td>
                      <td className="px-3 py-2 text-right text-slate-700">{fmtJPY(p.deltaOpTotal)}</td>
                      <td className="px-3 py-2 text-right text-slate-700">
                        {Number.isFinite(p.roi as any) ? `${((p.roi as number) * 100).toFixed(1)}%` : '-'}
                      </td>
                      <td className="px-3 py-2 text-left text-xs">
                        <div className="flex items-center gap-1">
                          <span
                            className={`px-2 py-1 rounded font-medium ${
                              p.evidence?.confidence === 'high'
                                ? 'bg-green-100 text-green-800'
                                : p.evidence?.confidence === 'medium'
                                  ? 'bg-blue-100 text-blue-800'
                                  : 'bg-slate-100 text-slate-700'
                            }`}
                          >
                            {p.evidence?.source === 'stage4_plan' ? 'STAGE4計画' : 'KR推定'}
                          </span>
                          <span className="text-slate-600">{p.evidence?.notes}</span>
                        </div>
                      </td>
                      <td className="px-3 py-2 text-left text-xs">
                        {p.executionWeight ? (
                          <div className="flex items-center gap-1">
                            <span
                              className={`px-2 py-1 rounded font-medium ${
                                p.executionWeight.weight >= 1.0
                                  ? 'bg-green-100 text-green-800'
                                  : p.executionWeight.weight >= 0.9
                                    ? 'bg-blue-100 text-blue-800'
                                    : 'bg-amber-100 text-amber-800'
                              }`}
                            >
                              {(p.executionWeight.weight * 100).toFixed(0)}%
                            </span>
                            <span className="text-slate-600 text-[11px]">{p.executionWeight.notes}</span>
                          </div>
                        ) : (
                          '-'
                        )}
                      </td>
                    </tr>
                  );
                })}
            </tbody>
          </table>
        </div>

        {core.approved.length === 0 && (
          <div className="mt-4 rounded-lg border border-slate-200 bg-slate-50 p-4 text-sm text-slate-700">
            Approved のプロジェクトがありません（planStatus=approved のプロジェクトが対象です）。
          </div>
        )}
      </section>
    </>
  );
}
