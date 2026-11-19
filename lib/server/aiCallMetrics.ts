import { initialAttemptTimeoutMs, isTransientError, retryTimeoutMs } from '@/lib/stage2/draftBudget';

export type AiCallOutcome =
  | { ok: true; attempts: number; ms: number }
  | { ok: false; attempts: number; ms: number; errorKind: string };

const errorKindOf = (e: unknown): string => {
  const err = e as { name?: unknown; status?: unknown } | null;
  if (typeof err?.name === 'string' && err.name !== '') return err.name;
  if (typeof err?.status === 'number') return `status_${err.status}`;
  return 'Error';
};

/* 処理単位ごとの所要時間と呼び出し回数を、1行のログに残す。入力や出力の本文は記録しない。 */
export function logAiCall(label: string, outcome: AiCallOutcome): void {
  console.info('[ai-call]', JSON.stringify({ label, ...outcome }));
}

/**
 * AI呼び出しを、残りの時間予算の中で実行する。
 * 一時的な障害（429・5xx・接続失敗）の時だけ、残りが足りれば1回だけ再試行する。
 * タイムアウトと中断は再試行しない。SDK の自動再試行は使わない（呼び出し回数を予算どおりに保つため）。
 */
export async function runWithRetryBudget<T>(
  label: string,
  budgetMs: number,
  run: (timeoutMs: number) => Promise<T>,
  now: () => number = Date.now,
): Promise<T> {
  const started = now();
  const deadline = started + budgetMs;
  let attempts = 1;
  let timeoutMs = initialAttemptTimeoutMs(budgetMs);
  for (;;) {
    try {
      const value = await run(timeoutMs);
      logAiCall(label, { ok: true, attempts, ms: now() - started });
      return value;
    } catch (e) {
      const next = attempts === 1 && isTransientError(e) ? retryTimeoutMs(Math.max(0, deadline - now())) : null;
      if (next === null) {
        logAiCall(label, { ok: false, attempts, ms: now() - started, errorKind: errorKindOf(e) });
        throw e;
      }
      attempts += 1;
      timeoutMs = next;
    }
  }
}

/** 入力の順序を保ったまま、同時に動かす数を上限まで抑えて並列に実行する */
export async function mapWithConcurrency<A, B>(items: readonly A[], limit: number, fn: (item: A, index: number) => Promise<B>): Promise<B[]> {
  const out = new Array<B>(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const index = next;
      next += 1;
      out[index] = await fn(items[index], index);
    }
  };
  const workers = Array.from({ length: Math.min(Math.max(1, limit), items.length) }, () => worker());
  await Promise.all(workers);
  return out;
}
