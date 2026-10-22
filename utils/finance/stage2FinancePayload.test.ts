import type { FinancePLRow } from '@/types/strategy';
import { buildStage2FinancePayload } from './stage2FinancePayload';

const COMPANY_A = 'a1000000-0000-4000-8000-000000000001';
const COMPANY_B = 'b1000000-0000-4000-8000-000000000002';

function build(overrides: Partial<Parameters<typeof buildStage2FinancePayload>[0]> = {}) {
  return buildStage2FinancePayload({
    requestCompanyId: COMPANY_A,
    storeCompanyId: COMPANY_A,
    financePL: [{ year: 2024, revenue: 1_200_000_000, operatingIncome: 100_000_000 }],
    ...overrides,
  });
}

describe('STAGE2へ渡す財務金額（円）の組み立て', () => {
  it('売上12億円・営業利益1億円を円のまま、明示の単位名つきで渡す', () => {
    expect(build()).toEqual([{ year: 2024, '売上高(円)': 1_200_000_000, '営業利益(円)': 100_000_000 }]);
  });

  it('営業利益50万円も円のまま渡す（百万円へは換算しない）', () => {
    const r = build({ financePL: [{ year: 2024, revenue: 1_200_000_000, operatingIncome: 500_000 }] });
    expect(r).toEqual([{ year: 2024, '売上高(円)': 1_200_000_000, '営業利益(円)': 500_000 }]);
  });

  it('単位確認の記録がない既存年度も、有効な数値なら送る', () => {
    const r = build({ financePL: [{ year: 2023, revenue: 900_000_000 }, { year: 2024, revenue: 1_200_000_000 }] });
    expect(r).toEqual([
      { year: 2023, '売上高(円)': 900_000_000 },
      { year: 2024, '売上高(円)': 1_200_000_000 },
    ]);
  });

  it('欠損（undefined・null）は省き、明示された0は0として残す', () => {
    const r = build({
      financePL: [
        { year: 2024, revenue: 0, operatingIncome: undefined },
        { year: 2023, revenue: undefined, operatingIncome: 0 },
        { year: 2022, revenue: null as unknown as number, operatingIncome: undefined },
      ],
    });
    expect(r).toEqual([
      { year: 2024, '売上高(円)': 0 },
      { year: 2023, '営業利益(円)': 0 },
    ]);
  });

  it('数値でない値（文字列・NaN・Infinity）はその項目だけ省く', () => {
    const r = build({
      financePL: [
        { year: 2024, revenue: '1200' as unknown as number, operatingIncome: 100_000_000 },
        { year: 2023, revenue: Number.NaN, operatingIncome: Number.POSITIVE_INFINITY },
      ],
    });
    expect(r).toEqual([{ year: 2024, '営業利益(円)': 100_000_000 }]);
  });

  it('金額が1つもない年度は送らない', () => {
    expect(build({ financePL: [{ year: 2024 }] })).toBeUndefined();
  });

  it('年度重複: 同じ年度の行は両方除外し、他の年度は送る', () => {
    const r = build({
      financePL: [
        { year: 2024, revenue: 1 },
        { year: 2024, revenue: 2 },
        { year: 2023, revenue: 900_000_000 },
      ],
    });
    expect(r).toEqual([{ year: 2023, '売上高(円)': 900_000_000 }]);
  });

  it('年度重複: 全行が重複する場合は何も送らない', () => {
    expect(build({ financePL: [{ year: 2024, revenue: 1 }, { year: 2024, revenue: 2 }] })).toBeUndefined();
  });

  it('年度の欠落: 年度のない行は除外し、他の行は送る', () => {
    const r = build({
      financePL: [{ revenue: 1 } as FinancePLRow, { year: 2024, revenue: 1_200_000_000 }],
    });
    expect(r).toEqual([{ year: 2024, '売上高(円)': 1_200_000_000 }]);
  });

  it('財務情報がない企業では何も渡さない（従来どおり生成できるように未指定にする）', () => {
    expect(build({ financePL: [] })).toBeUndefined();
    expect(build({ financePL: undefined })).toBeUndefined();
  });

  it('要求先の会社とストアの会社が一致しない場合は、別会社の財務を送らない', () => {
    expect(build({ requestCompanyId: COMPANY_B })).toBeUndefined();
    expect(build({ storeCompanyId: null })).toBeUndefined();
    expect(build({ requestCompanyId: null })).toBeUndefined();
  });

  it('会社Bのリクエストに会社Aのストアデータは混ざらない（切替直後の状態）', () => {
    const r = buildStage2FinancePayload({
      requestCompanyId: COMPANY_B,
      storeCompanyId: COMPANY_A,
      financePL: [{ year: 2024, revenue: 555_000_000 }],
    });
    expect(r).toBeUndefined();
  });
});
