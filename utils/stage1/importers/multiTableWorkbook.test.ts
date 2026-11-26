/* 1シートに複数の表がある資料（会社概要・事業の概要・全社PL・事業別PL・BS）を、実ファイル形式で読み、候補まで通す。 */
jest.mock('server-only', () => ({}));

import * as XLSX from 'xlsx';
import { buildCandidatesFromTable, normalizeCandidates } from './candidateBuilder';
import { parseCSVTables, parseExcel } from './excelCsvImporter';
import { extractProfileFromTable, mergeProfiles, type DocumentProfile } from './profileExtract';
import { buildDocumentCandidate } from '@/lib/autofill/publicCandidate';
import { describeDocumentCandidate } from '@/lib/autofill/documentSummary';

const SHEET: unknown[][] = [
  ['有限会社TRYFUT｜会社概要・財務資料', '', '', '', '', ''],
  ['検証専用・架空データ（実際のTRYFUTの企業情報・財務実績ではありません）', '', '', '', '', ''],
  ['', '', '', '', '', ''],
  ['1. 会社概要', '', '', '', '', ''],
  ['会社名', '有限会社TRYFUT', '', '', '', ''],
  ['所在地', '茨城県つくば市（検証上の仮定）', '', '', '', ''],
  ['従業員数', '15名', '', '', '', ''],
  ['決算期', '3月末', '', '', '', ''],
  ['業種', '新聞販売業・運輸業・フィットネス事業', '', '', '', ''],
  ['事業数', 3, '', '', '', ''],
  ['', '', '', '', '', ''],
  ['2. 事業の概要', '', '', '', '', ''],
  ['事業名', '事業内容', '主要顧客', '', '', ''],
  ['新聞販売・配達事業', '新聞の販売・定期配達', '地域の新聞購読世帯', '', '', ''],
  ['宅配事業', '地域内の宅配・配送受託', '物流事業者・地域の荷主', '', '', ''],
  ['フィットネス事業', '女性向けフィットネス店舗の運営', '地域の女性会員', '', '', ''],
  ['', '', '', '', '', ''],
  ['3. 全社損益計算書（PL）　単位：千円', '', '', '', '', ''],
  ['項目', '2022年度', '2023年度', '2024年度', '2025年度', '2026年度'],
  ['売上高', 161000, 164000, 167000, 170000, 174000],
  ['営業利益', 6600, 2700, 2900, 3900, 4700],
  ['', '', '', '', '', ''],
  ['4. 事業別損益計算書（PL）　単位：千円', '', '', '', '', ''],
  ['事業名', '年度', '売上高', '営業利益', '', ''],
  ['新聞販売・配達事業', 2022, 154000, 6500, '', ''],
  ['新聞販売・配達事業', 2023, 147000, 3100, '', ''],
  ['新聞販売・配達事業', 2024, 138000, 2100, '', ''],
  ['新聞販売・配達事業', 2025, 129000, 1200, '', ''],
  ['新聞販売・配達事業', 2026, 120000, 300, '', ''],
  ['宅配事業', 2022, 7000, 100, '', ''],
  ['宅配事業', 2023, 12000, 500, '', ''],
  ['宅配事業', 2024, 17000, 1100, '', ''],
  ['宅配事業', 2025, 23000, 1800, '', ''],
  ['宅配事業', 2026, 30000, 2400, '', ''],
  ['フィットネス事業', 2022, 0, 0, '', ''],
  ['フィットネス事業', 2023, 5000, -900, '', ''],
  ['フィットネス事業', 2024, 12000, -300, '', ''],
  ['フィットネス事業', 2025, 18000, 900, '', ''],
  ['フィットネス事業', 2026, 24000, 2000, '', ''],
  ['', '', '', '', '', ''],
  ['5. 貸借対照表（BS）　単位：千円', '', '', '', '', ''],
  ['項目', '2026年度', '', '', '', ''],
  ['現金及び預金', 12500, '', '', '', ''],
  ['総資産', 86000, '', '', '', ''],
  ['有利子負債', 24000, '', '', '', ''],
  ['純資産', 29000, '', '', '', ''],
  ['', '', '', '', '', ''],
  ['注記：金額はすべて架空の実績値。記載のない項目・年度は未提供。', '', '', '', '', ''],
];

