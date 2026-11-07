'use client';

import type { NorthStarRow } from '@/utils/stage6/types';

type Props = {
  northStarRows: NorthStarRow[];
};

export function TargetOverview({ northStarRows }: Props) {
  return (
    <div>
      <h4 className="text-sm font-bold text-slate-900">経営目標（STAGE2で設定・予測には加算しない）</h4>
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
  );
}
