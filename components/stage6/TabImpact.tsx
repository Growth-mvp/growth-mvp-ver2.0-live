'use client';

import {
  ResponsiveContainer,
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip as ReTooltip,
  Legend,
  CartesianGrid,
} from 'recharts';
import type { ProjectContribution } from '@/utils/stage6';
import { fmtJPY, compactJPY } from '@/utils/stage6';

interface TabImpactProps {
  chartData: any[];
  indicatorSeries: {
    growth: any[];
    margin: any[];
  };
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
  chartData,
  indicatorSeries,
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
      {/* A. Company-wide transition */}
      <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
        <div className="mb-4">
          <h2 className="text-lg font-bold text-slate-900">会社全体の推移（売上・営業利益）</h2>
          <p className="mt-1 text-[12px] text-slate-600">
            Baseline（影響なし）／全プロジェクト（Approved合算）／選択プロジェクト（複数選択合算）
          </p>
        </div>

        {/* Revenue Chart */}
        <div className="mb-6">
          <div className="mb-2 text-sm font-semibold text-slate-800">売上</div>
          <div className="h-[280px] w-full">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={chartData}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="year" />
                <YAxis tickFormatter={(v) => compactJPY(v)} />
                <ReTooltip formatter={(value: any, name: any) => [fmtJPY(Number(value)), name]} />
                <Legend />
                <Line
                  type="monotone"
                  dataKey="baselineRevenue"
                  name="Baseline"
                  stroke="#64748b"
                  strokeWidth={2}
                  dot={false}
                />
                <Line
                  type="monotone"
                  dataKey="allRevenue"
                  name="全プロジェクト（Approved合算）"
                  stroke="#0f172a"
                  strokeWidth={2}
                  dot={false}
                />
                <Line
                  type="monotone"
                  dataKey="selectedRevenue"
                  name="選択プロジェクト（合算）"
                  stroke="#334155"
                  strokeWidth={2}
                  strokeDasharray="6 3"
                  dot={false}
                />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* Operating Income Chart */}
        <div>
          <div className="mb-2 text-sm font-semibold text-slate-800">営業利益</div>
          <div className="h-[280px] w-full">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={chartData}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="year" />
                <YAxis tickFormatter={(v) => compactJPY(v)} />
                <ReTooltip formatter={(value: any, name: any) => [fmtJPY(Number(value)), name]} />
                <Legend />
                <Line
                  type="monotone"
                  dataKey="baselineOp"
                  name="Baseline"
                  stroke="#64748b"
                  strokeWidth={2}
                  dot={false}
                />
                <Line
                  type="monotone"
                  dataKey="allOp"
                  name="全プロジェクト（Approved合算）"
                  stroke="#0f172a"
                  strokeWidth={2}
                  dot={false}
                />
                <Line
                  type="monotone"
                  dataKey="selectedOp"
                  name="選択プロジェクト（合算）"
                  stroke="#334155"
                  strokeWidth={2}
                  strokeDasharray="6 3"
                  dot={false}
                />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </div>

        <div className="mt-3 text-[11px] text-slate-500">
          注：STAGE1の財務入力とKR/投資の前提に基づく簡易推計です。厳密な予算ではなく「因果の検証」を目的にします。
        </div>
      </section>

      {/* B. Key performance indicators */}
      <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
        <div className="mb-4">
          <h2 className="text-lg font-bold text-slate-900">企業価値につながる指標（最小セット）</h2>
          <p className="mt-1 text-[12px] text-slate-600">売上成長率（成長性）／営業利益率（収益性）</p>
        </div>

        <div className="grid gap-6 md:grid-cols-2">
          {/* Revenue Growth Rate */}
          <div>
            <div className="mb-2 text-sm font-semibold text-slate-800">売上成長率（年次）</div>
            <div className="h-[240px] w-full">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={indicatorSeries.growth}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="year" />
                  <YAxis tickFormatter={(v) => `${(v * 100).toFixed(0)}%`} />
                  <ReTooltip
                    formatter={(value: any, name: any) => [`${(Number(value) * 100).toFixed(1)}%`, name]}
                  />
                  <Legend />
                  <Line
                    type="monotone"
                    dataKey="baseline"
                    name="Baseline"
                    stroke="#64748b"
                    strokeWidth={2}
                    dot={false}
                  />
                  <Line
                    type="monotone"
                    dataKey="all"
                    name="全プロジェクト"
                    stroke="#0f172a"
                    strokeWidth={2}
                    dot={false}
                  />
                  <Line
                    type="monotone"
                    dataKey="selected"
                    name="選択プロジェクト"
                    stroke="#334155"
                    strokeWidth={2}
                    strokeDasharray="6 3"
                    dot={false}
                  />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </div>

          {/* Operating Margin */}
          <div>
            <div className="mb-2 text-sm font-semibold text-slate-800">営業利益率（年次）</div>
            <div className="h-[240px] w-full">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={indicatorSeries.margin}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="year" />
                  <YAxis tickFormatter={(v) => `${(v * 100).toFixed(0)}%`} />
                  <ReTooltip
                    formatter={(value: any, name: any) => [`${(Number(value) * 100).toFixed(1)}%`, name]}
                  />
                  <Legend />
                  <Line
                    type="monotone"
                    dataKey="baseline"
                    name="Baseline"
                    stroke="#64748b"
                    strokeWidth={2}
                    dot={false}
                  />
                  <Line
                    type="monotone"
                    dataKey="all"
                    name="全プロジェクト"
                    stroke="#0f172a"
                    strokeWidth={2}
                    dot={false}
                  />
                  <Line
                    type="monotone"
                    dataKey="selected"
                    name="選択プロジェクト"
                    stroke="#334155"
                    strokeWidth={2}
                    strokeDasharray="6 3"
                    dot={false}
                  />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </div>
        </div>
      </section>

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
