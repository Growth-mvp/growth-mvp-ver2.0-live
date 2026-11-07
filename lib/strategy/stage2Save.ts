import { REVISION_UNKNOWN_CODE, REVISION_UNKNOWN_SAVE_MESSAGE } from '@/lib/strategy/revisionUnknown';
/**
 * STAGE2 の保存（画面の内容を丸ごと保存する経路）で使う revision。
 * 画面が読み込んだ時点の revision を条件にし、保存処理の中で最新の値に読み替えさせない。
 */
export function stage2SaveRevision(storeState: { revision?: unknown }): number | undefined {
  return typeof storeState.revision === 'number' ? storeState.revision : undefined;
}

export function stage2ConflictMessage(error: unknown): string | null {
  const code = (error as { code?: unknown } | null | undefined)?.code;
  if (code === REVISION_UNKNOWN_CODE) return REVISION_UNKNOWN_SAVE_MESSAGE;
  if (code !== 'REVISION_CONFLICT') return null;
  return '他の利用者が先に保存したため、この内容は保存されませんでした。画面の編集内容は残っています。内容を確認してから、もう一度保存してください。';
}
