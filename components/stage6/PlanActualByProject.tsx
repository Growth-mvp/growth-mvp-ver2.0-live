'use client';

import { useMemo, useState } from 'react';
import { Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import type { Department } from '@/types/strategy';
import { parseFiscalYearEndMonth } from '@/utils/stage6/investmentDemand';
import { CHART_COLORS } from '@/lib/ui/tokens';
import {
  planActualItemsForMode,
  planActualProjectsOf,
  planActualYearRowsOf,
  type PlanActualItem,
  type PlanActualMode,
  type PlanActualProject,
  type PlanActualYearRow,
  type PlanActualYearStatus,
} from '@/utils/stage6/planActualComparison';

const MODE_LABEL: Record<PlanActualMode, string> = {
  REVENUE: '売上効果',
  COST: '費用・支出額',
  OPERATING: '営業利益効果',
};

const STATUS_TEXT: Record<PlanActualYearStatus, string> = {
  COMPLETE: '登録済み（計画期間の全月）',
  PARTIAL: '登録済み実績（途中）・差額は算出していません',
  NO_ACTUAL: '実績未登録',
  OUT_OF_PERIOD: '計画期間外の実績（達成状況には含めていません）',
  NOT_COMPARABLE: '比較できません',
};

const MILLION = 1_000_000;

const keyOf = (p: PlanActualProject) => `${p.deptIndex}:${p.projectIndex}`;

const yenText = (yen: number) => `${yen > 0 ? '+' : yen < 0 ? '−' : ''}${Math.abs(yen).toLocaleString('ja-JP')}円`;

/** 計画額が無いときの理由。0円とはしない */
function planMissingText(item: PlanActualItem): string {
  if (item.planState === 'NO_PLAN') return '計画なし';
  if (item.planState === 'NOT_CALCULATED') return '未算定';
  if (item.planState === 'DRAFT') return '未確認';
  if (item.planState === 'NOT_READY') return '計画未確定';
  if (item.planState === 'AMBIGUOUS') return '照合保留';
  return '—';
}

function RowAmounts({ row, item }: { row: PlanActualYearRow; item: PlanActualItem }) {
  return (
    <>
      <td className="py-1 pr-3 text-right">{row.planYen !== null ? yenText(row.planYen) : planMissingText(item)}</td>
      <td className="py-1 pr-3 text-right">{row.actualYen !== null ? yenText(row.actualYen) : '計画期間内は未登録'}</td>
      <td className="py-1 pr-3 text-right">{row.outOfPeriodYen !== null ? yenText(row.outOfPeriodYen) : '—'}</td>
      <td className="py-1 pr-3 text-right">{row.differenceYen !== null ? yenText(row.differenceYen) : '—'}</td>
      <td className="py-1">{STATUS_TEXT[row.status]}</td>
    </>
  );
}

export function PlanActualByProject({ departments, fiscalYearEnd }: { departments: Department[]; fiscalYearEnd: string | undefined }) {
  const projects = useMemo(() => planActualProjectsOf(departments, fiscalYearEnd), [departments, fiscalYearEnd]);
  const endMonth = parseFiscalYearEndMonth(fiscalYearEnd);
  const [projectKey, setProjectKey] = useState<string | null>(null);
  const [mode, setMode] = useState<PlanActualMode>('OPERATING');
  const [itemKey, setItemKey] = useState<string | null>(null);

  const hasItems = (p: PlanActualProject) => planActualItemsForMode(p.items, mode).length > 0;
  const project = projects.find((p) => keyOf(p) === projectKey) ?? projects.find(hasItems) ?? projects[0];
  const itemsForMode = project ? planActualItemsForMode(project.items, mode) : [];
  const item = itemsForMode.find((i) => i.itemKey === itemKey) ?? itemsForMode[0];
  const rows = item && endMonth !== null ? planActualYearRowsOf(item, mode, endMonth) : [];

  return (
    <section aria-label="プロジェクト別 財務効果の計画と実績" className="space-y-3 rounded-lg border border-slate-200 bg-white p-4">
      <div>
        <h4 className="text-sm font-bold text-slate-900">プロジェクト別 財務効果の計画と実績</h4>
        <p className="mt-1 text-xs leading-relaxed text-slate-600 break-keep">
          STAGE4の計画とSTAGE5で登録した月次実績を、年度別に並べて比べます（参照のみ）。実績の登録・修正はSTAGE5で行います。
          会社全体の試算・資金計画には加算しません。
        </p>
      </div>

      {projects.length === 0 || !project ? (
        <p className="rounded-lg border border-dashed border-slate-300 p-3 text-xs text-slate-600">
          比較できる財務効果・OPEXがありません（STAGE4で入力すると表示されます）。
        </p>
      ) : (
        <>
          <div className="flex flex-wrap items-end gap-3">
            <label className="text-xs text-slate-700">
              プロジェクト
              <select
                aria-label="プロジェクト"
                value={keyOf(project)}
                onChange={(e) => {
                  setProjectKey(e.target.value);
                  setItemKey(null);
                }}
                className="mt-1 block max-w-[28rem] rounded-lg border border-slate-300 bg-white px-2 py-1.5 text-sm"
              >
                {projects.map((p) => (
                  <option key={keyOf(p)} value={keyOf(p)}>
                    {p.deptName} / {p.projectTitle}
                  </option>
                ))}
              </select>
            </label>
            <div role="group" aria-label="表示対象" className="flex gap-1">
              {(Object.keys(MODE_LABEL) as PlanActualMode[]).map((m) => (
                <button
                  key={m}
                  type="button"
                  aria-pressed={mode === m}
                  onClick={() => {
                    setMode(m);
                    setItemKey(null);
                  }}
                  className={`rounded-lg border px-2.5 py-1.5 text-xs ${mode === m ? 'border-slate-900 bg-slate-900 font-semibold text-white' : 'border-slate-300 bg-white text-slate-700 hover:bg-slate-50'}`}
                >
                  {MODE_LABEL[m]}
                </button>
              ))}
            </div>
            {itemsForMode.length > 0 && (
              <label className="text-xs text-slate-700">
                財務項目
                <select
                  aria-label="財務項目"
                  value={item?.itemKey ?? ''}
                  onChange={(e) => setItemKey(e.target.value)}
                  className="mt-1 block max-w-[22rem] rounded-lg border border-slate-300 bg-white px-2 py-1.5 text-sm"
                >
                  {itemsForMode.map((i) => (
                    <option key={i.itemKey || i.label} value={i.itemKey}>
                      {i.label}
                    </option>
                  ))}
                </select>
              </label>
            )}
          </div>

          {!item ? (
            <p className="text-xs text-slate-600">この表示対象の財務項目はありません。</p>
          ) : (
            <div className="space-y-3">
              <div className="space-y-0.5 text-xs text-slate-700">
                <div>計画：{item.planStateText}</div>
                <div>対象期間：{item.periodText}</div>
                {item.operatingNote && <div className="text-amber-800">{item.operatingNote}</div>}
              </div>

              {rows.length === 0 ? (
                <p className="text-xs text-slate-600">比較できる年度がありません。</p>
              ) : (
                <>
                  <div className="h-56 w-full">
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart
                        data={rows.map((r) => ({
                          name: `${r.fiscalYear}年度`,
                          計画: r.planYen !== null ? r.planYen / MILLION : undefined,
                          登録済み実績: r.actualYen !== null ? r.actualYen / MILLION : undefined,
                        }))}
                        margin={{ top: 8, right: 16, left: 0, bottom: 0 }}
                      >
                        <CartesianGrid strokeDasharray="3 3" stroke={CHART_COLORS.grid} />
                        <XAxis dataKey="name" tick={{ fontSize: 12 }} />
                        <YAxis tick={{ fontSize: 12 }} tickFormatter={(v: number) => `${v}`} label={{ value: '百万円', angle: -90, position: 'insideLeft', fontSize: 11 }} />
                        <Tooltip formatter={(v) => (typeof v === 'number' ? `${v.toFixed(2)}百万円` : '未登録')} />
                        <Legend />
                        <Bar dataKey="計画" fill={CHART_COLORS.projectTarget} />
                        <Bar dataKey="登録済み実績" fill={CHART_COLORS.actual} />
                      </BarChart>
                    </ResponsiveContainer>
                  </div>

                  <div className="overflow-x-auto">
                    <table className="min-w-full text-left text-xs text-slate-800" aria-label={`${item.label}の年度別の計画と実績`}>
                      <thead className="text-slate-600">
                        <tr className="border-b border-slate-200">
                          <th className="py-1 pr-3 font-semibold">年度</th>
                          <th className="py-1 pr-3 text-right font-semibold">計画額</th>
                          <th className="py-1 pr-3 text-right font-semibold">登録済み実績額</th>
                          <th className="py-1 pr-3 text-right font-semibold">計画期間外の実績</th>
                          <th className="py-1 pr-3 text-right font-semibold">差額</th>
                          <th className="py-1 font-semibold">登録状況</th>
                        </tr>
                      </thead>
                      <tbody>
                        {rows.map((r) => (
                          <tr key={r.fiscalYear} className="border-b border-slate-100">
                            <td className="py-1 pr-3">{r.label}</td>
                            <RowAmounts row={r} item={item} />
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </>
              )}
            </div>
          )}
        </>
      )}
    </section>
  );
}
