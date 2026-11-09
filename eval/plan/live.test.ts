import { assertLiveApproved, makeLiveGuard, runLive } from './live';
import { GROWTH_INPUT } from './quality/growth';

describe('実API呼び出しの承認ゲート（今回は送信しない）', () => {
  it('承認の環境変数が無ければ例外（送信しない）', () => {
    expect(() => assertLiveApproved({})).toThrow('承認されていない');
    expect(() => assertLiveApproved({ PLAN_LIVE: '1' })).toThrow('承認されていない');
    expect(() => assertLiveApproved({ PLAN_LIVE: '1', PLAN_APPROVED: 'no' })).toThrow('承認されていない');
  });

  it('承認が無い状態で runLive を呼んでも、APIには触れず例外になる', async () => {
    await expect(
      runLive({
        cases: [{ id: 'growth', name: '成長戦略型', raw: GROWTH_INPUT }],
        now: { year: 2026, month: 11, day: 9 },
        outDir: '/nonexistent-should-not-be-created',
        apiKey: undefined,
        env: {},
      })
    ).rejects.toThrow('承認されていない');
  });
});

describe('費用ガード（送信せずに確認）', () => {
  const fakeSend = (guard: ReturnType<typeof makeLiveGuard>) => {
    const calls = { n: 0 };
    const send = guard.wrap(async (_p: { model: string; messages: Array<{ content: string }>; max_completion_tokens?: number }) => {
      calls.n += 1;
      return { usage: { prompt_tokens: 1000, completion_tokens: 500 } };
    });
    return { send, calls };
  };
  const msg = (chars: number) => ({ model: 'gpt-5.6-luna', messages: [{ content: 'あ'.repeat(chars) }], max_completion_tokens: 6000 });

  it('6回までは送られ、7回目は送信前に止まる', async () => {
    const guard = makeLiveGuard();
    const { send, calls } = fakeSend(guard);
    for (let i = 0; i < 6; i++) await send(msg(100));
    await expect(send(msg(100))).rejects.toThrow('呼び出し回数の上限');
    expect(calls.n).toBe(6);
  });

  it('予算を超える恐れがある入力は、送らずに止まる', async () => {
    const guard = makeLiveGuard();
    const { send, calls } = fakeSend(guard);
    await expect(send(msg(10_000_000))).rejects.toThrow('予算上限');
    expect(calls.n).toBe(0);
    expect(guard.callCount).toBe(0);
  });

  it('既定の共有ガードの上限（21回）より厳しい6回・$1で動く', () => {
    expect(makeLiveGuard().worstCaseUsd('gpt-5.6-luna', 4000, 6000)).toBeLessThan(0.02);
  });
});
