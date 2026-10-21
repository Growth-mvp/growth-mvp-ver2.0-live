/**
 * STAGE1 の財務金額の入力単位。保存単位は常に円（整数）。
 * 入力値は単位を明示して一度だけ円へ換算し、読み込み時には換算しない。
 */
import { columnMoneyUnitOfLabel } from './financeColumnUnit';


export type FinanceInputUnit = 'yen' | 'thousand_yen' | 'man_yen' | 'million_yen' | 'oku_yen';

export const FINANCE_INPUT_UNITS: readonly FinanceInputUnit[] = [
  'yen',
  'thousand_yen',
  'man_yen',
  'million_yen',
  'oku_yen',
];

/** 円で保存された財務データの版数。この版数の保存値には桁による換算を適用しない */
export const FINANCE_UNIT_VERSION = 2 as const;

/**
 * 円で保存されたと確定している範囲。pl は確定済みの年度の配列（年度単位で管理する）。
 * undefined の pl は会社PLの読込前を表し、その間は会社PLを保存しない。
 */
export type FinanceUnitConfirmed = {
  pl?: number[];
  bs?: boolean;
  segmentPL?: boolean;
  segmentBS?: boolean;
};

export const FINANCE_PL_YEAR_ISSUE_MESSAGE =
  '会社PLの年度に重複または欠落があるため、会社PLを更新・保存できません。重複・欠落を解消してから再度お試しください。';

/** 会社PLの年度キー。4桁の整数として解釈できない場合は null */
export function financePLYearKey(row: { year?: unknown }): number | null {
  const y = row.year;
  const n = typeof y === 'number' ? y : typeof y === 'string' && /^\d{4}$/.test(y.trim()) ? Number(y) : NaN;
  return Number.isInteger(n) ? n : null;
}

/** 年度が欠落しているか、同じ年度が複数あるとき true（どの行を更新するか推測できない状態） */
export function hasFinancePLYearIssue(rows: ReadonlyArray<{ year?: unknown }>): boolean {
  const seen = new Set<number>();
  for (const row of rows) {
    const key = financePLYearKey(row);
    if (key === null || seen.has(key)) return true;
    seen.add(key);
  }
  return false;
}

export const FINANCE_PL_LEGACY_PARTIAL_MESSAGE =
  '旧データの年度は、表示中の項目をすべて入力または再取込してから保存してください。一部の項目だけを変更した場合は適用されません。';

export function isFinancePLGuardMessage(message: unknown): boolean {
  return message === FINANCE_PL_YEAR_ISSUE_MESSAGE || message === FINANCE_PL_LEGACY_PARTIAL_MESSAGE;
}

/**
 * 未確定（旧データ）の年度で、数値の項目の一部だけが変わった年度を返す。
 * 旧年度は、保存されていた項目をすべて入力し直した場合だけ円として確定する。
 * 未変更の項目は表示上の換算値のままになるため、その年度の更新は適用しない。
 */
export function partiallyUpdatedLegacyYears(
  rows: ReadonlyArray<object>,
  prevRows: ReadonlyArray<object>,
  legacyRows: ReadonlyArray<object>,
): number[] {
  const prevByYear = new Map(prevRows.map((r) => [financePLYearKey(r as { year?: unknown }), r as Record<string, unknown>]));
  const legacyByYear = new Map(legacyRows.map((r) => [financePLYearKey(r as { year?: unknown }), r as Record<string, unknown>]));
  const out: number[] = [];
  for (const rowObj of rows) {
    const row = rowObj as Record<string, unknown>;
    const key = financePLYearKey(row as { year?: unknown });
    if (key === null) continue;
    const legacy = legacyByYear.get(key);
    const prev = prevByYear.get(key);
    if (!legacy || !prev || isSameFinanceRow(row, prev)) continue;
    const numericFields = Object.keys(legacy).filter((k) => k !== 'year' && typeof legacy[k] === 'number');
    if (numericFields.some((k) => Object.is(row[k], prev[k]))) out.push(key);
  }
  return out;
}

