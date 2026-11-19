import fs from 'node:fs';
import path from 'node:path';
import { parseEdinetCsv } from './edinetZip';
import { extractSegments, segmentNamesFromText } from './segments';

const FIX = path.join(__dirname, '__fixtures__');
const load = (name: string) => parseEdinetCsv(fs.readFileSync(path.join(FIX, name), 'utf8'));

describe('日本製罐（当期）の報告セグメント：原資料の値と照合する', () => {
  const s = extractSegments(load('nisshin-s100yk2j-main-subset.tsv'), '2026-03-31');

  it('セグメント別の売上高・営業利益（連結）を取り出す', () => {
    const steel = s.items.find((i) => i.memberCode === 'SteelCanManufacturer');
    const lease = s.items.find((i) => i.memberCode === 'RealEstateLease');
    expect(steel).toMatchObject({ sales: 11278329000, operatingIncome: -391504000 });
    expect(lease).toMatchObject({ sales: 163917000, operatingIncome: 83641000 });
    expect(s.totals).toEqual({ sales: 11442246000, operatingIncome: -307863000 });
  });

  it('セグメントの合計は、全体の値と一致する', () => {
    expect(s.checks.every((c) => c.ok)).toBe(true);
  });

  it('セグメント名は、説明文の「〜事業」の並びから、順番どおりに対応付ける（要確認と注記）', () => {
    expect(s.names).toEqual(['金属缶製造販売事業', '不動産賃貸事業']);
    expect(s.issues.join('')).toContain('説明文の並びから対応付けた');
  });
});

describe('丹青社（当期）の報告セグメント：原資料の値と照合する', () => {
  const s = extractSegments(load('tancho-s100y04l-main-subset.tsv'), '2026-01-31');

  it('3つの報告セグメントの売上高・営業利益を取り出す', () => {
    expect(s.items).toHaveLength(3);
    expect(s.items.find((i) => i.memberCode === 'CommercialAndOtherFacilityMarket')).toMatchObject({ sales: 72154000000, operatingIncome: 6808000000 });
    expect(s.items.find((i) => i.memberCode === 'ChainStoreMarket')).toMatchObject({ sales: 25619000000, operatingIncome: 1984000000 });
    expect(s.items.find((i) => i.memberCode === 'CulturalFacilityMarket')).toMatchObject({ sales: 8929000000, operatingIncome: -616000000 });
  });

  it('売上高の合計は一致し、営業利益は百万円単位の丸めの範囲で一致する', () => {
    const sales = s.checks.find((c) => c.metric === 'sales')!;
    const oi = s.checks.find((c) => c.metric === 'operatingIncome')!;
    expect(sales.ok).toBe(true);
    expect(oi.ok).toBe(true);
    expect(oi.total).toBe(8175000000);
  });

  it('セグメント名は、説明文の3つの「〜事業」と一致する', () => {
    expect(s.names).toEqual(['商業その他施設事業', 'チェーンストア事業', '文化施設事業']);
  });
});

describe('セグメント名の抽出（推測しない）', () => {
  it('説明文から「〜事業」だけを、助詞で区切って取り出す', () => {
    expect(segmentNamesFromText('ディスプレイ業を主な事業とし、当社は商業その他施設事業、チェーンストア事業、文化施設事業の三つ')).toEqual([
      '商業その他施設事業',
      'チェーンストア事業',
      '文化施設事業',
    ]);
  });

  it('説明文の名前の数が報告セグメントの数と合わない時は、名前を付けない', () => {
    const rows = parseEdinetCsv(
      [
        '"要素ID"\t"項目名"\t"コンテキストID"\t"相対年度"\t"連結・個別"\t"期間・時点"\t"ユニットID"\t"単位"\t"値"',
        '"jpcrp_cor:DescriptionOfReportableSegmentsTextBlock"\t"x"\t"CurrentYearDuration"\t"当期"\t"その他"\t"期間"\t"-"\t"－"\t"何もない説明"',
        '"jppfs_cor:NetSales"\t"売上高"\t"CurrentYearDuration_jpcrp030000-asr_E00001-000AAAReportableSegmentsMember"\t"当期"\t"連結"\t"期間"\t"JPY"\t"円"\t"100"',
      ].join('\n'),
    );
    const s = extractSegments(rows, null);
    expect(s.items).toHaveLength(1);
    expect(s.names).toEqual([]);
    expect(s.issues.join('')).toContain('名前は未入力');
  });
});
