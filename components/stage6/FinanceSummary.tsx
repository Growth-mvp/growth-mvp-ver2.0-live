'use client';

import { Bar, BarChart, Cell, LabelList, Legend, ReferenceLine, ResponsiveContainer, XAxis, YAxis } from 'recharts';
import { moveLabelOf, type FinanceTab } from './financePlanStatus';
import {
  achievementPct,
  cashChartOf,
  formatMil,
  formatPct,
  gapText,
  type CashSummary,
  type FundingStatus,
  type MetricSummary,
  type TargetSummary,
} from './financeSummaryModel';

const PLAN_COLOR = '#4f46e5';
const BASELINE_COLOR = '#cbd5e1';
const NEGATIVE_COLOR = '#e11d48';
const LABEL_COLOR = '#0f172a';

type Props = {
  target: TargetSummary;
  cash: CashSummary;
  funding: FundingStatus;
  requiredItem: { count: number; tab: FinanceTab } | null;
  onNavigate: (tab: FinanceTab) => void;
};

function metricStatusText(metric: Exclude<MetricSummary, { status: 'READY' }>, label: string): string {
  switch (metric.status) {
    case 'NO_TARGET':
      return `${label}の経営目標が未設定です（STAGE2で設定）`;
    case 'NO_DUE_YEAR':
      return `目標 ${formatMil(metric.targetYen)} 百万円。目標年度が未設定です`;
    case 'OUT_OF_RANGE':
      return `目標年度（${metric.fiscalYear}年度）が予測期間外です`;
    case 'PLAN_UNKNOWN':
      return `目標 ${formatMil(metric.targetYen)} 百万円。試算は未算定です`;
  }
}

function MetricCard({ label, metric }: { label: string; metric: MetricSummary }) {
  if (metric.status !== 'READY') {
    return (
      <div className="min-w-0 rounded-xl border border-slate-200 bg-white p-4">
        <div className="text-sm font-bold text-slate-900">{label}</div>
        <p className="mt-2 text-sm leading-relaxed text-slate-700">{metricStatusText(metric, label)}</p>
      </div>
    );
  }
  const pct = achievementPct(metric);
  const barWidth = pct === null ? 0 : Math.min(Math.max(pct, 0), 100);
  return (
    <div className="min-w-0 rounded-xl border border-slate-200 bg-white p-4">
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-sm font-bold text-slate-900">{label}</span>
        <span className="text-xs font-semibold text-slate-600">{metric.fiscalYear}年度</span>
      </div>
      {pct === null ? (
        <p className="mt-2 text-sm text-slate-700">目標がゼロ以下のため達成率は表示しません</p>
      ) : (
        <>
          <div className="mt-1 text-3xl font-bold leading-tight text-slate-900">{formatPct(pct)}</div>
          <div className="text-xs text-slate-600">達成率（試算 ÷ 目標）</div>
          <div
            role="progressbar"
            aria-label={`${label}の達成率`}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={Math.round(barWidth)}
            className="mt-2 h-2 w-full rounded-full bg-slate-200"
          >
            <div className="h-2 rounded-full bg-indigo-600" style={{ width: `${barWidth}%` }} />
          </div>
        </>
      )}
      <div className="mt-3 text-sm text-slate-800">
        目標 <span className="font-semibold">{formatMil(metric.targetYen)}</span>
        <span className="mx-1 text-slate-400">／</span>
        試算 <span className="font-semibold">{formatMil(metric.planYen)}</span> 百万円
      </div>
      <div className="mt-1 text-sm font-bold text-slate-900">{gapText(metric.gapYen)}</div>
    </div>
  );
}

/* 負の値は棒の下に、正の値は棒の上に数値を置く（Recharts の標準配置を使う） */
function valueLabels(prefix: string) {
  return (
    <>
      <LabelList dataKey={`${prefix}Pos`} position="top" fontSize={12} fill={LABEL_COLOR} />
      <LabelList dataKey={`${prefix}Neg`} position="bottom" fontSize={12} fill={LABEL_COLOR} />
    </>
  );
}

function withSignedLabels<T extends { text: string }>(
  row: T,
  prefix: string,
): Record<string, string> {
  const negative = row.text.startsWith('-');
  return { [`${prefix}Pos`]: negative ? '' : row.text, [`${prefix}Neg`]: negative ? row.text : '' };
}

