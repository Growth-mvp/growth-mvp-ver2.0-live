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

/**
 * CSV文字列からテーブルを抽出
 */
export function parseCSV(csvText: string): ExtractedTable {
  const result = Papa.parse<string[]>(csvText, {
    skipEmptyLines: true,
  });

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
  const workbook = XLSX.read(buffer, { type: 'buffer' });
  const tables: ExtractedTable[] = [];

  for (const sheetName of workbook.SheetNames) {
    const sheet = workbook.Sheets[sheetName];
    if (!sheet) continue;

    // シートを JSON に変換（ヘッダー行あり）
    const jsonData = XLSX.utils.sheet_to_json<Record<string, any>>(sheet, {
      header: 1, // 配列形式で取得
      defval: null,
    }) as any[][];

    if (!jsonData || jsonData.length === 0) continue;

    // 空行をスキップして最初の有効な行を探す
    let headerIndex = 0;
    for (let i = 0; i < jsonData.length; i++) {
      const row = jsonData[i];
      const nonEmpty = row?.filter((c) => c !== null && c !== undefined && c !== '').length || 0;
      if (nonEmpty >= 2) {
        headerIndex = i;
        break;
      }
    }

    const headerRow = jsonData[headerIndex] || [];
    const headers = headerRow.map((h, idx) => {
      const s = String(h ?? '').trim();
      return s || `col_${idx}`;
    });

    const rows: TableRow[] = [];
    for (let i = headerIndex + 1; i < jsonData.length; i++) {
      const row = jsonData[i];
      if (!row) continue;

      const obj: TableRow = {};
      let hasValue = false;

      for (let j = 0; j < headers.length; j++) {
        const key = headers[j];
        const val = row[j];
        if (val !== undefined && val !== null && val !== '') {
          const num = typeof val === 'number' ? val : parseNumber(String(val));
          obj[key] = num !== null ? num : String(val).trim();
          hasValue = true;
        } else {
          obj[key] = null;
        }
      }

      if (hasValue) {
        rows.push(obj);
      }
    }

    if (rows.length > 0) {
      tables.push({
        sheetName,
        headers,
        rows,
        sourceRef: `Excel:${sheetName}`,
      });
    }
  }

  return tables;
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
