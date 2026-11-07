/**
 * 過去実績の表示。元の数値は変えず、円で確認済みの年度だけを百万円に換算して表示する。
 * 単位が未確認の年度は換算せず、カンマを付けるだけにする。
 */
export function formatHistoricalAmount(value: unknown, unit: string | undefined): string {
  if (value === undefined || value === null) return '-';
  if (typeof value !== 'number' || !Number.isFinite(value)) return String(value);
  if (unit === '円') {
    return (value / 1_000_000).toLocaleString('ja-JP', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
  }
  return Number.isInteger(value) ? value.toLocaleString('ja-JP') : String(value);
}

export function historicalUnitLabel(unit: string | undefined): string {
  return unit === '円' ? '百万円' : unit || '未確認';
}
