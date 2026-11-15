/** 金額の規模に応じて、円・万円・百万円で表す（少額が0百万円にならないようにする） */
const oneDecimal = (n: number): string => (Math.round(n * 10) / 10).toLocaleString('ja-JP', { maximumFractionDigits: 1 });

export function formatYenScaled(yen: number): string {
  if (!Number.isFinite(yen)) return '未算定';
  const sign = yen < 0 ? '−' : '';
  const abs = Math.abs(yen);
  if (abs < 10_000) return `${sign}${Math.round(abs).toLocaleString('ja-JP')}円`;
  if (abs < 100_000_000) return `${sign}${oneDecimal(abs / 10_000)}万円`;
  return `${sign}${oneDecimal(abs / 1_000_000)}百万円`;
}
