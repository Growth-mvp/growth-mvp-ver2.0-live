import { MAX_SILENT_ROUNDS, NO_SPEECH_MESSAGE, RESTART_DELAY_MS, VoiceConversation, type ConversationStatus } from './conversation';
import type { RecognitionLike } from './browserSpeech';

type FakeRecognizer = RecognitionLike & { emitResult(text: string): void; emitError(code: string): void; emitEnd(): void };

function makeHarness(opts: { describe?: (code: string) => string | null; supported?: boolean } = {}) {
  const recognizers: FakeRecognizer[] = [];
  const speeches: Array<{ text: string; onEnd: () => void; cancelled: boolean }> = [];
  const statuses: ConversationStatus[] = [];
  const utterances: string[] = [];
  const notices: string[] = [];
  const timers: Array<{ fn: () => void; ms: number; id: number; cleared: boolean }> = [];
  let timerId = 0;

  const deps = {
    isSupported: () => opts.supported ?? true,
    createRecognizer: (): RecognitionLike | null => {
      const r: FakeRecognizer = {
        lang: '',
        continuous: false,
        interimResults: false,
        onresult: null,
        onerror: null,
        onend: null,
        start: jest.fn(),
        stop: jest.fn(),
        abort: jest.fn(),
        emitResult(text: string) {
          this.onresult?.({ results: [[{ transcript: text }]] as unknown as ArrayLike<ArrayLike<{ transcript: string }>> & { length: number } });
        },
        emitError(code: string) {
          this.onerror?.({ error: code });
        },
        emitEnd() {
          this.onend?.();
        },
      };
      recognizers.push(r);
      return r;
    },
    speakReply: (text: string, handlers: { onEnd: () => void }) => {
      const s = { text, onEnd: handlers.onEnd, cancelled: false };
      speeches.push(s);
      return { cancel: () => { s.cancelled = true; } };
    },
    onStatus: (s: ConversationStatus) => statuses.push(s),
    onUtterance: (t: string) => utterances.push(t),
    describeError: async (code: string) => (opts.describe ? opts.describe(code) : `エラー:${code}`),
    notify: (m: string) => notices.push(m),
    setTimer: (fn: () => void, ms: number) => {
      const t = { fn, ms, id: ++timerId, cleared: false };
      timers.push(t);
      return t;
    },
    clearTimer: (handle: unknown) => {
      (handle as { cleared: boolean }).cleared = true;
    },
  };

  const conversation = new VoiceConversation(deps);
  /* 待っているタイマーを、時間を進めずに実行する */
  const runPendingTimers = () => {
    for (const t of timers.filter((x) => !x.cleared)) {
      t.cleared = true;
      t.fn();
    }
  };
  const lastRecognizer = () => recognizers[recognizers.length - 1];
  return { conversation, recognizers, speeches, statuses, utterances, notices, timers, lastRecognizer, runPendingTimers };
}

const flush = () => new Promise((r) => setTimeout(r, 0));

describe('音声会話：1回の開始で、聞く→答える→読み上げる→聞き直す を続ける', () => {
  it('開始すると聞き始め、発言を1回だけ送り、回答を読み上げてから聞き直す', () => {
    const h = makeHarness();
    h.conversation.start();
    expect(h.conversation.current).toBe('listening');
    expect(h.recognizers).toHaveLength(1);

    h.lastRecognizer().emitResult('今、何から取り組めばいい？');
    expect(h.conversation.current).toBe('thinking');
    expect(h.utterances).toEqual(['今、何から取り組めばいい？']);

    h.conversation.replyDone('まずは論点を確認しましょう。');
    expect(h.conversation.current).toBe('speaking');
    expect(h.speeches[0].text).toBe('まずは論点を確認しましょう。');

    h.speeches[0].onEnd();
    expect(h.conversation.current).toBe('listening');
    h.runPendingTimers();
    expect(h.recognizers).toHaveLength(2);
  });

  it('AIが読み上げている間は、音声認識を開始しない（自分の声を拾わない）', () => {
    const h = makeHarness();
    h.conversation.start();
    h.lastRecognizer().emitResult('相談です');
    h.conversation.replyDone('回答です。');
    h.runPendingTimers();
    expect(h.recognizers).toHaveLength(1);
    expect(h.conversation.current).toBe('speaking');
  });

  it('回答がなければ（送信に失敗した等）、読み上げずにすぐ聞き直す', () => {
    const h = makeHarness();
    h.conversation.start();
    h.lastRecognizer().emitResult('相談です');
    h.conversation.replyDone(null);
    expect(h.speeches).toHaveLength(0);
    h.runPendingTimers();
    expect(h.recognizers).toHaveLength(2);
    expect(h.conversation.current).toBe('listening');
  });

  it('利用者の発言が空なら、送らずに聞き直す', () => {
    const h = makeHarness();
    h.conversation.start();
    h.lastRecognizer().emitResult('   ');
    expect(h.utterances).toHaveLength(0);
    h.runPendingTimers();
    expect(h.recognizers).toHaveLength(2);
  });
});

