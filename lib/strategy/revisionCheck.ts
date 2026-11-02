export type RevisionCheckResult =
  | { ok: true }
  | { ok: false; reason: 'unknown_after' | 'unknown_before' | 'not_advanced' | 'skipped' };

/**
 * 既存の行を更新した保存の後で、revision が正しく 1 増えたかを確認する。
 * 新規行（画面がまだ revision を持たない）は確認の対象外。revision が 0 の行は、既存行なら正常な初期値として扱う。
 */
export function checkRevisionAfterUpdate(input: {
  isExistingRow: boolean;
  before: number | undefined;
  after: number | undefined;
}): RevisionCheckResult {
  if (!input.isExistingRow) return { ok: true };
  if (typeof input.before !== 'number') return { ok: false, reason: 'unknown_before' };
  if (typeof input.after !== 'number') return { ok: false, reason: 'unknown_after' };
  if (input.after === input.before + 1) return { ok: true };
  if (input.after <= input.before) return { ok: false, reason: 'not_advanced' };
  return { ok: false, reason: 'skipped' };
}
