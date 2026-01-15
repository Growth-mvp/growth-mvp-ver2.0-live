// /utils/stage1/importers/candidateBuilder.ts
/**
 * テーブル/テキストから Stage1ImportCandidate を生成
 * - 簡易実装：キーワードマッチングで項目を特定
 * - 将来：より高度な表構造解析、AI支援
 */

import type { Stage1ImportCandidate } from '@/types/strategy';
import type { ExtractedTable, TableRow } from './excelCsvImporter';
import type { PdfPageText } from './pdfImporter';

/** PL項目のマッピング */
const PL_FIELD_PATTERNS: Record<string, RegExp[]> = {
  revenue: [/売上高/i, /売上/i, /revenue/i, /sales/i, /net\s*sales/i],
  grossProfit: [/売上総利益/i, /粗利/i, /gross\s*profit/i],
  cogs: [/売上原価/i, /原価/i, /cost\s*of\s*(goods\s*)?sold/i, /cogs/i],
  sga: [/販管費/i, /販売費及び一般管理費/i, /sg&?a/i, /operating\s*expenses/i],
  operatingIncome: [/営業利益/i, /operating\s*(income|profit)/i],
  depreciation: [/減価償却/i, /depreciation/i],
  interest: [/支払利息/i, /interest\s*expense/i],
  tax: [/法人税等?/i, /income\s*tax/i, /税金/i],
  netIncome: [/当期純利益/i, /純利益/i, /net\s*(income|profit)/i],
};

/** BS項目のマッピング */
const BS_FIELD_PATTERNS: Record<string, RegExp[]> = {
  cash: [/現金?及び?預金?/i, /現預金/i, /cash/i],
  ar: [/売掛金/i, /受取手形/i, /売上債権/i, /accounts?\s*receivable/i, /a\/r/i],
  inventory: [/棚卸資産/i, /商品/i, /製品/i, /inventory/i, /inventories/i],
  ap: [/買掛金/i, /支払手形/i, /仕入債務/i, /accounts?\s*payable/i, /a\/p/i],
  fixedAssets: [/固定資産/i, /有形固定資産/i, /fixed\s*assets/i, /property/i],
  totalAssets: [/総資産/i, /資産合計/i, /total\s*assets/i],
  interestBearingDebt: [/有利子負債/i, /借入金/i, /社債/i, /interest.bearing\s*debt/i],
  equity: [/純資産/i, /株主資本/i, /自己資本/i, /(shareholders'?|stockholders'?)\s*equity/i],
  netAssets: [/純資産合計/i, /net\s*assets/i],
};

/** 年度パターン */
const YEAR_PATTERNS = [
  /(\d{4})年度?/,
  /FY\s*(\d{4})/i,
  /(\d{4})\/\d{1,2}/,
  /(\d{4})-\d{1,2}/,
  /(\d{4})/,
];

/**
 * テーブルから候補を生成
 */
export function buildCandidatesFromTable(
  table: ExtractedTable
): Stage1ImportCandidate[] {
  const candidates: Stage1ImportCandidate[] = [];

  // ヘッダーから年度列を特定
  const yearColumns = findYearColumns(table.headers);

  // 行ごとに項目を特定
  for (const row of table.rows) {
    // 行の最初の列を項目名として扱う
    const firstCol = Object.keys(row)[0];
    const itemName = String(row[firstCol] ?? '').trim();

    if (!itemName) continue;

    // PL項目かチェック
    const plField = matchField(itemName, PL_FIELD_PATTERNS);
    if (plField) {
      for (const yearCol of yearColumns) {
        const year = yearCol.year;
        const value = row[yearCol.column];
        if (value !== null && value !== undefined && typeof value === 'number') {
          candidates.push({
            kind: 'companyPL',
            year,
            fields: { [plField]: value },
            confidence: 0.7,
            sourceRef: `${table.sourceRef}:${itemName}`,
          });
        }
      }
      continue;
    }

    // BS項目かチェック
    const bsField = matchField(itemName, BS_FIELD_PATTERNS);
    if (bsField) {
      for (const yearCol of yearColumns) {
        const year = yearCol.year;
        const value = row[yearCol.column];
        if (value !== null && value !== undefined && typeof value === 'number') {
          candidates.push({
            kind: 'companyBS',
            year,
            fields: { [bsField]: value },
            confidence: 0.7,
            sourceRef: `${table.sourceRef}:${itemName}`,
          });
        }
      }
    }
  }

  // 同一年度・同一kindの候補をマージ
  return mergeCandidates(candidates);
}

/**
 * PDFテキストから候補を生成（簡易実装）
 */
