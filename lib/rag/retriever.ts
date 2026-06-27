// lib/rag/retriever.ts
// Sprint 6A: 簡易 RAG 検索エンジン

import type { RagChunk, RagHit, RagRetrieveResult, RagIndex } from './types';

// 重要キーワード（重み増加）
const STRONG_KEYWORDS = [
  'stage1', 'stage2', 'stage3', 'stage4', 'stage5', 'stage6',
  'ステージ1', 'ステージ2', 'ステージ3', 'ステージ4', 'ステージ5', 'ステージ6',
  '企業価値分析', '経営戦略策定', '全社戦略', '部門戦略策定', '事業・部門別戦略', '実行計画策定', '実行支援', '業績シミュレーション',
  '業績', 'CSV', 'エラー', '保存', '権限',
];

/**
 * テキストをトークン化（日本語対応・簡易版）
 * - 英数字は単語単位
 * - 日本語は 2-3 gram
 */
function tokenize(text: string): string[] {
  const tokens: string[] = [];
  const lower = text.toLowerCase();

  // 英数字キーワード抽出
  const englishMatches = lower.match(/[a-z0-9_]+/g) || [];
  tokens.push(...englishMatches);

  // 日本語 2-gram
  const japaneseMatches = lower.match(/[\u4e00-\u9fff\u3040-\u309f\u30a0-\u30ff]+/g) || [];
  for (const word of japaneseMatches) {
    for (let i = 0; i < word.length - 1; i++) {
      tokens.push(word.slice(i, i + 2));
    }
    if (word.length >= 3) {
      // 3-gram も追加
      for (let i = 0; i < word.length - 2; i++) {
        tokens.push(word.slice(i, i + 3));
      }
    }
  }

  return tokens;
}

/**
 * 単語の出現回数をカウント
 */
function countOccurrences(text: string, word: string): number {
  const regex = new RegExp(word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi');
  const matches = text.match(regex);
  return matches ? matches.length : 0;
}

/**
 * スコアリング関数
 */
function scoreChunk(chunk: RagChunk, queryTokens: string[]): { score: number; reasons: string[] } {
  const reasons: string[] = [];
  let score = 0;

  for (const token of queryTokens) {
    // コンテンツ内の出現回数
    const contentCount = countOccurrences(chunk.content, token);
    if (contentCount > 0) {
      // 基本スコア（出現回数）
      const baseScore = Math.min(contentCount * 0.15, 0.5);
      score += baseScore;

      // 強いキーワード？
      if (STRONG_KEYWORDS.some((kw) => kw.toLowerCase().includes(token) || token.includes(kw.toLowerCase()))) {
        score += 0.3; // ボーナス
        reasons.push(`強キーワード: ${token}`);
      }
    }

    // タイトル・見出しに含まれる？
    if (chunk.title.toLowerCase().includes(token)) {
      score += 0.4; // タイトル一致は高スコア
      reasons.push(`タイトル一致: ${token}`);
    }

    if (chunk.headings) {
      for (const heading of chunk.headings) {
        if (heading.toLowerCase().includes(token)) {
          score += 0.25;
          reasons.push(`見出し一致: ${token}`);
          break; // 1 回だけ
        }
      }
    }
  }

  // 最終スコアを 0-1 に正規化
  const finalScore = Math.min(score / Math.max(queryTokens.length, 1), 1);

  return { score: finalScore, reasons };
}

/**
 * GROWTH ドキュメントから知識を検索
 *
 * @param query 検索クエリ
 * @param index RAG インデックス
 * @param topK 返すチャンク数（デフォルト: 4）
 * @returns 検索結果
 */
export function retrieveGrowthKnowledge(
  query: string,
  index: RagIndex,
  topK: number = 4
): RagRetrieveResult {
  const startTime = Date.now();

  // クエリをトークン化
  const queryTokens = tokenize(query);
  if (queryTokens.length === 0) {
    return {
      query,
      hits: [],
      usedChunks: [],
      totalTime: Date.now() - startTime,
    };
  }

  // 各チャンクをスコアリング
  const scored: RagHit[] = index.chunks
    .map((chunk) => {
      const { score, reasons } = scoreChunk(chunk, queryTokens);
      return {
        chunk,
        score,
        reasons,
      };
    })
    .filter((hit) => hit.score > 0) // スコア 0 は除外
    .sort((a, b) => b.score - a.score) // スコア順
    .slice(0, topK); // 上位 topK

  // 注入用チャンクを抽出（重複なし）
  const usedChunkIds = new Set<string>();
  const usedChunks: RagChunk[] = [];
  for (const hit of scored) {
    if (!usedChunkIds.has(hit.chunk.chunkId)) {
      usedChunks.push(hit.chunk);
      usedChunkIds.add(hit.chunk.chunkId);
    }
  }

  return {
    query,
    hits: scored,
    usedChunks,
    totalTime: Date.now() - startTime,
  };
}

/**
 * STAGE 番号から対応するドキュメント ID を取得
 * （優先検索用）
 */
export function getStageDocId(stageNum: string): string | null {
  const stageMap: Record<string, string> = {
    '1': 'stage1',
    '2': 'stage2',
    '3': 'stage3',
    '4': 'stage4',
    '5': 'stage5',
    '6': 'stage6',
  };
  return stageMap[stageNum] || null;
}
