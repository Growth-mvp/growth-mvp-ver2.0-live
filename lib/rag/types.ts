// lib/rag/types.ts
// Sprint 6A: Light RAG 型定義

/**
 * ドキュメントメタデータ
 */
export interface RagDoc {
  id: string; // ファイル名（growth/overview.md → "overview"）
  title: string; // ドキュメント タイトル（ファイルまたは H1 見出しから抽出）
  path: string; // ファイルパス（docs/growth/overview.md）
  text: string; // ドキュメント全文
  updatedAt?: number; // 最後の更新 Unix timestamp
}

/**
 * チャンク（ドキュメント分割単位）
 */
export interface RagChunk {
  docId: string; // 所属ドキュメント ID
  title: string; // ドキュメント タイトル
  chunkId: string; // チャンク ID（docId#0, docId#1 など）
  content: string; // チャンク本体（600〜900 字）
  tokensApprox: number; // 近似トークン数（文字数 / 3-4 程度）
  headings?: string[]; // 見出し階層（["## 目的", "### 詳細"]）
}

/**
 * 検索結果スコア付きチャンク
 */
export interface RagHit {
  chunk: RagChunk;
  score: number; // 0-1 の関連度スコア
  reasons?: string[]; // スコア計算理由（デバッグ用）
}

/**
 * RAG 検索結果
 */
export interface RagRetrieveResult {
  query: string; // 入力クエリ
  hits: RagHit[]; // マッチしたチャンク（最大 topK 件、スコア順）
  usedChunks: RagChunk[]; // 実際に systemPrompt に注入するチャンク
  totalTime?: number; // 検索処理時間（ms）
}

/**
 * RAG インデックス（メモリキャッシュ）
 */
export interface RagIndex {
  chunks: RagChunk[];
  docs: RagDoc[];
  loadedAt: number; // ロード時刻（Unix timestamp）
}
