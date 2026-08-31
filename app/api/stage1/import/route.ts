// /app/api/stage1/import/route.ts
/**
 * STAGE1 資料インポート API
 * - PDF/Excel/CSV を受け取り、財務データ候補を抽出
 * - キャッシュ対応（同一ファイルは再解析しない）
 *
 * 追加対応（重要）:
 * - 事業部別CSVが candidates 0 件になる問題へのフォールバック解析を強化
 *   - 「事業部,項目,2022年度,...」の matrix 形式（ヘッダ名の揺れ許容）
 *   - 「kind,segmentName,year,...」の long 形式（ヘッダ名の揺れ許容）
 *
 * ★今回の修正（確定）
 * - long形式が segmentPL/segmentBS しか候補化しない制約を撤廃（companyPL/companyBS も許可）
 * - 1ファイル統合向け matrix（kind,segmentName,item,2019年度,...）を正式対応
 */

import { NextRequest, NextResponse } from 'next/server';
import type { Stage1ImportResult, Stage1ImportCandidate } from '@/types/strategy';
import { getSupabaseAdmin } from '@/lib/supabaseAdmin';
import { getAuthUserIdFromBearer, requireMembership, assertMinRole } from '@/lib/server/rbacGuard';
import {
  generateCacheKey,
  getFromCache,
  saveToCache,
  cleanupExpiredCache,
} from '@/utils/stage1/importers/cache';
import { parseCSV, parseExcel, detectFileType } from '@/utils/stage1/importers/excelCsvImporter';
import { parsePdf, isPdfBuffer } from '@/utils/stage1/importers/pdfImporter';
import {
  buildCandidatesFromTable,
  buildCandidatesFromPdfText,
  normalizeCandidates,
} from '@/utils/stage1/importers/candidateBuilder';

/** 最大ファイルサイズ（20MB） */
const MAX_FILE_SIZE = 20 * 1024 * 1024;

type TabKey = 'companyPL' | 'companyBS' | 'segmentPL' | 'segmentBS' | 'pbr';

/* =========================================================
 * CSV フォールバック（事業部別）: ユーティリティ
 * ========================================================= */

function stripBom(s: string): string {
  if (!s) return s;
  return s.charCodeAt(0) === 0xfeff ? s.slice(1) : s;
}

function normalizeText(s: unknown): string {
  return stripBom(String(s ?? '')).trim();
}

function normalizeHeaderKey(s: unknown): string {
  return normalizeText(s).toLowerCase().replace(/\s+/g, '');
}

function headerToYear(h: unknown): number | null {
  const s = normalizeText(h);
  const m = s.match(/(19|20)\d{2}/);
  if (!m) return null;
  const y = Number(m[0]);
  return Number.isFinite(y) ? y : null;
}

function toNum(v: unknown): number | undefined {
  if (v === null || v === undefined) return undefined;
  const s = String(v).replace(/,/g, '').trim();
  if (!s) return undefined;
  const n = Number(s);
  return Number.isFinite(n) ? n : undefined;
}

function normalizeKind(k: unknown): TabKey | null {
  const s = normalizeText(k);
  if (!s) return null;
  const lower = s.toLowerCase();

  if (lower === 'companypl' || lower === 'company_pl' || s === '全社PL') return 'companyPL';
  if (lower === 'companybs' || lower === 'company_bs' || s === '全社BS') return 'companyBS';
  if (lower === 'segmentpl' || lower === 'segment_pl' || lower === 'segpl' || s === '事業部PL') return 'segmentPL';
  if (lower === 'segmentbs' || lower === 'segment_bs' || lower === 'segbs' || s === '事業部BS') return 'segmentBS';
  if (lower === 'pbr') return 'pbr';
  return null;
}

/** 項目名の揺れを潰す（単位、括弧、スペース、全角記号など） */
function normalizeItemName(raw: unknown): string {
  let s = normalizeText(raw);
  if (!s) return s;

  s = s.replace(/[（]/g, '(').replace(/[）]/g, ')');
  s = s.replace(/\(.*?\)/g, ''); // 括弧内（単位等）を除去
  s = s
    .replace(/単位[:：]?\s*/g, '')
    .replace(/百万円|千円|万円|円|百万|千|million|thousand/gi, '');
  s = s.replace(/[\s　]/g, '').replace(/[：:]/g, '');

  return s.trim();
}

