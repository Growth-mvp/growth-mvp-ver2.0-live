import type { FinanceOutlook } from '@/utils/stage6/financeOutlook';
import { achievementPct, formatPct, type MetricSummary, type TargetSummary } from './financeSummaryModel';

const MILLION = 1_000_000;

export type OutlookChartPoint = {
  fiscalYear: number;
  kind: 'ACTUAL' | 'FORECAST';
  /** 既存事業の見通し（百万円）。未算定は null */
  baselineMil: number | null;
  /** 施策効果を反映した見通し（百万円）。未算定は null（0にしない） */
  planMil: number | null;
};

export type OutlookChartMetric = {
  label: string;
  points: OutlookChartPoint[];
  targetMil: number | null;
  targetFiscalYear: number | null;
  /** 目標年度が試算の年度に含まれるときだけ、目標の印を描く */
  targetInRange: boolean;
  achievementPct: number | null;
  headline: string;
  unknownYears: number[];
  unknownReasons: string[];
};

export type OutlookCharts = {
  years: number[];
  basis: 'FLAT' | 'BASE_SCENARIO';
  basisText: string;
  revenue: OutlookChartMetric;
  operatingIncome: OutlookChartMetric;
};

const mil = (yen: number | null | undefined) => (typeof yen === 'number' ? yen / MILLION : null);

function headlineOf(metric: MetricSummary, label: string): string {
  switch (metric.status) {
    case 'READY': {
      const pct = achievementPct(metric);
      return pct === null ? '目標がゼロ以下のため達成率は表示しません' : `達成率 ${formatPct(pct)}（${metric.fiscalYear}年度）`;
    }
    case 'PLAN_UNKNOWN':
      return `${metric.fiscalYear}年度の${label}は未算定（理由は下記）`;
    case 'NO_TARGET':
      return `${label}の経営目標が未設定です（STAGE2で設定）`;
    case 'NO_DUE_YEAR':
      return `${label}の目標年度が未設定のため、達成率は出していません`;
    case 'OUT_OF_RANGE':
      return `目標年度（${metric.fiscalYear}年度）が試算期間の外のため、達成率は出していません`;
  }
}

function metricOf(args: {
  label: string;
  summary: MetricSummary;
  points: OutlookChartPoint[];
  unknownReasonsByYear: Map<number, string>;
}): OutlookChartMetric {
  const { label, summary, points, unknownReasonsByYear } = args;
  const targetMil = 'targetYen' in summary ? mil(summary.targetYen) : null;
  const targetFiscalYear = 'fiscalYear' in summary ? summary.fiscalYear : null;
  const forecastPoints = points.filter((p) => p.kind === 'FORECAST');
  const unknownYears = forecastPoints.filter((p) => p.planMil === null).map((p) => p.fiscalYear);
  const unknownReasons = [...new Set(unknownYears.map((y) => unknownReasonsByYear.get(y)).filter((r): r is string => !!r))];
  return {
    label,
    points,
    targetMil,
    targetFiscalYear,
    targetInRange: targetFiscalYear !== null && points.some((p) => p.fiscalYear === targetFiscalYear),
    achievementPct: achievementPct(summary),
    headline: headlineOf(summary, label),
    unknownYears,
    unknownReasons,
  };
}

/** 財務試算（共通の financeOutlook）の値を、グラフ用に並べ替えるだけの変換。新しい計算はしない */
export function buildOutlookCharts(outlook: FinanceOutlook, targetSummary: TargetSummary): OutlookCharts {
  const actual = outlook.baselinePlan.years.find((y) => y.kind === 'ACTUAL');
  const actualPoint: OutlookChartPoint | null = actual
    ? {
        fiscalYear: actual.year,
        kind: 'ACTUAL',
        baselineMil: mil(actual.revenue.value),
        planMil: mil(actual.revenue.value),
      }
    : null;
  const forecastRows = outlook.unifiedPl.years;
  const revenuePoints = [
    ...(actualPoint ? [actualPoint] : []),
    ...forecastRows.map((r) => ({
      fiscalYear: r.fiscalYear,
      kind: 'FORECAST' as const,
      baselineMil: mil(r.baseline.revenueYen),
      planMil: mil(r.plan.revenueYen),
    })),
  ];
  const operatingPoints = [
    ...(actual
      ? [{ fiscalYear: actual.year, kind: 'ACTUAL' as const, baselineMil: mil(actual.operatingIncome.value), planMil: mil(actual.operatingIncome.value) }]
      : []),
    ...forecastRows.map((r) => ({
      fiscalYear: r.fiscalYear,
      kind: 'FORECAST' as const,
      baselineMil: mil(r.baseline.operatingIncomeYen),
      planMil: mil(r.plan.operatingIncomeYen),
    })),
  ];
  const reasonsOf = (pick: (r: (typeof forecastRows)[number]) => number | null) =>
    new Map(forecastRows.filter((r) => pick(r) === null).map((r) => [r.fiscalYear, r.unknownReasons.join('、')] as const));

  const flat = outlook.baselinePlan.basisMode !== 'BASE_SCENARIO';
  return {
    years: [...(actual ? [actual.year] : []), ...forecastRows.map((r) => r.fiscalYear)],
    basis: flat ? 'FLAT' : 'BASE_SCENARIO',
    basisText: flat
      ? '横ばい仮定：既存事業の増減は未設定のため、直近実績を将来も横ばいに置いています'
      : '既存事業の年度別増減（利用者入力）を反映しています',
    revenue: metricOf({
      label: '売上高',
      summary: targetSummary.revenue,
      points: revenuePoints,
      unknownReasonsByYear: reasonsOf((r) => r.plan.revenueYen),
    }),
    operatingIncome: metricOf({
      label: '営業利益',
      summary: targetSummary.operatingIncome,
      points: operatingPoints,
      unknownReasonsByYear: reasonsOf((r) => r.plan.operatingIncomeYen),
    }),
  };
}
