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
  // New props from Step 1
  revenueGapMJPY?: number;
  opGapMJPY?: number;
  topRevenueProjects?: ProjectContribution[];
  topOpProjects?: ProjectContribution[];
}

function fmtMJPY(value?: number) {
  if (!Number.isFinite(value as any)) return '-';
  const millions = Math.round((value as number));
  return `${millions.toLocaleString()} 百万円`;
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
  topRevenueProjects = [],
  topOpProjects = [],
}: TabImpactProps) {
  const filtered = projectContrib
    .filter((p) => (deptFilter === 'all' ? true : p.dept === deptFilter))
    .slice()
    .sort((a, b) => Math.abs(b.deltaOpTotal) - Math.abs(a.deltaOpTotal));

  // Count projects with missing formal fields
  const missingFormalFieldsCount = projectContrib.filter((p) => {
    // Check if project has neither revenue nor op formal fields set
    const hasRevenue = p.deltaRevenueTotal > 0;
    const hasOp = p.deltaOpTotal > 0;
    return !hasRevenue && !hasOp;
  }).length;

  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
      <div className="mb-6 flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
        <div>
          <h2 className="text-lg font-bold text-slate-900">プロジェクト寄与</h2>
          <p className="mt-1 text-[12px] text-slate-600">
            どのプロジェクトが売上・営業利益に効いているかを確認し、不足を埋めるための戦略を検討します。
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

      {/* Gap & Top Projects Summary (from dashboardSummary) */}
      {/* ★ C.修正: 黄色セクション廃止、bg-slate-50 / border-slate-200 ベースへ */}
      <div className="mb-6 rounded-xl border border-slate-200 bg-slate-50 p-5 space-y-4">
        <h3 className="font-semibold text-slate-900 text-sm">不足と効くプロジェクト</h3>

        <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-4">
          {/* Revenue Gap */}
          <div className="rounded-lg bg-white border border-slate-100 p-4">
            <div className="text-xs font-semibold text-slate-600 mb-2">売上不足額</div>
            <div className={`text-lg font-semibold ${revenueGapMJPY > 0 ? 'text-slate-900' : 'text-slate-500'}`}>
              {revenueGapMJPY > 0 ? `+${fmtMJPY(revenueGapMJPY)}` : '達成済み'}
            </div>
          </div>

          {/* OpIncome Gap */}
          <div className="rounded-lg bg-white border border-slate-100 p-4">
            <div className="text-xs font-semibold text-slate-600 mb-2">営業利益不足額</div>
            <div className={`text-lg font-semibold ${opGapMJPY > 0 ? 'text-slate-900' : 'text-slate-500'}`}>
              {opGapMJPY > 0 ? `+${fmtMJPY(opGapMJPY)}` : '達成済み'}
            </div>
          </div>

          {/* Missing data count */}
          <div className="rounded-lg bg-white border border-slate-100 p-4">
            <div className="text-xs font-semibold text-slate-600 mb-2">未入力件数</div>
            <div className={`text-lg font-semibold ${missingFormalFieldsCount > 0 ? 'text-slate-900' : 'text-slate-500'}`}>
              {missingFormalFieldsCount}件
            </div>
          </div>

          {/* Selected projects count */}
          <div className="rounded-lg bg-white border border-slate-100 p-4">
            <div className="text-xs font-semibold text-slate-600 mb-2">選択中</div>
            <div className="text-lg font-semibold text-slate-900">
              {selectedProjectKeys.length}件
            </div>
          </div>
        </div>

        {/* Top Revenue Projects */}
        {topRevenueProjects && topRevenueProjects.length > 0 && (
          <div className="pt-2 border-t border-slate-200">
            <div className="text-xs font-semibold text-slate-700 mb-2">売上に効くTOP3</div>
            <div className="flex gap-2 flex-wrap">
              {topRevenueProjects.slice(0, 3).map((p) => (
                <div key={p.key} className="text-xs rounded-lg bg-slate-200 px-3 py-2 text-slate-700 font-medium">
                  {p.proj}: {fmtMJPY(p.deltaRevenueTotal / 1_000_000)}
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Top OpIncome Projects */}
        {topOpProjects && topOpProjects.length > 0 && (
          <div className="pt-2 border-t border-slate-200">
            <div className="text-xs font-semibold text-slate-700 mb-2">営業利益に効くTOP3</div>
            <div className="flex gap-2 flex-wrap">
              {topOpProjects.slice(0, 3).map((p) => (
                <div key={p.key} className="text-xs rounded-lg bg-slate-200 px-3 py-2 text-slate-700 font-medium">
                  {p.proj}: {fmtMJPY(p.deltaOpTotal / 1_000_000)}
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Selected Summary */}
      {/* ★ C.修正: padding拡大、階層を明確化 */}
      <div className="mb-6 grid gap-4 md:grid-cols-4">
        <div className="rounded-xl border border-slate-200 bg-white p-5 space-y-2">
          <div className="text-xs font-semibold text-slate-600">選択PJ数</div>
          <div className="text-2xl font-semibold text-slate-900">{selectedProjectKeys.length}件</div>
        </div>

        <div className="rounded-xl border border-slate-200 bg-white p-5 space-y-2">
          <div className="text-xs font-semibold text-slate-600">投資合計</div>
          <div className="text-2xl font-semibold text-slate-900">{fmtJPY(selectedSummary.invest)}</div>
        </div>

        <div className="rounded-xl border border-slate-200 bg-white p-5 space-y-2">
          <div className="text-xs font-semibold text-slate-600">売上寄与合計（単年）</div>
          <div className="text-2xl font-semibold text-slate-900">{fmtMJPY(selectedSummary.deltaRev)}</div>
        </div>

        <div className="rounded-xl border border-slate-200 bg-white p-5 space-y-2">
          <div className="text-xs font-semibold text-slate-600">営業利益寄与合計（単年）</div>
          <div className="text-2xl font-semibold text-slate-900">{fmtMJPY(selectedSummary.deltaOp)}</div>
        </div>
      </div>

      {/* Empty State Message */}
      {/* ★ 最終仕上げ3: 寄与が全件0のときのメッセージ */}
      {selectedSummary.deltaRev === 0 && selectedSummary.deltaOp === 0 && (
        <div className="rounded-xl border border-slate-200 bg-white p-5 mb-6">
          <div className="text-sm text-slate-700">
            <div className="font-medium text-slate-900 mb-2">プロジェクトの寄与がまだ入力されていません</div>
            <p className="text-sm text-slate-600">
              STAGE4で売上寄与 / 営業利益寄与を入力すると、この一覧に反映されます。
            </p>
          </div>
        </div>
      )}

      {/* Project List - Simplified Cards (no debug info) */}
      {/* ★ C.修正: padding拡大、余白改善 */}
      <div className="space-y-4">
        {filtered.map((p) => {
          const checked = selectedSet.has(p.key);
          const revenueContribMJPY = p.deltaRevenueTotal;
          const opContribMJPY = p.deltaOpTotal;

          return (
            <div
              key={p.key}
              className="rounded-xl border border-slate-200 bg-white p-5 transition hover:bg-slate-50"
            >
              <div className="flex items-start gap-4">
                <input
                  type="checkbox"
                  checked={checked}
                  onChange={() => toggleProject(p.key)}
                  className="mt-1 h-4 w-4"
                />

                <div className="min-w-0 flex-1">
                  <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
                    {/* Left: Project Info */}
                    <div className="min-w-0">
                      <div className="truncate text-base font-semibold text-slate-900">{p.proj}</div>
                      <div className="mt-1 text-sm text-slate-600">{p.dept}</div>

                      {/* Investment badge only */}
                      {Number.isFinite(p.investTotal as any) && (p.investTotal ?? 0) !== 0 && (
                        <div className="mt-3">
                          <span className="inline-block rounded-lg bg-slate-100 px-3 py-1 text-xs text-slate-700 font-medium">
                            投資 {fmtJPY(p.investTotal)}
                          </span>
                        </div>
                      )}
                    </div>

                    {/* Right: Contributions */}
                    <div className="grid min-w-[260px] grid-cols-2 gap-4 md:min-w-[340px]">
                      <div className="rounded-lg border border-slate-100 bg-slate-50 p-4">
                        <div className="text-xs font-semibold text-slate-600 mb-2">売上寄与（単年）</div>
                        <div className="text-lg font-semibold text-slate-900">
                          {fmtMJPY(revenueContribMJPY)}
                        </div>
                      </div>

                      <div className="rounded-lg border border-slate-100 bg-slate-50 p-4">
                        <div className="text-xs font-semibold text-slate-600 mb-2">営業利益寄与（単年）</div>
                        <div className="text-lg font-semibold text-slate-900">
                          {fmtMJPY(opContribMJPY)}
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
