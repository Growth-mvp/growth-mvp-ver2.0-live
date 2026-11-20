import type { ExtractedTable } from './excelCsvImporter';
import { consolidationOfSource, extractProfileFromPages, extractProfileFromTable, mergeProfiles } from './profileExtract';

const table = (headers: string[], rows: Array<Record<string, string | number | null>>): ExtractedTable => ({
  headers,
  rows,
  sourceRef: 'test',
});

describe('表から基本情報を読む（ラベルの右隣の値）', () => {
  it('見出し行と値の行から、会社名・所在地・従業員数・事業内容を読む', () => {
    const t = table(['項目', '内容'], [
      { 項目: '会社名', 内容: '株式会社サンプル製作所' },
      { 項目: '本店の所在地', 内容: '東京都千代田区1-1-1' },
      { 項目: '従業員数（単体）', 内容: '120名' },
      { 項目: '事業の内容', 内容: '産業用機械の設計・製造' },
    ]);
    expect(extractProfileFromTable(t, 'A.xlsx（会社概要）')).toEqual({
      companyName: { value: '株式会社サンプル製作所', where: 'A.xlsx（会社概要）' },
      location: { value: '東京都千代田区1-1-1', where: 'A.xlsx（会社概要）' },
      employees: { value: 120, where: 'A.xlsx（会社概要）' },
      businessContent: { value: '産業用機械の設計・製造', where: 'A.xlsx（会社概要）' },
    });
  });

  it('ラベルの右に値が無い時は読まない。人数として読めない従業員数も採らない', () => {
    const t = table(['会社名', ''], [{ a: '従業員数', b: '多数' }]);
    expect(extractProfileFromTable(t, 'x')).toEqual({});
  });
});

describe('PDFの本文から基本情報を読む', () => {
  it('「ラベル 値」「ラベル：値」の行を読み、文章中の「会社名は」は採らない', () => {
    const pages = [
      { pageNumber: 1, text: '会社案内\n商号　株式会社サンプル製作所\n本店所在地：東京都千代田区1-1-1' },
      { pageNumber: 2, text: '従業員数 120名\n当社の会社名は、長く親しまれている名称です。\n事業内容：産業用機械の設計・製造' },
    ];
    const p = extractProfileFromPages(pages, '会社案内.pdf');
    expect(p.companyName).toEqual({ value: '株式会社サンプル製作所', where: '会社案内.pdf（1ページ）' });
    expect(p.location?.value).toBe('東京都千代田区1-1-1');
    expect(p.employees).toEqual({ value: 120, where: '会社案内.pdf（2ページ）' });
    expect(p.businessContent?.value).toBe('産業用機械の設計・製造');
  });

  it('同じ項目が複数あれば、先に出てきた値を採る', () => {
    const p = extractProfileFromPages([{ pageNumber: 1, text: '所在地：東京都港区1-1\n所在地：大阪府大阪市1-1' }], 'a.pdf');
    expect(p.location?.value).toBe('東京都港区1-1');
  });
});

describe('連結・単体の判定と、資料どうしの統合', () => {
  it('取込元の名称に書かれた連結・単体だけで判断し、無ければ未確認', () => {
    expect(consolidationOfSource('連結貸借対照表')).toBe('CONSOLIDATED');
    expect(consolidationOfSource('個別損益計算書')).toBe('NON_CONSOLIDATED');
    expect(consolidationOfSource('単体')).toBe('NON_CONSOLIDATED');
    expect(consolidationOfSource('Sheet1')).toBe('UNKNOWN');
    expect(consolidationOfSource(undefined)).toBe('UNKNOWN');
  });

  it('統合では、項目ごとに資料の順で最初の値を採る', () => {
    const merged = mergeProfiles([
      { companyName: { value: '株式会社A', where: '1' } },
      { companyName: { value: '株式会社B', where: '2' }, location: { value: '東京都港区1-1', where: '2' } },
    ]);
    expect(merged.companyName?.value).toBe('株式会社A');
    expect(merged.location?.value).toBe('東京都港区1-1');
  });
});
