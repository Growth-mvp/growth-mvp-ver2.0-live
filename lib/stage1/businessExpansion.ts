import type { BusinessExpansionScope } from '@/types/strategy';

export const EXPANSION_SCOPE_OPTIONS: ReadonlyArray<{ value: BusinessExpansionScope; label: string }> = [
  { value: 'domestic', label: '国内中心' },
  { value: 'overseas', label: '海外中心' },
  { value: 'both', label: '国内・海外の両方' },
];

/** 海外の国・地域の許可リスト。UI の選択肢・サーバーの検証・検索ラベルの唯一の定義元 */
export const OVERSEAS_REGION_OPTIONS = [
  '東南アジア',
  '中国',
  '韓国・台湾',
  'インド',
  '北米',
  '中南米',
  '欧州',
  '中東',
  'アフリカ',
  'オセアニア',
] as const;

export type OverseasRegion = (typeof OVERSEAS_REGION_OPTIONS)[number];

export const DOMESTIC_SEARCH_LABEL = '日本国内';
export const OVERSEAS_UNSPECIFIED_SEARCH_LABEL = '海外（国・地域は未指定）';

export function normalizeExpansionScope(value: unknown): BusinessExpansionScope | undefined {
  return EXPANSION_SCOPE_OPTIONS.find((o) => o.value === value)?.value;
}

/** 許可リストに一致する値だけを、リストの順に重複なく返す（自由入力・不正値は捨てる） */
export function sanitizeOverseasRegions(input: unknown): OverseasRegion[] {
  if (!Array.isArray(input)) return [];
  return OVERSEAS_REGION_OPTIONS.filter((region) => input.includes(region));
}

export function toggleOverseasRegion(current: unknown, value: string): OverseasRegion[] {
  const selected = sanitizeOverseasRegions(current);
  if (!(OVERSEAS_REGION_OPTIONS as readonly string[]).includes(value)) return selected;
  const next = selected.includes(value as OverseasRegion)
    ? selected.filter((r) => r !== value)
    : [...selected, value as OverseasRegion];
  return sanitizeOverseasRegions(next);
}

export type SegmentMarketInput = { expansionScope?: unknown; overseasRegions?: unknown };

/**
 * SWOT 検索へ渡す現在の事業展開地域の参考ラベル。許可リストの値だけを使い、
 * 探索対象を限定しない。事業名・概要・顧客・自由入力は含めない。
 */
export function currentRegionLabels(segments: SegmentMarketInput[]): string[] {
  const labels: string[] = [];
  const add = (label: string) => {
    if (!labels.includes(label)) labels.push(label);
  };
  for (const seg of segments) {
    const scope = normalizeExpansionScope(seg.expansionScope);
    if (!scope) continue;
    if (scope === 'domestic' || scope === 'both') add(DOMESTIC_SEARCH_LABEL);
    if (scope === 'overseas' || scope === 'both') {
      const regions = sanitizeOverseasRegions(seg.overseasRegions);
      add(regions.length ? `海外（${regions.join('、')}）` : OVERSEAS_UNSPECIFIED_SEARCH_LABEL);
    }
  }
  return labels;
}

/** 分析入力に出す事業ごとの現在の事業展開地域（許可リストの値だけを使う） */
export function segmentCurrentRegionText(seg: SegmentMarketInput): string {
  const scope = normalizeExpansionScope(seg.expansionScope);
  if (!scope) return '未入力';
  const regions = sanitizeOverseasRegions(seg.overseasRegions).join('、');
  if (scope === 'domestic') return '国内中心';
  if (scope === 'overseas') return `海外中心（${regions || '国・地域は未指定'}）`;
  return `国内・海外の両方（${regions || '海外の国・地域は未指定'}）`;
}