/**
 * PL/BS の項目マップ（日本語＋内部キー＋ありがちな英語）
 * ※ TS1117回避のため「同一キーは1回のみ」定義する
 */
const PL_ITEM_MAP: Record<string, string> = {
  // 日本語
  売上高: 'revenue',
  売上総利益: 'grossProfit',
  売上原価: 'cogs',
  販管費: 'sga',
  営業利益: 'operatingIncome',
  減価償却費: 'depreciation',
  支払利息: 'interest',
  法人税等: 'tax',
  当期純利益: 'netIncome',

  // 内部キー（そのまま許容）
  revenue: 'revenue',
  grossprofit: 'grossProfit',
  cogs: 'cogs',
  sga: 'sga',
  operatingincome: 'operatingIncome',
  depreciation: 'depreciation',
  interest: 'interest',
  tax: 'tax',
  netincome: 'netIncome',

  // 英語寄りの表記
  sales: 'revenue',
  operatingprofit: 'operatingIncome',
  netprofit: 'netIncome',
};

const BS_ITEM_MAP: Record<string, string> = {
  // 日本語
  現預金: 'cash',
  売掛金: 'ar',
  棚卸資産: 'inventory',
  買掛金: 'ap',
  固定資産: 'fixedAssets',
  総資産: 'totalAssets',
  有利子負債: 'interestBearingDebt',
  純資産: 'equity',
  純資産合計: 'netAssets',

  // 内部キー（そのまま許容）
  cash: 'cash',
  ar: 'ar',
  inventory: 'inventory',
  ap: 'ap',
  fixedassets: 'fixedAssets',
  totalassets: 'totalAssets',
  interestbearingdebt: 'interestBearingDebt',
  equity: 'equity',
  netassets: 'netAssets',

  // 英語寄りの表記
  accountsreceivable: 'ar',
  accountspayable: 'ap',
  debt: 'interestBearingDebt',
};

/** parseCSV が返す table を、確実に string[][] に落とす（配列行・オブジェクト行両対応） */
function tableToRows(table: any): string[][] {
  const headersRaw: string[] =
    (Array.isArray(table?.headers) && table.headers.map((h: any) => normalizeText(h))) ||
    (Array.isArray(table?.header) && table.header.map((h: any) => normalizeText(h))) ||
    [];

  const rowsRaw: any[] =
    (Array.isArray(table?.rows) && table.rows) ||
    (Array.isArray(table?.data) && table.data) ||
    (Array.isArray(table?.cells) && table.cells) ||
    [];

  const out: string[][] = [];
  if (rowsRaw.length === 0) return out;

  // rows が配列配列ならそのまま
  if (Array.isArray(rowsRaw[0])) {
    for (const r of rowsRaw) out.push((r as any[]).map((c) => normalizeText(c)));
    if (out[0]?.[0]) out[0][0] = stripBom(out[0][0]);
    return out;
  }

  // rows がオブジェクトなら headers に沿って並べる
  if (rowsRaw[0] && typeof rowsRaw[0] === 'object') {
    const keys = headersRaw.length > 0 ? headersRaw : Object.keys(rowsRaw[0]).map((k) => normalizeText(k));
    out.push(keys.map((k) => stripBom(k)));
    for (const obj of rowsRaw) out.push(keys.map((k) => normalizeText((obj as any)[k])));
    return out;
  }

  return out;
}

/** matrix形式かどうかを“ゆるく”判定（ヘッダ名が違っても通す） */
function detectMatrixColumns(headers: string[]): {
  segIdx: number;
  itemIdx: number;
  yearCols: Array<{ col: number; year: number }>;
} | null {
  if (!headers || headers.length < 3) return null;

  const yearCols: Array<{ col: number; year: number }> = [];
  for (let i = 0; i < headers.length; i++) {
    const y = headerToYear(headers[i]);
    if (y) yearCols.push({ col: i, year: y });
  }
  if (yearCols.length === 0) return null;

  let segIdx = -1;
  let itemIdx = -1;

  for (let i = 0; i < headers.length; i++) {
    const h = headers[i];
    if (segIdx < 0 && /事業部|セグメント|segment/i.test(h)) segIdx = i;
    if (itemIdx < 0 && /項目|科目|勘定|item/i.test(h)) itemIdx = i;
  }

  const nonYearCols = headers
    .map((h, i) => ({ i, y: headerToYear(h) }))
    .filter((x) => x.y === null)
    .map((x) => x.i);

  if (segIdx < 0) segIdx = nonYearCols[0] ?? 0;
  if (itemIdx < 0) itemIdx = nonYearCols[1] ?? (segIdx === 0 ? 1 : 0);

  const yearColSet = new Set(yearCols.map((yc) => yc.col));
  if (yearColSet.has(segIdx)) segIdx = nonYearCols[0] ?? 0;
  if (yearColSet.has(itemIdx)) itemIdx = nonYearCols[1] ?? 1;

  if (segIdx === itemIdx) return null;

  return { segIdx, itemIdx, yearCols };
}

