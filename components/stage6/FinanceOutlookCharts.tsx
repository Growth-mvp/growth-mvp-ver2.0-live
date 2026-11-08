'use client';

import {
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { formatMil } from './financeSummaryModel';
import type { OutlookChartMetric, OutlookCharts } from './financeOutlookChartModel';

const PLAN_COLOR = '#4f46e5';
const BASELINE_COLOR = '#94a3b8';
const TARGET_COLOR = '#e11d48';

function ChartCard({ metric }: { metric: OutlookChartMetric }) {
  const data = metric.points.map((p) => ({
    name: `${p.fiscalYear}年`,
    baseline: p.baselineMil,
    plan: p.planMil,
    target: metric.targetInRange && p.fiscalYear === metric.targetFiscalYear ? metric.targetMil : null,
  }));
  return (
    <div className="min-w-0 rounded-xl border border-slate-200 bg-white p-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h4 className="text-sm font-bold text-slate-900">{metric.label}の見通し</h4>
        <span className="text-xs font-semibold text-slate-600">単位：百万円</span>
      </div>
      <p className="mt-1 text-sm font-semibold text-slate-900">{metric.headline}</p>
      {metric.targetMil !== null && (
        <p className="mt-0.5 text-xs text-slate-700">
          経営目標 {formatMil(metric.targetMil * 1_000_000)} 百万円
          {metric.targetFiscalYear !== null ? `（${metric.targetFiscalYear}年度）` : ''}
        </p>
      )}
      <div className="mt-2 h-56" role="img" aria-label={`${metric.label}の経年グラフ`}>
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={data} margin={{ top: 12, right: 16, left: 4, bottom: 4 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
            <XAxis dataKey="name" tick={{ fontSize: 12, fill: '#334155' }} tickLine={false} />
            <YAxis tick={{ fontSize: 11, fill: '#475569' }} width={56} domain={['auto', 'auto']} />
            <Tooltip formatter={(v) => (typeof v === 'number' ? formatMil(v * 1_000_000) : '未算定')} />
            <Legend iconSize={10} wrapperStyle={{ fontSize: 12 }} />
            <Line
              type="linear"
              dataKey="baseline"
              name="既存事業の見通し"
              stroke={BASELINE_COLOR}
              strokeDasharray="5 4"
              dot={false}
              connectNulls={false}
              isAnimationActive={false}
            />
            <Line
              type="linear"
              dataKey="plan"
              name="施策効果を反映した見通し"
              stroke={PLAN_COLOR}
              strokeWidth={2}
              connectNulls={false}
              isAnimationActive={false}
            />
            <Line
              type="linear"
              dataKey="target"
              name="経営目標"
              stroke={TARGET_COLOR}
              strokeWidth={0}
              dot={{ r: 6, fill: TARGET_COLOR, stroke: '#fff', strokeWidth: 1 }}
              activeDot={{ r: 7 }}
              connectNulls={false}
              isAnimationActive={false}
            />
          </LineChart>
        </ResponsiveContainer>
      </div>
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
      <p
        className={`rounded-lg px-3 py-2 text-xs ${charts.basis === 'FLAT' ? 'bg-amber-50 text-amber-900' : 'bg-emerald-50 text-emerald-900'}`}
      >
        {charts.basisText}。施策効果は確認済みのものだけを加算しています（確定予測ではありません）。
      </p>
      <div className="grid grid-cols-1 gap-4 2xl:grid-cols-2">
        <ChartCard metric={charts.revenue} />
        <ChartCard metric={charts.operatingIncome} />
      </div>
    </section>
  );
}
