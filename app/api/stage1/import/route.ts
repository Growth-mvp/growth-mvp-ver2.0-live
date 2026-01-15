// /app/api/stage1/import/route.ts
/**
 * STAGE1 資料インポート API
 * - PDF/Excel/CSV を受け取り、財務データ候補を抽出
 * - キャッシュ対応（同一ファイルは再解析しない）
 */

import { NextRequest, NextResponse } from 'next/server';
import type { Stage1ImportResult, Stage1ImportCandidate } from '@/types/strategy';
import {
  generateCacheKey,
  getFromCache,
  saveToCache,
  cleanupExpiredCache,
} from '@/utils/stage1/importers/cache';
import {
  parseCSV,
  parseExcel,
  detectFileType,
} from '@/utils/stage1/importers/excelCsvImporter';
import {
  parsePdf,
  isPdfBuffer,
} from '@/utils/stage1/importers/pdfImporter';
import {
  buildCandidatesFromTable,
  buildCandidatesFromPdfText,
  normalizeCandidates,
} from '@/utils/stage1/importers/candidateBuilder';

/** 最大ファイルサイズ（20MB） */
const MAX_FILE_SIZE = 20 * 1024 * 1024;

export async function POST(request: NextRequest): Promise<NextResponse> {
  try {
    // クリーンアップ（バックグラウンド）
    cleanupExpiredCache();

    const formData = await request.formData();
    const files = formData.getAll('files') as File[];

    if (!files || files.length === 0) {
      return NextResponse.json<Stage1ImportResult>(
        {
          success: false,
          error: 'ファイルがアップロードされていません',
          candidates: [],
        },
        { status: 400 }
      );
    }

    const allCandidates: Stage1ImportCandidate[] = [];
    const warnings: string[] = [];
    const tableHints: string[] = [];

    for (const file of files) {
      // サイズチェック
      if (file.size > MAX_FILE_SIZE) {
        warnings.push(`${file.name}: ファイルサイズが大きすぎます（${Math.round(file.size / 1024 / 1024)}MB）`);
        continue;
      }

      const buffer = Buffer.from(await file.arrayBuffer());
      const cacheKey = generateCacheKey(buffer);

      // キャッシュチェック
      const cached = getFromCache<Stage1ImportCandidate[]>(cacheKey);
      if (cached) {
        allCandidates.push(...cached);
        tableHints.push(`${file.name}: キャッシュから読み込み`);
        continue;
      }

      // ファイル種別判定
      const fileType = detectFileType(buffer, file.name);
      let candidates: Stage1ImportCandidate[] = [];

      try {
        if (fileType === 'csv') {
          const text = buffer.toString('utf-8');
          const table = parseCSV(text);
          candidates = buildCandidatesFromTable(table);
          tableHints.push(`${file.name}: CSV（${table.rows.length}行）`);
        } else if (fileType === 'excel') {
          const tables = parseExcel(buffer);
          for (const table of tables) {
            const tableCandidates = buildCandidatesFromTable(table);
            candidates.push(...tableCandidates);
          }
          tableHints.push(`${file.name}: Excel（${tables.length}シート）`);
        } else if (isPdfBuffer(buffer)) {
          const pdfResult = await parsePdf(buffer);
          candidates = buildCandidatesFromPdfText(pdfResult.pages);
          tableHints.push(
            `${file.name}: PDF（${pdfResult.processedPages}/${pdfResult.totalPages}ページ解析）`
          );
          if (pdfResult.warnings.length > 0) {
            warnings.push(...pdfResult.warnings.map((w) => `${file.name}: ${w}`));
          }
        } else {
          warnings.push(`${file.name}: 未対応のファイル形式です`);
          continue;
        }

        // キャッシュに保存
        if (candidates.length > 0) {
          saveToCache(cacheKey, candidates);
        }

        allCandidates.push(...candidates);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        warnings.push(`${file.name}: 解析エラー - ${message}`);
      }
    }

    // 候補を正規化（5年分のみ、年度昇順、重複排除）
    const normalized = normalizeCandidates(allCandidates);

    // 信頼度でソート（高い順）
    normalized.sort((a, b) => b.confidence - a.confidence);

    const result: Stage1ImportResult = {
      success: true,
      candidates: normalized,
      tableHints,
      previewText: warnings.length > 0 ? warnings.join('\n') : undefined,
    };

    return NextResponse.json(result);
  } catch (err) {
    console.error('[stage1/import] Error:', err);
    const message = err instanceof Error ? err.message : 'Unknown error';
    return NextResponse.json<Stage1ImportResult>(
      {
        success: false,
        error: `サーバーエラー: ${message}`,
        candidates: [],
      },
      { status: 500 }
    );
  }
}

// GETは許可しない
export async function GET(): Promise<NextResponse> {
  return NextResponse.json(
    { error: 'Method not allowed' },
    { status: 405 }
  );
}
