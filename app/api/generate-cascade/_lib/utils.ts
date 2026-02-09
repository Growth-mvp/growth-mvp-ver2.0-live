/**
 * _lib/utils.ts
 * Small utility functions
 */

/**
 * CSV行を読みやすいテキスト形式に変換
 */
export const toLinesFromCsv = (csvRows: any[], limit = 5) =>
  (csvRows || [])
    .slice(0, limit)
    .map((row: any, i: number) => {
      const obj = row && typeof row === 'object' ? row : { value: row };
      return `【${i + 1}行目】 ${Object.entries(obj)
        .map(([k, v]) => `${k}: ${v}`)
        .join(', ')}`;
    })
    .join('\n');

/**
 * 部門名を取得（name または departmentName）
 */
export function pickName(d: any) {
  return (
    (typeof d?.name === 'string' && d.name.trim()) ||
    (typeof d?.departmentName === 'string' && d.departmentName.trim()) ||
    ''
  );
}

/**
 * 部門リストから名前だけを抽出
 */
export function onlyDeptNames(list: any[]): string[] {
  return (list || []).map(pickName).filter(Boolean);
}

/**
 * 文字列リストをトリミングしてフィルタ
 */
export function trimList(list?: string[], max = 6) {
  return (Array.isArray(list) ? list : [])
    .map((s) => String(s || '').trim())
    .filter(Boolean)
    .slice(0, max);
}

/**
 * 文字列をNumber に変換（%やカンマを吸収）
 */
export function toNum(v: any): number | null {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  const s = String(v ?? '').trim();
  if (!s) return null;
  const n = Number(s.replace(/[,%\s]/g, '').replace(/,/g, ''));
  return Number.isFinite(n) ? n : null;
}

/**
 * Probability を正規化（0..1）
 * 100や%が来たら吸収
 */
export function normalizeProbability(v: any): number | undefined {
  const n = toNum(v);
  if (n == null) return undefined;
  if (n <= 0) return 0;
  if (n > 1 && n <= 100) return Math.max(0, Math.min(1, n / 100));
  return Math.max(0, Math.min(1, n));
}

/**
 * Unknown値をテキスト化（null/undefined → ''）
 */
export function mStrFromUnknown(v: unknown): string {
  if (v == null) return '';
  if (typeof v === 'string') return v;
  if (typeof v === 'number') return String(v);
  if (typeof v === 'boolean') return v ? 'true' : 'false';
  return String(v);
}
