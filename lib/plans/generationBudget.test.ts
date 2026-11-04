import {
  PLAN_ATTEMPT_SAFETY_MS,
  PLAN_DEADLINE_MS,
  PLAN_MIN_ATTEMPT_MS,
  PLAN_POST_AI_RESERVE_MS,
  createPhaseTimer,
  planAttemptTimeoutMs,
} from './generationBudget';

describe('planAttemptTimeoutMs', () => {
  it('leaves room for post-AI work and the attempt safety margin', () => {
    expect(planAttemptTimeoutMs(1_000, 1_000)).toBe(
      PLAN_DEADLINE_MS - PLAN_POST_AI_RESERVE_MS - PLAN_ATTEMPT_SAFETY_MS
    );
  });

  it('shrinks by the time already elapsed', () => {
    expect(planAttemptTimeoutMs(0, 10_000)).toBe(
      PLAN_DEADLINE_MS - PLAN_POST_AI_RESERVE_MS - PLAN_ATTEMPT_SAFETY_MS - 10_000
    );
  });

  it('returns null when the remaining time cannot fit a useful attempt', () => {
    const boundary = PLAN_DEADLINE_MS - PLAN_POST_AI_RESERVE_MS - PLAN_ATTEMPT_SAFETY_MS - PLAN_MIN_ATTEMPT_MS;
    expect(planAttemptTimeoutMs(0, boundary)).toBe(PLAN_MIN_ATTEMPT_MS);
    expect(planAttemptTimeoutMs(0, boundary + 1)).toBeNull();
  });

  it('keeps every attempt and the post-AI reserve inside the deadline', () => {
    for (const now of [0, 5_000, 40_000, 60_000]) {
      const timeout = planAttemptTimeoutMs(0, now);
      if (timeout !== null) {
        expect(now + timeout + PLAN_POST_AI_RESERVE_MS).toBeLessThanOrEqual(PLAN_DEADLINE_MS);
      }
    }
  });
});

describe('createPhaseTimer', () => {
  it('records the time between marks and the total', () => {
    let t = 0;
    const timer = createPhaseTimer(() => t);
    t = 120;
    timer.mark('auth');
    t = 500;
    timer.mark('llm');

    expect(timer.summary()).toEqual({ totalMs: 500, phases: { auth: 120, llm: 380 } });
  });
});
