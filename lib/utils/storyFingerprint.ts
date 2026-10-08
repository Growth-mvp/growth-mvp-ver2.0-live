/**
 * story_fingerprint 生成（サーバー・クライアント双方で使用）
 * 目的：4章が同一かどうかを判定する（暗号学的安全性は不要）
 *
 * 重要：このアルゴリズムはサーバー API と UI 側で絶対に同じ値を返すこと
 */

export interface StoryChapter {
  title?: string;
  body?: string;
}

/**
 * 簡易的だが安定したハッシュ関数
 * Node.js と ブラウザ両方で動作し、同じ結果を返す
 */
function simpleHash(str: string): string {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash; // Convert to 32bit integer
  }
  return Math.abs(hash).toString(16).padStart(8, '0');
}

/**
 * 4章から story_fingerprint を生成
 *
 * 仕様（厳密に守ること）：
 * - chapters が undefined/null/empty → ''を返す
 * - 各章：title を trim() → body を trim() → 結合
 * - 区切り文字は固定: '||'（タイトルと本文間）, '\n---\n'（章間）
 * - null/undefined は空文字として扱う
 * - 改行は正規化しない（API側と一致させるため）
 */
export function createStoryFingerprint(story: unknown): string {
  // 型ガード
  if (!Array.isArray(story) || story.length === 0) {
    return '';
  }

  // 各章を正規化
  const normalized = story
    .filter((ch): ch is StoryChapter => !!ch && typeof ch === 'object')
    .map((ch) => {
      const title = (ch.title || '').trim();
      const body = (ch.body || '').trim();
      return `${title}||${body}`;
    })
    .filter(Boolean); // 空の章を除外

  if (normalized.length === 0) {
    return '';
  }

  // 章を結合
  const concatenated = normalized.join('\n---\n');

  // ハッシュを生成
  return simpleHash(concatenated);
}
