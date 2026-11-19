import fs from 'node:fs';
import path from 'node:path';
import { parseEdinetCsv } from './edinetZip';
import { extractFacts, periodOffsetOf } from './xbrlFacts';

const FIX = path.join(__dirname, '__fixtures__');
const load = (name: string) => parseEdinetCsv(fs.readFileSync(path.join(FIX, name), 'utf8'));

// 原資料（EDINETのCSV、書類ID S100YK2J・S100Y04L）の値。期待値はこの値をそのまま使う
describe('日本製罐（S100YK2J・第121期）の抽出：原資料の値と照合する', () => {
  const f = extractFacts(load('nisshin-s100yk2j-main-subset.tsv'));

  it('企業情報（表紙・DEI）を取り出す', () => {
    expect(f.companyName).toBe('日本製罐株式会社');
    expect(f.filerNameDei).toBe('日本製罐株式会社');
    expect(f.address).toBe('埼玉県さいたま市北区吉野町２丁目275番地');
    expect(f.exchange).toBe('東京証券取引所スタンダード市場');
    expect(f.accountingStandard).toBe('Japan GAAP');
    expect(f.periodEnd).toBe('2026-03-31');
    expect(f.fiscalYearEndMonth).toBe(3);
    expect(f.fiscalYear).toBe(2026);
  });

  it('従業員数（当期末）は189名。連結・単体の区分は未確認として注記する', () => {
    expect(f.employees).toBe(189);
    expect(f.issues.join('')).toContain('従業員数は、連結・単体の区分を書類の要素から確定できない');
  });

  it('5期の売上高・親会社株主に帰属する当期純利益は、原資料の値と一致する', () => {
    const pl = Object.fromEntries(f.pl.map((p) => [p.year, p]));
    expect(pl[2026].revenue).toBe(11442246000);
    expect(pl[2025].revenue).toBe(11259429000);
    expect(pl[2026].netIncome).toBe(-346736000);
    expect(pl[2022].revenue).toBe(10472199000);
    expect(pl[2022].netIncome).toBe(236572000);
    expect(f.pl.map((p) => p.year)).toEqual([2022, 2023, 2024, 2025, 2026]);
  });

  it('営業利益は、書類の連結財務諸表にある2期（前期・当期）だけ取り出し、それ以外の年度は埋めない', () => {
    const pl = Object.fromEntries(f.pl.map((p) => [p.year, p]));
    expect(pl[2026].operatingIncome).toBe(-307863000);
    expect(pl[2025].operatingIncome).toBe(-540734000);
    expect(pl[2024].operatingIncome).toBeUndefined();
    expect(pl[2022].operatingIncome).toBeUndefined();
  });

  it('5期の総資産・純資産は原資料の値と一致する', () => {
    const bs = Object.fromEntries(f.bs.map((b) => [b.year, b]));
    expect(bs[2026].totalAssets).toBe(12975874000);
    expect(bs[2026].netAssets).toBe(4856436000);
    expect(bs[2022].totalAssets).toBe(13619035000);
  });

  it('主要指標（5期）と連結財務諸表（当期・前期）の照合は、すべて一致し、連結として確認できている', () => {
    expect(f.checks.length).toBeGreaterThan(0);
    expect(f.checks.every((c) => c.result === 'MATCH')).toBe(true);
    expect(f.consolidationConfirmed).toBe(true);
  });

  it('事業の内容（本文）を取り出す（原資料の文言のまま）', () => {
    expect(f.businessText).toContain('日本製罐株式会社）及び子会社１社');
  });
});

describe('丹青社（S100Y04L・第68期）の抽出：原資料の値と照合する', () => {
  const f = extractFacts(load('tancho-s100y04l-main-subset.tsv'));

  it('決算月は1月。所在地・上場市場・従業員数', () => {
    expect(f.companyName).toBe('株式会社丹青社');
    expect(f.periodEnd).toBe('2026-01-31');
    expect(f.fiscalYearEndMonth).toBe(1);
    expect(f.address).toBe('東京都港区港南１丁目２番70号');
    expect(f.exchange).toBe('東京証券取引所プライム市場');
    expect(f.employees).toBe(1579);
  });

  it('売上高・営業利益・純利益・総資産・純資産は、原資料の値と一致する（単位は円）', () => {
    const pl = Object.fromEntries(f.pl.map((p) => [p.year, p]));
    const bs = Object.fromEntries(f.bs.map((b) => [b.year, b]));
    expect(pl[2026]).toMatchObject({ revenue: 107222000000, operatingIncome: 8358000000, netIncome: 5993000000 });
    expect(pl[2025]).toMatchObject({ revenue: 91858000000, operatingIncome: 5147000000, netIncome: 3875000000 });
    expect(pl[2022].revenue).toBe(62714000000);
    expect(bs[2026]).toMatchObject({ totalAssets: 55725000000, netAssets: 37665000000 });
    expect(f.consolidationConfirmed).toBe(true);
    expect(f.checks.every((c) => c.result === 'MATCH')).toBe(true);
  });
});

describe('照合・単位・期間の扱い（誤った値を採用しない）', () => {
  it('主要指標と連結財務諸表が一致しない時は、数値を採用せず、連結として確認できない', () => {
    const rows = load('nisshin-s100yk2j-main-subset.tsv').map((r) =>
      r.elementId === 'jpcrp_cor:NetSalesSummaryOfBusinessResults' && r.contextId === 'CurrentYearDuration'
        ? { ...r, value: '99999' }
        : r,
    );
    const f = extractFacts(rows);
    expect(f.consolidationConfirmed).toBe(false);
    expect(f.pl).toEqual([]);
    expect(f.bs).toEqual([]);
    expect(f.checks.some((c) => c.result === 'MISMATCH')).toBe(true);
    expect(f.issues.join('')).toContain('照合不一致');
  });

  it('単位が円でない値は、採用しない', () => {
    const rows = load('nisshin-s100yk2j-main-subset.tsv').map((r) =>
      r.elementId === 'jppfs_cor:NetSales' && r.contextId === 'CurrentYearDuration' ? { ...r, unit: '百万円' } : r,
    );
    const f = extractFacts(rows);
    expect(f.issues.join('')).toContain('単位が円ではない値を除外');
  });

  it('期の文脈名を、当期からの差に直す（メンバー付きの文脈は対象外）', () => {
    expect(periodOffsetOf('CurrentYearDuration')).toBe(0);
    expect(periodOffsetOf('Prior4YearInstant')).toBe(4);
    expect(periodOffsetOf('CurrentYearDuration_NonConsolidatedMember')).toBeNull();
  });
});
