/**
 * 組織変革ルームの個人投稿を外部AIで集約する機能の有効化フラグ。
 * 既定は無効。保護策（公開範囲の説明・同意・最低件数）が成立するまで有効にしない。
 */
export function isOrgInsightAiEnabled(value: string | undefined): boolean {
  return value === 'true';
}