export function buildCandidatesFromPdfText(
  pages: PdfPageText[]
): Stage1ImportCandidate[] {
  const candidates: Stage1ImportCandidate[] = [];

  for (const page of pages) {
    if (!page.isPriority) continue;

    const text = page.text;
    const lines = text.split('\n');

    // 年度を抽出
    const years = extractYearsFromText(text);

    for (const line of lines) {
      // 数値が含まれる行を探す
      const numbers = extractNumbersFromLine(line);
      if (numbers.length === 0) continue;

      // PL項目をチェック
      const plField = matchField(line, PL_FIELD_PATTERNS);
      if (plField && years.length > 0) {
        // 複数の数値があれば年度に対応させる
        for (let i = 0; i < Math.min(numbers.length, years.length); i++) {
          candidates.push({
            kind: 'companyPL',
            year: years[i],
            fields: { [plField]: numbers[i] },
            confidence: 0.5, // PDFからの抽出は信頼度低め
            sourceRef: `PDF:P${page.pageNumber}`,
          });
        }
        continue;
      }

      // BS項目をチェック
      const bsField = matchField(line, BS_FIELD_PATTERNS);
      if (bsField && years.length > 0) {
        for (let i = 0; i < Math.min(numbers.length, years.length); i++) {
          candidates.push({
            kind: 'companyBS',
            year: years[i],
            fields: { [bsField]: numbers[i] },
            confidence: 0.5,
            sourceRef: `PDF:P${page.pageNumber}`,
          });
        }
      }
    }
  }

  return mergeCandidates(candidates);
}

/**
 * ヘッダーから年度列を特定
 */
function findYearColumns(
  headers: string[]
): Array<{ column: string; year: number }> {
  const results: Array<{ column: string; year: number }> = [];

  for (const header of headers) {
    for (const pattern of YEAR_PATTERNS) {
      const match = header.match(pattern);
      if (match) {
        const year = parseInt(match[1], 10);
        if (year >= 1990 && year <= 2100) {
          results.push({ column: header, year });
          break;
        }
      }
    }
  }

  return results;
}

/**
 * テキストから年度を抽出
 */
function extractYearsFromText(text: string): number[] {
  const years: number[] = [];
  const seen = new Set<number>();

  for (const pattern of YEAR_PATTERNS) {
    const globalPattern = new RegExp(pattern.source, 'gi');
    let match;
    while ((match = globalPattern.exec(text)) !== null) {
      const year = parseInt(match[1], 10);
      if (year >= 2015 && year <= 2030 && !seen.has(year)) {
        years.push(year);
        seen.add(year);
      }
    }
  }

  // ソートして返す
  return years.sort((a, b) => a - b);
}

/**
 * 行から数値を抽出
 */
function extractNumbersFromLine(line: string): number[] {
  const numbers: number[] = [];

  // 数値パターン（カンマ区切り対応）
  const pattern = /[-−]?[\d,]+(?:\.\d+)?/g;
  let match;

  while ((match = pattern.exec(line)) !== null) {
    const s = match[0].replace(/[,]/g, '').replace(/[−]/g, '-');
    const num = parseFloat(s);
    if (Number.isFinite(num) && Math.abs(num) >= 1) {
      numbers.push(num);
    }
  }

  return numbers;
}

/**
 * 文字列がどの項目にマッチするか判定
 */
function matchField(
  text: string,
  patterns: Record<string, RegExp[]>
): string | null {
  for (const [field, regexes] of Object.entries(patterns)) {
    for (const regex of regexes) {
      if (regex.test(text)) {
        return field;
      }
    }
  }
  return null;
}

/**
 * 同一年度・同一kindの候補をマージ
 */
function mergeCandidates(
  candidates: Stage1ImportCandidate[]
): Stage1ImportCandidate[] {
  const map = new Map<string, Stage1ImportCandidate>();

  for (const c of candidates) {
    const key = `${c.kind}:${c.year ?? ''}:${c.segmentName ?? ''}`;
    const existing = map.get(key);

    if (existing) {
      // フィールドをマージ
      existing.fields = { ...existing.fields, ...c.fields };
      // 信頼度は高い方を採用
      existing.confidence = Math.max(existing.confidence, c.confidence);
      // ソース参照を追加
      if (c.sourceRef && !existing.sourceRef?.includes(c.sourceRef)) {
        existing.sourceRef = `${existing.sourceRef}, ${c.sourceRef}`;
      }
    } else {
      map.set(key, { ...c });
    }
  }

  return Array.from(map.values());
}

/**
 * 候補を正規化（5年分のみ、年度昇順、重複排除）
 */
export function normalizeCandidates(
  candidates: Stage1ImportCandidate[]
): Stage1ImportCandidate[] {
  // 年度でソート
  const sorted = [...candidates].sort((a, b) => {
    if (a.kind !== b.kind) return a.kind.localeCompare(b.kind);
    return (a.year ?? 0) - (b.year ?? 0);
  });

  // 各kindで最新5年分のみを残す
  const result: Stage1ImportCandidate[] = [];
  const kindYears = new Map<string, number[]>();

  for (const c of sorted) {
    const key = `${c.kind}:${c.segmentName ?? ''}`;
    if (!kindYears.has(key)) {
      kindYears.set(key, []);
    }
    const years = kindYears.get(key)!;

    if (c.year && !years.includes(c.year)) {
      years.push(c.year);
    }
  }

  // 各kindで最新5年を特定
  const kindLatest5 = new Map<string, Set<number>>();
  for (const [key, years] of kindYears) {
    const latest5 = years.sort((a, b) => b - a).slice(0, 5);
    kindLatest5.set(key, new Set(latest5));
  }

  // フィルタリング
  for (const c of sorted) {
    const key = `${c.kind}:${c.segmentName ?? ''}`;
    const allowed = kindLatest5.get(key);
    if (!c.year || (allowed && allowed.has(c.year))) {
      result.push(c);
    }
  }

  return result;
}
