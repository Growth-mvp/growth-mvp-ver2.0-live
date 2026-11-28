import type { BusinessPortfolio, BusinessUnit, FinancePLRow, ValueAnalysis } from '@/types/strategy';

/** 事業ポートフォリオの固定の設定（STAGE1→2の引き渡しで自動生成する分の設定値） */
const GENERATED_META = {
  unitType: 'business',
  periodLabel: 'FY2025',
  currency: 'JPY',
  threshold: { growthBaseline: 0, profitBaseline: 0 },
} as const;

export type PortfolioInput = {
  segments: ReadonlyArray<{ name?: string }>;
  segmentValueAnalysis?: Record<string, ValueAnalysis>;
  segmentPL?: Record<string, FinancePLRow[]>;
  /** 既存の単位。分析の値がまだない事業は、既存の値を残す */
  fallback?: BusinessPortfolio | null;
};

/** 事業セグメントから事業ポートフォリオを生成する（単位の ID は事業名） */
export function buildBusinessPortfolio(input: PortfolioInput): BusinessPortfolio | null {
  const names = input.segments.map((s) => s?.name).filter((n): n is string => Boolean(n));
  if (names.length === 0) return null;

  const units: BusinessUnit[] = names.map((name) => {
    const va = input.segmentValueAnalysis?.[name] as
      | { revenueCagrPct?: unknown; operatingMarginPctLatest?: unknown }
      | undefined;
    const old = input.fallback?.units.find((u) => u.name === name);
    const rows = input.segmentPL?.[name];
    const lastRow = Array.isArray(rows) && rows.length > 0 ? rows[rows.length - 1] : undefined;
    const latestRevenue = typeof lastRow?.revenue === 'number' ? lastRow.revenue : 0;
    return {
      id: name,
      name,
      growthRate: typeof va?.revenueCagrPct === 'number' ? va.revenueCagrPct : va ? 0 : (old?.growthRate ?? 0),
      profitMargin:
        typeof va?.operatingMarginPctLatest === 'number' ? va.operatingMarginPctLatest : va ? 0 : (old?.profitMargin ?? 0),
      revenueShare: latestRevenue > 0 ? 100 / names.length : 0, // 均等配分（簡易）
    };
  });

  return { ...GENERATED_META, threshold: { ...GENERATED_META.threshold }, units };
}

/**
 * 事業ポートフォリオが、事業セグメントからの自動生成の形のままか。
 * 生成元と違う設定値、事業と一致しない単位がある場合は、独立して編集された可能性があるため false
 */
export function isGeneratedPortfolio(p: BusinessPortfolio | null | undefined, segmentNames: readonly string[]): boolean {
  if (!p) return true;
  if (p.unitType !== GENERATED_META.unitType || p.periodLabel !== GENERATED_META.periodLabel || p.currency !== GENERATED_META.currency) {
    return false;
  }
  if (p.threshold?.growthBaseline !== 0 || p.threshold?.profitBaseline !== 0) return false;
  if (!Array.isArray(p.units)) return false;
  return p.units.every((u) => u.id === u.name && segmentNames.includes(u.name));
}
