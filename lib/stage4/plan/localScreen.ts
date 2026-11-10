/* ローカル開発で、新STAGE4の文書型画面を通常のSTAGE4として使うかどうか。本番ビルドでは常に false。 */
export function isLocalStage4DocumentScreen(): boolean {
  return process.env.NODE_ENV !== 'production' && process.env.NEXT_PUBLIC_STAGE4_DOCUMENT_SCREEN === 'true';
}
