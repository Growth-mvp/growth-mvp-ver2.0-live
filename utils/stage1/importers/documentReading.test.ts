/* 実ファイル形式（Excelブック）を生成し、既存の解析（parseExcel）から候補作成までを通す。 */
jest.mock('server-only', () => ({}));

import * as XLSX from 'xlsx';
import { buildCandidatesFromTable, normalizeCandidates } from './candidateBuilder';
import { parseCSV, parseExcel } from './excelCsvImporter';
import { extractProfileFromTable, mergeProfiles, type DocumentProfile } from './profileExtract';
import { buildDocumentCandidate } from '@/lib/autofill/publicCandidate';

function workbook(sheets: Record<string, unknown[][]>): Buffer {
  const wb = XLSX.utils.book_new();
  for (const [name, aoa] of Object.entries(sheets)) XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(aoa), name);
  return Buffer.from(XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Uint8Array);
}

const FETCHED = '2026-11-20T00:00:00.000Z';

function readWorkbook(buf: Buffer) {
  const tables = parseExcel(buf);
  const candidates = [];
  const profiles: DocumentProfile[] = [];
  for (const t of tables) {
    const name = (t as { sheetName?: string }).sheetName ?? '';
    candidates.push(...buildCandidatesFromTable(t));
    profiles.push(extractProfileFromTable(t, `会社資料.xlsx（${name}）`));
  }
  return { candidates: normalizeCandidates(candidates), profiles: [mergeProfiles(profiles)] };
}

describe('実ファイル形式のExcelから、基本情報と財務の候補を作る', () => {
  const buf = workbook({
    会社概要: [
      ['項目', '内容'],
      ['会社名', '株式会社サンプル製作所'],
      ['本店所在地', '東京都千代田区1-1-1'],
      ['従業員数', '120名'],
      ['事業の内容', '産業用機械の設計・製造'],
    ],
    '全社PL（単位：千円）': [
      ['項目名', '2024', '2025'],
      ['売上高', 1100000, 1200000],
      ['営業利益', 90000, 100000],
    ],
    '全社BS（単位：百万円）': [
      ['項目名', '2025'],
      ['総資産', 5000],
      ['純資産合計', 2000],
    ],
  });

  it('基本情報は資料の記載どおり、財務は単位を換算して円で候補にする', () => {
    const { candidates, profiles } = readWorkbook(buf);
    const r = buildDocumentCandidate({ candidates, profiles, fetchedAt: FETCHED });
    expect(r.status).toBe('FOUND');
    if (r.status !== 'FOUND') return;
    const c = r.candidate;

    expect(c.filer.name).toBe('株式会社サンプル製作所');
    expect(c.profileExtra.location?.value).toBe('東京都千代田区1-1-1');
    expect(c.profileExtra.employees?.value).toBe(120);
    expect(c.profileExtra.businessContent?.value).toBe('産業用機械の設計・製造');

    const y2025 = c.finance.find((y) => y.year === 2025);
    const y2024 = c.finance.find((y) => y.year === 2024);
    expect(y2025?.revenue?.value).toBe(1_200_000_000);
    expect(y2025?.operatingIncome?.value).toBe(100_000_000);
    expect(y2025?.totalAssets?.value).toBe(5_000_000_000);
    expect(y2025?.netAssets?.value).toBe(2_000_000_000);
    expect(y2024?.revenue?.value).toBe(1_100_000_000);
    expect(c.fiscalYear).toBe(2025);
  });

  it('単位の換算と、連結・単体の未確認を利用者に示す', () => {
    const { candidates, profiles } = readWorkbook(buf);
    const r = buildDocumentCandidate({ candidates, profiles, fetchedAt: FETCHED });
    if (r.status !== 'FOUND') throw new Error('expected FOUND');
    expect(r.candidate.issues.some((t) => t.includes('単位を換算して円で取り込みました'))).toBe(true);
    expect(r.candidate.issues.some((t) => t.includes('連結・単体は資料の名称から判断できない'))).toBe(true);
    expect(r.candidate.finance.find((y) => y.year === 2025)?.revenue?.consolidation).toBe('UNKNOWN');
  });

  it('資料の出典（ファイル名・シート名）を保持する', () => {
    const { candidates, profiles } = readWorkbook(buf);
    const r = buildDocumentCandidate({ candidates, profiles, fetchedAt: FETCHED });
    if (r.status !== 'FOUND') throw new Error('expected FOUND');
    const refs = r.candidate.sources.map((s) => (s.source === 'DOCUMENT' ? s.fileName : ''));
    expect(refs).toContain('会社資料.xlsx');
    expect(refs.some((n) => n.includes('全社PL'))).toBe(true);
  });
});

describe('実ファイル形式のCSVから、基本情報を読む', () => {
  it('会社案内のCSVから、会社名と従業員数を読む（財務の無い資料も候補になる）', () => {
    const t = parseCSV('項目,内容\n会社名,株式会社サンプル製作所\n従業員数,120名\n');
    const profile = extractProfileFromTable(t, '会社案内.csv');
    const r = buildDocumentCandidate({ candidates: [], profiles: [profile], fetchedAt: FETCHED });
    expect(r.status).toBe('FOUND');
    if (r.status !== 'FOUND') return;
    expect(r.candidate.profile.fields.companyName?.value).toBe('株式会社サンプル製作所');
    expect(r.candidate.profileExtra.employees?.value).toBe(120);
  });
});
