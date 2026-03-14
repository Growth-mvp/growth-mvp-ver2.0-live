'use client';

import React, { useMemo } from 'react';

type Props = {
  northStarRows: any[];
  dashboardSummary?: {
    revenue: { baseline: number; forecast: number; target: number; gap: number };
    op: { baseline: number; forecast: number; target: number; gap: number };
  };
  fourMetricCards?: Array<{
    key: string;
    label: string;
    current?: number;
    forecast?: number;
    target?: number;
    unit: string;
  }>;
};

// Format helpers
function fmtMJPY(x: number | null | undefined) {
  if (x === null || x === undefined || !Number.isFinite(x)) return '-';
  return `${Math.round(x).toLocaleString()} 百万円`;
}

function fmtPct(x: number | null | undefined) {
  if (x === null || x === undefined || !Number.isFinite(x)) return '-';
  return `${x.toFixed(1)}%`;
}

// Format with explicit sign prefix (+ or -)
function fmtSignedMJPY(v: number): string {
  if (!Number.isFinite(v)) return '-';
  const sign = v > 0 ? '+' : v < 0 ? '-' : '±';
  return `${sign}${fmtMJPY(Math.abs(v))}`;
}

// Bar ratio calculation helper - max-based relative ratio (0-100%)
// ★ 棒グラフ差分修正: max 値を100%とする相対比率で計算
function calcBarRatio(values: number[], value: number): number {
  const max = Math.max(...values, 1);
  return Math.max(0, Math.min(100, (value / max) * 100));
}

// Three-bar chart component (baseline / forecast / target)
// ★ 最終仕上げ1: 比較チャート化、太い横棒、広い縦間隔
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
  // Calculate bar widths based on max value in this card (0-100%)
  // ★ 棒グラフ差分修正: max 基準の相対比率を使用（padding なし）
  const values = [baseline, forecast, target];
  const baselineWidth = calcBarRatio(values, baseline);
  const forecastWidth = calcBarRatio(values, forecast);
  const targetWidth = calcBarRatio(values, target);

  const achievementPct = target > 0 ? Math.round((forecast / target) * 100) : 0;

  // Debug logging to verify ratio calculations
  if (typeof window !== 'undefined') {
    console.log(`[ThreeBarChart] ${title}: baseline=${baselineWidth.toFixed(1)}%, forecast=${forecastWidth.toFixed(1)}%, target=${targetWidth.toFixed(1)}%`);
  }

  return (
    <div className="rounded-xl border border-slate-200 bg-white p-6 space-y-5">
      {/* Header */}
      <div>
        <div className="text-base font-semibold text-slate-900">{title}</div>
        <div className="mt-2 text-sm text-slate-600">
          達成見込み: <span className="text-slate-900 font-semibold">{achievementPct}%</span>
        </div>
      </div>

      {/* Bars - Comparison Chart with Delta Display */}
      <div className="space-y-4">
        {/* Baseline */}
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

        {/* Forecast */}
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

        {/* Target */}
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

      {/* Gap info */}
      <div className="pt-3 border-t border-slate-100">
        <div className="text-xs text-slate-600">目標までの不足</div>
        <div className={`mt-1 text-base font-semibold ${gap > 0 ? 'text-slate-900' : 'text-slate-500'}`}>
          {gap > 0 ? `+${fmtMJPY(gap)}` : '達成済み'}
        </div>
      </div>
    </div>
  );
}

