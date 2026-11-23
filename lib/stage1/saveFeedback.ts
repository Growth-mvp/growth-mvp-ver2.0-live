export type Stage1SaveFeedback =
  | { state: 'success'; message: string }
  | { state: 'idle'; message: string }
  | { state: 'error'; message: string };

const FAILED_MESSAGE = '保存に失敗しました（consoleのエラーを確認してください）';

/** 保存の戻り値から画面の表示を決める。変更がなくスキップされた保存は、保存したように見せない */
export function resolveStage1SaveFeedback(result: unknown, isManual: boolean): Stage1SaveFeedback {
  const r = (result ?? {}) as { ok?: boolean; skipped?: boolean };
  if (r.ok === true) return { state: 'success', message: '保存しました' };
  if (r.skipped === true) return { state: 'idle', message: isManual ? '変更はありません' : '' };
  return { state: 'error', message: FAILED_MESSAGE };
}
