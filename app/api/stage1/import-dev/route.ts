// /app/api/stage1/import-dev/route.ts
/**
 * ★開発用：認証スキップ版 STAGE1 インポート API
 * - 認証チェックをスキップして、ファイル処理ロジックのみをテスト
 * - 本番環境には絶対にデプロイしないこと
 */

import { NextRequest, NextResponse } from 'next/server';
import type { Stage1ImportResult, Stage1ImportCandidate } from '@/types/strategy';
import {
  generateCacheKey,
  getFromCache,
  saveToCache,
  cleanupExpiredCache,
} from '@/utils/stage1/importers/cache';
import { parseCSV, parseExcel, detectFileType, type ExtractedTable } from '@/utils/stage1/importers/excelCsvImporter';
// ★ CRITICAL: pdfImporter は PDF 処理時のみ dynamic import（DOMMatrix 要求避け）
// import { parsePdf, isPdfBuffer } from '@/utils/stage1/importers/pdfImporter';

/** PDF ファイルを判定（pdfImporter の依存を避けるためローカル実装） */
function isPdfBuffer(buffer: Buffer): boolean {
  if (buffer.length < 5) return false;
  const header = buffer.slice(0, 5).toString('ascii');
  return header === '%PDF-';
}
import {
  buildCandidatesFromTable,
  buildCandidatesFromPdfText,
  normalizeCandidates,
} from '@/utils/stage1/importers/candidateBuilder';

const MAX_FILE_SIZE = 20 * 1024 * 1024;

function stripBom(s: string): string {
  if (!s) return s;
  return s.charCodeAt(0) === 0xfeff ? s.slice(1) : s;
}

