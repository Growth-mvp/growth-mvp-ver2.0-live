/* 資料（表・PDFの本文）から、会社名・所在地・従業員数・事業内容のラベルと値を読み取る。
 * ラベルの直後にある値だけを採る。見つからない項目は未取得のままにし、推測で補わない。 */
import type { ExtractedTable } from './excelCsvImporter';
import type { PdfPageText } from './pdfImporter';

export type ProfileKey = 'companyName' | 'location' | 'employees' | 'businessContent' | 'industry' | 'fiscalYearEnd';

export type ProfileFinding = { value: string | number; where: string };

export type DocumentProfile = Partial<Record<ProfileKey, ProfileFinding>>;

export type ConsolidationHint = 'CONSOLIDATED' | 'NON_CONSOLIDATED' | 'UNKNOWN';

const LABELS: Record<ProfileKey, string[]> = {
  companyName: ['会社名', '商号', '法人名'],
  location: ['本店の所在地', '本店所在地', '本社の所在地', '本社所在地', '所在地', '住所'],
  employees: ['常時使用する従業員数', '従業員数'],
  businessContent: ['主要な事業の内容', '事業の内容', '事業内容', '主な事業内容'],
  industry: ['業種'],
  fiscalYearEnd: ['決算期', '決算月'],
};

const VALID_LENGTH: Record<Exclude<ProfileKey, 'employees' | 'fiscalYearEnd'>, [number, number]> = {
  companyName: [2, 100],
  location: [4, 200],
  businessContent: [2, 2000],
  industry: [2, 100],
};

const nfkc = (s: string) => s.normalize('NFKC');

/** 表の見出しと照合するため、空白と括弧（連結・単体の注記など）を除く */
const cellKey = (s: string) => nfkc(s).replace(/[\s　]/g, '').replace(/[（(][^）)]*[）)]/g, '').replace(/[:：]$/, '');

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

function asEmployees(raw: string): number | null {
  const v = nfkc(raw).replace(/[（(][^）)]*[）)]?.*$/, '').replace(/[,\s]/g, '');
  const m = /^(\d{1,7})(名|人)?$/.exec(v);
  if (!m) return null;
  const n = Number(m[1]);
  return n > 0 ? n : null;
}

/** 「3月末」「12月」のように決算月が明記された値だけ、月（1〜12）にする。年月（2026年3月期）からは推測しない */
function asFiscalMonth(raw: string): number | null {
  const m = /^(\d{1,2})\s*月/.exec(nfkc(raw).trim().replace(/^[:：]\s*/, ''));
  if (!m) return null;
  const n = Number(m[1]);
  return n >= 1 && n <= 12 ? n : null;
}

function validText(key: Exclude<ProfileKey, 'employees' | 'fiscalYearEnd'>, raw: string): string | null {
  const v = raw.trim().replace(/^[:：]\s*/, '');
  const [min, max] = VALID_LENGTH[key];
  if (v.length < min || v.length > max) return null;
  return v;
}

function accept(profile: DocumentProfile, key: ProfileKey, raw: string, where: string): void {
  if (profile[key]) return;
  if (key === 'employees') {
    const n = asEmployees(raw);
    if (n !== null) profile.employees = { value: n, where };
    return;
  }
  if (key === 'fiscalYearEnd') {
    const month = asFiscalMonth(raw);
    if (month !== null) profile.fiscalYearEnd = { value: String(month), where };
    return;
  }
  const v = validText(key, raw);
  if (v !== null) profile[key] = { value: v, where };
}

