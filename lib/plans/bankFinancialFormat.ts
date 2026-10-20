export type AllowedFigures = {
  yen: number[];
  fractions: number[];
};

export const UNCONFIRMED_TEXT = '未確定';

const MILLION = 1_000_000;

export function formatMillionYen(yen: number | null | undefined): string {
  if (yen === null || yen === undefined || !Number.isFinite(yen)) return UNCONFIRMED_TEXT;
  return (yen / MILLION).toLocaleString('ja-JP', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
}

export function formatMillionYenText(yen: number | null | undefined): string {
  const text = formatMillionYen(yen);
  return text === UNCONFIRMED_TEXT ? text : `${text}百万円`;
}

export function formatPercent(fraction: number | null | undefined): string {
  if (fraction === null || fraction === undefined || !Number.isFinite(fraction)) return UNCONFIRMED_TEXT;
  return `${(fraction * 100).toFixed(1)}%`;
}

export function formatRatio(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return UNCONFIRMED_TEXT;
  return `${value.toFixed(2)}倍`;
}

export function formatYearLabel(year: number): string {
  return `${year}年`;
}

const EXCLUDED_KEY = /year|month|count|label|note|basis|status|kind|verdict|hash|version|at$|id$/i;

/** 表示・引用されうる数値の集合（計算結果のみ）。LLM本文の数値検証に使う */
export function collectAllowedFigures(value: unknown, out: AllowedFigures = { yen: [], fractions: [] }, key = ''): AllowedFigures {
  if (typeof value === 'number') {
    if (!Number.isFinite(value) || EXCLUDED_KEY.test(key)) return out;
    if (Math.abs(value) < 1) out.fractions.push(value);
    else out.yen.push(value);
    return out;
  }
  if (Array.isArray(value)) {
    for (const item of value) collectAllowedFigures(item, out, key);
    return out;
  }
  if (value && typeof value === 'object') {
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) collectAllowedFigures(v, out, k);
  }
  return out;
}