function normalizeText(s: unknown): string {
  return stripBom(String(s ?? '')).trim();
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  const reqId = Math.random().toString(36).slice(2, 10);
  const startTime = Date.now();

  console.log(`[stage1/import-dev] [${reqId}] DEV MODE - POST request started`, {
    url: request.url,
    timestamp: new Date().toISOString(),
  });

  try {
    cleanupExpiredCache();

    // ★ DEBUG：formData 取得前のログ
    console.log(`[stage1/import-dev] [${reqId}] About to parse formData`, {
      contentType: request.headers.get('content-type'),
      timestamp: new Date().toISOString(),
    });

    let formData;
    try {
      formData = await request.formData();
      console.log(`[stage1/import-dev] [${reqId}] formData parsed successfully`, {
        timestamp: new Date().toISOString(),
      });
    } catch (formDataErr) {
      const errMsg = formDataErr instanceof Error ? formDataErr.message : String(formDataErr);
      const errStack = formDataErr instanceof Error ? formDataErr.stack : undefined;
      console.error(`[stage1/import-dev] [${reqId}] formData parsing FAILED`, {
        error: errMsg,
        stack: errStack,
        cause: (formDataErr as any)?.cause,
        timestamp: new Date().toISOString(),
      });
      throw new Error(`Failed to parse multipart/form-data: ${errMsg}`);
    }

    // ★ DEBUG：files 取得のログ
    const files = formData.getAll('files') as File[];
    console.log(`[stage1/import-dev] [${reqId}] Files extracted from formData`, {
      fileCount: files.length,
      fileNames: files.map(f => f.name),
      fileSizes: files.map(f => f.size),
      timestamp: new Date().toISOString(),
    });

    if (!files || files.length === 0) {
      console.warn(`[stage1/import-dev] [${reqId}] No files provided`);
      return NextResponse.json<Stage1ImportResult>(
        { success: false, error: 'ファイルがアップロードされていません', candidates: [] },
        { status: 400 }
      );
    }

    const allCandidates: Stage1ImportCandidate[] = [];
    const warnings: string[] = [];
    const tableHints: string[] = [];

    for (const file of files) {
      console.log(`[stage1/import-dev] [${reqId}] Processing file: ${file.name}`, {
        size: file.size,
        type: file.type,
        lastModified: file.lastModified,
        timestamp: new Date().toISOString(),
      });

      if (file.size > MAX_FILE_SIZE) {
        warnings.push(`${file.name}: ファイルサイズが大きすぎます（${Math.round(file.size / 1024 / 1024)}MB）`);
        continue;
      }

      let buffer: Buffer;
      try {
        const arrayBuf = await file.arrayBuffer();
        console.log(`[stage1/import-dev] [${reqId}] arrayBuffer obtained for ${file.name}`, {
          arrayBufByteLength: arrayBuf.byteLength,
          timestamp: new Date().toISOString(),
        });
        buffer = Buffer.from(arrayBuf);
        console.log(`[stage1/import-dev] [${reqId}] Buffer created for ${file.name}`, {
          bufferLength: buffer.length,
          timestamp: new Date().toISOString(),
        });
      } catch (bufErr) {
        const errMsg = bufErr instanceof Error ? bufErr.message : String(bufErr);
        const errStack = bufErr instanceof Error ? bufErr.stack : undefined;
        console.error(`[stage1/import-dev] [${reqId}] Buffer conversion FAILED for ${file.name}`, {
          error: errMsg,
          stack: errStack,
          cause: (bufErr as any)?.cause,
          timestamp: new Date().toISOString(),
        });
        warnings.push(`${file.name}: バッファ変換エラー - ${errMsg}`);
        continue;
      }

      let fileType;
      try {
        fileType = detectFileType(buffer, file.name);
        console.log(`[stage1/import-dev] [${reqId}] File type detected for ${file.name}`, {
          fileType,
          timestamp: new Date().toISOString(),
        });
      } catch (typeErr) {
        const errMsg = typeErr instanceof Error ? typeErr.message : String(typeErr);
        console.error(`[stage1/import-dev] [${reqId}] File type detection FAILED for ${file.name}`, {
          error: errMsg,
          timestamp: new Date().toISOString(),
        });
        throw typeErr;
      }

      let candidates: Stage1ImportCandidate[] = [];

      try {
        if (fileType === 'excel') {
          console.log(`[stage1/import-dev] [${reqId}] Processing Excel file: ${file.name}`);
          let tables: ExtractedTable[] = [];
          try {
            console.log(`[stage1/import-dev] [${reqId}] Calling parseExcel for ${file.name}`);
            tables = parseExcel(buffer);
            console.log(`[stage1/import-dev] [${reqId}] parseExcel succeeded for ${file.name}`, {
              sheetsCount: tables.length,
              sheetNames: tables.map((t) => (t as any).sheetName || (t as any).title || '(no name)'),
              timestamp: new Date().toISOString(),
            });
          } catch (excelErr) {
            const errorMsg = excelErr instanceof Error ? excelErr.message : String(excelErr);
            const errorStack = excelErr instanceof Error ? excelErr.stack : undefined;
            const errorCause = (excelErr as any)?.cause;
            console.error(`[stage1/import-dev] [${reqId}] parseExcel FAILED for ${file.name}`, {
              error: errorMsg,
              stack: errorStack,
              cause: errorCause,
              timestamp: new Date().toISOString(),
            });
            throw excelErr;
          }

          console.log(`[stage1/import-dev] [${reqId}] Processing ${tables.length} sheets...`);
          for (const t of tables) {
            const beforeLen = candidates.length;
            try {
              const sheetName = (t as any).sheetName || (t as any).title || '(no name)';
              console.log(`[stage1/import-dev] [${reqId}] Processing sheet: ${sheetName}`);
              candidates.push(...buildCandidatesFromTable(t));
              const afterLen = candidates.length;
              console.log(`[stage1/import-dev] [${reqId}] Sheet processed: ${sheetName}`, {
                candidatesAdded: afterLen - beforeLen,
                totalCandidates: afterLen,
                timestamp: new Date().toISOString(),
              });
            } catch (sheetErr) {
              const sheetName = (t as any).sheetName || (t as any).title || '(unknown)';
              const errMsg = sheetErr instanceof Error ? sheetErr.message : String(sheetErr);
              console.error(`[stage1/import-dev] [${reqId}] Sheet processing FAILED: ${sheetName}`, {
                error: errMsg,
                timestamp: new Date().toISOString(),
              });
              throw sheetErr;
            }
          }
          tableHints.push(`${file.name}: Excel（${tables.length}シート）`);
        } else if (fileType === 'csv') {
          console.log(`[stage1/import-dev] [${reqId}] Processing CSV file: ${file.name}`);
          const text = buffer.toString('utf-8');
          const parseResult = parseCSV(text);
          candidates = buildCandidatesFromTable(parseResult);
          tableHints.push(`${file.name}: CSV`);
        } else if (isPdfBuffer(buffer)) {
          console.log(`[stage1/import-dev] [${reqId}] [PDF] Processing PDF file: ${file.name}`);
          try {
            // ★ CRITICAL: Dynamic import to avoid DOMMatrix error on Excel/CSV paths
            console.log(`[stage1/import-dev] [${reqId}] [PDF] Loading pdfImporter dynamically...`, {
              timestamp: new Date().toISOString(),
            });
            const { parsePdf: parsePdfDynamic } = await import('@/utils/stage1/importers/pdfImporter');
            console.log(`[stage1/import-dev] [${reqId}] [PDF] pdfImporter loaded successfully`, {
              timestamp: new Date().toISOString(),
            });

            const pdfResult = await parsePdfDynamic(buffer);
            candidates = buildCandidatesFromPdfText(pdfResult.pages);
            tableHints.push(`${file.name}: PDF（${pdfResult.processedPages}/${pdfResult.totalPages}ページ）`);
          } catch (pdfErr) {
            const errMsg = pdfErr instanceof Error ? pdfErr.message : String(pdfErr);
            console.error(`[stage1/import-dev] [${reqId}] [PDF] PDF processing FAILED for ${file.name}`, {
              error: errMsg,
              timestamp: new Date().toISOString(),
            });
            throw pdfErr;
          }
        } else {
          warnings.push(`${file.name}: 未対応のファイル形式です`);
          continue;
        }

        console.log(`[stage1/import-dev] [${reqId}] Candidates generated for ${file.name}`, {
          candidatesCount: candidates.length,
          kinds: Array.from(new Set(candidates.map(c => c.kind))),
          timestamp: new Date().toISOString(),
        });

        allCandidates.push(...candidates);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        const stack = err instanceof Error ? err.stack : undefined;
        const cause = (err as any)?.cause;
        console.error(`[stage1/import-dev] [${reqId}] File processing error for ${file.name}`, {
          error: message,
          stack,
          cause,
          timestamp: new Date().toISOString(),
        });
        warnings.push(`${file.name}: 解析エラー - ${message}`);
      }
    }

    console.log(`[stage1/import-dev] [${reqId}] All files processed`, {
      totalCandidates: allCandidates.length,
      warningsCount: warnings.length,
      timestamp: new Date().toISOString(),
    });

    const normalized = normalizeCandidates(allCandidates);
    normalized.sort((a, b) => b.confidence - a.confidence);

    const result: Stage1ImportResult = {
      success: true,
      candidates: normalized,
      tableHints,
      previewText: warnings.length > 0 ? warnings.join('\n') : undefined,
    };

    const elapsedMs = Date.now() - startTime;
    console.log(`[stage1/import-dev] [${reqId}] POST completed successfully`, {
      elapsedMs,
      candidatesReturned: normalized.length,
      timestamp: new Date().toISOString(),
    });

    return NextResponse.json(result);
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : String(err);
    const errorStack = err instanceof Error ? err.stack : undefined;
    const errorCause = (err as any)?.cause;
    const elapsedMs = Date.now() - startTime;

    console.error(`[stage1/import-dev] [${reqId}] Fatal Error`, {
      message: errorMessage,
      stack: errorStack,
      cause: errorCause,
      type: err instanceof Error ? err.constructor.name : typeof err,
      elapsedMs,
      timestamp: new Date().toISOString(),
    });

    return NextResponse.json<Stage1ImportResult>(
      {
        success: false,
        error: 'ファイル解析に失敗しました',
        candidates: [],
        previewText: errorMessage,
      },
      { status: 500 }
    );
  }
}

export async function GET(): Promise<NextResponse> {
  return NextResponse.json({ error: 'Method not allowed' }, { status: 405 });
}
