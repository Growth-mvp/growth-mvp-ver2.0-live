import type { ConditionalCf } from '@/utils/stage6/conditionalCf';
import type { PlTarget, UnifiedPl, UnifiedPlMetricGap, UnifiedPlYear } from '@/utils/stage6/unifiedPl';
import type { RepaymentOutlook } from './financePlanStatus';

const MILLION = 1_000_000;

export function formatMil(yen: number): string {
  const text = (yen / MILLION).toLocaleString('ja-JP', { maximumFractionDigits: 1, minimumFractionDigits: 1 });
  return /^-0(\.0+)?$/.test(text) ? text.slice(1) : text;
}

export function gapText(gapYen: number): string {
  return gapYen > 0 ? `不足 ${formatMil(gapYen)} 百万円` : `目標を達成（${formatMil(Math.abs(gapYen))} 百万円超過）`;
}

export function formatPct(pct: number): string {
  const text = pct.toLocaleString('ja-JP', { maximumFractionDigits: 1, minimumFractionDigits: 1 });
  return `${/^-0(\.0+)?$/.test(text) ? text.slice(1) : text}%`;
}

export type MetricSummary =
  | { status: 'READY'; fiscalYear: number; targetYen: number; planYen: number; gapYen: number }
  | { status: 'NO_TARGET' }
  | { status: 'NO_DUE_YEAR'; targetYen: number }
  | { status: 'OUT_OF_RANGE'; targetYen: number; fiscalYear: number }
  | { status: 'PLAN_UNKNOWN'; targetYen: number; fiscalYear: number; reason: string };

export type TargetSummary = { revenue: MetricSummary; operatingIncome: MetricSummary };

/** 達成率（試算 ÷ 目標）。試算が確定し、目標が正の値のときだけ算出する */
export function achievementPct(metric: MetricSummary): number | null {
  if (metric.status !== 'READY' || metric.targetYen <= 0) return null;
  return (metric.planYen / metric.targetYen) * 100;
}

function metricSummary(args: {
  targetYen: number | null;
  dueYear: number | null;
  gap: UnifiedPlMetricGap | undefined;
  years: UnifiedPlYear[];
  planOf: (row: UnifiedPlYear) => number | null;
}): MetricSummary {
  const { targetYen, dueYear, gap, years, planOf } = args;
  if (targetYen === null) return { status: 'NO_TARGET' };
  if (dueYear === null) return { status: 'NO_DUE_YEAR', targetYen };
  const row = years.find((y) => y.fiscalYear === dueYear);
  if (!row) return { status: 'OUT_OF_RANGE', targetYen, fiscalYear: dueYear };
  const planYen = planOf(row);
  const gapYen = gap?.valueYen ?? null;
  if (planYen === null || gapYen === null) {
    return {
      status: 'PLAN_UNKNOWN',
      targetYen,
      fiscalYear: dueYear,
      reason: gap?.reason ?? '施策反映後の試算が未算定です',
    };
  }
  return { status: 'READY', fiscalYear: dueYear, targetYen, planYen, gapYen };
}

export function buildTargetSummary(args: { unifiedPl: UnifiedPl; target: PlTarget }): TargetSummary {
  const { unifiedPl, target } = args;
  return {
    revenue: metricSummary({
      targetYen: target.revenueYen,
      dueYear: target.revenueDueYear,
      gap: unifiedPl.gap?.revenue,
      years: unifiedPl.years,
      planOf: (row) => row.plan.revenueYen,
    }),
    operatingIncome: metricSummary({
      targetYen: target.operatingIncomeYen,
      dueYear: target.operatingIncomeDueYear,
      gap: unifiedPl.gap?.operatingIncome,
      years: unifiedPl.years,
      planOf: (row) => row.plan.operatingIncomeYen,
    }),
  };
}

export type CashPoint = { fiscalYear: number; baselineYen: number | null; conditionalYen: number | null };

export type CashSummary = { points: CashPoint[]; unknownReason: string | null };

export function buildCashSummary(cf: ConditionalCf): CashSummary {
  const points = cf.years.map((y) => ({
    fiscalYear: y.fiscalYear,
    baselineYen: y.operatingCf.baselineYen,
    conditionalYen: y.operatingCf.conditionalYen,
  }));
  const reasons = cf.years.filter((y) => y.operatingCf.conditionalYen === null).flatMap((y) => y.unknownReasons);
  return { points, unknownReason: reasons[0] ?? null };
}

export type FundingStatus =
  | { kind: 'TARGET_PATH_IN_USE' }
  | { kind: 'JUDGED'; label: string; detail: string; tone: RepaymentOutlook['tone'] };

export function buildFundingStatus(args: { targetPathInUse: boolean; outlook: RepaymentOutlook }): FundingStatus {
  const { targetPathInUse, outlook } = args;
  if (targetPathInUse) return { kind: 'TARGET_PATH_IN_USE' };
  if (outlook.label === '評価保留' && outlook.detail === '借入・配当が未入力です') {
    return { kind: 'JUDGED', label: '未入力のため保留', detail: '', tone: outlook.tone };
  }
  const detail = outlook.tone === 'warn' && outlook.detail ? `該当年度：${outlook.detail}` : outlook.detail;
  return { kind: 'JUDGED', label: outlook.label, detail, tone: outlook.tone };
}

export type CashChartRow = { name: string; mil: number; text: string };
export type CashComparisonRow = {
  name: string;
  baseline: number | null;
  conditional: number | null;
  baselineText: string;
  conditionalText: string;
};

export type CashChart =
  | { mode: 'NONE' }
  | { mode: 'UNCALCULATED' }
  | { mode: 'SINGLE'; rows: CashChartRow[] }
  | { mode: 'COMPARE'; rows: CashComparisonRow[]; unknownYears: number[] };

/** 施策反映前後が全年度で同じ（かつ全年度が算定済み）なら単一系列、それ以外は比較表示。未算定は0にしない */
export function cashChartOf(cash: CashSummary): CashChart {
  const { points } = cash;
  if (points.length === 0) return { mode: 'NONE' };
  if (points.every((p) => p.conditionalYen === null)) return { mode: 'UNCALCULATED' };
  const allSame = points.every((p) => p.conditionalYen !== null && p.baselineYen === p.conditionalYen);
  if (allSame) {
    return {
      mode: 'SINGLE',
      rows: points.map((p) => ({
        name: `${p.fiscalYear}年`,
        mil: (p.conditionalYen as number) / MILLION,
        text: formatMil(p.conditionalYen as number),
      })),
    };
  }
  return {
    mode: 'COMPARE',
    rows: points.map((p) => ({
      name: `${p.fiscalYear}年`,
      baseline: p.baselineYen === null ? null : p.baselineYen / MILLION,
      conditional: p.conditionalYen === null ? null : p.conditionalYen / MILLION,
      baselineText: p.baselineYen === null ? '' : formatMil(p.baselineYen),
      conditionalText: p.conditionalYen === null ? '' : formatMil(p.conditionalYen),
    })),
    unknownYears: points.filter((p) => p.conditionalYen === null).map((p) => p.fiscalYear),
  };
}
