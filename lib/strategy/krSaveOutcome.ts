export type SaveOutcome = { ok: true } | { ok: false; message: string };

type SaveLike = { ok?: boolean; reason?: string; skipped?: boolean; code?: string } | null | undefined;

const CONFLICT_REASONS = new Set(['revision_conflict_persist', 'departments_conflict', 'field_conflict']);

export function krSaveOutcome(result: SaveLike): SaveOutcome {
  if (result?.ok === true) return { ok: true };
  if (!result) {
    return { ok: false, message: '保存されませんでした。画面を再読み込みしてから、もう一度お試しください。' };
  }
  if (result.skipped || result.reason === 'scope_changed') {
    return { ok: false, message: '会社または戦略が切り替わったため、保存されませんでした。内容を確認してから、もう一度保存してください。' };
  }
  if (result.code === 'REVISION_CONFLICT' || CONFLICT_REASONS.has(result.reason ?? '')) {
    return { ok: false, message: '他の更新と競合したため、保存されませんでした。画面を再読み込みして内容を確認してください。' };
  }
  return { ok: false, message: '保存に失敗しました。もう一度お試しください。' };
}
