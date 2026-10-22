/**
 * STAGE1 の財務金額は円（整数）で入力・保存する。単位の選択・換算はしない。
 * 資料内に円以外の単位が明示されている場合は取込を止める（自動換算はしない）。
 */

/**
 * 円で保存されたと確定している範囲。
 * pl は会社PLの確定済みの年度（年度単位で管理する）。
 * segmentPL / segmentBS は確定したセグメントの BusinessSegment.id。
 */
export type FinanceUnitConfirmed = {
  pl?: number[];
  bs?: boolean;
  segmentPL?: string[];
  segmentBS?: string[];
};

export const FINANCE_CURRENCY_NOTICE =
  '財務データは円単位で入力してください。千円・百万円単位の資料は、円単位に変換してから取り込んでください。';

export const FINANCE_PL_YEAR_ISSUE_MESSAGE =
  '会社PLの年度に重複または欠落があるため、会社PLを更新・保存できません。重複・欠落を解消してから再度お試しください。';

export function isFinancePLGuardMessage(message: unknown): boolean {
  return message === FINANCE_PL_YEAR_ISSUE_MESSAGE;
}

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

/** 保存済み csv_finance_data の BS の確定フラグ */
export function readFinanceBSConfirmed(csvMeta: Record<string, unknown>): boolean {
  const stored = (csvMeta.financeUnitConfirmed ?? {}) as Record<string, unknown>;
  return stored.bs === true;
}

/** 確定セグメントIDの配列として正規化する。旧形式の共通フラグ（true）は個別の根拠がないため空にする */
export function normalizeConfirmedSegmentIds(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return Array.from(new Set(value.filter((id): id is string => typeof id === 'string' && id !== '')));
}

/** 保存済み csv_finance_data から、円で確定したセグメントIDを読む */
export function readConfirmedSegmentIds(csvMeta: Record<string, unknown>, key: 'segmentPL' | 'segmentBS'): string[] {
  const stored = (csvMeta.financeUnitConfirmed ?? {}) as Record<string, unknown>;
  return normalizeConfirmedSegmentIds(stored[key]);
}

/** 指定した名前のセグメントのIDを、既存の確定IDに加えた集合を返す */
export function addConfirmedSegmentIds(
  prev: readonly string[] | undefined,
  segments: ReadonlyArray<{ id: string; name: string }>,
  names: readonly string[],
): string[] {
  const nameSet = new Set(names);
  const added = segments.filter((seg) => nameSet.has(seg.name)).map((seg) => seg.id);
  return Array.from(new Set([...(prev ?? []), ...added]));
}

/** 確定IDのうち、現在のセグメントに存在するものの名前。PL/BS のデータ（名前キー）の判定に使う */
export function confirmedSegmentNames(
  segments: ReadonlyArray<{ id: string; name: string }>,
  confirmedIds: readonly string[],
): Set<string> {
  const idSet = new Set(confirmedIds);
  return new Set(segments.filter((seg) => idSet.has(seg.id)).map((seg) => seg.name));
}

/**
 * セグメントの追加・削除・名称変更に合わせて、名前キーのデータを付け替える。
 * 名称変更は同じIDのデータを新しい名前へ移し、削除されたセグメントのデータは残さない。
 */
export function rekeySegmentRecord<T>(
  record: Record<string, T> | undefined,
  prevSegments: ReadonlyArray<{ id: string; name: string }>,
  nextSegments: ReadonlyArray<{ id: string; name: string }>,
): Record<string, T> {
  const prevIdByName = new Map(prevSegments.map((seg) => [seg.name, seg.id]));
  const nextNameById = new Map(nextSegments.map((seg) => [seg.id, seg.name]));
  const nextNames = new Set(nextSegments.map((seg) => seg.name));
  const out: Record<string, T> = {};
  for (const [key, value] of Object.entries(record ?? {})) {
    const id = prevIdByName.get(key);
    const nextName = id !== undefined ? nextNameById.get(id) : key;
    if (nextName !== undefined && nextNames.has(nextName)) out[nextName] = value;
  }
  return out;
}

