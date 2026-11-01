import {
  DRAFT_ATTEMPT_SAFETY_MS,
  DRAFT_REPAIR_MAX_MS,
  DRAFT_REPAIR_MIN_MS,
  DRAFT_RETRY_MIN_MS,
  DRAFT_TOTAL_BUDGET_MS,
  initialAttemptTimeoutMs,
  isTimeoutError,
  isTransientError,
  remainingBudgetMs,
  repairTimeoutMs,
  retryTimeoutMs,
} from './draftBudget';

describe('draftBudget', () => {
  it('合計予算は Vercel の maxDuration（60秒）より短い', () => {
    expect(DRAFT_TOTAL_BUDGET_MS).toBeLessThan(60_000);
  });

  it('残り時間は期限から現在を引いた値で、0 未満にならない', () => {
    expect(remainingBudgetMs(10_000, 4_000)).toBe(6_000);
    expect(remainingBudgetMs(10_000, 12_000)).toBe(0);
  });

  it('初回のタイムアウトは残り時間から安全余裕を引いた値になる', () => {
    expect(initialAttemptTimeoutMs(50_000)).toBe(50_000 - DRAFT_ATTEMPT_SAFETY_MS);
    expect(initialAttemptTimeoutMs(0)).toBe(1);
  });

  it('再試行は残りが最小値以上のときだけ許可し、タイムアウトは残りから安全余裕を引く', () => {
    expect(retryTimeoutMs(DRAFT_RETRY_MIN_MS - 1)).toBeNull();
    expect(retryTimeoutMs(DRAFT_RETRY_MIN_MS)).toBe(DRAFT_RETRY_MIN_MS - DRAFT_ATTEMPT_SAFETY_MS);
  });

  it('Repair は残りが最小値未満なら行わず、十分あれば上限 35 秒でキャップする', () => {
    expect(repairTimeoutMs(DRAFT_REPAIR_MIN_MS - 1)).toBeNull();
    expect(repairTimeoutMs(DRAFT_REPAIR_MIN_MS + DRAFT_ATTEMPT_SAFETY_MS)).toBe(DRAFT_REPAIR_MIN_MS);
    expect(repairTimeoutMs(60_000)).toBe(DRAFT_REPAIR_MAX_MS);
  });

  it('一時的な障害（429・5xx・接続失敗）だけを再試行対象とする', () => {
    expect(isTransientError({ status: 429 })).toBe(true);
    expect(isTransientError({ status: 500 })).toBe(true);
    expect(isTransientError({ status: 503 })).toBe(true);
    expect(isTransientError({ name: 'APIConnectionError' })).toBe(true);
    expect(isTransientError({ status: 400 })).toBe(false);
    expect(isTransientError({ status: 401 })).toBe(false);
    expect(isTransientError({ name: 'AbortError' })).toBe(false);
    expect(isTransientError({ name: 'APIConnectionTimeoutError' })).toBe(false);
    expect(isTransientError({ name: 'APIUserAbortError' })).toBe(false);
    expect(isTransientError(new Error('plain'))).toBe(false);
  });

  it('タイムアウトと中断を識別する', () => {
    expect(isTimeoutError({ name: 'AbortError' })).toBe(true);
    expect(isTimeoutError({ name: 'APIConnectionTimeoutError' })).toBe(true);
    expect(isTimeoutError({ name: 'APIUserAbortError' })).toBe(true);
    expect(isTimeoutError({ status: 500 })).toBe(false);
    expect(isTimeoutError(null)).toBe(false);
  });
});
