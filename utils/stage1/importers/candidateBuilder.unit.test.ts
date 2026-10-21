/* eslint-disable @typescript-eslint/no-explicit-any -- テストのモックとテストデータは型を緩くしている */
import { buildCandidatesFromTable } from './candidateBuilder';
import type { ExtractedTable } from './excelCsvImporter';

function plTable(sheetName: string, items: Array<[string, number, number]>): ExtractedTable {
  return {
    sheetName,
    headers: ['項目名', '2024', '2023'],
    rows: items.map(([name, y24, y23]) => ({ '項目名': name, '2024': y24, '2023': y23 })),
    sourceRef: 'a.csv',
  } as unknown as ExtractedTable;
}

describe('取込候補の単位（列名・資料内の表記）', () => {
  it('列名に明示された単位（売上高(千円)）を候補の項目単位として残す。値は換算しない', () => {
    const [candidate] = buildCandidatesFromTable(plTable('全社PL', [['売上高(千円)', 5000, 4000], ['営業利益', 200, 100]]));
    expect(candidate.kind).toBe('companyPL');
    expect(candidate.year).toBe(2024);
    expect((candidate as any).fields).toMatchObject({ revenue: 5000, operatingIncome: 200 });
    expect((candidate as any).fieldUnits).toEqual({ revenue: 'thousand_yen' });
    expect((candidate as any).source).toBe('a.csv');
  });

  it('資料内の単位表記（シート名の単位：千円）は、資料全体の単位として候補に付く', () => {
    const [candidate] = buildCandidatesFromTable(plTable('PL（単位：千円）', [['売上高', 5000, 4000]]));
    expect((candidate as any).sheetUnit).toBe('thousand_yen');
    expect((candidate as any).fieldUnits).toBeUndefined();
  });

  it('列名の明示単位は、資料全体の単位より優先する', () => {
    const [candidate] = buildCandidatesFromTable(plTable('PL（単位：千円）', [['営業利益(万円)', 200, 100]]));
    expect((candidate as any).sheetUnit).toBe('thousand_yen');
    expect((candidate as any).fieldUnits).toEqual({ operatingIncome: 'man_yen' });
  });

  it('単位の表記が無い資料は、単位を推測せず候補にも付けない', () => {
    const [candidate] = buildCandidatesFromTable(plTable('PL', [['売上高', 5_000_000, 4_000_000]]));
    expect((candidate as any).sheetUnit).toBeUndefined();
    expect((candidate as any).fieldUnits).toBeUndefined();
    expect((candidate as any).fields).toEqual({ revenue: 5_000_000 });
  });

  it('未対応の単位（千万円）は明示単位として扱わない', () => {
    const [candidate] = buildCandidatesFromTable(plTable('PL', [['売上高(千万円)', 3, 2]]));
    expect((candidate as any).fieldUnits).toBeUndefined();
  });
});
