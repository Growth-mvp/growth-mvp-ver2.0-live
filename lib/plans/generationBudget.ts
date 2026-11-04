/**
 * 経営計画書生成 API の時間予算と処理時間計測（純粋関数）。
 *
 * route.ts の maxDuration（120秒）と一致させること。
 * 計測ログには本文・財務データ・プロンプト・ID を含めない。
 */

export const PLAN_DEADLINE_MS = 120_000;
export const PLAN_POST_AI_RESERVE_MS = 20_000;
export const PLAN_ATTEMPT_SAFETY_MS = 3_000;
export const PLAN_MIN_ATTEMPT_MS = 30_000;
export const PLAN_MAX_ATTEMPTS = 2;

/** 残り時間から OpenAI 1 試行のタイムアウトを求める。試行を始められない場合は null */
export function planAttemptTimeoutMs(startedAt: number, now: number): number | null {
  const remaining = PLAN_DEADLINE_MS - (now - startedAt);
  const timeout = remaining - PLAN_POST_AI_RESERVE_MS - PLAN_ATTEMPT_SAFETY_MS;
  return timeout >= PLAN_MIN_ATTEMPT_MS ? timeout : null;
}

export class PlanGenerationTimeoutError extends Error {
  constructor() {
    super('Plan generation exceeded the time budget');
    this.name = 'PlanGenerationTimeoutError';
  }
}

export type PlanPhase = 'auth' | 'db' | 'build' | 'prompt' | 'llm' | 'save';

export function createPhaseTimer(now: () => number = () => performance.now()) {
  const start = now();
  let last = start;
  const phases: Partial<Record<PlanPhase, number>> = {};
  return {
    mark(phase: PlanPhase) {
      const t = now();
      phases[phase] = Math.round(t - last);
      last = t;
    },
    summary() {
      return { totalMs: Math.round(now() - start), phases: { ...phases } };
    },
  };
}