// Four metric card component
// ★ 最終仕上げ2: ダッシュをやめて「未算出」と表示、注釈を追加
function FourMetricCard({
  label,
  current,
  forecast,
  target,
  unit,
}: {
  label: string;
  current?: number;
  forecast?: number;
  target?: number;
  unit: string;
}) {
  const fmtValue = (v?: number) => {
    if (!Number.isFinite(v as any)) return '未算出';
    return `${(v as number).toFixed(1)}`;
  };

  // Determine caption based on what values are present
  const getCaption = () => {
    if (label === 'WACC') return '現状値のみ表示';
    if (Number.isFinite(target as any)) {
      if (label === '売上CAGR') return '売上目標から算出';
      if (label === '営業利益率') return '売上・営業利益目標から算出';
      if (label === 'ROIC') return '営業利益目標から算出';
    }
    return '現状値のみ表示';
  };

  return (
    <div className="rounded-xl border border-slate-200 bg-white p-5 space-y-4">
      <div className="text-xs font-semibold text-slate-600">{label}</div>

      <div className="space-y-4">
        {/* Current */}
        <div>
          <div className="text-xs text-slate-600 mb-2">現状</div>
          <div className="text-lg font-semibold text-slate-900">
            {fmtValue(current)}<span className="text-xs text-slate-600 ml-1">{unit}</span>
          </div>
        </div>

        {/* Forecast */}
        <div>
          <div className="text-xs text-slate-600 mb-2">見込み</div>
          <div className="text-lg font-semibold text-slate-900">
            {fmtValue(forecast)}<span className="text-xs text-slate-600 ml-1">{unit}</span>
          </div>
        </div>

        {/* Target - Show only if defined */}
        {Number.isFinite(target as any) && (
          <div>
            <div className="text-xs text-slate-600 mb-2">参考値</div>
            <div className="text-lg font-semibold text-slate-900">
              {fmtValue(target)}<span className="text-xs text-slate-600 ml-1">{unit}</span>
            </div>
          </div>
        )}
      </div>

      {/* Caption */}
      <div className="pt-2 border-t border-slate-100">
        <div className="text-xs text-slate-500">{getCaption()}</div>
      </div>
    </div>
  );
}

export function TabValueDashboard({
  northStarRows,
  dashboardSummary,
  fourMetricCards = [],
}: Props) {
  console.log('[STAGE6] TabValueDashboard: component loaded with updated structure');

  // Compute actions based on gap
  const actions = useMemo(() => {
    const revenueGap = dashboardSummary?.revenue.gap ?? 0;
    const opGap = dashboardSummary?.op.gap ?? 0;

    const actionList: { title: string; detail: string }[] = [];

    if (opGap > 0) {
      actionList.push({
        title: `営業利益を +${fmtMJPY(opGap)} 上積みする手当て`,
        detail:
          '利益寄与の大きいプロジェクトを強化するか、利益寄与の計画を追加してください。STAGE4で計画寄与を見直すと説明可能性が上がります。',
      });
    }

    if (revenueGap > 0) {
      actionList.push({
        title: `売上を +${fmtMJPY(revenueGap)} 上積みする手当て`,
        detail:
          '売上寄与の大きいプロジェクトを増やすか、既存プロジェクトの寄与を引き上げてください。',
      });
    }

    if (actionList.length === 0) {
      actionList.push({
        title: '次のアクション',
        detail:
          '大きな未達は見えていません。プロジェクト寄与の内訳を確認し、実行度の低いプロジェクトを重点管理してください。',
      });
    }

    return actionList.slice(0, 4);
  }, [dashboardSummary]);

  return (
    <section className="space-y-6">
      {/* 3-Bar Charts: Revenue and Operating Income */}
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

      {/* 4-Metric Cards */}
      <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
        <div className="mb-5">
          <h3 className="text-base font-semibold text-slate-900">主要4指標の見込み</h3>
          <p className="mt-2 text-sm text-slate-600">
            売上成長、利益率、投下資本効率、資本コストを現状・見込みで確認します。
          </p>
        </div>
        <div className="grid gap-4 md:grid-cols-4">
          {fourMetricCards && fourMetricCards.length > 0 ? (
            fourMetricCards.map((card) => (
              <FourMetricCard
                key={card.key}
                label={card.label}
                current={card.current}
                forecast={card.forecast}
                target={card.target}
                unit={card.unit}
              />
            ))
          ) : (
            <div className="col-span-4 rounded-lg bg-slate-50 p-4 text-sm text-slate-600">
              4指標データが準備できていません。
            </div>
          )}
        </div>
      </section>

      {/* Next Actions */}
      <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
        <div className="mb-5">
          <h3 className="text-base font-semibold text-slate-900">次に取るべきアクション</h3>
          <p className="mt-2 text-sm text-slate-600">
            目標を達成するために、次にやるべきことを示します。
          </p>
        </div>
        <div className="grid gap-4 md:grid-cols-2">
          {actions.map((a) => (
            <div key={a.title} className="rounded-xl border border-slate-200 p-5 space-y-2">
              <div className="font-semibold text-slate-900">{a.title}</div>
              <div className="text-sm text-slate-700">{a.detail}</div>
              <div className="pt-2 text-xs text-slate-500">操作場所：STAGE4 / プロジェクト寄与一覧</div>
            </div>
          ))}
        </div>
      </section>
    </section>
  );
}
