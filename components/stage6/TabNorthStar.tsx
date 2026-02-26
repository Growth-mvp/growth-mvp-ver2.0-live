'use client';

import React, { useState } from 'react';
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
import type { NorthStarRow } from '@/utils/stage6';
import type { ProjectTargetImpact } from '@/types/strategy';
import { fmtJPY, compactJPY } from '@/utils/stage6';
import { canonicalizeUnit } from '@/utils/stage6/compute';

interface TabNorthStarProps {
  northStarRows: NorthStarRow[];
  chartData?: any[];
  projectTargetImpacts?: ProjectTargetImpact[];
  allProjectKeys?: string[];
  onUpdateImpact?: (projectId: string, targetId: string, delta: number, notes?: string) => void;
  onRemoveImpact?: (projectId: string, targetId: string) => void;
}

/**
 * ★ formatByUnit: unit に応じて ¥ の付け外しを制御
 * - unit が百万円/million_yen のときは ¥ を付けない（数値だけ）
 * - unit が yen のときは ¥ を付ける
 */
function formatByUnit(value: number | null | undefined, unit: string): string {
  if (value == null || Number.isNaN(value)) return '—';

  const u = canonicalizeUnit(unit);
  if (u === 'million_yen') {
    // ¥ は付けない。数値だけ
    return value.toLocaleString('ja-JP', { maximumFractionDigits: 0 });
  }
  // yen のときだけ ¥ を付ける
  return '¥' + value.toLocaleString('ja-JP', { maximumFractionDigits: 0 });
}

