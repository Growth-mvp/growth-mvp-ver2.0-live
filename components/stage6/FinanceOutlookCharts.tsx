'use client';

import {
  CartesianGrid,
  ComposedChart,
  Legend,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { formatMil } from './financeSummaryModel';
import type { OutlookChartMetric, OutlookCharts } from './financeOutlookChartModel';
import { CHART_COLORS } from '@/lib/ui/tokens';

const millionText = (v: number | null) => (v === null ? '未算定' : formatMil(v * 1_000_000));
const signedMillionText = (v: number) => `${v > 0 ? '+' : v < 0 ? '−' : ''}${formatMil(Math.abs(v) * 1_000_000)}`;

function ChartCard({ metric }: { metric: OutlookChartMetric }) {
  const data = metric.points.map((p) => ({
    name: `${p.fiscalYear}年`,
    baseline: p.baselineMil,
    improvement: p.improvementMil,
    plan: p.planMil,
    reference: p.referenceMil,
    target: metric.targetInRange && p.fiscalYear === metric.targetFiscalYear ? metric.targetMil : null,
  }));
  const improvedYears = metric.points.filter((p) => p.kind === 'FORECAST' && (p.improvementMil ?? 0) !== 0);
  return (
    <div className="min-w-0 rounded-2xl bg-slate-50/70 p-5">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h4 className="text-sm font-medium text-slate-500">{metric.label}の見通し</h4>
        <span className="text-[11px] text-slate-500">単位：百万円</span>
      </div>
      <p className="mt-1 text-lg font-semibold tracking-tight text-slate-900">{metric.headline}</p>
      {metric.targetMil !== null && (
        <p className="mt-0.5 text-[11px] text-slate-500">
          経営目標 {formatMil(metric.targetMil * 1_000_000)} 百万円
          {metric.targetFiscalYear !== null ? `（${metric.targetFiscalYear}年度）` : ''}
        </p>
      )}
      <div className="mt-3 h-52" role="img" aria-label={`${metric.label}の経年グラフ`}>
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={data} margin={{ top: 12, right: 16, left: 4, bottom: 4 }}>
            <CartesianGrid strokeDasharray="3 3" stroke={CHART_COLORS.grid} />
            <XAxis dataKey="name" tick={{ fontSize: 12, fill: CHART_COLORS.axis }} tickLine={false} />
            <YAxis tick={{ fontSize: 11, fill: CHART_COLORS.axis }} width={56} domain={['auto', 'auto']} />
            <Tooltip formatter={(v) => (typeof v === 'number' ? formatMil(v * 1_000_000) : '未算定')} />
            <Legend iconSize={10} wrapperStyle={{ fontSize: 12 }} />
            <Line
              type="linear"
              dataKey="baseline"
              name="既存事業の見通し"
              stroke={CHART_COLORS.baseline}
              strokeWidth={2}
              strokeDasharray="5 4"
              dot={false}
              connectNulls={false}
              isAnimationActive={false}
            />
            <Line
              type="linear"
              dataKey="plan"
              name="施策効果を反映した見通し"
              stroke={CHART_COLORS.companyTarget}
              strokeWidth={2}
              connectNulls={false}
              isAnimationActive={false}
            />
            <Line
              type="linear"
              dataKey="target"
              name="経営目標"
              stroke={CHART_COLORS.targetPoint}
              strokeWidth={0}
              dot={{ r: 6, fill: CHART_COLORS.targetPoint, stroke: '#fff', strokeWidth: 1 }}
              activeDot={{ r: 7 }}
              connectNulls={false}
              isAnimationActive={false}
            />
          </ComposedChart>
        </ResponsiveContainer>
      </div>
      {improvedYears.length > 0 && (
        <details className="mt-2 rounded-lg bg-slate-50 px-3 py-2 text-xs text-slate-700">
          <summary className="cursor-pointer font-semibold text-slate-800">年度別の計算内訳</summary>
          <ul className="mt-2 space-y-0.5">
            {improvedYears.map((p) => (
              <li key={p.fiscalYear}>
                {p.fiscalYear}年：既存 {millionText(p.baselineMil)} ＋ 確認済みの改善 {signedMillionText(p.improvementMil ?? 0)} ＝ 算定済み分の参考値{' '}
                {millionText(p.referenceMil)}（百万円）
              </li>
            ))}
            <li className="text-slate-600">参考値は、未算定の項目（売上増加の営業利益など）を含みません。全体の確定見通しではありません。</li>
          </ul>
        </details>
      )}
      {metric.unknownYears.length > 0 && (
        <div className="mt-2 text-xs text-slate-700">
          <p className="text-xs text-slate-700">
            未算定：{metric.unknownYears.map((y) => `${y}年`).join('、')}（線を描いていません。0としては扱いません）
          </p>
          {metric.unknownReasons.map((r) => (
            <p key={r} className="mt-0.5 text-xs text-slate-600">
              理由：{r}
            </p>
          ))}
        </div>
      )}
    </div>
  );
}

export function FinanceOutlookCharts({ charts }: { charts: OutlookCharts }) {
  return (
    <section aria-label="売上高と営業利益の経年グラフ" className="space-y-2">
      <p className="text-[11px] leading-5 text-slate-500">
        {charts.basisText}。確認済みの施策効果のみを加算（確定予測ではありません）
      </p>
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <ChartCard metric={charts.revenue} />
        <ChartCard metric={charts.operatingIncome} />
      </div>
    </section>
  );
}
