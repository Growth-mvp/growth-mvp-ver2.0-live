/**
 * 財務列名に明示された単位の判定。
 * 単位は列名の末尾（例: 売上高(千円)）だけで決め、数値の大きさでは判定しない。
 */

export type ColumnMoneyUnit = 'million_yen' | 'thousand_yen' | 'man_yen' | 'yen' | 'unitless';

export type MoneyColumn = { unit: ColumnMoneyUnit; value: number; key: string };

/** 単位表記のない列。GROWTH SHIFTの財務データは円に統一されているため、円として換算する */
const SUFFIX_UNITS: Record<string, ColumnMoneyUnit> = {
  百万円: 'million_yen',
  千円: 'thousand_yen',
  万円: 'man_yen',
  円: 'yen',
};

/** 認識はするが換算しない単位（誤って別の単位として扱わないため除外する） */
const UNSUPPORTED_SUFFIXES = new Set(['千万円', '億円']);

/** 同じ指標の列が併存する場合の優先順位（明示された単位を、単位なしより優先） */
const PRIORITY: ColumnMoneyUnit[] = ['million_yen', 'thousand_yen', 'man_yen', 'yen', 'unitless'];

export const FINANCE_SALES_COLUMN_BASES = ['売上高', '売上', 'sales', 'salesrevenue', 'revenue'] as const;
export const FINANCE_OPERATING_PROFIT_COLUMN_BASES = ['営業利益', 'operatingprofit'] as const;

export function normalizeColumnKey(key: string): string {
  return key.toLowerCase().replace(/\s+|[_\-（）()]/g, '');
}

function toNumber(v: unknown): number | null {
  if (v == null) return null;
  const s = String(v).replace(/[,\s％%]/g, '');
  if (!s || s.toLowerCase() === 'nan' || s.toLowerCase() === 'null') return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

function unitOfSuffix(suffix: string): ColumnMoneyUnit | 'unsupported' | null {
  if (suffix === '') return 'unitless';
  if (UNSUPPORTED_SUFFIXES.has(suffix)) return 'unsupported';
  return SUFFIX_UNITS[suffix] ?? null;
}

/**
 * 指定した指標名（bases）で始まる列のうち、単位が認識できるものを列挙する。
 * 指標名の後ろに単位以外の文字がある列（売上原価など）は対象外。
 */
export function findMoneyColumns(row: Record<string, unknown>, bases: readonly string[]): MoneyColumn[] {
  const sortedBases = bases.map(normalizeColumnKey).sort((a, b) => b.length - a.length);
  const out: MoneyColumn[] = [];
  for (const [key, raw] of Object.entries(row)) {
    const nk = normalizeColumnKey(key);
    let unit: ColumnMoneyUnit | null = null;
    for (const base of sortedBases) {
      if (!nk.startsWith(base)) continue;
      const u = unitOfSuffix(nk.slice(base.length));
      if (u && u !== 'unsupported') {
        unit = u;
        break;
      }
    }
    if (!unit) continue;
    const value = toNumber(raw);
    if (value === null) continue;
    out.push({ unit, value, key });
  }
  return out;
}

export function toMillion(value: number, unit: ColumnMoneyUnit): number {
  switch (unit) {
    case 'million_yen':
      return value;
    case 'thousand_yen':
      return value / 1_000;
    case 'man_yen':
      return value / 100;
    case 'unitless':
    case 'yen':
      return value / 1_000_000;
  }
}

/** 同じ指標の列から、優先順位に従って1つを選び、百万円に換算する。候補がなければ null */
export function selectMoneyInMillion(
  columns: MoneyColumn[],
): { valueMillion: number; unit: ColumnMoneyUnit; key: string } | null {
  for (const unit of PRIORITY) {
    const column = columns.find((c) => c.unit === unit);
    if (column) return { valueMillion: toMillion(column.value, unit), unit, key: column.key };
  }
  return null;
}

/**
 * 列名（見出し）の末尾に書かれた単位を読み取る。単位が無ければ null。
 * 認識するが換算しない単位（千万円・億円）は 'unsupported' を返す。
 */
export function columnMoneyUnitOfLabel(label: string): ColumnMoneyUnit | 'unsupported' | null {
  const nk = normalizeColumnKey(label);
  for (const suffix of ['百万円', '千万円', '千円', '万円', '億円', '円']) {
    if (!nk.endsWith(suffix)) continue;
    return unitOfSuffix(suffix);
  }
  return null;
}
