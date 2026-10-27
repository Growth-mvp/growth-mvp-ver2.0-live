/**
 * MFA（TOTP）の判定ロジック。副作用なし。クライアント・サーバーの両方から使う。
 * AAL は Supabase の認証レベル（aal1: パスワード等、aal2: 追加の要素で確認済み）。
 */

export type Aal = 'aal1' | 'aal2';

export type AalState = {
  currentLevel: string | null;
  nextLevel: string | null;
};

/** クライアント：登録済みで、現在のセッションが aal2 でなければ追加認証（step-up）が必要 */
export function needsStepUp(state: AalState): boolean {
  return state.nextLevel === 'aal2' && state.currentLevel !== 'aal2';
}

export type MfaAccessDecision =
  | { allowed: true }
  | { allowed: false; reason: 'mfa_required' | 'invalid_aal' };

/**
 * サーバー：JWT の aal クレームと、検証済み factor の有無で判定する（fail closed）。
 * - 検証済み factor があるユーザーは aal2 でなければ拒否する。
 * - aal が想定外の値なら拒否する。
 * - 免除されたルート（MFA 登録・認証、招待受諾など）は呼び出し側が exempt で指定する。
 */
export function decideMfaAccess(input: {
  aal: unknown;
  hasVerifiedFactor: boolean;
  exempt?: boolean;
}): MfaAccessDecision {
  if (input.exempt) return { allowed: true };

  const aal = input.aal;
  if (aal !== undefined && aal !== 'aal1' && aal !== 'aal2') {
    return { allowed: false, reason: 'invalid_aal' };
  }

  if (input.hasVerifiedFactor && aal !== 'aal2') {
    return { allowed: false, reason: 'mfa_required' };
  }

  return { allowed: true };
}
