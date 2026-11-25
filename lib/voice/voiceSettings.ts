export type KeyValueStorage = Pick<Storage, 'getItem' | 'setItem'>;

const AUTO_READ_PREFIX = 'growth.ceoVoice.autoRead.v1';
const SPEECH_RATE_PREFIX = 'growth.ceoVoice.speechRate.v1';
const REPLY_MODE_PREFIX = 'growth.ceoVoice.replyMode.v1';

export const SPEECH_RATE_OPTIONS = [
  { key: 'standard', label: '標準', rate: 1.0 },
  { key: 'fast', label: '速め', rate: 1.3 },
  { key: 'faster', label: '高速', rate: 1.5 },
] as const;

export type SpeechRateKey = (typeof SPEECH_RATE_OPTIONS)[number]['key'];
export const DEFAULT_SPEECH_RATE_KEY: SpeechRateKey = 'fast';

export type ReplyMode = 'voice-and-text' | 'text-only';
export const DEFAULT_REPLY_MODE: ReplyMode = 'voice-and-text';

export function speechRateOf(key: SpeechRateKey): number {
  return SPEECH_RATE_OPTIONS.find((o) => o.key === key)?.rate ?? 1.3;
}

export function readSpeechRate(storage: KeyValueStorage, userId: string): SpeechRateKey {
  try {
    const raw = storage.getItem(`${SPEECH_RATE_PREFIX}:${userId}`);
    return SPEECH_RATE_OPTIONS.some((o) => o.key === raw) ? (raw as SpeechRateKey) : DEFAULT_SPEECH_RATE_KEY;
  } catch {
    return DEFAULT_SPEECH_RATE_KEY;
  }
}

export function writeSpeechRate(storage: KeyValueStorage, userId: string, key: SpeechRateKey): void {
  try {
    storage.setItem(`${SPEECH_RATE_PREFIX}:${userId}`, key);
  } catch {
    // 保存できない環境では、画面を開いたときの既定の速さに戻る
  }
}

export function readReplyMode(storage: KeyValueStorage, userId: string): ReplyMode {
  try {
    const raw = storage.getItem(`${REPLY_MODE_PREFIX}:${userId}`);
    return raw === 'text-only' ? 'text-only' : DEFAULT_REPLY_MODE;
  } catch {
    return DEFAULT_REPLY_MODE;
  }
}

export function writeReplyMode(storage: KeyValueStorage, userId: string, mode: ReplyMode): void {
  try {
    storage.setItem(`${REPLY_MODE_PREFIX}:${userId}`, mode);
  } catch {
    // 保存できない環境では、画面を開いたときの既定の回答方法に戻る
  }
}

/** 環境変数で音声機能を止める。全体（"true"）または会社ID（カンマ区切り）単位で無効化できる */
export function isVoiceDisabledFor(
  companyId: string | null | undefined,
  disabledFlag: string | undefined,
  disabledCompanyIds: string | undefined,
): boolean {
  if (disabledFlag === 'true') return true;
  if (!companyId || !disabledCompanyIds) return false;
  return disabledCompanyIds
    .split(',')
    .map((id) => id.trim())
    .filter(Boolean)
    .includes(companyId);
}

/** 文字で入力したときの回答の自動読み上げ。初期状態はOFF（会話モード中は回答を自動で読み上げる） */
export function readAutoRead(storage: KeyValueStorage, userId: string): boolean {
  try {
    return storage.getItem(`${AUTO_READ_PREFIX}:${userId}`) === 'on';
  } catch {
    return false;
  }
}

export function writeAutoRead(storage: KeyValueStorage, userId: string, on: boolean): void {
  try {
    storage.setItem(`${AUTO_READ_PREFIX}:${userId}`, on ? 'on' : 'off');
  } catch {
    // 保存できない環境では、画面を開いたときの設定（OFF）に戻る
  }
}
