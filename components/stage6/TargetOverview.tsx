'use client';

import type { NorthStarRow } from '@/utils/stage6/types';
import { TabValueDashboard } from './TabValue.dashboard';

type DashboardSummary = NonNullable<Parameters<typeof TabValueDashboard>[0]['dashboardSummary']>;
type TargetGap = Pick<DashboardSummary['revenue'], 'forecast' | 'target' | 'gap'>;

type ExcludedImpact = { projectId: string; targetId: string; valueMJPY: number | null; reason: string };

type Props = {
  northStarRows: NorthStarRow[];
  dashboardSummary?: DashboardSummary;
  excludedImpacts?: ExcludedImpact[];
};

function fmtMJPY(v: number) {
  return `${Math.round(v).toLocaleString('ja-JP')} 百万円`;
}

function summaryText(row: TargetGap | undefined) {
  if (!row || !(row.target > 0)) return '目標が未設定のため、達成率は算出していません';
  const pct = Math.round((row.forecast / row.target) * 100);
  return `現状＋北極星の施策寄与の参考計算 ${fmtMJPY(row.forecast)} ／ 目標 ${fmtMJPY(row.target)}（参考達成率 ${pct}%・重複の可能性あり）`;
}

export function TargetOverview({ northStarRows, dashboardSummary, excludedImpacts = [] }: Props) {
  return (
    <div className="space-y-5">
      {excludedImpacts.length > 0 && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
          <div className="font-semibold">北極星の集計から外した金額（{excludedImpacts.length}件）</div>
          <ul className="mt-1 list-disc pl-5 text-xs">
            {excludedImpacts.map((e, i) => (
              <li key={`${e.projectId}-${e.targetId}-${i}`}>
                {e.projectId}（目標: {e.targetId}、登録額: {e.valueMJPY === null ? '不明' : `${e.valueMJPY} 百万円`}）：{e.reason}
              </li>
            ))}
          </ul>
          <p className="mt-1 text-xs">金額は削除していません。対象の施策を確認し、必要なら金額を入力し直してください。</p>
        </div>
      )}
      <div>
        <h4 className="text-sm font-bold text-slate-900">売上・営業利益の目標と条件付き試算（要約）</h4>
        <ul className="mt-2 space-y-1 text-sm text-slate-800">
          <li>
            <span className="font-semibold">売上：</span>
            {summaryText(dashboardSummary?.revenue)}
          </li>
          <li>
            <span className="font-semibold">営業利益：</span>
            {summaryText(dashboardSummary?.op)}
          </li>
        </ul>
      </div>

      <div>
        <h4 className="text-sm font-bold text-slate-900">STAGE2で設定した経営目標</h4>
        {northStarRows.length === 0 ? (
          <div className="mt-2 rounded-lg border border-dashed border-slate-300 p-3 text-xs text-slate-600">
            経営目標が未設定です。STAGE2で目標を設定すると、ここに表示されます。
          </div>
        ) : (
          <div className="mt-2 overflow-x-auto rounded-xl border border-slate-200">
            <table className="min-w-full text-sm">
              <thead className="bg-slate-50 text-xs text-slate-600">
                <tr>
                  <th className="px-3 py-2 text-left font-semibold">目標</th>
                  <th className="px-3 py-2 text-right font-semibold">目標値</th>
                  <th className="px-3 py-2 text-right font-semibold">期限</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {northStarRows.map((row) => (
                  <tr key={row.targetId}>
                    <td className="px-3 py-2 text-slate-800">{row.label}</td>
                    <td className="px-3 py-2 text-right font-medium text-slate-900">
                      {Number.isFinite(row.base) ? `${row.base.toLocaleString('ja-JP')} ${row.unit}` : '-'}
                    </td>
                    <td className="px-3 py-2 text-right text-slate-700">
                      {row.dueYear ? `${row.dueYear}年` : '-'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <details className="rounded-xl border border-slate-200 bg-white p-4">
        <summary className="cursor-pointer text-sm font-semibold text-slate-900">
          詳細グラフを開く
        </summary>
        <div className="mt-4">
          <TabValueDashboard northStarRows={northStarRows} dashboardSummary={dashboardSummary} />
        </div>
      </details>
    </div>
  );
}