/** 2つの行の値が同じか（キーの集合と各値の Object.is で比較） */
export function isSameFinanceRow(a: object, b: object): boolean {
  const ra = a as Record<string, unknown>;
  const rb = b as Record<string, unknown>;
  const keys = new Set([...Object.keys(ra), ...Object.keys(rb)]);
  for (const key of keys) {
    if (!Object.is(ra[key], rb[key])) return false;
  }
  return true;
}

/**
 * 保存済み csv_finance_data から、会社PLの年度ごとの確定判定を作る。
 * - pl が配列なら、その年度だけ円で確定済み
 * - pl がない旧円版（版数2）は全年度を円とみなす（pl=true も同じ扱い）
 * - それ以外（版数なしの旧データ）は全年度が未確定
 */
export function plYearConfirmedPredicate(csvMeta: Record<string, unknown>): (year: number | null) => boolean {
  const stored = (csvMeta.financeUnitConfirmed ?? {}) as { pl?: unknown };
  if (Array.isArray(stored.pl)) {
    const years = new Set(stored.pl.map((y) => Number(y)));
    return (year) => year !== null && years.has(year);
  }
  const wholeYen = stored.pl === true || csvMeta.financeUnitVersion === FINANCE_UNIT_VERSION;
  return () => wholeYen;
}

/** 保存済み csv_finance_data の bs・セグメントの確定フラグ（版数2の旧円版は確定とみなす） */
export function readFinanceDatasetConfirmed(
  csvMeta: Record<string, unknown>,
  key: 'bs' | 'segmentPL' | 'segmentBS',
): boolean {
  const stored = (csvMeta.financeUnitConfirmed ?? {}) as Record<string, unknown>;
  return csvMeta.financeUnitVersion === FINANCE_UNIT_VERSION || stored[key] === true;
}

export const FINANCE_INPUT_UNIT_LABEL: Record<FinanceInputUnit, string> = {
  yen: '円',
  thousand_yen: '千円',
  man_yen: '万円',
  million_yen: '百万円',
  oku_yen: '億円',
};

const YEN_PER_UNIT: Record<FinanceInputUnit, number> = {
  yen: 1,
  thousand_yen: 1_000,
  man_yen: 10_000,
  million_yen: 1_000_000,
  oku_yen: 100_000_000,
};

export function isFinanceInputUnit(v: unknown): v is FinanceInputUnit {
  return typeof v === 'string' && (FINANCE_INPUT_UNITS as readonly string[]).includes(v);
}

/** 単位を明示した入力値を、円の整数に換算する（一度だけ使う） */
export function toYen(value: number, unit: FinanceInputUnit): number {
  return Math.round(value * YEN_PER_UNIT[unit]);
}

/** 円の値を、選択した単位の表示数値に直す（表示・編集用。金額は変えない） */
export function displayNumber(yen: number, unit: FinanceInputUnit): number {
  return Number((yen / YEN_PER_UNIT[unit]).toFixed(8));
}

/** 行の金額項目（year 以外の数値）を換算する。display: 円 → 表示数値、yen: 表示数値 → 円 */
export function scaleMonetaryRows<T extends { year: number }>(
  rows: readonly T[],
  unit: FinanceInputUnit,
  direction: 'display' | 'yen',
): T[] {
  return rows.map((row) => {
    const next: Record<string, unknown> = { ...row };
    for (const [key, value] of Object.entries(row)) {
      if (key === 'year' || typeof value !== 'number') continue;
      next[key] = direction === 'display' ? displayNumber(value, unit) : toYen(value, unit);
    }
    return next as T;
  });
}

/**
 * 表の編集結果を円の行にする。表示値に変更がない年度は、保存済みの円の行をそのまま使う。
 * 表示単位への換算と戻しの往復で未編集年度の値が変わるのを防ぐ。
 */
