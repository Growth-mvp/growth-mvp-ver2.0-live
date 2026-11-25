export type KeyValueStorage = Pick<Storage, 'getItem' | 'setItem'>;

const AUTO_READ_PREFIX = 'growth.ceoVoice.autoRead.v1';
const REPLY_MODE_PREFIX = 'growth.ceoVoice.replyMode.v1';

/** 読み上げ速度（音声会話と通常の読み上げで共通。利用者による変更はない） */
export const VOICE_SPEECH_RATE = 1.2;

export type ReplyMode = 'voice-and-text' | 'text-only';
export const DEFAULT_REPLY_MODE: ReplyMode = 'voice-and-text';

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