/**
 * ★統合1ファイル向け matrix（kind,segmentName,item,2019年度,...）の列位置を検出
 * - kind, segmentName, item が必須
 * - 年度列（2019/2020/.. または 2019年度 等）が複数
 */
function detectMatrixWithKindColumns(headers: string[]): {
  kindIdx: number;
  segIdx: number;
  itemIdx: number;
  yearCols: Array<{ col: number; year: number }>;
} | null {
  if (!headers || headers.length < 4) return null;

  const yearCols: Array<{ col: number; year: number }> = [];
  for (let i = 0; i < headers.length; i++) {
    const y = headerToYear(headers[i]);
    if (y) yearCols.push({ col: i, year: y });
  }
  if (yearCols.length === 0) return null;

  const lower = headers.map((h) => normalizeHeaderKey(h));

  const kindIdx = lower.findIndex((h) => h === 'kind');
  const segIdx = lower.findIndex(
    (h) =>
      h === 'segmentname' ||
      h === 'segment_name' ||
      h === 'segment' ||
      /事業部|セグメント/.test(h)
  );
  const itemIdx = lower.findIndex((h) => h === 'item' || /項目|科目|勘定/.test(h));

  if (kindIdx < 0 || segIdx < 0 || itemIdx < 0) return null;

  const yearSet = new Set(yearCols.map((y) => y.col));
  if (yearSet.has(kindIdx) || yearSet.has(segIdx) || yearSet.has(itemIdx)) return null;

  if (kindIdx === segIdx || kindIdx === itemIdx || segIdx === itemIdx) return null;

  return { kindIdx, segIdx, itemIdx, yearCols };
}

/** long形式の列位置を検出（ヘッダ名の揺れを許容） */
function detectLongColumns(headers: string[]): {
  kindIdx: number;
  segIdx: number;
  yearIdx: number;
  fieldCols: Array<{ col: number; key: string }>;
} | null {
  const lower = headers.map((h) => normalizeHeaderKey(h));

  const kindIdx = lower.findIndex((h) => h === 'kind');
  const yearIdx = lower.findIndex((h) => h === 'year');
  const segIdx = lower.findIndex(
    (h) =>
      h === 'segmentname' ||
      h === 'segment_name' ||
      h === 'segment' ||
      h === 'businesssegment' ||
      h === 'businesssegmentname'
  );

  if (kindIdx < 0 || yearIdx < 0 || segIdx < 0) return null;

  const fieldCols: Array<{ col: number; key: string }> = [];
  for (let i = 0; i < headers.length; i++) {
    if (i === kindIdx || i === yearIdx || i === segIdx) continue;
    const hRaw = normalizeText(headers[i]);
    if (!hRaw) continue;

    const norm = normalizeItemName(hRaw);
    const kPl = PL_ITEM_MAP[norm] || PL_ITEM_MAP[norm.toLowerCase()];
    const kBs = BS_ITEM_MAP[norm] || BS_ITEM_MAP[norm.toLowerCase()];
    const key = kPl || kBs || hRaw;
    fieldCols.push({ col: i, key });
  }

  return { kindIdx, segIdx, yearIdx, fieldCols };
}