export function TabNorthStar({
  northStarRows,
  chartData,
  projectTargetImpacts,
  allProjectKeys,
  onUpdateImpact,
  onRemoveImpact,
}: TabNorthStarProps) {
  const [expandedRow, setExpandedRow] = useState<string | null>(null);
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
    <>
      {/* 説明テキスト */}
      <div className="mb-4 rounded-lg bg-blue-50 p-3 text-sm text-blue-800 border border-blue-200">
        <strong>💡 自動推定について：</strong> STAGE4の計画を指標へ推定変換し、STAGE5の実行ログで確度補正しています（推定値は調整可能）
      </div>

      {/* A. Company-wide transition */}
      {chartData && chartData.length > 0 && (
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
      )}

      {/* B. North Star Metrics */}
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
                <th className="px-3 py-2 text-left font-semibold text-slate-700">操作</th>
              </tr>
            </thead>
            <tbody>
              {northStarRows.map((row) => {
                const gap = row.forecastValue !== undefined && row.base ? row.forecastValue - row.base : undefined;

                return (
                  <React.Fragment key={row.targetId}>
                    <tr className="border-b border-slate-100 hover:bg-slate-50">
                      <td className="px-3 py-2 font-medium text-slate-900">{row.label}</td>
                      <td className="px-3 py-2 text-slate-700">{row.unit}</td>
                      <td className="px-3 py-2 text-right text-slate-700">{row.dueYear ?? '-'}</td>
                      <td className="px-3 py-2 text-right text-slate-700">
                        {row.low !== undefined ? (
                          row.unit.includes('%') ? `${row.low.toFixed(1)}%` : formatByUnit(row.low, row.unit)
                        ) : (
                          '-'
                        )}
                      </td>
                      <td className="px-3 py-2 text-right font-semibold text-slate-900">
                        {row.unit.includes('%') ? `${row.base.toFixed(1)}%` : formatByUnit(row.base, row.unit)}
                      </td>
                      <td className="px-3 py-2 text-right text-slate-700">
                        {row.high !== undefined ? (
                          row.unit.includes('%') ? `${row.high.toFixed(1)}%` : formatByUnit(row.high, row.unit)
                        ) : (
                          '-'
                        )}
                      </td>
                      <td className="px-3 py-2 text-right text-slate-700">
                        {row.forecastValue !== undefined ? (
                          row.unit.includes('%') ? `${row.forecastValue.toFixed(1)}%` : formatByUnit(row.forecastValue, row.unit)
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
                          row.unit.includes('%') ? `${gap.toFixed(1)}%` : formatByUnit(gap, row.unit)
                        ) : (
                          '-'
                        )}
                      </td>
                      <td className="px-3 py-2 text-left text-xs max-w-xs">
                        {(() => {
                          // H-1: breakdown から動的に Top3 を生成（最新の計算結果を常に反映）
                          const top3 = row.breakdown
                            ? [...row.breakdown]
                                .sort((a, b) => Math.abs(b.effectiveDelta) - Math.abs(a.effectiveDelta))
                                .slice(0, 3)
                            : [];

                          // fallback: topProjects があれば使用
                          const displayProjects = top3.length > 0 ? top3 : (row.topProjects ?? []);

                          return displayProjects.length > 0 ? (
                            <div className="space-y-1">
                              {displayProjects.map((proj: any, idx: number) => {
                                // breakdown item から dept/proj を抽出
                                const parts = proj.projectId?.includes('::')
                                  ? proj.projectId.split('::')
                                  : proj.projectId?.split(':') ?? [proj.dept, proj.proj];
                                const dept = parts[0] ?? proj.dept ?? '';
                                const projName = parts[1] ?? proj.proj ?? proj.projectId ?? '';
                                const value = proj.effectiveDelta ?? proj.contribution ?? 0;

                                return (
                                  <div key={idx} className="text-slate-600">
                                    <span className="font-medium">{dept}</span>
                                    {' / '}
                                    <span>{projName}</span>
                                    <span className="text-slate-500">: {formatByUnit(value, row.unit)}</span>
                                  </div>
                                );
                              })}
                            </div>
                          ) : (
                            '-'
                          );
                        })()}
                      </td>
                      <td className="px-3 py-2 text-left">
                        <button
                          onClick={() => setExpandedRow(expandedRow === row.targetId ? null : row.targetId)}
                          className="text-xs text-blue-600 hover:underline"
                        >
                          {expandedRow === row.targetId ? '閉じる' : '編集'}
                        </button>
                      </td>
                    </tr>

                    {expandedRow === row.targetId && (
                      <tr>
                        <td colSpan={11} className="bg-slate-50 p-4">
                          {/* H-1: Breakdown display */}
                          {row.breakdown && row.breakdown.length > 0 && (
                            <div className="mb-4 pb-3 border-b border-slate-200">
                              <div className="text-xs font-semibold text-slate-900 mb-2">
                                予測内訳（Top3）
                              </div>
                              <div className="space-y-1">
                                {row.breakdown
                                  .sort((a, b) => Math.abs(b.effectiveDelta) - Math.abs(a.effectiveDelta))
                                  .slice(0, 3)
                                  .map((item) => {
                                    const parts = item.projectId.split('::');
                                    const deptName = parts[0] ?? '';
                                    const projName = parts[1] ?? item.projectId;
                                    const weight = (item.executionWeight * 100).toFixed(0);

                                    return (
                                      <div key={item.projectId} className="text-xs text-slate-600">
                                        <span className="font-medium">{deptName}</span>
                                        <span>：</span>
                                        <span>{projName}</span>
                                        <span className="text-slate-500 ml-1">
                                          delta {item.delta > 0 ? '+' : ''}{item.delta.toFixed(0)} ×
                                          weight {weight}% = {item.effectiveDelta > 0 ? '+' : ''}
                                          {item.effectiveDelta.toFixed(0)}
                                        </span>
                                      </div>
                                    );
                                  })}
                              </div>
                            </div>
                          )}

                          <div className="text-sm font-semibold mb-3 text-slate-900">
                            プロジェクト別の寄与量（delta）を入力
                          </div>
                          <div className="space-y-2">
                            {(allProjectKeys ?? []).map((projectKey) => {
                              const impact = (projectTargetImpacts ?? []).find(
                                (imp) => imp.projectId === projectKey && imp.targetId === row.targetId
                              );
                              const deltaValue = impact?.delta ?? '';
                              const hasWarning = impact?.delta && Math.abs(impact.delta) > row.base * 10;

                              return (
                                <div key={projectKey} className="flex items-start gap-4">
                                  <div className="w-48 text-xs text-slate-700 pt-2">{projectKey}</div>
                                  <div className="flex-1">
                                    <div className="flex items-center gap-2">
                                      <input
                                        type="number"
                                        value={deltaValue}
                                        onChange={(e) => {
                                          const val = e.target.value;
                                          if (val === '') {
                                            if (impact) {
                                              onRemoveImpact?.(projectKey, row.targetId);
                                            }
                                          } else {
                                            const numVal = parseFloat(val);
                                            if (!isNaN(numVal)) {
                                              onUpdateImpact?.(projectKey, row.targetId, numVal);
                                            }
                                          }
                                        }}
                                        className="w-32 border border-slate-300 px-2 py-1 text-xs rounded"
                                        placeholder="0"
                                      />
                                      <span className="text-xs text-slate-600 w-16">{row.unit}</span>
                                      {impact && (
                                        <button
                                          onClick={() => onRemoveImpact?.(projectKey, row.targetId)}
                                          className="text-xs text-red-600 hover:underline"
                                        >
                                          削除
                                        </button>
                                      )}
                                    </div>
                                    {/* H-2: Unit-specific warning thresholds */}
                                    {impact && impact.delta && (() => {
                                      const unit = String(row.unit).toLowerCase();
                                      let warningThreshold = row.base * 2; // デフォルト: base * 2

                                      if (unit.includes('百万') || unit === 'mjpy') {
                                        warningThreshold = row.base * 2;
                                      } else if (unit.includes('千') || unit === 'kjpy') {
                                        warningThreshold = row.base * 1.5;
                                      } else if (unit === '円' || unit === 'jpy') {
                                        warningThreshold = row.base * 0.5;
                                      } else if (unit === '%') {
                                        warningThreshold = Math.min(50, row.base * 1.5);
                                      }

                                      return (
                                        Math.abs(impact.delta) > warningThreshold && (
                                          <div className="text-xs text-amber-600 mt-1">
                                            ⚠ 入力値が想定範囲を超えています。単位（{row.unit}）を確認してください。
                                          </div>
                                        )
                                      );
                                    })()}
                                  </div>
                                </div>
                              );
                            })}
                          </div>
                          <div className="mt-3 text-xs text-slate-500">
                            注：単位は North Star の単位（{row.unit}）に合わせてください。
                          </div>
                        </td>
                      </tr>
                    )}
                  </React.Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
      </section>
    </>
  );
}
