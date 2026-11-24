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

export function speakJapanese(text: string, handlers: { onStart?: () => void; onEnd?: () => void } = {}): boolean {
  if (!isSpeechOutputSupported() || !text) return false;
  const synth = window.speechSynthesis;
  synth.cancel();
  const utterance = new SpeechSynthesisUtterance(text);
  utterance.lang = 'ja-JP';
  utterance.onstart = () => handlers.onStart?.();
  utterance.onend = () => handlers.onEnd?.();
  utterance.onerror = () => handlers.onEnd?.();
  synth.speak(utterance);
  return true;
}

export function stopSpeaking(): void {
  if (isSpeechOutputSupported()) window.speechSynthesis.cancel();
}

export const RECOGNITION_ERROR_MESSAGE: Record<string, string> = {
  'not-allowed': 'マイクの使用が許可されていません。ブラウザの設定でマイクを許可してください。',
  'service-not-allowed': 'このブラウザでは音声認識が許可されていません。文字でご入力ください。',
  'audio-capture': 'マイクが見つかりません。マイクの接続を確認してください。',
  'no-speech': '音声が聞き取れませんでした。もう一度お試しください。',
  network: '音声認識サービスに接続できませんでした。文字でご入力ください。',
};

export function recognitionErrorMessage(code: string): string | null {
  if (code === 'aborted') return null;
  return RECOGNITION_ERROR_MESSAGE[code] ?? '音声入力でエラーが起きました。文字でご入力ください。';
}
