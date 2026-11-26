// /utils/stage1/importers/excelCsvImporter.ts
/**
 * CSV/Excel ファイルからテーブルデータを抽出
 * - papaparse: CSV解析
 * - xlsx: Excel解析
 */

import Papa from 'papaparse';
import * as XLSX from 'xlsx';

export type TableRow = Record<string, string | number | null>;

export type ExtractedTable = {
  /** シート名（Excelの場合） */
  sheetName?: string;
  /** ヘッダー行（推定） */
  headers: string[];
  /** データ行 */
  rows: TableRow[];
  /** 抽出元の参照（シート名、範囲など） */
  sourceRef: string;
};

// Defense in Depth: Input validation constants
const MAX_ROWS_PER_SHEET = 50000;
const MAX_COLUMNS_PER_SHEET = 300;

/**
 * CSV文字列からテーブルを抽出
 */
export function parseCSV(csvText: string): ExtractedTable {
  const result = Papa.parse<string[]>(csvText, {
    skipEmptyLines: true,
    preview: MAX_ROWS_PER_SHEET + 1,
  });

  // Hard limit: Reject if CSV exceeds row limit
  if (result.data.length > MAX_ROWS_PER_SHEET) {
    throw new Error(
      `CSV file exceeds maximum row limit of ${MAX_ROWS_PER_SHEET} rows. ` +
      `Detected ${result.data.length} rows.`
    );
  }

  if (!result.data || result.data.length === 0) {
    return { headers: [], rows: [], sourceRef: 'CSV' };
  }

  // 最初の行をヘッダーとして扱う
  const headers = result.data[0].map((h) => String(h ?? '').trim());
  const rows: TableRow[] = [];

  for (let i = 1; i < result.data.length; i++) {
    const row = result.data[i];
    const obj: TableRow = {};
    for (let j = 0; j < headers.length; j++) {
      const key = headers[j] || `col_${j}`;
      const val = row[j];
      // 数値変換を試みる
      if (val !== undefined && val !== null && val !== '') {
        const num = parseNumber(String(val));
        obj[key] = num !== null ? num : String(val).trim();
      } else {
        obj[key] = null;
      }
    }
    rows.push(obj);
  }

  return { headers, rows, sourceRef: 'CSV' };
}

/**
 * Excel バッファからテーブルを抽出（全シート）
 */
export function parseExcel(buffer: Buffer): ExtractedTable[] {
  // Defense in Depth: Parse with row limit to protect memory
  // sheetRows restricts parsing but preserves !fullref to detect overflow
  const workbook = XLSX.read(buffer, { type: 'buffer', sheetRows: MAX_ROWS_PER_SHEET + 1 });
  const tables: ExtractedTable[] = [];

  // Hard limit: Check sheet count (downstream resource protection)
  if (workbook.SheetNames.length > 50) {
    throw new Error(
      `Excel file exceeds maximum sheet limit of 50 sheets. ` +
      `Detected ${workbook.SheetNames.length} sheets.`
    );
  }

  for (const sheetName of workbook.SheetNames) {
    const sheet = workbook.Sheets[sheetName];
    if (!sheet) continue;

    // Defense in Depth: Validate row and column dimensions before parsing
    // Use !fullref (original range before sheetRows) to detect if file exceeds limits
    const fullRef = (sheet['!fullref'] as string) || (sheet['!ref'] as string);
    if (fullRef) {
      const range = XLSX.utils.decode_range(fullRef);
      const totalRows = range.e.r + 1;
      const totalCols = range.e.c + 1;

      // Hard limit: Row count
      if (totalRows > MAX_ROWS_PER_SHEET) {
        throw new Error(
          `Sheet "${sheetName}" exceeds maximum row limit of ${MAX_ROWS_PER_SHEET} rows. ` +
          `Detected ${totalRows} rows.`
        );
      }

      // Hard limit: Column count
      if (totalCols > MAX_COLUMNS_PER_SHEET) {
        throw new Error(
          `Sheet "${sheetName}" exceeds maximum column limit of ${MAX_COLUMNS_PER_SHEET} columns. ` +
          `Detected ${totalCols} columns.`
        );
      }
    }

    // シートを JSON に変換（ヘッダー行あり）
    const jsonData = XLSX.utils.sheet_to_json<Record<string, any>>(sheet, {
      header: 1, // 配列形式で取得
      defval: null,
    }) as any[][];

    if (!jsonData || jsonData.length === 0) continue;

    tables.push(...splitRowsIntoTables(jsonData, { sheetName, sourceRef: `Excel:${sheetName}` }));
  }

  return tables;
}

const isBlankCell = (v: unknown) => v === null || v === undefined || (typeof v === 'string' && v.trim() === '');