function workbook(sheets: Record<string, unknown[][]>): Buffer {
  const wb = XLSX.utils.book_new();
  for (const [name, aoa] of Object.entries(sheets)) XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(aoa), name);
  return Buffer.from(XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Uint8Array);
}

const FILE = 'TRYFUT.xlsx';
const FETCHED = '2026-11-26T00:00:00.000Z';

function readWorkbook(buf: Buffer) {
  const tables = parseExcel(buf);
  const candidates = [];
  let profile: DocumentProfile = {};
  for (const t of tables) {
    candidates.push(...buildCandidatesFromTable(t));
    profile = mergeProfiles([profile, extractProfileFromTable(t, `${FILE}（${t.sheetName ?? ''}）`)]);
  }
  return { candidates: normalizeCandidates(candidates), profiles: [profile] };
}

describe('1シートに複数の表がある資料を、表ごとに読む', () => {
  const buf = workbook({ 企業資料: SHEET });

  it('表は空行と見出し行で分けられ、表の名前（タイトル）が付く', () => {
    const tables = parseExcel(buf);
    expect(tables.map((t) => t.sheetName?.split('｜')[1])).toEqual([
      '1. 会社概要',
      '2. 事業の概要',
      '3. 全社損益計算書（PL）　単位：千円',
      '4. 事業別損益計算書（PL）　単位：千円',
      '5. 貸借対照表（BS）　単位：千円',
    ]);
  });

  it('会社概要は1列目のラベルから読む。事業内容は事業名と事業内容の表から組み立てる（主要顧客は取らない）', () => {
    const { profiles } = readWorkbook(buf);
    const p = profiles[0];
    expect(p.companyName?.value).toBe('有限会社TRYFUT');
    expect(p.location?.value).toBe('茨城県つくば市（検証上の仮定）');
    expect(p.employees?.value).toBe(15);
    expect(p.fiscalYearEnd?.value).toBe('3');
    expect(p.industry?.value).toBe('新聞販売業・運輸業・フィットネス事業');
    expect(p.businessContent?.value).toBe('新聞販売・配達事業\n新聞の販売・定期配達\n宅配事業\n地域内の宅配・配送受託\nフィットネス事業\n女性向けフィットネス店舗の運営');
  });

  it('全社PLの5期を千円から円に換算し、事業別PLの3事業×5期を、0と赤字も含めて読む', () => {
    const { candidates, profiles } = readWorkbook(buf);
    const r = buildDocumentCandidate({ candidates, profiles, fetchedAt: FETCHED });
    if (r.status !== 'FOUND') throw new Error('expected FOUND');
    const c = r.candidate;

    expect(c.finance.map((y) => [y.year, y.revenue?.value, y.operatingIncome?.value])).toEqual([
      [2022, 161_000_000, 6_600_000],
      [2023, 164_000_000, 2_700_000],
      [2024, 167_000_000, 2_900_000],
      [2025, 170_000_000, 3_900_000],
      [2026, 174_000_000, 4_700_000],
    ]);

    expect(c.segments?.items.map((i) => i.name)).toEqual(['新聞販売・配達事業', '宅配事業', 'フィットネス事業']);
    const fitness = c.segments?.items.find((i) => i.name === 'フィットネス事業');
    expect(fitness?.byYear).toEqual([
      { year: 2022, sales: 0, operatingIncome: 0 },
      { year: 2023, sales: 5_000_000, operatingIncome: -900_000 },
      { year: 2024, sales: 12_000_000, operatingIncome: -300_000 },
      { year: 2025, sales: 18_000_000, operatingIncome: 900_000 },
      { year: 2026, sales: 24_000_000, operatingIncome: 2_000_000 },
    ]);
    expect(c.segments?.items.every((i) => (i.byYear?.length ?? 0) === 5)).toBe(true);
  });

  it('最新BSは2026年度の値だけを、千円から円に換算して読む（他の年度へ振り分けない）', () => {
    const { candidates, profiles } = readWorkbook(buf);
    const r = buildDocumentCandidate({ candidates, profiles, fetchedAt: FETCHED });
    if (r.status !== 'FOUND') throw new Error('expected FOUND');
    const latest = r.candidate.finance.find((y) => y.year === 2026);
    expect(latest).toMatchObject({
      cash: { value: 12_500_000 },
      totalAssets: { value: 86_000_000 },
      interestBearingDebt: { value: 24_000_000 },
      netAssets: { value: 29_000_000 },
    });
    expect(r.candidate.finance.filter((y) => y.year !== 2026).every((y) => y.cash === undefined && y.totalAssets === undefined)).toBe(true);
  });

  it('取得できた項目と、取得できなかった項目（BSの他の年度）を正確に案内する', () => {
    const { candidates, profiles } = readWorkbook(buf);
    const r = buildDocumentCandidate({ candidates, profiles, fetchedAt: FETCHED });
    if (r.status !== 'FOUND') throw new Error('expected FOUND');
    const s = describeDocumentCandidate(r.candidate);
    expect(s.obtained).toEqual(expect.arrayContaining(['会社名', '決算月', '事業内容', '全社PL（2022・2023・2024・2025・2026年度）', '貸借対照表（2026年度）', '事業セグメント3件', '事業別PL（3事業）']));
    expect(s.missing).toEqual(expect.arrayContaining(['業種（東証33業種として区分できず）', '貸借対照表（2022・2023・2024・2025年度は資料になし）']));
  });
});

