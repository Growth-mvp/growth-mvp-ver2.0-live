import { needsStepUp, type AalState } from './mfaPolicy';

export type MfaGateAction = 'none' | 'challenge';

/**
 * ログイン後のゲート判定。
 * - セッションが無ければ何もしない（既存のログイン処理に任せる）。
 * - 状態の取得に失敗・不明な場合は安全側（challenge）に倒す。
 * - 登録済みで aal1 のときだけ追加認証へ誘導する。未登録のユーザーは従来どおり。
 */
export function decideMfaGate(input: { hasSession: boolean; state: AalState | null; error: boolean }): MfaGateAction {
  if (!input.hasSession) return 'none';
  if (input.error || !input.state) return 'challenge';
  return needsStepUp(input.state) ? 'challenge' : 'none';
}