/**
 * 行の並び（シートまたはCSV）を、空行で区切った表に分ける。
 * 1セルだけの行（表の前に置かれたタイトル）は次の表のタイトルとして、表の名前（sheetName）に続けて使う（単位・PL/BSの判定に使う）。
 * 表の最初の行を見出しとし、2セル以上ある行を数値に直す。
 */
export function splitRowsIntoTables(rows: unknown[][], base: { sheetName?: string; sourceRef: string }): ExtractedTable[] {
  const tables: ExtractedTable[] = [];
  let title: string | null = null;
  let block: unknown[][] = [];

  const flush = () => {
    if (block.length >= 2) {
      const [headerRow, ...dataRows] = block;
      const headers = headerRow.map((h, idx) => {
        const s = String(h ?? '').trim();
        return s || `col_${idx}`;
      });
      const tableRows: TableRow[] = dataRows.map((row) => {
        const obj: TableRow = {};
        headers.forEach((key, j) => {
          const val = row[j];
          if (isBlankCell(val)) obj[key] = null;
          else if (typeof val === 'number') obj[key] = val;
          else {
            const num = parseNumber(String(val));
            obj[key] = num !== null ? num : String(val).trim();
          }
        });
        return obj;
      });
      const name = [base.sheetName, title].filter(Boolean).join('｜') || undefined;
      tables.push({ sheetName: name, headers, rows: tableRows, sourceRef: base.sourceRef });
      title = null;
    }
    block = [];
  };

  for (const row of rows) {
    const cells = (row ?? []).filter((c) => !isBlankCell(c));
    if (cells.length === 0) {
      flush();
    } else if (cells.length === 1 && block.length === 0) {
      title = String(cells[0]).trim();
    } else {
      block.push(row ?? []);
    }
  }
  flush();
  return tables;
}

/**
 * CSV文字列を、空行で区切った表の列に分ける（1つの表だけのCSVは従来どおり）
 */
export function parseCSVTables(csvText: string): ExtractedTable[] {
  const result = Papa.parse<string[]>(csvText, {
    skipEmptyLines: false,
    preview: MAX_ROWS_PER_SHEET + 1,
  });
  if (result.data.length > MAX_ROWS_PER_SHEET) {
    throw new Error(
      `CSV file exceeds maximum row limit of ${MAX_ROWS_PER_SHEET} rows. ` +
      `Detected ${result.data.length} rows.`
    );
  }
  const tables = splitRowsIntoTables(result.data, { sourceRef: 'CSV' });
  return tables.length > 0 ? tables : [parseCSV(csvText)];
}

/**
 * ファイル種別を判定
 */
export function detectFileType(
  buffer: Buffer,
  filename: string
): 'csv' | 'excel' | 'unknown' {
  const ext = filename.toLowerCase().split('.').pop();

  if (ext === 'csv' || ext === 'tsv') {
    return 'csv';
  }

  if (ext === 'xlsx' || ext === 'xls' || ext === 'xlsm') {
    return 'excel';
  }

  // マジックナンバーで判定
  if (buffer.length >= 4) {
    const magic = buffer.slice(0, 4).toString('hex');
    // ZIP (xlsx)
    if (magic === '504b0304') {
      return 'excel';
    }
    // OLE2 (xls)
    if (magic === 'd0cf11e0') {
      return 'excel';
    }
  }

  // PDF はバイナリ内に区切り文字を含むため、テキスト判定より前に除外する（呼び出し側で PDF として扱う）
  if (buffer.length >= 5 && buffer.slice(0, 5).toString('ascii') === '%PDF-') {
    return 'unknown';
  }

  // テキストとして読めるかどうか
  try {
    const text = buffer.toString('utf-8').slice(0, 1000);
    if (text.includes(',') || text.includes('\t')) {
      return 'csv';
    }
  } catch {
    // ignore
  }

  return 'unknown';
}

/**
 * 数値文字列をパース（カンマ区切り、括弧マイナス対応）
 */
function parseNumber(s: string): number | null {
  if (!s) return null;

  let cleaned = s.trim();

  // 括弧で囲まれている場合はマイナス
  const isNegative = cleaned.startsWith('(') && cleaned.endsWith(')');
  if (isNegative) {
    cleaned = cleaned.slice(1, -1);
  }

  // カンマ、スペース、円記号などを除去
  cleaned = cleaned.replace(/[,\s¥$€]/g, '');

  // マイナス記号の正規化
  cleaned = cleaned.replace(/[−–]/g, '-');

  // 数値に変換
  const num = Number(cleaned);
  if (Number.isFinite(num)) {
    return isNegative ? -num : num;
  }

  return null;
}
