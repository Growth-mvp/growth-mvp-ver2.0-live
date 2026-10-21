/* eslint-disable @typescript-eslint/no-explicit-any -- テストのモックとテストデータは型を緩くしている */
jest.mock('server-only', () => ({}));

import { buildFinanceCsvUnitMeta, buildStateFromDbRow } from './strategy';

const YEN_ROW_CSV = { financeUnitVersion: 2, financeBS: [], segmentPL: {}, segmentBS: {} };

describe('STAGE1 財務値の復元（単位版数による）', () => {
  it('版数2（円で保存された）の会社PLは、桁で100万倍されない', () => {
    const state = buildStateFromDbRow({
      finance_pl: [{ year: 2024, revenue: 500_000, operatingIncome: 200_000, cogs: 300_000 }],
      csv_finance_data: YEN_ROW_CSV,
    }) as any;
    expect(state.financePL[0].revenue).toBe(500_000);
    expect(state.financePL[0].operatingIncome).toBe(200_000);
    expect(state.financePL[0].cogs).toBe(300_000);
  });

  it('版数2の大きな円の値は変わらない', () => {
    const state = buildStateFromDbRow({
      finance_pl: [{ year: 2024, revenue: 1_234_567_890 }],
      csv_finance_data: YEN_ROW_CSV,
    }) as any;
    expect(state.financePL[0].revenue).toBe(1_234_567_890);
  });

  it('版数のない旧データの会社PLは、従来の救済換算を維持する（旧データの意味を変えない）', () => {
    const state = buildStateFromDbRow({
      finance_pl: [{ year: 2024, revenue: 500 }],
      csv_finance_data: {},
    }) as any;
    expect(state.financePL[0].revenue).toBe(500_000_000);
  });

  it('入力単位は保存値と一緒に復元される', () => {
    const state = buildStateFromDbRow({
      finance_pl: [],
      csv_finance_data: { ...YEN_ROW_CSV, financeInputUnit: 'thousand_yen' },
    }) as any;
    expect(state.financeInputUnit).toBe('thousand_yen');
  });

  it('版数のない旧データは、会社PLを換算して表示し、換算前の値を保持する（保存値と表示値が異なる）', () => {
    const state = buildStateFromDbRow({
      finance_pl: [{ year: 2024, revenue: 500_000 }],
      csv_finance_data: {},
    }) as any;
    expect(state.financePL[0].revenue).toBe(500_000_000_000);
    expect(state.legacyFinancePLRaw).toEqual([{ year: 2024, revenue: 500_000 }]);
    expect(state.financeUnitConfirmed).toEqual({ pl: [], bs: false, segmentPL: false, segmentBS: false });
  });

  it('旧データを読み込んだ後の保存メタは、確定年度なしとして書き、版数は付けない', () => {
    const state = buildStateFromDbRow({
      finance_pl: [{ year: 2024, revenue: 500_000 }],
      csv_finance_data: {},
    }) as any;
    expect(buildFinanceCsvUnitMeta(state)).toEqual({ financeUnitConfirmed: { pl: [] } });
  });

  it('年度ごとの確定は年度単位で読まれ、確定していない年度だけ換算する', () => {
    const state = buildStateFromDbRow({
      finance_pl: [
        { year: 2024, revenue: 500_000 },
        { year: 2025, revenue: 300 },
        { year: 2026, revenue: 500_000 },
      ],
      csv_finance_data: { financeUnitConfirmed: { pl: [2026] } },
    }) as any;
    expect(state.financePL.map((r: any) => r.revenue)).toEqual([500_000_000_000, 300_000_000, 500_000]);
    expect(state.legacyFinancePLRaw).toEqual([
      { year: 2024, revenue: 500_000 },
      { year: 2025, revenue: 300 },
    ]);
    expect(state.financeUnitConfirmed.pl).toEqual([2026]);
  });

  it('年度の重複がある会社PLは、換算前の値を保持せず、確定年度も推測しない', () => {
    const state = buildStateFromDbRow({
      finance_pl: [
        { year: 2025, revenue: 300 },
        { year: 2025, revenue: 400 },
      ],
      csv_finance_data: {},
    }) as any;
    expect(state.legacyFinancePLRaw).toBeUndefined();
    expect(state.financeUnitConfirmed.pl).toEqual([]);
  });

  it('旧版数2の行は全年度を円とみなし、会社PLを換算しない', () => {
    const state = buildStateFromDbRow({
      finance_pl: [{ year: 2024, revenue: 500_000 }],
      csv_finance_data: YEN_ROW_CSV,
    }) as any;
    expect(state.financePL[0].revenue).toBe(500_000);
    expect(state.legacyFinancePLRaw).toBeUndefined();
    expect(state.financeUnitConfirmed).toEqual({ pl: [2024], bs: true, segmentPL: true, segmentBS: true });
  });

  it('新規の円建て保存は確定年度として書かれ、再読込で換算されない', () => {
    const meta = buildFinanceCsvUnitMeta({ financeUnitConfirmed: { pl: [2024] }, financeInputUnit: 'yen' } as any);
    expect(meta).toEqual({ financeUnitConfirmed: { pl: [2024] }, financeInputUnit: 'yen' });
    const reloaded = buildStateFromDbRow({
      finance_pl: [{ year: 2024, revenue: 500_000 }],
      csv_finance_data: meta,
    }) as any;
    expect(reloaded.financePL[0].revenue).toBe(500_000);
  });

  it('保存時の単位メタは入力単位を含み、未選択なら含まない', () => {
    expect(buildFinanceCsvUnitMeta({ financeInputUnit: 'man_yen' } as any)).toEqual({ financeInputUnit: 'man_yen' });
    expect(buildFinanceCsvUnitMeta({} as any)).toEqual({});
  });

  it('会社PLを書く保存は確定年度の一覧を置き換え、書かない保存では既存の一覧を残す', () => {
    expect(
      buildFinanceCsvUnitMeta({ financeUnitConfirmed: { pl: [2026] } } as any, { financeUnitConfirmed: { pl: [2024] } }),
    ).toEqual({ financeUnitConfirmed: { pl: [2026] } });
    expect(
      buildFinanceCsvUnitMeta({ financeUnitConfirmed: { bs: true } } as any, { financeUnitConfirmed: { pl: [2024] } }),
    ).toEqual({ financeUnitConfirmed: { pl: [2024], bs: true } });
  });

  it('保存時の確定状態は既存DBのBS・セグメントの確定を取り消さない', () => {
    expect(buildFinanceCsvUnitMeta({} as any, { financeUnitConfirmed: { bs: true } })).toEqual({
      financeUnitConfirmed: { bs: true },
    });
  });
});