/** CSVフォールバック解析（table→rows を経由して必ず試す） */
function buildCandidatesFromCsvFallback(
  rows: string[][],
  filename: string,
  hintsOut: string[]
): Stage1ImportCandidate[] {
  if (!rows || rows.length < 2) return [];

  const headers = rows[0].map((c) => normalizeText(c));
  const body = rows.slice(1);

  // 0) ★統合1ファイル matrix（kind付き）形式
  const matKind = detectMatrixWithKindColumns(headers);
  if (matKind) {
    hintsOut.push(
      `${filename}: CSVフォールバック解析（matrix+kind） kindIdx=${matKind.kindIdx}, segIdx=${matKind.segIdx}, itemIdx=${matKind.itemIdx}, years=${matKind.yearCols.length}`
    );

    const bucket = new Map<
      string,
      { kind: TabKey; year: number; segmentName: string; fields: Record<string, number> }
    >();

    for (const r of body) {
      const kind = normalizeKind(r[matKind.kindIdx]);
      const segRaw = normalizeText(r[matKind.segIdx]);
      const seg = segRaw || '全社';
      const itemRaw = normalizeText(r[matKind.itemIdx]);

      if (!kind || !itemRaw) continue;

      const item = normalizeItemName(itemRaw);
      const itemLower = item.toLowerCase();

      const plKey = PL_ITEM_MAP[item] || PL_ITEM_MAP[itemLower];
      const bsKey = BS_ITEM_MAP[item] || BS_ITEM_MAP[itemLower];

      // kindに応じて、PL/BSどちらのマップを採用するか決める
      let fieldKey: string | null = null;
      if (kind === 'companyPL' || kind === 'segmentPL') fieldKey = plKey ?? null;
      if (kind === 'companyBS' || kind === 'segmentBS') fieldKey = bsKey ?? null;
      if (!fieldKey) continue;

      for (const yc of matKind.yearCols) {
        const v = toNum(r[yc.col]);
        if (v === undefined) continue;

        const key = `${kind}::${seg}::${yc.year}`;
        if (!bucket.has(key)) bucket.set(key, { kind, year: yc.year, segmentName: seg, fields: {} });

        bucket.get(key)!.fields[fieldKey] = v;
      }
    }

    const out: Stage1ImportCandidate[] = [];
    for (const rec of bucket.values()) {
      if (Object.keys(rec.fields).length === 0) continue;
      out.push({
        kind: rec.kind as any,
        year: rec.year as any,
        segmentName: rec.segmentName as any,
        fields: rec.fields as any,
        confidence: 0.97 as any,
        source: filename as any,
      } as any);
    }
    return out;
  }

  // 1) long形式
  const long = detectLongColumns(headers);
  if (long) {
    const out: Stage1ImportCandidate[] = [];
    for (const r of body) {
      const kind = normalizeKind(r[long.kindIdx]);
      const segRaw = normalizeText(r[long.segIdx]);
      const seg = segRaw || '全社';
      const year = Number(normalizeText(r[long.yearIdx]));
      if (!kind || !Number.isFinite(year)) continue;

      // ★修正：companyPL/companyBS も通す（統合1ファイル対応）
      // 以前は segmentPL/segmentBS に限定していたため、全社が候補化されないバグになっていた

      const fields: Record<string, number> = {};
      for (const fc of long.fieldCols) {
        const v = toNum(r[fc.col]);
        if (v === undefined) continue;
        fields[fc.key] = v;
      }
      if (Object.keys(fields).length === 0) continue;

      out.push({
        kind: kind as any,
        year: year as any,
        segmentName: seg as any,
        fields: fields as any,
        confidence: 0.98 as any,
        source: filename as any,
      } as any);
    }

    hintsOut.push(
      `${filename}: CSVフォールバック解析（long） kindIdx=${long.kindIdx}, segIdx=${long.segIdx}, yearIdx=${long.yearIdx}, fields=${long.fieldCols.length}`
    );
    return out;
  }

  // 2) matrix形式（従来：事業部,項目,2019年度,...）
  const mat = detectMatrixColumns(headers);
  if (!mat) {
    hintsOut.push(
      `${filename}: CSVフォールバック解析: matrix形式を検出できませんでした（year列が見つからない/列構造不明）`
    );
    return [];
  }

  hintsOut.push(
    `${filename}: CSVフォールバック解析（matrix） segIdx=${mat.segIdx}, itemIdx=${mat.itemIdx}, years=${mat.yearCols.length}`
  );

  const nameLower = filename.toLowerCase();
  const forcePl = nameLower.includes('pl');
  const forceBs = nameLower.includes('bs');

  const bucket = new Map<
    string,
    { kind: TabKey; year: number; segmentName: string; fields: Record<string, number> }
  >();

  for (const r of body) {
    const seg = normalizeText(r[mat.segIdx]);
    const itemRaw = normalizeText(r[mat.itemIdx]);
    if (!seg || !itemRaw) continue;

    const item = normalizeItemName(itemRaw);
    const itemLower = item.toLowerCase();

    const plKey = PL_ITEM_MAP[item] || PL_ITEM_MAP[itemLower];
    const bsKey = BS_ITEM_MAP[item] || BS_ITEM_MAP[itemLower];

    let kind: TabKey | null = null;
    let fieldKey: string | null = null;

    if (forcePl && plKey) {
      kind = 'segmentPL';
      fieldKey = plKey;
    } else if (forceBs && bsKey) {
      kind = 'segmentBS';
      fieldKey = bsKey;
    } else if (plKey) {
      kind = 'segmentPL';
      fieldKey = plKey;
    } else if (bsKey) {
      kind = 'segmentBS';
      fieldKey = bsKey;
    } else {
      continue;
    }

    for (const yc of mat.yearCols) {
      const v = toNum(r[yc.col]);
      if (v === undefined) continue;

      const key = `${kind}::${seg}::${yc.year}`;
      if (!bucket.has(key)) bucket.set(key, { kind, year: yc.year, segmentName: seg, fields: {} });

      bucket.get(key)!.fields[fieldKey] = v;
    }
  }

  const out: Stage1ImportCandidate[] = [];
  for (const rec of bucket.values()) {
    if (Object.keys(rec.fields).length === 0) continue;
    out.push({
      kind: rec.kind as any,
      year: rec.year as any,
      segmentName: rec.segmentName as any,
      fields: rec.fields as any,
      confidence: 0.97 as any,
      source: filename as any,
    } as any);
  }

  return out;
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  try {
    // ★ 認証 & Role チェック: admin / manager のみ許可
    const admin = getSupabaseAdmin();
    const userId = await getAuthUserIdFromBearer(admin, request);
    if (!userId) {
      return NextResponse.json<Stage1ImportResult>(
        { success: false, error: 'unauthorized', candidates: [] },
        { status: 401 }
      );
    }

    const membership = await requireMembership(admin, userId);
    if (!membership) {
      return NextResponse.json<Stage1ImportResult>(
        { success: false, error: 'forbidden', candidates: [] },
        { status: 403 }
      );
    }

    try {
      await assertMinRole(membership, 'manager');
    } catch {
      return NextResponse.json<Stage1ImportResult>(
        { success: false, error: 'insufficient_role', candidates: [] },
        { status: 403 }
      );
    }

    cleanupExpiredCache();

    const formData = await request.formData();
    const files = formData.getAll('files') as File[];

    if (!files || files.length === 0) {
      return NextResponse.json<Stage1ImportResult>(
        { success: false, error: 'ファイルがアップロードされていません', candidates: [] },
        { status: 400 }
      );
    }

    const allCandidates: Stage1ImportCandidate[] = [];
    const warnings: string[] = [];
    const tableHints: string[] = [];

    for (const file of files) {
      if (file.size > MAX_FILE_SIZE) {
        warnings.push(`${file.name}: ファイルサイズが大きすぎます（${Math.round(file.size / 1024 / 1024)}MB）`);
        continue;
      }

      const buffer = Buffer.from(await file.arrayBuffer());
      const cacheKey = generateCacheKey(buffer);

      const cached = getFromCache<Stage1ImportCandidate[]>(cacheKey);
      if (cached) {
        allCandidates.push(...cached);
        tableHints.push(`${file.name}: キャッシュから読み込み`);
        continue;
      }

      const fileType = detectFileType(buffer, file.name);
      let candidates: Stage1ImportCandidate[] = [];

      try {
        if (fileType === 'csv') {
          const text = buffer.toString('utf-8');
          let table: ExtractedTable;
          try {
            table = parseCSV(text);
          } catch (err) {
            const errorMsg = err instanceof Error ? err.message : String(err);
            // Check if this is a validation error we defined
            if (errorMsg.includes('exceeds maximum') || errorMsg.includes('row limit')) {
              throw new Error(`CSV validation error: ${errorMsg}`);
            } else {
              // Unexpected error - use generic message
              throw new Error('Failed to parse CSV file');
            }
          }

          // 標準解析（既存）
          candidates = buildCandidatesFromTable(table);

          const approxRows =
            (Array.isArray((table as any)?.rows) && (table as any).rows.length) ||
            (Array.isArray((table as any)?.data) && (table as any).data.length) ||
            (Array.isArray((table as any)?.cells) && (table as any).cells.length) ||
            'unknown';
          tableHints.push(`${file.name}: CSV（${approxRows}行）`);

          // candidates が 0 の場合のみフォールバック
          if (candidates.length === 0) {
            const rows = tableToRows(table);
            const localHints: string[] = [];
            const fallback = buildCandidatesFromCsvFallback(rows, file.name, localHints);

            tableHints.push(...localHints);

            if (fallback.length > 0) {
              candidates.push(...fallback);
              tableHints.push(`${file.name}: CSVフォールバック解析で候補を補完（${fallback.length}件）`);
            } else {
              tableHints.push(`${file.name}: CSVフォールバック解析では候補化できませんでした`);
            }
          }
        } else if (fileType === 'excel') {
          let tables: ExtractedTable[] = [];
          try {
            tables = parseExcel(buffer);
          } catch (err) {
            const errorMsg = err instanceof Error ? err.message : String(err);
            // Check if this is a validation error we defined (contains specific limits)
            if (
              errorMsg.includes('exceeds maximum') ||
              errorMsg.includes('sheet limit') ||
              errorMsg.includes('row limit') ||
              errorMsg.includes('column limit')
            ) {
              throw new Error(`Excel validation error: ${errorMsg}`);
            } else {
              // Unexpected error - use generic message
              throw new Error('Failed to parse Excel file');
            }
          }

          // ★ DEBUG：Excelシート抽出確認
          if (process.env.NEXT_PUBLIC_DEBUG_HYDRATE === '1') {
            console.log('[stage1/import] Excel parsed', {
              fileName: file.name,
              sheetsCount: tables.length,
              sheetNames: tables.map((t) => (t as any).sheetName || (t as any).title || '(no name)'),
            });
          }

          for (const t of tables) {
            const beforeLen = candidates.length;
            candidates.push(...buildCandidatesFromTable(t));
            const afterLen = candidates.length;

            if (process.env.NEXT_PUBLIC_DEBUG_HYDRATE === '1' && afterLen > beforeLen) {
              console.log('[stage1/import] Table candidates added', {
                sheetName: (t as any).sheetName,
                candidatesAdded: afterLen - beforeLen,
              });
            }
          }
          tableHints.push(`${file.name}: Excel（${tables.length}シート）`);
        } else if (isPdfBuffer(buffer)) {
          const pdfResult = await parsePdf(buffer);
          candidates = buildCandidatesFromPdfText(pdfResult.pages);
          tableHints.push(`${file.name}: PDF（${pdfResult.processedPages}/${pdfResult.totalPages}ページ解析）`);
          if (pdfResult.warnings.length > 0) {
            warnings.push(...pdfResult.warnings.map((w) => `${file.name}: ${w}`));
          }
        } else {
          warnings.push(`${file.name}: 未対応のファイル形式です`);
          continue;
        }

        if (candidates.length > 0) saveToCache(cacheKey, candidates);

        allCandidates.push(...candidates);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        warnings.push(`${file.name}: 解析エラー - ${message}`);
      }
    }

    const normalized = normalizeCandidates(allCandidates);
    normalized.sort((a, b) => b.confidence - a.confidence);

    // ★ DEBUG：複数セグメント確認用ログ
    if (process.env.NEXT_PUBLIC_DEBUG_HYDRATE === '1') {
      const segmentCounts: Record<string, number> = {};
      for (const c of normalized) {
        const seg = (c as any).segmentName ?? 'N/A';
        const key = `${c.kind}:${seg}`;
        segmentCounts[key] = (segmentCounts[key] ?? 0) + 1;
      }
      console.log('[stage1/import] candidates distribution:', {
        totalCandidates: normalized.length,
        segmentDistribution: segmentCounts,
        segmentNames: Array.from(new Set(normalized.map((c: any) => c.segmentName).filter(Boolean))),
      });
    }

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
      { success: false, error: `サーバーエラー: ${message}`, candidates: [] },
      { status: 500 }
    );
  }
}

// GETは許可しない
export async function GET(): Promise<NextResponse> {
  return NextResponse.json({ error: 'Method not allowed' }, { status: 405 });
}