/** セグメントが削除されたときに、残っているセグメントの確定IDだけを残す */
export function pruneConfirmedSegmentIds(
  confirmedIds: readonly string[] | undefined,
  nextSegments: ReadonlyArray<{ id: string }>,
): string[] {
  const nextIds = new Set(nextSegments.map((seg) => seg.id));
  return (confirmedIds ?? []).filter((id) => nextIds.has(id));
}

/**
 * 円で確定した金額をAIへ渡す表記にする（百万円は明示的に100万で割る）。
 * 百万円未満は円のまま表記し、桁数から単位を推定しない。
 */
export function formatYenForPrompt(yen: number): string {
  const rounded = Math.round(yen);
  if (Math.abs(rounded) >= 1_000_000) {
    return `${Math.round((rounded / 1_000_000) * 10) / 10}百万円`;
  }
  return `${rounded}円`;
}

/**
 * セグメント財務の金額行。単位が確定していない場合は数値を出さず、その旨を記載する。
 */
export function formatSegmentMoneyForPrompt(label: string, value: number | null | undefined, unitConfirmed: boolean): string {
  if (value == null || !Number.isFinite(value)) return '';
  if (!unitConfirmed) return `${label}：単位未確認のため金額は記載しない`;
  return `${label}${formatYenForPrompt(value)}`;
}

const NON_YEN_UNIT_PATTERN = '(百万円|千万円|千円|万円|億円)';

/** 列見出しの末尾に書かれた円以外の単位（例：「売上高（千円）」→「千円」）。無ければ undefined */
export function nonYenUnitOfLabel(label: string): string | undefined {
  const m = label.trim().match(new RegExp(`${NON_YEN_UNIT_PATTERN}\\s*[）)]?\\s*$`));
  return m?.[1];
}

/** 資料内の「単位：○○」表記に書かれた円以外の単位（例：「単位：千円」）。無ければ undefined */
export function nonYenUnitInSheetText(text: string): string | undefined {
  const m = text.match(new RegExp(`単位\\s*[:：]?\\s*${NON_YEN_UNIT_PATTERN}`));
  return m?.[1];
}

const MONEY_CANDIDATE_KINDS = new Set(['companyPL', 'companyBS', 'segmentPL', 'segmentBS']);

/** 単位表記の判定に使う取込候補の形（金額の候補の kind・取込元・検出した単位） */
export type UnitNotationCandidate = {
  kind: string;
  source?: string;
  sheetUnit?: string;
  fieldUnits?: Record<string, string>;
};

/** 取込元ごとに、資料内の円以外の単位表記を集める（金額の候補のみ）。表記が無い取込元は含まない */
export function nonYenUnitsBySource(candidates: ReadonlyArray<UnitNotationCandidate>): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (const c of candidates) {
    if (!MONEY_CANDIDATE_KINDS.has(c.kind)) continue;
    const labels = [c.sheetUnit, ...Object.values(c.fieldUnits ?? {})].filter((u): u is string => Boolean(u));
    if (labels.length === 0) continue;
    const key = c.source ?? '';
    out[key] = [...(out[key] ?? []), ...labels];
  }
  return out;
}

/** 金額の候補がある取込元のうち、円以外の単位表記が一つも検出されなかったもの（円であることの確認が必要） */
export function sourcesWithoutUnitNotation(candidates: ReadonlyArray<UnitNotationCandidate>): string[] {
  const money = candidates.filter((c) => MONEY_CANDIDATE_KINDS.has(c.kind));
  const allSources = Array.from(new Set(money.map((c) => c.source ?? '')));
  const withNotation = new Set(Object.keys(nonYenUnitsBySource(money)));
  return allSources.filter((key) => !withNotation.has(key));
}
