// /utils/stage1/importers/pdfImporter.ts
/**
 * PDF ファイルからテキストを抽出
 * - pdf-parse を使用
 * - 巨大PDF対策：ページ分割、優先ページ抽出、上限設定
 */

// pdf-parse は CommonJS モジュールのため require を使用
// eslint-disable-next-line @typescript-eslint/no-require-imports
const pdf = require('pdf-parse');

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

  // pdf-parse で全体を解析
  const data = await pdf(buffer, {
    // ページ数だけ取得するためのオプション
    max: 0, // 0 = ページ数だけ取得、テキストは取らない
  });

  const totalPages = data.numpages;

  if (totalPages === 0) {
    return {
      totalPages: 0,
      processedPages: 0,
      pages: [],
      warnings: ['PDFにページがありません'],
    };
  }

  // ページ制限チェック
  if (totalPages > MAX_PAGES) {
    warnings.push(`PDFが${totalPages}ページあります。先頭${MAX_PAGES}ページを解析します。`);
  }

  // 実際にテキストを抽出（ページ制限あり）
  const fullData = await pdf(buffer, {
    max: Math.min(totalPages, MAX_PAGES),
  });

  // ページごとにテキストを分割（pdf-parseは全テキストを1つの文字列で返す）
  // ページ区切りのパターンを使って分割を試みる
  const pages = splitIntoPages(fullData.text, Math.min(totalPages, MAX_PAGES));

  // 優先ページを特定
  const analyzedPages = pages.map((text, index) => {
    const pageNumber = index + 1;
    const { isPriority, reason } = checkPriority(text);
    return {
      pageNumber,
      text,
      isPriority,
      priorityReason: reason,
    };
  });

  // 優先ページがあればそれを優先、なければ先頭/末尾をサンプリング
  const priorityPages = analyzedPages.filter((p) => p.isPriority);

  if (priorityPages.length === 0 && analyzedPages.length > FALLBACK_SAMPLE_PAGES) {
    // 優先ページがない場合、先頭と末尾からサンプリング
    const half = Math.floor(FALLBACK_SAMPLE_PAGES / 2);
    const frontPages = analyzedPages.slice(0, half);
    const backPages = analyzedPages.slice(-half);

    // フラグを立てる
    for (const p of [...frontPages, ...backPages]) {
      p.isPriority = true;
      p.priorityReason = 'サンプリング（優先キーワードなし）';
    }
  }

  return {
    totalPages,
    processedPages: analyzedPages.length,
    pages: analyzedPages,
    metadata: data.info,
    warnings,
  };
}

/**
 * テキストをページに分割（簡易実装）
 * pdf-parse は全テキストを1つの文字列で返すため、ヒューリスティックで分割
 */
function splitIntoPages(fullText: string, expectedPages: number): string[] {
  if (expectedPages <= 1) {
    return [fullText];
  }

  // ページ区切りパターン（フォームフィードや連続改行）
  const pageBreakPatterns = [
    /\f/g, // フォームフィード
    /\n{4,}/g, // 4連続以上の改行
  ];

  let pages: string[] = [];

  for (const pattern of pageBreakPatterns) {
    const parts = fullText.split(pattern).filter((p) => p.trim());
    if (parts.length >= expectedPages * 0.5) {
      pages = parts;
      break;
    }
  }

  // 分割できなかった場合は均等分割
  if (pages.length === 0 || pages.length === 1) {
    const chunkSize = Math.ceil(fullText.length / expectedPages);
    pages = [];
    for (let i = 0; i < expectedPages; i++) {
      const start = i * chunkSize;
      const end = Math.min(start + chunkSize, fullText.length);
      pages.push(fullText.slice(start, end));
    }
  }

  return pages;
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
