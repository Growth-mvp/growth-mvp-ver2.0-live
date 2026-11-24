export type KeyValueStorage = Pick<Storage, 'getItem' | 'setItem'>;

const CONSENT_PREFIX = 'growth.ceoVoice.consent.v1';
const AUTO_READ_PREFIX = 'growth.ceoVoice.autoRead.v1';

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

export function readVoiceConsent(storage: KeyValueStorage, userId: string): boolean {
  try {
    return storage.getItem(`${CONSENT_PREFIX}:${userId}`) === 'agreed';
  } catch {
    return false;
  }
}

export function writeVoiceConsent(storage: KeyValueStorage, userId: string): void {
  try {
    storage.setItem(`${CONSENT_PREFIX}:${userId}`, 'agreed');
  } catch {
    // 保存できない環境では、次回以降に同意を求め直す
  }
}

/** 回答の自動読み上げ。初期状態はOFF */
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

/** 読み上げ用に、Markdownの記号・URL・診断表示を取り除く */
export function toSpeakableText(markdown: string): string {
  return markdown
    .split('\n')
    .filter((line) => !/^\s*\[debug\]/.test(line))
    .join('\n')
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/`([^`]*)`/g, '$1')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, '')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/https?:\/\/\S+/g, '')
    .replace(/^\s{0,3}#{1,6}\s+/gm, '')
    .replace(/^\s*>\s?/gm, '')
    .replace(/^\s*[-*+]\s+/gm, '')
    .replace(/^\s*\d+\.\s+/gm, '')
    .replace(/\*\*|__|~~|\*/g, '')
    .replace(/\|/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}