describe('縦持ちの表は、年度の列が1つにまとまっている時だけ読む', () => {
  it('「項目×年度」の表（全社PL）はこれまでどおり年度の列から読む', () => {
    const buf = workbook({
      '全社PL（単位：千円）': [
        ['項目名', '2024', '2025'],
        ['売上高', 1100000, 1200000],
        ['営業利益', 90000, 100000],
      ],
    });
    const { candidates } = readWorkbook(buf);
    expect(candidates.map((c) => [c.kind, c.year, (c.fields as Record<string, number>).revenue ?? (c.fields as Record<string, number>).operatingIncome])).toEqual(
      expect.arrayContaining([
        ['companyPL', 2024, 1100000],
        ['companyPL', 2025, 1200000],
      ]),
    );
  });
});

describe('CSVも、空行で区切られた複数の表を読む', () => {
  const csv = [
    '1. 会社概要,',
    '会社名,有限会社TRYFUT',
    '決算期,3月末',
    '',
    '事業名,年度,売上高,営業利益',
    '宅配事業,2025,23000,1800',
    '宅配事業,2026,30000,2400',
  ].join('\n');

  it('表が複数の時は、表ごとに分ける。1つだけのCSVは従来どおり1つの表', () => {
    const tables = parseCSVTables(csv);
    expect(tables).toHaveLength(2);
    expect(tables[1].headers).toEqual(['事業名', '年度', '売上高', '営業利益']);
    expect(parseCSVTables('項目,2025\n売上高,100').length).toBe(1);
  });

  it('CSVの候補と基本情報も表ごとに読む（会社名・決算月・事業別PL）', () => {
    const tables = parseCSVTables(csv);
    const candidates = tables.flatMap((t) => buildCandidatesFromTable(t));
    expect(candidates.some((c) => c.kind === 'segmentPL' && c.year === 2026 && (c as any).segmentName === '宅配事業')).toBe(true);
    const profile = tables.map((t) => extractProfileFromTable(t, 'a.csv')).reduce((a, b) => mergeProfiles([a, b]));
    expect(profile.companyName?.value).toBe('有限会社TRYFUT');
    expect(profile.fiscalYearEnd?.value).toBe('3');
  });
});
