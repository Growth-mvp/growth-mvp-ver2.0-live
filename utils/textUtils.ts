/* ============================================================================
 *  /utils/textUtils.ts
 *  日本語テキスト整形・正規化ユーティリティ
 * ============================================================================ */

/**
 * 全角英数・全角スペースを半角に変換し、改行や余分な空白を整形
 */
export function normalizeJapanese(s: string): string {
  if (!s) return '';
  return s
    .replace(/\r?\n/g, ' ')
    .replace(/[Ａ-Ｚａ-ｚ０-９]/g, (ch) =>
      String.fromCharCode(ch.charCodeAt(0) - 0xfee0)
    )
    .replace(/　/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * 文末が不自然なときに補正
 */
export function fixSentenceEnding(s: string): string {
  if (!s) return '';
  let t = s.trim();
  t = t.replace(/[。．.]+$/g, '');
  if (!/[?？]$/.test(t)) {
    t = t.endsWith('か') ? t + '？' : t + 'ですか？';
  }
  return t;
}
