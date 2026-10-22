/* eslint-disable @typescript-eslint/no-explicit-any -- テストのモックとテストデータは型を緩くしている */
jest.mock('server-only', () => ({}));

import { buildFinanceCsvUnitMeta, buildStateFromDbRow } from './strategy';

const YEN_CONFIRMED_CSV = {
  financeUnitConfirmed: { pl: [2024, 2025, 2026] },
  financeBS: [],
  segmentPL: {},
  segmentBS: {},
};

describe('STAGE1 財務値の復元（円で確定した年度は換算しない）', () => {
  it('円で確定した年度の会社PLは、桁で100万倍されない', () => {
    const state = buildStateFromDbRow({
      finance_pl: [{ year: 2024, revenue: 500_000, operatingIncome: 200_000, cogs: 300_000 }],
      csv_finance_data: YEN_CONFIRMED_CSV,
    }) as any;
    expect(state.financePL[0].revenue).toBe(500_000);
    expect(state.financePL[0].operatingIncome).toBe(200_000);
    expect(state.financePL[0].cogs).toBe(300_000);
  });

  it('円で確定した大きな値は変わらない', () => {
    const state = buildStateFromDbRow({
      finance_pl: [{ year: 2024, revenue: 1_234_567_890 }],
      csv_finance_data: YEN_CONFIRMED_CSV,
    }) as any;
    expect(state.financePL[0].revenue).toBe(1_234_567_890);
  });

  it('確定年度のない旧データの会社PLは、従来の救済換算を維持する（保存値は変えない）', () => {
    const rows = [{ year: 2024, revenue: 500 }];
    const state = buildStateFromDbRow({ finance_pl: rows, csv_finance_data: {} }) as any;
    expect(state.financePL[0].revenue).toBe(500_000_000);
    expect(state.legacyFinancePLRaw).toEqual([{ year: 2024, revenue: 500 }]);
    expect(rows).toEqual([{ year: 2024, revenue: 500 }]);
  });

  it('旧データを読み込んだ後の保存メタは、確定年度なしとして書き、単位の選択は含めない', () => {
    const state = buildStateFromDbRow({
      finance_pl: [{ year: 2024, revenue: 500_000 }],
      csv_finance_data: {},
    }) as any;
    expect(state.financeUnitConfirmed).toEqual({ pl: [], bs: false, segmentPL: [], segmentBS: [] });
    expect(buildFinanceCsvUnitMeta(state)).toEqual({ financeUnitConfirmed: { pl: [], segmentPL: [], segmentBS: [] } });
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

  it('新規の円建て保存は確定年度として書かれ、再読込で換算されない', () => {
    const meta = buildFinanceCsvUnitMeta({ financeUnitConfirmed: { pl: [2024] } } as any);
    expect(meta).toEqual({ financeUnitConfirmed: { pl: [2024] } });
    const reloaded = buildStateFromDbRow({
      finance_pl: [{ year: 2024, revenue: 500_000 }],
      csv_finance_data: meta,
    }) as any;
    expect(reloaded.financePL[0].revenue).toBe(500_000);
  });

  it('旧データの保存メタに、取込単位や単位の選択は書かれない', () => {
    expect(buildFinanceCsvUnitMeta({} as any)).toEqual({});
  });
});

describe('会社PL・BSの確定メタ（保存の仕方）', () => {
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

describe('セグメントの確定（セグメントIDごと）', () => {
  it('確定したセグメントIDは再読込後も同じIDだけが残る', () => {
    const meta = buildFinanceCsvUnitMeta({
      financeUnitConfirmed: { pl: [], segmentPL: ['seg-a'], segmentBS: ['seg-b'] },
    } as any);
    const state = buildStateFromDbRow({ finance_pl: [], csv_finance_data: meta }) as any;
    expect(state.financeUnitConfirmed.segmentPL).toEqual(['seg-a']);
    expect(state.financeUnitConfirmed.segmentBS).toEqual(['seg-b']);
  });

  it('旧形式の共通フラグ true は、どのセグメントの確定としても扱わない', () => {
    const state = buildStateFromDbRow({
      finance_pl: [],
      csv_finance_data: { financeUnitConfirmed: { segmentPL: true, segmentBS: true } },
    }) as any;
    expect(state.financeUnitConfirmed.segmentPL).toEqual([]);
    expect(state.financeUnitConfirmed.segmentBS).toEqual([]);
  });

  it('会社ごとのセグメント確定は、読み込んだ会社のCSVだけから決まる', () => {
    const companyA = buildStateFromDbRow({
      finance_pl: [],
      csv_finance_data: { financeUnitConfirmed: { segmentPL: ['seg-a'] } },
    }) as any;
    const companyB = buildStateFromDbRow({ finance_pl: [], csv_finance_data: {} }) as any;
    expect(companyA.financeUnitConfirmed.segmentPL).toEqual(['seg-a']);
    expect(companyB.financeUnitConfirmed.segmentPL).toEqual([]);
  });

  it('セグメント確定を状態から書くと一覧で置き換わり、削除済みセグメントの確定は残らない', () => {
    const meta = buildFinanceCsvUnitMeta(
      { financeUnitConfirmed: { segmentPL: ['seg-b'] } } as any,
      { financeUnitConfirmed: { segmentPL: ['seg-a', 'seg-b'] } },
    );
    expect(meta.financeUnitConfirmed).toEqual({ segmentPL: ['seg-b'] });
  });

  it('セグメント確定が未読込の状態で保存しても、既存のセグメント確定を消さない', () => {
    const meta = buildFinanceCsvUnitMeta({} as any, { financeUnitConfirmed: { segmentPL: ['seg-a'] } });
    expect(meta.financeUnitConfirmed).toEqual({ segmentPL: ['seg-a'] });
  });
});

describe('旧年度の読込で欠損項目を0円に補完しない', () => {
  const legacyState = (row: Record<string, unknown>) =>
    buildStateFromDbRow({ finance_pl: [{ year: 2025, ...row }], csv_finance_data: {} }) as any;

  it.each(['revenue', 'operatingIncome', 'cogs', 'sga', 'grossProfit'])(
    '欠損した %s はキーのまま欠損として残る',
    (field) => {
      const row: Record<string, unknown> = { revenue: 500_000, operatingIncome: 20_000, cogs: 300_000, sga: 40_000, grossProfit: 60_000 };
      delete row[field];
      const pl = legacyState(row).financePL[0];
      expect(pl).not.toHaveProperty(field);
    },
  );

  it('null は0円に変えず null のまま残す', () => {
    const pl = legacyState({ revenue: 500_000, grossProfit: null }).financePL[0];
    expect(pl.grossProfit).toBeNull();
  });

  it('明示的な0円は0円のまま残す', () => {
    const pl = legacyState({ revenue: 500_000, operatingIncome: 0 }).financePL[0];
    expect(pl.operatingIncome).toBe(0);
  });

  it('100万円未満の値は従来どおり換算し、100万円以上の値は変えない', () => {
    const pl = legacyState({ revenue: 300, operatingIncome: 2_000_000 }).financePL[0];
    expect(pl.revenue).toBe(300_000_000);
    expect(pl.operatingIncome).toBe(2_000_000);
  });

  it('数値として保存された文字列は従来どおり数値に換算する', () => {
    const pl = legacyState({ revenue: '2000' }).financePL[0];
    expect(pl.revenue).toBe(2_000_000_000);
  });

  it('円確認済みの年度では欠損は欠損のまま、値も変えない', () => {
    const state = buildStateFromDbRow({
      finance_pl: [{ year: 2025, revenue: 500_000, cogs: 300_000 }],
      csv_finance_data: { financeUnitConfirmed: { pl: [2025] } },
    }) as any;
    expect(state.financePL[0]).toStrictEqual({ year: 2025, revenue: 500_000, cogs: 300_000 });
  });
});
