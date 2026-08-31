export type StoryFingerprint = {
  chapterCount: number;
  firstChapterKeyMessageLength: number;
  fullHash: string;
  updatedAt?: string;
};

/**
 * Story データのフィンガープリントを計算（本文は出力しない）
 * 同じデータかどうかを追跡するためだけに使用
 */
export function calculateStoryFingerprint(
  chapters: any[] | undefined,
  updatedAt?: string
): StoryFingerprint {
  const chapterCount = Array.isArray(chapters) ? chapters.length : 0;

  // 第1章のkeyMessage文字数（存在しなければ0）
  const firstChapterKeyMessage =
    Array.isArray(chapters) && chapters.length > 0
      ? (chapters[0]?.keyMessage || chapters[0]?.title || chapters[0]?.body || '')
      : '';
  const firstChapterKeyMessageLength = typeof firstChapterKeyMessage === 'string'
    ? firstChapterKeyMessage.length
    : 0;

  // 全体の簡易ハッシュ（ブラウザ互換）
  let fullHash = 'N/A';
  try {
    const data = JSON.stringify(chapters);
    let hash = 0;
    for (let i = 0; i < data.length; i++) {
      const chr = data.charCodeAt(i);
      hash = ((hash << 5) - hash) + chr;
      hash = hash & hash; // Convert to 32bit integer
    }
    fullHash = Math.abs(hash).toString(16).slice(0, 8);
  } catch (e) {
    fullHash = 'error';
  }

  return {
    chapterCount,
    firstChapterKeyMessageLength,
    fullHash,
    updatedAt,
  };
}

/**
 * フィンガープリントをログ出力用の文字列に変換
 */
export function fingerprintToString(fp: StoryFingerprint | undefined, label: string): string {
  if (!fp) return `${label} undefined`;
  return `${label} chapters=${fp.chapterCount} keyMsg=${fp.firstChapterKeyMessageLength} hash=${fp.fullHash}${fp.updatedAt ? ` updatedAt=${fp.updatedAt}` : ''}`;
}
