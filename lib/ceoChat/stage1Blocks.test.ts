import {
  buildFinanceSummaryBlock,
  financeSummaryForPrompt,
  financeSummaryRowsFromPL,
  hasFinanceSummaryValues,
} from './stage1Blocks';

describe('financeSummaryRowsFromPL', () => {
  it('財務表（PL）の売上・営業利益を年度ごとに写す', () => {
    const rows = financeSummaryRowsFromPL([{ year: 2025, revenue: 160000000, operatingIncome: 1500000 }]);
    expect(rows).toEqual([{ year: 2025, revenue: 160000000, operatingIncome: 1500000 }]);
  });

  it('数値が無い年度は写さない', () => {
    expect(financeSummaryRowsFromPL([{ year: 2024 }])).toEqual([]);
  });

  it('PLが配列でなければ空を返す', () => {
    expect(financeSummaryRowsFromPL(undefined)).toEqual([]);
  });
});

describe('hasFinanceSummaryValues', () => {
  it('年だけの行は数値なしとみなす', () => {
    expect(hasFinanceSummaryValues([{ year: 2025 }])).toBe(false);
  });

  it('売上か営業利益があれば数値ありとみなす', () => {
    expect(hasFinanceSummaryValues([{ year: 2025, revenue: 1 }])).toBe(true);
  });
});

describe('financeSummaryForPrompt', () => {
  const PL = [{ year: 2025, revenue: 160000000, operatingIncome: 1500000 }];

  it('数値のある財務サマリーはそのまま使う', () => {
    const summary = [{ year: 2025, revenue: 1, operatingIncome: 2 }];
    expect(financeSummaryForPrompt(summary, PL)).toBe(summary);
  });

  it('数値の無い財務サマリーは財務表（PL）から補う', () => {
    expect(financeSummaryForPrompt([{ year: 2025 }], PL)).toEqual([{ year: 2025, revenue: 160000000, operatingIncome: 1500000 }]);
  });

  it('PLも無ければ元の値を返す', () => {
    const summary = [{ year: 2025 }];
    expect(financeSummaryForPrompt(summary, undefined)).toBe(summary);
  });
});

describe('財務ブロックへの反映', () => {
  it('補われた行から財務サマリーを出力する', () => {
    const rows = financeSummaryRowsFromPL([{ year: 2025, revenue: 160000000, operatingIncome: 1500000 }]);
    expect(buildFinanceSummaryBlock(rows)).toContain('売上 160百万円');
  });

  it('年だけの行のままでは数値が出ない', () => {
    expect(buildFinanceSummaryBlock([{ year: 2025 }] as any[])).not.toContain('売上');
  });
});
