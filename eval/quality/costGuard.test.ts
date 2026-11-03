import {
  costUsd,
  EvalCallGuard,
  EvalBudgetExceeded,
  MAX_ANSWER_CALLS,
  MAX_INTENT_CALLS,
  MAX_TOTAL_CALLS,
  SDK_MAX_RETRIES,
  BUDGET_USD,
} from './costGuard';

describe('単価と費用の計算（指示の標準料金）', () => {
  it('gpt-5.6-luna：入力 $0.20 / 100万、出力 $1.20 / 100万', () => {
    expect(costUsd('gpt-5.6-luna', { prompt_tokens: 1_000_000, completion_tokens: 0 })).toBeCloseTo(0.2, 9);
    expect(costUsd('gpt-5.6-luna', { prompt_tokens: 0, completion_tokens: 1_000_000 })).toBeCloseTo(1.2, 9);
  });

  it('gpt-4o-mini：入力 $0.15 / 100万、出力 $0.60 / 100万', () => {
    expect(costUsd('gpt-4o-mini', { prompt_tokens: 1_000_000, completion_tokens: 0 })).toBeCloseTo(0.15, 9);
    expect(costUsd('gpt-4o-mini', { prompt_tokens: 0, completion_tokens: 1_000_000 })).toBeCloseTo(0.6, 9);
  });

  it('単価が未登録のモデルは例外にする（黙って0円にしない）', () => {
    expect(() => costUsd('unknown-model', { prompt_tokens: 1, completion_tokens: 1 })).toThrow();
  });

  it('自動再試行は無効（SDKの既定の再試行を使わない）', () => {
    expect(SDK_MAX_RETRIES).toBe(0);
  });

  it('予定の回数と予算の定数は指示どおり（回答14・意図判定7・予算$1）', () => {
    expect(MAX_ANSWER_CALLS).toBe(14);
    expect(MAX_INTENT_CALLS).toBe(7);
    expect(MAX_TOTAL_CALLS).toBe(21);
    expect(BUDGET_USD).toBe(1);
  });

  it('計画全体の最悪ケースの費用は予算の $1 を大きく下回る', () => {
    const worst = EvalCallGuard.plannedWorstCaseUsd(25_000, 7 * 1_000);
    expect(worst).toBeLessThan(BUDGET_USD);
  });
});

describe('呼び出しの上限（送信前に確認し、超えたら送らない）', () => {
  it('回答の回数は14件まで。15件目は送らない', () => {
    const guard = new EvalCallGuard();
    for (let i = 0; i < MAX_ANSWER_CALLS; i++) {
      guard.beforeCall('gpt-5.6-luna', 100, 10);
      guard.afterCall('gpt-5.6-luna', { prompt_tokens: 100, completion_tokens: 10 });
    }
    expect(() => guard.beforeCall('gpt-5.6-luna', 100, 10)).toThrow(EvalBudgetExceeded);
  });

  it('意図判定の回数は7件まで。8件目は送らない', () => {
    const guard = new EvalCallGuard();
    for (let i = 0; i < MAX_INTENT_CALLS; i++) {
      guard.beforeCall('gpt-4o-mini', 100, 10);
      guard.afterCall('gpt-4o-mini', { prompt_tokens: 100, completion_tokens: 10 });
    }
    expect(() => guard.beforeCall('gpt-4o-mini', 100, 10)).toThrow(EvalBudgetExceeded);
  });

  it('予算を超える見込みの呼び出しは、送る前に止める', () => {
    const guard = new EvalCallGuard({ budgetUsd: 0.0001, maxTotalCalls: 21, maxIntentCalls: 7, maxAnswerCalls: 14 });
    expect(() => guard.beforeCall('gpt-5.6-luna', 100, 6000)).toThrow(/予算上限/);
    expect(guard.callCount).toBe(0);
  });

  it('wrap は失敗を再試行しない。1回の失敗は1回として数える', async () => {
    const guard = new EvalCallGuard();
    const raw = jest.fn(async () => {
      throw new Error('network down');
    });
    const send = guard.wrap(raw as any);
    await expect(send({ model: 'gpt-5.6-luna', messages: [{ content: 'x' }], max_completion_tokens: 6000 } as any)).rejects.toThrow('network down');
    expect(raw).toHaveBeenCalledTimes(1);
    expect(guard.callCount).toBe(1);
    expect(guard.records[0].error).toBe('network down');
  });

  it('wrap は成功時の usage から実費を記録する', async () => {
    const guard = new EvalCallGuard();
    const raw = jest.fn(async () => ({ usage: { prompt_tokens: 2000, completion_tokens: 500 }, choices: [] }));
    const send = guard.wrap(raw as any);
    await send({ model: 'gpt-5.6-luna', messages: [{ content: 'x' }], max_completion_tokens: 6000 } as any);
    const expected = costUsd('gpt-5.6-luna', { prompt_tokens: 2000, completion_tokens: 500 });
    expect(guard.spentUsd).toBeCloseTo(expected, 12);
    expect(guard.records[0].costUsd).toBeCloseTo(expected, 12);
  });

  it('呼び出しごとのタグで、どの質問・条件の費用かを分けて記録する', async () => {
    const guard = new EvalCallGuard();
    const raw = jest.fn(async () => ({ usage: { prompt_tokens: 10, completion_tokens: 5 } }));
    const send = guard.wrap(raw as any);
    guard.setTag('A-q1');
    await send({ model: 'gpt-5.6-luna', messages: [{ content: 'a' }], max_completion_tokens: 6000 } as any);
    guard.setTag('B-q1');
    await send({ model: 'gpt-4o-mini', messages: [{ content: 'b' }] } as any);
    expect(guard.records.map((r) => r.tag)).toEqual(['A-q1', 'B-q1']);
  });
});