describe('音声会話：終了・停止', () => {
  it('利用者が終了すると、マイクと読み上げを止め、以後は聞き直さない', () => {
    const h = makeHarness();
    h.conversation.start();
    h.lastRecognizer().emitResult('相談です');
    h.conversation.replyDone('回答です。');
    h.conversation.stop();
    expect(h.conversation.current).toBe('off');
    expect(h.speeches[0].cancelled).toBe(true);
    h.speeches[0].onEnd();
    h.runPendingTimers();
    expect(h.recognizers).toHaveLength(1);
    expect(h.conversation.current).toBe('off');
  });

  it('聞いている途中で止めると、認識を止める（以後は開始しない）', () => {
    const h = makeHarness();
    h.conversation.start();
    const r = h.lastRecognizer();
    h.conversation.stop('会話を終了しました。');
    expect(r.abort).toHaveBeenCalled();
    expect(h.notices).toEqual(['会話を終了しました。']);
    h.runPendingTimers();
    expect(h.recognizers).toHaveLength(1);
  });

  it('送信中に止めた場合、後から届いた回答は読み上げない', () => {
    const h = makeHarness();
    h.conversation.start();
    h.lastRecognizer().emitResult('相談です');
    h.conversation.stop();
    h.conversation.replyDone('遅れて届いた回答');
    expect(h.speeches).toHaveLength(0);
    expect(h.conversation.current).toBe('off');
  });

  it('止まっている会話は、もう一度止めても何もしない', () => {
    const h = makeHarness();
    h.conversation.stop('x');
    expect(h.notices).toHaveLength(0);
  });
});

describe('音声会話：無音・エラーで再試行を繰り返さない', () => {
  it('無音が続いたら、上限で会話を終え、案内を出す（無限に聞き直さない）', () => {
    const h = makeHarness();
    h.conversation.start();
    for (let i = 0; i < MAX_SILENT_ROUNDS; i++) {
      h.lastRecognizer().emitEnd();
      if (h.conversation.current === 'off') break;
      h.runPendingTimers();
    }
    expect(h.conversation.current).toBe('off');
    expect(h.notices).toEqual([NO_SPEECH_MESSAGE]);
    h.runPendingTimers();
    expect(h.recognizers.length).toBeLessThanOrEqual(MAX_SILENT_ROUNDS + 1);
  });

  it('no-speech が続いたら、上限で終える', () => {
    const h = makeHarness();
    h.conversation.start();
    for (let i = 0; i < MAX_SILENT_ROUNDS; i++) {
      h.lastRecognizer().emitError('no-speech');
      h.runPendingTimers();
    }
    expect(h.conversation.current).toBe('off');
    expect(h.notices).toEqual([NO_SPEECH_MESSAGE]);
  });

  it('ネットワーク・許可・マイクのエラーは、再試行せず、その原因の案内で終える', async () => {
    const h = makeHarness({ describe: (code) => `案内:${code}` });
    h.conversation.start();
    h.lastRecognizer().emitError('network');
    await flush();
    expect(h.conversation.current).toBe('off');
    expect(h.notices).toEqual(['案内:network']);
    h.runPendingTimers();
    expect(h.recognizers).toHaveLength(1);
  });

  it('not-allowed でも、同じように一度だけ案内して終える', async () => {
    const h = makeHarness({ describe: () => 'マイクの案内' });
    h.conversation.start();
    h.lastRecognizer().emitError('not-allowed');
    await flush();
    expect(h.conversation.current).toBe('off');
    expect(h.notices).toEqual(['マイクの案内']);
  });

  it('認識の中断（aborted）は、会話を止めない', () => {
    const h = makeHarness();
    h.conversation.start();
    h.lastRecognizer().emitError('aborted');
    expect(h.conversation.current).toBe('listening');
    expect(h.notices).toHaveLength(0);
  });

  it('聞き直しの間隔は一定の時間を空ける（連続して開始しない）', () => {
    const h = makeHarness();
    h.conversation.start();
    h.lastRecognizer().emitEnd();
    expect(h.timers[h.timers.length - 1].ms).toBe(RESTART_DELAY_MS);
  });
});

describe('音声会話：状態の通知', () => {
  it('状態は、聞いている → 考えている → お答えしている → 聞いている の順に通知される', () => {
    const h = makeHarness();
    h.conversation.start();
    h.lastRecognizer().emitResult('相談です');
    h.conversation.replyDone('回答です。');
    h.speeches[0].onEnd();
    expect(h.statuses).toEqual(['listening', 'thinking', 'speaking', 'listening']);
  });

  it('対応していないブラウザでは開始せず、案内する', () => {
    const notices: string[] = [];
    const c = new VoiceConversation({
      isSupported: () => false,
      createRecognizer: () => null,
      speakReply: () => ({ cancel: () => {} }),
      onStatus: () => {},
      onUtterance: () => {},
      describeError: async () => null,
      notify: (m) => notices.push(m),
      setTimer: () => 0,
      clearTimer: () => {},
    });
    c.start();
    expect(c.current).toBe('off');
    expect(notices).toHaveLength(1);
  });
});
