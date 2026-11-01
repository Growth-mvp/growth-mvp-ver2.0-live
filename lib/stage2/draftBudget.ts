/** Vercel の関数上限（route の maxDuration 60秒）より余裕を持たせた、たたき台生成の合計時間 */
export const DRAFT_TOTAL_BUDGET_MS = 50_000;
/** 各試行のタイムアウトに足す、レスポンス返却用の余裕 */
export const DRAFT_ATTEMPT_SAFETY_MS = 2_000;
/** 残りがこれ未満なら再試行しない */
export const DRAFT_RETRY_MIN_MS = 20_000;
/** 残りがこれ未満なら Repair を行わず、初回結果を返す */
export const DRAFT_REPAIR_MIN_MS = 15_000;
export const DRAFT_REPAIR_MAX_MS = 35_000;
/** 応答前に監査ログの書き込みを待つ上限。超えた場合は応答を先に返す */
export const DRAFT_AUDIT_WAIT_MS = 3_000;

export function remainingBudgetMs(deadlineAt: number, now: number): number {
  return Math.max(0, deadlineAt - now);
}

export function initialAttemptTimeoutMs(remainingMs: number): number {
  return Math.max(1, remainingMs - DRAFT_ATTEMPT_SAFETY_MS);
}

export function retryTimeoutMs(remainingMs: number): number | null {
  if (remainingMs < DRAFT_RETRY_MIN_MS) return null;
  return remainingMs - DRAFT_ATTEMPT_SAFETY_MS;
}

export function repairTimeoutMs(remainingMs: number): number | null {
  if (remainingMs < DRAFT_REPAIR_MIN_MS) return null;
  return Math.min(DRAFT_REPAIR_MAX_MS, remainingMs - DRAFT_ATTEMPT_SAFETY_MS);
}

/** 一時的な障害（429・5xx・接続失敗）だけを再試行対象にする。タイムアウトと中断は対象外 */
export function isTransientError(e: unknown): boolean {
  const err = e as { name?: unknown; status?: unknown } | null;
  const name = typeof err?.name === 'string' ? err.name : '';
  if (name === 'AbortError' || name === 'APIUserAbortError' || name === 'APIConnectionTimeoutError') return false;
  if (typeof err?.status === 'number') return err.status === 429 || err.status >= 500;
  return name === 'APIConnectionError';
}

export function isTimeoutError(e: unknown): boolean {
  const err = e as { name?: unknown } | null;
  const name = typeof err?.name === 'string' ? err.name : '';
  return name === 'AbortError' || name === 'APIUserAbortError' || name === 'APIConnectionTimeoutError';
}
