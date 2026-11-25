/* ブラウザ標準の音声API（音声認識・読み上げ）の薄いラッパー。外部の有料APIは使わない */

export type RecognitionLike = {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  onresult: ((event: { results: ArrayLike<ArrayLike<{ transcript: string }>> & { length: number } }) => void) | null;
  onerror: ((event: { error: string }) => void) | null;
  onend: (() => void) | null;
  start(): void;
  stop(): void;
  abort(): void;
};

type RecognitionCtor = new () => RecognitionLike;

export function getRecognitionCtor(): RecognitionCtor | null {
  if (typeof window === 'undefined') return null;
  const w = window as unknown as { SpeechRecognition?: RecognitionCtor; webkitSpeechRecognition?: RecognitionCtor };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

export function isSpeechOutputSupported(): boolean {
  return typeof window !== 'undefined' && 'speechSynthesis' in window && typeof SpeechSynthesisUtterance !== 'undefined';
}

/* 日本語の声のうち、自然に聞こえやすいものを優先する。候補が無ければ null（ブラウザ既定の声を使う） */
export function pickJapaneseVoice<T extends { name: string; lang: string }>(voices: readonly T[]): T | null {
  const japanese = voices.filter((v) => /^ja([-_]|$)/i.test(v.lang));
  if (japanese.length === 0) return null;
  const rank = (v: T): number => {
    if (/natural/i.test(v.name)) return 0;
    if (/Google 日本語/.test(v.name)) return 1;
    if (/Nanami|Keita|Haruka|Ayumi|Ichiro/.test(v.name)) return 2;
    return 3;
  };
  return [...japanese].sort((a, b) => rank(a) - rank(b))[0];
}

let cachedVoice: SpeechSynthesisVoice | null = null;

/* 声の一覧は読み込みが遅れることがあるため、voiceschanged を待つ（最大1.5秒） */
function loadJapaneseVoice(): Promise<SpeechSynthesisVoice | null> {
  if (cachedVoice) return Promise.resolve(cachedVoice);
  return new Promise((resolve) => {
    const synth = window.speechSynthesis;
    const finish = (voice: SpeechSynthesisVoice | null) => {
      synth.removeEventListener('voiceschanged', onChanged);
      resolve(voice);
    };
    const onChanged = () => {
      const voice = pickJapaneseVoice(synth.getVoices());
      if (voice) {
        cachedVoice = voice;
        finish(voice);
      }
    };
    onChanged();
    if (cachedVoice) return;
    synth.addEventListener('voiceschanged', onChanged);
    window.setTimeout(() => finish(null), 1500);
  });
}

export type SpeechHandle = { cancel(): void };

/* 回答を文ごとに読む。途中の文が止まっても次へ進み、利用者が止めたら残りは読まない */
export function speakChunks(
  chunks: string[],
  handlers: { onStart?: () => void; onEnd?: () => void; rate?: number } = {},
): SpeechHandle {
  const rate = handlers.rate ?? 1.0;
  if (!isSpeechOutputSupported() || chunks.length === 0) {
    const timer = window.setTimeout(() => handlers.onEnd?.(), 0);
    return { cancel: () => window.clearTimeout(timer) };
  }
  const synth = window.speechSynthesis;
  let cancelled = false;
  let ended = false;
  let started = false;
  let index = 0;
  let voice: SpeechSynthesisVoice | null = null;
  let watchdog: number | undefined;

  const finish = () => {
    if (ended || cancelled) return;
    ended = true;
    handlers.onEnd?.();
  };

  const advance = (): void => {
    if (cancelled || ended) return;
    if (index >= chunks.length) {
      finish();
      return;
    }
    const text = chunks[index++];
    let done = false;
    const next = () => {
      if (done) return;
      done = true;
      window.clearTimeout(watchdog);
      advance();
    };
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = 'ja-JP';
    utterance.rate = rate;
    utterance.pitch = 1.0;
    if (voice) utterance.voice = voice;
    utterance.onstart = () => {
      if (started) return;
      started = true;
      handlers.onStart?.();
    };
    utterance.onend = next;
    utterance.onerror = next;
    watchdog = window.setTimeout(() => {
      if (done) return;
      done = true;
      synth.cancel();
      advance();
    }, (text.length * 450) / rate + 6000);
    synth.speak(utterance);
  };

  synth.cancel();
  void loadJapaneseVoice().then((v) => {
    voice = v;
    if (!cancelled) advance();
  });

  return {
    cancel: () => {
      cancelled = true;
      window.clearTimeout(watchdog);
      synth.cancel();
    },
  };
}

export function stopSpeaking(): void {
  if (isSpeechOutputSupported()) window.speechSynthesis.cancel();
}

export const RECOGNITION_ERROR_MESSAGE: Record<string, string> = {
  'service-not-allowed': 'このブラウザでは音声認識が許可されていません。文字でご入力ください。',
  'audio-capture': 'マイクが見つかりません。マイクの接続を確認してください。',
  'no-speech': '音声が聞き取れませんでした。もう一度お試しください。',
  network: '音声認識サービスに接続できませんでした。文字でご入力ください。',
};

export type MicrophoneProbe = {
  policyAllowed: boolean | null;
  permission: 'granted' | 'denied' | 'prompt' | 'unknown';
  device: 'available' | 'denied' | 'missing' | 'error' | 'unknown';
};

/* not-allowed の原因を切り分けるための読み取り。音声は録らず、取得したマイクはすぐ止める */
export async function probeMicrophone(): Promise<MicrophoneProbe> {
  const doc = document as unknown as { permissionsPolicy?: { allowsFeature?: (f: string) => boolean } };
  const policyAllowed = typeof doc.permissionsPolicy?.allowsFeature === 'function' ? doc.permissionsPolicy.allowsFeature('microphone') : null;

  let permission: MicrophoneProbe['permission'] = 'unknown';
  try {
    const status = await navigator.permissions?.query({ name: 'microphone' as PermissionName });
    if (status && (status.state === 'granted' || status.state === 'denied' || status.state === 'prompt')) permission = status.state;
  } catch {
    permission = 'unknown';
  }

  let device: MicrophoneProbe['device'] = 'unknown';
  try {
    const stream = await navigator.mediaDevices?.getUserMedia({ audio: true });
    if (stream) {
      stream.getTracks().forEach((track) => track.stop());
      device = 'available';
    }
  } catch (e) {
    const name = e instanceof DOMException ? e.name : '';
    device = name === 'NotAllowedError' || name === 'SecurityError' ? 'denied' : name === 'NotFoundError' ? 'missing' : 'error';
  }
  return { policyAllowed, permission, device };
}

/* not-allowed は、ページのポリシー・ブラウザのマイク許可・マイク取得の結果で原因が違うため、結果に合わせて案内する */
export function microphoneErrorMessage(code: string, probe: MicrophoneProbe | null): string | null {
  if (code === 'aborted') return null;
  if (code !== 'not-allowed') return RECOGNITION_ERROR_MESSAGE[code] ?? '音声入力でエラーが起きました。文字でご入力ください。';
  if (probe?.policyAllowed === false) {
    return 'このページではマイクの利用が制限されています（サイトの設定）。管理者に連絡してください。文字でご入力ください。';
  }
  if (probe?.device === 'denied' || probe?.permission === 'denied') {
    return 'マイクの使用が許可されていません。ブラウザのアドレスバー（鍵のマーク）からこのサイトのマイクを許可してください。';
  }
  if (probe?.device === 'missing') return 'マイクが見つかりません。マイクの接続を確認してください。';
  if (probe?.device === 'available') {
    return 'マイクは使えますが、音声認識サービスがこのページでの音声入力を開始できませんでした。時間をおいて再度お試しください。文字でご入力ください。';
  }
  return '音声認識を開始できませんでした。文字でご入力ください。';
}
