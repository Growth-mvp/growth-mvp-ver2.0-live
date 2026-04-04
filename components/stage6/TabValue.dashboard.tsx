// /components/stage6/TabValue.dashboard.tsx
'use client';

import React from 'react';

type Props = {
  northStarRows: any[];
  dashboardSummary?: {
    revenue: { baseline: number; forecast: number; target: number; gap: number };
    op: { baseline: number; forecast: number; target: number; gap: number };
  };
};

function fmtMJPY(x: number | null | undefined) {
  if (x === null || x === undefined || !Number.isFinite(x)) return '-';
  return `${Math.round(x).toLocaleString()} 百万円`;
}

function fmtSignedMJPY(v: number): string {
  if (!Number.isFinite(v)) return '-';
  const sign = v > 0 ? '+' : v < 0 ? '-' : '±';
  return `${sign}${fmtMJPY(Math.abs(v))}`;
}

function calcBarRatio(values: number[], value: number): number {
  const max = Math.max(...values, 1);
  return Math.max(0, Math.min(100, (value / max) * 100));
}

function ThreeBarChart({
  title,
  baseline,
  forecast,
  target,
  gap,
}: {
  title: string;
  baseline: number;
  forecast: number;
  target: number;
  gap: number;
}) {
  const values = [baseline, forecast, target];
  const baselineWidth = calcBarRatio(values, baseline);
  const forecastWidth = calcBarRatio(values, forecast);
  const targetWidth = calcBarRatio(values, target);
  const achievementPct = target > 0 ? Math.round((forecast / target) * 100) : 0;

  return (
    <div className="rounded-xl border border-slate-200 bg-white p-6 space-y-5">
      <div>
        <div className="text-base font-semibold text-slate-900">{title}</div>
        <div className="mt-2 text-sm text-slate-600">
          達成見込み: <span className="text-slate-900 font-semibold">{achievementPct}%</span>
        </div>
      </div>

      <div className="space-y-4">
        <div className="flex items-center gap-4">
          <div className="w-12 flex-shrink-0">
            <div className="text-xs font-semibold text-slate-600">現状</div>
          </div>
          <div className="flex-1 h-3 rounded-full bg-slate-100 overflow-hidden">
            <div className="h-full rounded-full bg-slate-300 transition-all" style={{ width: `${Math.min(100, baselineWidth)}%` }} />
          </div>
          <div className="w-24 text-right">
            <div className="text-sm font-semibold text-slate-900">{fmtMJPY(baseline)}</div>
          </div>
        </div>

        <div className="flex items-center gap-4">
          <div className="w-12 flex-shrink-0">
            <div className="text-xs font-semibold text-slate-600">見込み</div>
          </div>
          <div className="flex-1 h-3 rounded-full bg-slate-100 overflow-hidden">
            <div className="h-full rounded-full bg-slate-400 transition-all" style={{ width: `${Math.min(100, forecastWidth)}%` }} />
          </div>
          <div className="w-24 text-right">
            <div className="text-sm font-semibold text-slate-900">{fmtMJPY(forecast)}</div>
            <div className="text-xs text-slate-500">現状比 {fmtSignedMJPY(forecast - baseline)}</div>
          </div>
        </div>

        <div className="flex items-center gap-4">
          <div className="w-12 flex-shrink-0">
            <div className="text-xs font-semibold text-slate-600">目標</div>
          </div>
          <div className="flex-1 h-3 rounded-full bg-slate-100 overflow-hidden">
            <div className="h-full rounded-full bg-slate-600 transition-all" style={{ width: `${Math.min(100, targetWidth)}%` }} />
          </div>
          <div className="w-24 text-right">
            <div className="text-sm font-semibold text-slate-900">{fmtMJPY(target)}</div>
            <div className="text-xs text-slate-600 font-medium">現状比 {fmtSignedMJPY(target - baseline)}</div>
          </div>
        </div>
      </div>

      <div className="pt-3 border-t border-slate-100">
        <div className="text-xs text-slate-600">目標までの不足</div>
        <div className={`mt-1 text-base font-semibold ${gap > 0 ? 'text-slate-900' : 'text-slate-500'}`}>
          {gap > 0 ? `+${fmtMJPY(gap)}` : '達成済み'}
        </div>
      </div>
    </div>
  );
}

export function TabValueDashboard({
  northStarRows,
  dashboardSummary,
}: Props) {
  console.log('[STAGE6] TabValueDashboard: top review section removed');

  return (
    <section className="space-y-6">
      <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
        <div className="mb-5">
          <h3 className="text-base font-semibold text-slate-900">会社業績の3本比較</h3>
          <p className="mt-2 text-sm text-slate-600">
            現状、見込み、目標を並べて、目標達成見込みを確認します。
          </p>
        </div>
        <div className="grid gap-5 md:grid-cols-2">
          {dashboardSummary && (
            <>
              <ThreeBarChart
                title="売上"
                baseline={dashboardSummary.revenue.baseline}
                forecast={dashboardSummary.revenue.forecast}
                target={dashboardSummary.revenue.target}
                gap={dashboardSummary.revenue.gap}
              />
              <ThreeBarChart
                title="営業利益"
                baseline={dashboardSummary.op.baseline}
                forecast={dashboardSummary.op.forecast}
                target={dashboardSummary.op.target}
                gap={dashboardSummary.op.gap}
              />
            </>
          )}
        </div>
      </section>
    </section>
  );
}
