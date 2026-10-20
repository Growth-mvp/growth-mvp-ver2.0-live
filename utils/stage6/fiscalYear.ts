const MONTH_PATTERN = /^0?([1-9]|1[0-2])$/;

/**
 * 決算月を '1'〜'12' の文字列に正規化する。未設定・不正値は '' を返す（0月などの推定補完はしない）。
 */
export function normalizeFiscalYearEnd(value: unknown): string {
  if (typeof value === 'number') {
    return Number.isInteger(value) && value >= 1 && value <= 12 ? String(value) : '';
  }
  if (typeof value !== 'string') return '';
  const trimmed = value.trim();
  const match = MONTH_PATTERN.exec(trimmed);
  return match ? String(Number(match[1])) : '';
}

export const FISCAL_YEAR_END_MONTHS: readonly number[] = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12];
