// lib/rag/indexer.ts
// Sprint 6A: ドキュメント読み込み＆チャンク化

import * as fs from 'fs';
import * as path from 'path';
import type { RagDoc, RagChunk, RagIndex } from './types';

const DOCS_DIR = path.join(process.cwd(), 'docs', 'growth');
const CHUNK_SIZE_MIN = 600; // 最小文字数
const CHUNK_SIZE_MAX = 900; // 最大文字数
const CHUNK_SIZE_TARGET = 750; // 目標文字数

// メモリキャッシュ
let cachedIndex: RagIndex | null = null;
let lastLoadTime = 0;
const CACHE_TTL = 5 * 60 * 1000; // 5 分間キャッシュ（開発時）

/**
 * /docs/growth フォルダから Markdown ファイルを読み込む
 */
export function loadGrowthDocs(): RagDoc[] {
  const docs: RagDoc[] = [];

  try {
    if (!fs.existsSync(DOCS_DIR)) {
      console.warn(`[RAG] ドキュメントフォルダが見つかりません: ${DOCS_DIR}`);
      return docs;
    }

    const files = fs.readdirSync(DOCS_DIR).filter(
      (f) => f.endsWith('.md') || f.endsWith('.txt')
    );

    for (const file of files) {
      try {
        const filePath = path.join(DOCS_DIR, file);
        const text = fs.readFileSync(filePath, 'utf-8');

        // ファイル ID（拡張子除去）
        const docId = path.basename(file, path.extname(file));

        // タイトル抽出（先頭の # 見出しか、ファイル名）
        const titleMatch = text.match(/^#\s+(.+?)$/m);
        const title = titleMatch ? titleMatch[1] : docId;

        docs.push({
          id: docId,
          title,
          path: filePath,
          text,
          updatedAt: Math.floor(fs.statSync(filePath).mtime.getTime()),
        });
      } catch (err) {
        console.error(`[RAG] ファイル読み込みエラー: ${file}`, err);
        // スキップして続行
      }
    }
  } catch (err) {
    console.error('[RAG] ドキュメント読み込み失敗', err);
  }

  return docs;
}

/**
 * ドキュメントをチャンクに分割
 * - 見出し（# または ##）を優先して分割
 * - 各チャンク 600〜900 文字
 */
export function buildChunks(docs: RagDoc[]): RagChunk[] {
  const chunks: RagChunk[] = [];
  let chunkIndex = 0;

  for (const doc of docs) {
    // ドキュメントを # または ## で分割
    const sections = doc.text.split(/^(#{1,2}\s+.+?)$/m).filter(Boolean);

    let currentChunk = '';
    let currentHeadings: string[] = [];

    for (const section of sections) {
      // 見出し判定
      const isHeading = /^#{1,2}\s+/.test(section);

      if (isHeading) {
        // 現在のチャンクを保存（ある場合）
        if (currentChunk.trim().length >= CHUNK_SIZE_MIN) {
          const chunkId = `${doc.id}#${chunkIndex++}`;
          chunks.push({
            docId: doc.id,
            title: doc.title,
            chunkId,
            content: currentChunk.trim(),
            tokensApprox: Math.ceil(currentChunk.length / 3.5),
            headings: currentHeadings,
          });
          currentChunk = '';
          currentHeadings = [];
        }

        // 新しい見出しを開始
        currentHeadings.push(section.trim());
        currentChunk = section + '\n';
      } else {
        // 本文を追加
        currentChunk += section;

        // チャンク size がターゲットを超えたら分割
        if (currentChunk.length >= CHUNK_SIZE_TARGET) {
          const chunkId = `${doc.id}#${chunkIndex++}`;
          chunks.push({
            docId: doc.id,
            title: doc.title,
            chunkId,
            content: currentChunk.trim(),
            tokensApprox: Math.ceil(currentChunk.length / 3.5),
            headings: [...currentHeadings],
          });
          currentChunk = '';
          // 見出しは保持（次のチャンクにも含める）
        }
      }
    }

    // 残りのテキストをチャンク化
    if (currentChunk.trim().length >= CHUNK_SIZE_MIN) {
      const chunkId = `${doc.id}#${chunkIndex++}`;
      chunks.push({
        docId: doc.id,
        title: doc.title,
        chunkId,
        content: currentChunk.trim(),
        tokensApprox: Math.ceil(currentChunk.length / 3.5),
        headings: currentHeadings,
      });
    }
  }

  return chunks;
}

/**
 * GROWTH RAG インデックスを取得（キャッシュ活用）
 *
 * 開発環境では 5 分ごとに再読み込み
 * 本番環境では起動時ロードのみ
 */
export function getGrowthRagIndex(): RagIndex {
  const now = Date.now();
  const isDev = process.env.NODE_ENV === 'development';

  // キャッシュが有効？
  if (
    cachedIndex &&
    (isDev ? now - lastLoadTime < CACHE_TTL : lastLoadTime > 0)
  ) {
    return cachedIndex;
  }

  // キャッシュが無効 → 再読み込み
  const docs = loadGrowthDocs();
  const chunks = buildChunks(docs);

  cachedIndex = {
    docs,
    chunks,
    loadedAt: now,
  };
  lastLoadTime = now;

  if (isDev) {
    console.log(
      `[RAG] インデックス loaded: ${docs.length} docs, ${chunks.length} chunks`
    );
  }

  return cachedIndex;
}

/**
 * キャッシュをクリア（テスト/手動リロード用）
 */
export function clearRagCache(): void {
  cachedIndex = null;
  lastLoadTime = 0;
}
