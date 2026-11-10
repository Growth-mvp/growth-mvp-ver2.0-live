/* 新STAGE4の文書型画面を通常のSTAGE4として使うかどうかの公開フラグ。未設定・true以外は従来の画面（既定はOFF）。 */
export function isStage4DocumentScreenEnabled(): boolean {
  return process.env.NEXT_PUBLIC_STAGE4_DOCUMENT_SCREEN === 'true';
}
