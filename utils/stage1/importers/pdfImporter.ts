// /utils/stage1/importers/pdfImporter.ts
/**
 * PDF ファイルからテキストを抽出
 * - pdf-parse（v2 の PDFParse）を使用。ページごとのテキストを取得する
 * - 巨大PDF対策：優先ページ抽出、上限設定
 */

import path from 'node:path';

type PdfParseModule = typeof import('pdf-parse');

// Next のバンドルに含めず、Node の標準の読み込みで pdf-parse を使う（PDF.js のワーカーを正しく解決するため）
const loadNative = new Function('specifier', 'return import(specifier)') as (specifier: string) => Promise<PdfParseModule>;
let pdfParseModule: Promise<PdfParseModule> | null = null;
const loadPdfParse = () => (pdfParseModule ??= loadNative('pdf-parse'));

/** 埋め込まれていない日本語フォントの文字コードを読むためのCMap（pdf.js 同梱）。無いと本文が空になる */
const CMAP_DIR = path.join(process.cwd(), 'node_modules', 'pdfjs-dist', 'cmaps').replace(/\\/g, '/') + '/';

/** ページごとの抽出結果 */
export type PdfPageText = {
  pageNumber: number;
  text: string;
  isPriority: boolean;
  priorityReason?: string;
};

/** PDF解析結果 */
export type PdfExtractResult = {
  /** 総ページ数 */
  totalPages: number;
  /** 解析したページ数 */
  processedPages: number;
  /** ページごとのテキスト */
  pages: PdfPageText[];
  /** メタデータ */
  metadata?: Record<string, any>;
  /** 警告（ページ制限など） */
  warnings: string[];
};

/** 優先抽出キーワード */
const PRIORITY_KEYWORDS = [
  // 日本語
  '連結損益計算書',
  '損益計算書',
  '連結貸借対照表',
  '貸借対照表',
  'セグメント情報',
  'セグメント別',
  '事業セグメント',
  '注記',
  '財務諸表',
  '経営成績',
  '財政状態',
  '売上高',
  '営業利益',
  '純資産',
  '有利子負債',
  // 英語
  'income statement',
  'balance sheet',
  'segment information',
  'consolidated',
  'revenue',
  'operating income',
  'financial statements',
];

/** ページ処理の上限 */
const MAX_PAGES = 25;

/** 優先ページが見つからない場合のサンプリング数 */
const FALLBACK_SAMPLE_PAGES = 10;

/**
 * PDFバッファからテキストを抽出
 */
export async function parsePdf(buffer: Buffer): Promise<PdfExtractResult> {
  const warnings: string[] = [];
  const { PDFParse } = await loadPdfParse();
  const parser = new PDFParse({ data: new Uint8Array(buffer), cMapUrl: CMAP_DIR, cMapPacked: true });

  try {
    const info = await parser.getInfo();
    const totalPages: number = info.total;

    if (totalPages === 0) {
      return {
        totalPages: 0,
        processedPages: 0,
        pages: [],
        warnings: ['PDFにページがありません'],
      };
    }

    if (totalPages > MAX_PAGES) {
      warnings.push(`PDFが${totalPages}ページあります。先頭${MAX_PAGES}ページを解析します。`);
    }

    const text = await parser.getText({ first: Math.min(totalPages, MAX_PAGES) });

    const analyzedPages: PdfPageText[] = text.pages.map((page: { num: number; text: string }) => {
      const { isPriority, reason } = checkPriority(page.text);
      return {
        pageNumber: page.num,
        text: page.text,
        isPriority,
        priorityReason: reason,
      };
    });

    // 優先ページがあればそれを優先、なければ先頭/末尾をサンプリング
    const priorityPages = analyzedPages.filter((p) => p.isPriority);

    if (priorityPages.length === 0 && analyzedPages.length > FALLBACK_SAMPLE_PAGES) {
      const half = Math.floor(FALLBACK_SAMPLE_PAGES / 2);
      const frontPages = analyzedPages.slice(0, half);
      const backPages = analyzedPages.slice(-half);

      for (const p of [...frontPages, ...backPages]) {
        p.isPriority = true;
        p.priorityReason = 'サンプリング（優先キーワードなし）';
      }
    }

    return {
      totalPages,
      processedPages: analyzedPages.length,
      pages: analyzedPages,
      metadata: info.info,
      warnings,
    };
  } finally {
    await parser.destroy();
  }
}

/**
 * テキストが優先ページかどうかを判定
 */
function checkPriority(text: string): { isPriority: boolean; reason?: string } {
  const lowerText = text.toLowerCase();

  for (const keyword of PRIORITY_KEYWORDS) {
    if (lowerText.includes(keyword.toLowerCase())) {
      return {
        isPriority: true,
        reason: `キーワード「${keyword}」を検出`,
      };
    }
  }

  return { isPriority: false };
}

/**
 * ファイルがPDFかどうかを判定
 */
export function isPdfBuffer(buffer: Buffer): boolean {
  if (buffer.length < 5) return false;
  const header = buffer.slice(0, 5).toString('ascii');
  return header === '%PDF-';
}
