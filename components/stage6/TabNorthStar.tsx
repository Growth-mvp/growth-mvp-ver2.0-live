'use client';

import type { NorthStarRow } from '@/utils/stage6';
import { fmtJPY } from '@/utils/stage6';

interface TabNorthStarProps {
  northStarRows: NorthStarRow[];
}

export function TabNorthStar({ northStarRows }: TabNorthStarProps) {
  if (northStarRows.length === 0) {
    return (
      <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
        <div className="mb-4">
          <h2 className="text-lg font-bold text-slate-900">North Star Metrics vs プロジェクト合計予測</h2>
          <p className="mt-1 text-[12px] text-slate-600">
            会社目標（North Star）と、プロジェクト実行による達成予測のギャップを可視化します。
          </p>
        </div>

        <div className="rounded-lg border border-slate-200 bg-slate-50 p-4 text-sm text-slate-700">
          会社目標（North Star）がまだ設定されていません。STAGE2で定義してください。
        </div>
      </section>
    );
  }

  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
      <div className="mb-4">
        <h2 className="text-lg font-bold text-slate-900">North Star Metrics vs プロジェクト合計予測</h2>
        <p className="mt-1 text-[12px] text-slate-600">
          会社目標（North Star）と、プロジェクト実行による達成予測のギャップを可視化します。
        </p>
      </div>

      <div className="space-y-4">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-200">
                <th className="px-3 py-2 text-left font-semibold text-slate-700">目標</th>
                <th className="px-3 py-2 text-left font-semibold text-slate-700">単位</th>
                <th className="px-3 py-2 text-right font-semibold text-slate-700">期限年</th>
                <th className="px-3 py-2 text-right font-semibold text-slate-700">低位</th>
                <th className="px-3 py-2 text-right font-semibold text-slate-700">基準</th>
                <th className="px-3 py-2 text-right font-semibold text-slate-700">高位</th>
                <th className="px-3 py-2 text-right font-semibold text-slate-700">予測値</th>
                <th className="px-3 py-2 text-right font-semibold text-slate-700">達成率</th>
                <th className="px-3 py-2 text-right font-semibold text-slate-700">ギャップ</th>
                <th className="px-3 py-2 text-left font-semibold text-slate-700">★予測内訳（Top3PJ）</th>
              </tr>
            </thead>
            <tbody>
              {northStarRows.map((row) => {
                const gap = row.forecastValue !== undefined && row.base ? row.forecastValue - row.base : undefined;

                return (
                  <tr key={row.targetId} className="border-b border-slate-100 hover:bg-slate-50">
                    <td className="px-3 py-2 font-medium text-slate-900">{row.label}</td>
                    <td className="px-3 py-2 text-slate-700">{row.unit}</td>
                    <td className="px-3 py-2 text-right text-slate-700">{row.dueYear ?? '-'}</td>
                    <td className="px-3 py-2 text-right text-slate-700">
                      {row.low !== undefined ? (
                        row.unit.includes('%') ? `${row.low.toFixed(1)}%` : fmtJPY(row.low)
                      ) : (
                        '-'
                      )}
                    </td>
                    <td className="px-3 py-2 text-right font-semibold text-slate-900">
                      {row.unit.includes('%') ? `${row.base.toFixed(1)}%` : fmtJPY(row.base)}
                    </td>
                    <td className="px-3 py-2 text-right text-slate-700">
                      {row.high !== undefined ? (
                        row.unit.includes('%') ? `${row.high.toFixed(1)}%` : fmtJPY(row.high)
                      ) : (
                        '-'
                      )}
                    </td>
                    <td className="px-3 py-2 text-right text-slate-700">
                      {row.forecastValue !== undefined ? (
                        row.unit.includes('%') ? `${row.forecastValue.toFixed(1)}%` : fmtJPY(row.forecastValue)
                      ) : (
                        '-'
                      )}
                    </td>
                    <td
                      className={`px-3 py-2 text-right font-semibold ${
                        row.achievementRate !== undefined && row.achievementRate >= 100
                          ? 'text-green-700'
                          : 'text-red-700'
                      }`}
                    >
                      {row.achievementRate !== undefined ? `${row.achievementRate.toFixed(1)}%` : '-'}
                    </td>
                    <td className="px-3 py-2 text-right text-slate-700">
                      {gap !== undefined ? (
                        row.unit.includes('%') ? `${gap.toFixed(1)}%` : fmtJPY(gap)
                      ) : (
                        '-'
                      )}
                    </td>
                    <td className="px-3 py-2 text-left text-xs max-w-xs">
                      {row.topProjects && row.topProjects.length > 0 ? (
                        <div className="space-y-1">
                          {row.topProjects.map((proj: any, idx: number) => (
                            <div key={idx} className="text-slate-600">
                              <span className="font-medium">{proj.dept}</span>
                              {' / '}
                              <span>{proj.proj}</span>
                              <span className="text-slate-500">: {fmtJPY(proj.contribution)}</span>
                            </div>
                          ))}
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
      </div>
    </section>
  );
}