function CashCard({ cash }: { cash: CashSummary }) {
  const chart = cashChartOf(cash);
  return (
    <div className="min-w-0">
      <div className="text-sm font-bold text-slate-900">事業キャッシュフロー（営業CF）</div>
      {chart.mode === 'NONE' && <p className="mt-2 text-sm text-slate-700">推計年度がありません。</p>}
      {chart.mode === 'UNCALCULATED' && (
        <p className="mt-2 text-sm text-slate-700">施策反映後の営業CFは未算定です（詳細はタブ2）</p>
      )}
      {chart.mode === 'SINGLE' && (
        <>
          <p className="mt-1 text-xs text-slate-600">施策効果による差はありません</p>
          <div className="mt-2 h-40">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart
                data={chart.rows.map((r) => ({ name: r.name, mil: r.mil, ...withSignedLabels(r, 'value') }))}
                margin={{ top: 20, right: 4, left: 4, bottom: 22 }}
              >
                <XAxis dataKey="name" interval={0} tick={{ fontSize: 12, fill: '#334155' }} tickLine={false} />
                <YAxis hide domain={['auto', 'auto']} />
                <ReferenceLine y={0} stroke="#64748b" />
                <Bar dataKey="mil" isAnimationActive={false}>
                  {chart.rows.map((r) => (
                    <Cell key={r.name} fill={r.mil < 0 ? NEGATIVE_COLOR : PLAN_COLOR} />
                  ))}
                  {valueLabels('value')}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </>
      )}
      {chart.mode === 'COMPARE' && (
        <>
          <div className="mt-2 h-40">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart
                data={chart.rows.map((r) => ({
                  name: r.name,
                  baseline: r.baseline,
                  conditional: r.conditional,
                  ...withSignedLabels({ text: r.baselineText }, 'baseline'),
                  ...withSignedLabels({ text: r.conditionalText }, 'conditional'),
                }))}
                margin={{ top: 20, right: 4, left: 4, bottom: 22 }}
              >
                <XAxis dataKey="name" interval={0} tick={{ fontSize: 12, fill: '#334155' }} tickLine={false} />
                <YAxis hide domain={['auto', 'auto']} />
                <Legend iconSize={10} wrapperStyle={{ fontSize: 12 }} />
                <ReferenceLine y={0} stroke="#64748b" />
                <Bar dataKey="baseline" name="横ばい" fill={BASELINE_COLOR} isAnimationActive={false}>
                  {valueLabels('baseline')}
                </Bar>
                <Bar dataKey="conditional" name="施策反映後" fill={PLAN_COLOR} isAnimationActive={false}>
                  {chart.rows.map((r) => (
                    <Cell key={r.name} fill={r.conditional !== null && r.conditional < 0 ? NEGATIVE_COLOR : PLAN_COLOR} />
                  ))}
                  {valueLabels('conditional')}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
          {chart.unknownYears.length > 0 && (
            <p className="mt-1 text-xs text-slate-600">
              未算定：{chart.unknownYears.map((y) => `${y}年`).join('、')}（棒なし）
            </p>
          )}
        </>
      )}
      {(chart.mode === 'SINGLE' || chart.mode === 'COMPARE') && (
        <p className="mt-1 text-xs text-slate-600">単位：百万円。赤い棒はマイナス</p>
      )}
    </div>
  );
}

function FundingCard({ funding, requiredItem, onNavigate }: Pick<Props, 'funding' | 'requiredItem' | 'onNavigate'>) {
  return (
    <div className="min-w-0 space-y-3">
      <div className="text-sm font-bold text-slate-900">借入・返済の見通し</div>
      {funding.kind === 'TARGET_PATH_IN_USE' ? (
        <p className="text-sm text-slate-700">補間の前提を入力中のため非表示（タブ5で確認）</p>
      ) : (
        <div>
          <div className="text-base font-bold text-slate-900">{funding.label}</div>
          {funding.detail && <p className="mt-0.5 text-sm text-slate-700">{funding.detail}</p>}
          <p className="mt-1 text-xs text-slate-600">参考（施策効果を含まない簡易判定）</p>
        </div>
      )}
      {requiredItem && (
        <div className="flex flex-col items-start gap-2 rounded-lg border border-slate-200 bg-slate-50 p-3 text-sm text-slate-800">
          <span>判定に影響する未確認 {requiredItem.count}件</span>
          <button
            type="button"
            onClick={() => onNavigate(requiredItem.tab)}
            className="whitespace-nowrap rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50"
          >
            {moveLabelOf(requiredItem.tab)}
          </button>
        </div>
      )}
    </div>
  );
}

export function FinanceSummary({ target, cash, funding, requiredItem, onNavigate }: Props) {
  return (
    <section aria-label="経営計画のサマリー" className="space-y-3">
      <div className="rounded-2xl border border-slate-200 bg-white p-4">
        <div className="flex flex-wrap items-baseline justify-between gap-x-3">
          <h3 className="text-base font-bold text-slate-900">① 目標達成の状況</h3>
          <p className="text-xs text-slate-600">施策効果を反映した試算（確定予測ではありません）</p>
        </div>
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          <MetricCard label="売上高" metric={target.revenue} />
          <MetricCard label="営業利益" metric={target.operatingIncome} />
        </div>
      </div>

      <div className="rounded-2xl border border-slate-200 bg-white p-4">
        <h3 className="text-base font-bold text-slate-900">② 資金の状況</h3>
        <div className="mt-3 grid gap-4 md:grid-cols-2">
          <CashCard cash={cash} />
          <FundingCard funding={funding} requiredItem={requiredItem} onNavigate={onNavigate} />
        </div>
      </div>
    </section>
  );
}
