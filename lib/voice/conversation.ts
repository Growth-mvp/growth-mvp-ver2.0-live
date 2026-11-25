/* 音声会話の状態遷移：聞いている → 考えている → お答えしている → 聞いている、を利用者が終了するまで繰り返す。
 * 音声認識・読み上げ・タイマーは外から渡す（テストで差し替えられるように）。 */

import type { RecognitionLike } from './browserSpeech';
import type { SpeechHandle } from './browserSpeech';

export type ConversationStatus = 'off' | 'listening' | 'thinking' | 'speaking';

export type ConversationDeps = {
  isSupported: () => boolean;
  createRecognizer: () => RecognitionLike | null;
  speakReply: (text: string, handlers: { onEnd: () => void }) => SpeechHandle;
  onStatus: (status: ConversationStatus) => void;
  onUtterance: (text: string) => void;
  describeError: (code: string) => Promise<string | null>;
  notify: (message: string) => void;
  setTimer: (fn: () => void, ms: number) => unknown;
  clearTimer: (handle: unknown) => void;
};

export const MAX_SILENT_ROUNDS = 3;
export const RESTART_DELAY_MS = 350;
export const NO_SPEECH_MESSAGE = '音声が聞き取れなかったため、会話を終了しました。再開するには「会話を始める」を押してください。';

export class VoiceConversation {
  private status: ConversationStatus = 'off';
  private recognizer: RecognitionLike | null = null;
  private silentRounds = 0;
  private timer: unknown = null;
  private speech: SpeechHandle | null = null;
  private generation = 0;

  constructor(private readonly deps: ConversationDeps) {}

  get current(): ConversationStatus {
    return this.status;
  }

  get active(): boolean {
    return this.status !== 'off';
  }

  start(): void {
    if (this.status !== 'off') return;
    if (!this.deps.isSupported()) {
      this.deps.notify('このブラウザは音声入力に対応していません。文字でご入力ください。');
      return;
    }
    this.silentRounds = 0;
    this.setStatus('listening');
    this.listen();
  }

  /* 会話を止める。マイクと読み上げを止め、以後は自動で再開しない */
  stop(message?: string): void {
    if (this.status === 'off') return;
    this.generation++;
    this.clearTimer();
    this.detachRecognizer();
    this.speech?.cancel();
    this.speech = null;
    this.setStatus('off');
    if (message) this.deps.notify(message);
  }

  /* 利用者の発言への回答が終わった。回答があれば読み上げ、無ければすぐ聞き直す */
  replyDone(answer: string | null): void {
    if (this.status !== 'thinking') return;
    if (answer && answer.trim()) {
      this.setStatus('speaking');
      const generation = this.generation;
      this.speech = this.deps.speakReply(answer, {
        onEnd: () => {
          if (generation !== this.generation || this.status !== 'speaking') return;
          this.speech = null;
          this.setStatus('listening');
          this.scheduleRestart();
        },
      });
      return;
    }
    this.setStatus('listening');
    this.scheduleRestart();
  }

  private listen(): void {
    if (this.status !== 'listening') return;
    const generation = this.generation;
    const recognizer = this.deps.createRecognizer();
    if (!recognizer) {
      this.fail('error');
      return;
    }
    recognizer.lang = 'ja-JP';
    recognizer.continuous = false;
    recognizer.interimResults = false;
    let heard = false;

    recognizer.onresult = (event) => {
      if (generation !== this.generation) return;
      heard = true;
      this.silentRounds = 0;
      const text = event.results[event.results.length - 1]?.[0]?.transcript?.trim() ?? '';
      this.detachRecognizer();
      if (!text) {
        this.scheduleRestart();
        return;
      }
      this.setStatus('thinking');
      this.deps.onUtterance(text);
    };

    recognizer.onerror = (event) => {
      if (generation !== this.generation || event.error === 'aborted') return;
      this.detachRecognizer();
      if (event.error === 'no-speech') {
        this.silentRounds++;
        if (this.silentRounds >= MAX_SILENT_ROUNDS) {
          this.stop(NO_SPEECH_MESSAGE);
          return;
        }
        this.scheduleRestart();
        return;
      }
      this.fail(event.error);
    };

    recognizer.onend = () => {
      if (generation !== this.generation || this.status !== 'listening' || heard) return;
      this.detachRecognizer();
      this.silentRounds++;
      if (this.silentRounds >= MAX_SILENT_ROUNDS) {
        this.stop(NO_SPEECH_MESSAGE);
        return;
      }
      this.scheduleRestart();
    };

    this.recognizer = recognizer;
    try {
      recognizer.start();
    } catch {
      this.fail('start-failed');
    }
  }

  /* 認識が止まったときは、理由に合わせた案内を出して会話を終える（自動の再試行で繰り返さない） */
  private fail(code: string): void {
    const generation = this.generation;
    this.detachRecognizer();
    void this.deps.describeError(code).then((message) => {
      if (generation !== this.generation) return;
      this.stop(message ?? '音声入力を続けられなかったため、会話を終了しました。文字でご入力ください。');
    });
  }

  private scheduleRestart(): void {
    this.clearTimer();
    const generation = this.generation;
    this.timer = this.deps.setTimer(() => {
      this.timer = null;
      if (generation !== this.generation || this.status !== 'listening') return;
      this.listen();
    }, RESTART_DELAY_MS);
  }

  private detachRecognizer(): void {
    const recognizer = this.recognizer;
    this.recognizer = null;
    if (!recognizer) return;
    recognizer.onresult = null;
    recognizer.onerror = null;
    recognizer.onend = null;
    try {
      recognizer.abort();
    } catch {
      /* 既に止まっている認識は、止めなくてよい */
    }
  }

  private clearTimer(): void {
    if (this.timer !== null) this.deps.clearTimer(this.timer);
    this.timer = null;
  }

  private setStatus(status: ConversationStatus): void {
    this.status = status;
    this.deps.onStatus(status);
  }
}
