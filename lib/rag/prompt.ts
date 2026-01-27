// lib/rag/prompt.ts
// Sprint 6A: RAG 検索結果を systemPrompt 注入用に整形

import type { RagRetrieveResult } from './types';

/**
 * RAG 検索結果を systemPrompt 注入用ブロックに変換
 *
 * 形式:
 * 【GROWTHナレッジ（検索結果）】
 * - [doc: stage6.md] score=0.92
 *   <チャンク内容 400-700字、改行保持>
 * - [doc: overview.md] score=0.85
 *   <チャンク内容>
 *
 * 末尾に【根拠（参照）】セクションで参照doc名の簡潔なサマリーを追加
 */
export function buildRagContextBlock(result: RagRetrieveResult): string {
  if (result.hits.length === 0) {
    return '';
  }

  // 内容をカット（各チャンク最大 700 字）
  const MAX_CHUNK_LENGTH = 700;
  const truncateContent = (content: string): string => {
    if (content.length <= MAX_CHUNK_LENGTH) {
      return content;
    }
    return content.slice(0, MAX_CHUNK_LENGTH) + '...';
  };

  // 見出しなしバージョンの content を取得（Markdown フォーマット削除）
  const cleanContent = (content: string): string => {
    // 見出しを削除（# または ## で始まる行）
    return content
      .split('\n')
      .filter((line) => !/^#{1,2}\s+/.test(line))
      .join('\n')
      .trim();
  };

  // ブロック組み立て
  const lines: string[] = ['【GROWTHナレッジ（検索結果）】'];

  for (const hit of result.hits) {
    const score = (hit.score * 100).toFixed(0);
    const docName = hit.chunk.docId + '.md';
    const cleanedContent = cleanContent(hit.chunk.content);
    const truncated = truncateContent(cleanedContent);

    lines.push(`- [${docName}] score=${score}%`);
    lines.push(`  ${truncated.split('\n').join('\n  ')}`); // インデント付与
  }

  // 根拠の簡潔なサマリーを追加（末尾に2〜4行）
  const uniqueDocs = Array.from(new Set(result.hits.map((hit) => hit.chunk.docId)));
  if (uniqueDocs.length > 0) {
    lines.push('');
    lines.push('【根拠（参照）】');
    uniqueDocs.forEach((docId) => {
      lines.push(`- ${docId}.md`);
    });
  }

  return lines.join('\n');
}

/**
 * RAG ガード文を systemPrompt に追加（任意）
 *
 * "検索結果（RAG）に根拠がある場合は、それを優先して具体回答する"
 */
export function buildRagGuardSection(): string {
  return `
## RAG 検索結果の優先利用

提供された【GROWTHナレッジ（検索結果）】に根拠がある場合は、それを必ず参照し、具体的な回答をしてください。
- ナレッジに記載された内容は GROWTH の正式定義です
- 根拠がない場合は、確認質問をしてください（最大1つ）
- 推測・一般論は避けてください`;
}

/**
 * Debug 情報を生成（開発時のみ）
 */
export function buildRagDebugFooter(result: RagRetrieveResult): string {
  if (!result.hits || result.hits.length === 0) {
    return '[RAG] hits=0';
  }

  const docNames = result.usedChunks
    .map((chunk) => `${chunk.docId}.md`)
    .join(',');
  const totalScore = result.hits.reduce((sum, hit) => sum + hit.score, 0) / result.hits.length;

  return `[RAG] hits=${result.hits.length} score=${(totalScore * 100).toFixed(0)}% docs=${docNames}`;
}