export function toYenRowsKeepingUnchanged<T extends { year: number }>(
  nextDisplay: readonly T[],
  prevDisplay: readonly T[],
  prevYen: readonly T[],
  unit: FinanceInputUnit,
): T[] {
  const converted = scaleMonetaryRows(nextDisplay, unit, 'yen');
  const prevDisplayByYear = new Map(prevDisplay.map((r) => [r.year, r]));
  const prevYenByYear = new Map(prevYen.map((r) => [r.year, r]));
  return nextDisplay.map((row, i) => {
    const before = prevDisplayByYear.get(row.year);
    const yen = prevYenByYear.get(row.year);
    if (before && yen && isSameFinanceRow(row, before)) return yen;
    return converted[i];
  });
}

/**
 * 取込候補の金額を円へ換算する。列ごとの明示単位を優先し、無い列は全体の単位を使う。
 * どちらも無い列は換算せず unresolvedKeys に入れる（金額を捏造しない）。
 */
export function convertCandidateFieldsToYen(
  fields: Record<string, number>,
  fieldUnits: Partial<Record<string, FinanceInputUnit>>,
  fallbackUnit: FinanceInputUnit | undefined,
): { yenFields: Record<string, number>; unresolvedKeys: string[] } {
  const yenFields: Record<string, number> = {};
  const unresolvedKeys: string[] = [];
  for (const [key, value] of Object.entries(fields)) {
    if (typeof value !== 'number' || !Number.isFinite(value)) continue;
    const unit = fieldUnits[key] ?? fallbackUnit;
    if (!unit) {
      unresolvedKeys.push(key);
      continue;
    }
    yenFields[key] = toYen(value, unit);
  }
  return { yenFields, unresolvedKeys };
}

/** 列名・項目名に明示された単位を入力単位へ変換する。明示が無い・未対応の場合は undefined */
export function explicitInputUnitOfLabel(label: string): FinanceInputUnit | undefined {
  const unit = columnMoneyUnitOfLabel(label);
  if (unit === 'million_yen' || unit === 'thousand_yen' || unit === 'man_yen' || unit === 'yen') return unit;
  return undefined;
}

/** 資料内の単位表記（例: 単位：千円）を読み取る。見つからなければ undefined */
export function detectSheetUnitText(text: string): FinanceInputUnit | undefined {
  const m = text.match(/単位\s*[:：]?\s*(百万円|千円|万円|億円|円)/);
  if (!m) return undefined;
  const map: Record<string, FinanceInputUnit> = {
    円: 'yen',
    千円: 'thousand_yen',
    万円: 'man_yen',
    百万円: 'million_yen',
    億円: 'oku_yen',
  };
  return map[m[1]];
}

const MONEY_CANDIDATE_KINDS = new Set(['companyPL', 'companyBS', 'segmentPL', 'segmentBS']);

export type UnitResolvableCandidate = {
  kind: string;
  fields: Record<string, unknown>;
  fieldUnits?: Partial<Record<string, FinanceInputUnit>>;
  source?: string;
};

/**
 * 取込候補の金額を円へ換算する。単位の優先順位は「列の明示単位」→「取込元ごとに確定した単位」。
 * どちらも無い金額は換算せず、unresolvedCount に数える（適用はできない）。
 */
export function resolveCandidatesToYen<T extends UnitResolvableCandidate>(
  candidates: T[],
  confirmedUnitBySource: Record<string, FinanceInputUnit | undefined>,
): { candidates: T[]; unresolvedCount: number } {
  let unresolvedCount = 0;
  const resolved = candidates.map((c) => {
    if (!MONEY_CANDIDATE_KINDS.has(c.kind)) return c;
    const numeric: Record<string, number> = {};
    for (const [key, value] of Object.entries(c.fields)) {
      if (typeof value === 'number' && Number.isFinite(value)) numeric[key] = value;
    }
    const { yenFields, unresolvedKeys } = convertCandidateFieldsToYen(
      numeric,
      c.fieldUnits ?? {},
      confirmedUnitBySource[c.source ?? ''],
    );
    unresolvedCount += unresolvedKeys.length;
    return { ...c, fields: yenFields };
  });
  return { candidates: resolved, unresolvedCount };
}
