import fs from 'node:fs';
import path from 'node:path';
import {
  CodeListIndex,
  CODELIST_TTL_MS,
  getCodeListIndex,
  parseCodeListText,
  parseFiscalYearEnd,
  resetCodeListCacheForTest,
  secCodeOf,
  splitCsvLine,
} from './edinetCodeList';
import { makeZip } from './__fixtures__/makeZip';

const FIX = path.join(__dirname, '__fixtures__', 'edinetcode-subset.csv');
const subset = () => parseCodeListText(fs.readFileSync(FIX, 'utf8'));

describe('コードリストの読み取り（一覧の形式）', () => {
  it('引用符とカンマを正しく分ける', () => {
    expect(splitCsvLine('"a,b","c""d",e')).toEqual(['a,b', 'c"d', 'e']);
  });

  it('決算日（3月31日）と証券コード（5桁→4桁）を取り出す', () => {
    expect(parseFiscalYearEnd('3月31日')).toEqual({ month: 3, day: 31 });
    expect(parseFiscalYearEnd('13月1日')).toBeNull();
    expect(secCodeOf('59050')).toBe('5905');
    expect(secCodeOf('')).toBeNull();
  });

  it('日本製罐と丹青社の行を、上場・連結の有無・業種・所在地つきで読む', () => {
    const idx = new CodeListIndex(subset());
    expect(idx.byEdinetCode('E01408')).toMatchObject({
      name: '日本製罐株式会社',
      listed: true,
      consolidated: true,
      fiscalYearEndMonth: 3,
      fiscalYearEndDay: 31,
      industryName: '金属製品',
      secCode: '5905',
      address: 'さいたま市北区吉野町２丁目２７５番地',
    });
    expect(idx.byEdinetCode('E00208')).toMatchObject({ name: '株式会社丹青社', fiscalYearEndMonth: 1, industryName: 'サービス業', secCode: '9743' });
  });
});

describe('コードリストでの検索（推測で1社に決めない）', () => {
  const idx = new CodeListIndex(subset());

  it('証券コードは一意に引く', () => {
    expect(idx.search({ secCode: '5905' }).map((e) => e.edinetCode)).toEqual(['E01408']);
  });

  it('会社名は、株式会社などを除いて完全一致を優先する', () => {
    expect(idx.search({ name: '日本製罐' }).map((e) => e.edinetCode)).toEqual(['E01408']);
    expect(idx.search({ name: '丹青社' }).map((e) => e.edinetCode)).toEqual(['E00208']);
  });

  it('同じ名前の一部を含む会社は、すべて返す（曖昧さを残す）', () => {
    const names = idx.search({ name: '東洋' }).map((e) => e.name);
    expect(names).toEqual(expect.arrayContaining(['東洋紡株式会社', '東洋水産株式会社', '東洋製罐グループホールディングス株式会社']));
  });

  it('短すぎる名前、一覧に無い名前は、何も返さない', () => {
    expect(idx.search({ name: '日' })).toEqual([]);
    expect(idx.search({ name: 'ゼッタイナイ' })).toEqual([]);
  });
});

describe('コードリストの取得（キャッシュ：24時間）', () => {
  // 本番と同じ Shift_JIS の一覧（実データの一部の行）を zip にして返す
  const sjis = fs.readFileSync(path.join(__dirname, '__fixtures__', 'edinetcode-subset-sjis.csv'));
  const zip = makeZip([{ name: 'EdinetcodeDlInfo.csv', data: sjis }]);
  const makeFetch = () => {
    const f = jest.fn(async () => ({ ok: true, status: 200, arrayBuffer: async () => zip.buffer.slice(zip.byteOffset, zip.byteOffset + zip.byteLength) }));
    return { f, fetchImpl: f as unknown as typeof fetch };
  };

  beforeEach(() => resetCodeListCacheForTest());

  it('一度取得したら、24時間は再取得しない。並行の要求もまとめる', async () => {
    const { f, fetchImpl } = makeFetch();
    const t0 = 1_000_000;
    const [a, b] = await Promise.all([getCodeListIndex({ now: t0, fetchImpl }), getCodeListIndex({ now: t0, fetchImpl })]);
    expect(a).toBe(b);
    await getCodeListIndex({ now: t0 + 1000, fetchImpl });
    expect(f).toHaveBeenCalledTimes(1);
  });

  it('24時間を過ぎたら、取り直す', async () => {
    const { f, fetchImpl } = makeFetch();
    await getCodeListIndex({ now: 0, fetchImpl });
    await getCodeListIndex({ now: CODELIST_TTL_MS + 1, fetchImpl });
    expect(f).toHaveBeenCalledTimes(2);
  });

  it('取得に失敗したら、保持しない（次の依頼で取り直す）', async () => {
    const f = jest.fn(async () => ({ ok: false, status: 500, arrayBuffer: async () => new ArrayBuffer(0) }));
    await expect(getCodeListIndex({ now: 0, fetchImpl: f as unknown as typeof fetch })).rejects.toThrow('codelist_http_500');
    const ok = makeFetch();
    const idx = await getCodeListIndex({ now: 1, fetchImpl: ok.fetchImpl });
    expect(idx.byEdinetCode('E01408')?.name).toBe('日本製罐株式会社');
  });
});