/** 表（CSV・Excel）の見出しと行から、ラベルの右隣にある値を読む */
/** 表（CSV・Excel）の見出しと行から、1列目のラベルの右隣にある値を読む。「事業名」「事業内容」の表からは事業内容を組み立てる */
export function extractProfileFromTable(table: ExtractedTable, where: string): DocumentProfile {
  const profile: DocumentProfile = {};
  const rows: string[][] = [
    table.headers.map((h) => String(h ?? '')),
    ...table.rows.map((r) => Object.values(r).map((v) => (v === null || v === undefined ? '' : String(v)))),
  ];
  for (const cells of rows) {
    const key = cellKey(cells[0] ?? '');
    for (const k of Object.keys(LABELS) as ProfileKey[]) {
      if (!LABELS[k].some((l) => cellKey(l) === key)) continue;
      const value = cells.slice(1).find((c) => c.trim() !== '');
      if (value !== undefined) accept(profile, k, value, where);
    }
  }

  const nameKey = table.headers.find((h) => h === '事業名');
  const contentKey = table.headers.find((h) => h === '事業内容');
  if (nameKey !== undefined && contentKey !== undefined) {
    const text = table.rows
      .map((r) => [String(r[nameKey] ?? '').trim(), String(r[contentKey] ?? '').trim()] as const)
      .filter(([name, content]) => name !== '' && content !== '')
      .map(([name, content]) => `${name}\n${content}`)
      .join('\n');
    if (text) accept(profile, 'businessContent', text, where);
  }
  return profile;
}

/** PDFの本文から、「ラベル 値」「ラベル：値」の行を読む */
const BUSINESS_SECTION_HEADING = /^\d+\.\s*事業の概要$/;
const NUMBERED_HEADING = /^\d+\.\s/;

/** PDFの本文から、「ラベル 値」「ラベル：値」の行を読む。「N. 事業の概要」の節は、次の見出しまでを事業内容とする */
export function extractProfileFromPages(pages: ReadonlyArray<Pick<PdfPageText, 'pageNumber' | 'text'>>, fileName: string): DocumentProfile {
  const profile: DocumentProfile = {};
  for (const page of pages) {
    const where = `${fileName}（${page.pageNumber}ページ）`;
    let section: string[] | null = null;
    const closeSection = () => {
      if (section && section.length > 0) accept(profile, 'businessContent', section.join('\n'), where);
      section = null;
    };
    for (const raw of page.text.split('\n')) {
      const line = nfkc(raw).trim();
      if (!line) continue;
      if (BUSINESS_SECTION_HEADING.test(line)) {
        closeSection();
        section = [];
        continue;
      }
      if (section !== null) {
        if (NUMBERED_HEADING.test(line)) closeSection();
        else (section as string[]).push(line);
      }
      for (const k of Object.keys(LABELS) as ProfileKey[]) {
        for (const label of LABELS[k]) {
          const m = new RegExp(`^${escapeRe(label)}(?:[（(][^）)]*[）)])?\\s*[:：]?\\s*(.+)$`).exec(line);
          if (m && !/^[はがをにでのとへも、。]/.test(m[1])) accept(profile, k, m[1], where);
        }
      }
      const fiscalPhrase = /(\d{1,2})月末?決算/.exec(line);
      if (fiscalPhrase) accept(profile, 'fiscalYearEnd', `${fiscalPhrase[1]}月`, where);
    }
    closeSection();
  }
  return profile;
}

/** 取込元の名前（シート名・ファイル名）に書かれた連結・単体の区別。書かれていなければ未確認 */
export function consolidationOfSource(source: string | undefined): ConsolidationHint {
  const s = nfkc(source ?? '');
  if (/連結/.test(s)) return 'CONSOLIDATED';
  if (/単体|個別/.test(s)) return 'NON_CONSOLIDATED';
  return 'UNKNOWN';
}

/** 複数の資料の読み取り結果から、項目ごとに最初に見つかった値を採る（資料の順） */
export function mergeProfiles(profiles: ReadonlyArray<DocumentProfile>): DocumentProfile {
  const out: DocumentProfile = {};
  for (const p of profiles) {
    for (const k of Object.keys(LABELS) as ProfileKey[]) {
      if (!out[k] && p[k]) out[k] = p[k];
    }
  }
  return out;
}
