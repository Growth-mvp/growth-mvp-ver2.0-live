import { extractMetricFromYearlyPL, isRevenueLabel } from './compute';

describe('売上の判定：原価・利益・債権は売上高として扱わない（P0-3）', () => {
  it.each([
    '売上原価',
    '売上総利益',
    '売上総利益率',
    '売上債権',
    '売上債権回転日数',
    '売掛金',
    '売上利益率',
    '売上高営業利益',
    'Cost of Sales',
    'Sales Cost',
    'COGS',
    'Gross Profit',
    'Sales Profit',
  ])('%s は売上ではない', (label) => {
    expect(isRevenueLabel(label)).toBe(false);
  });

  it.each(['売上高', '売上', '売上高（百万円）', '営業収益', 'Sales', 'Revenue', 'Net Sales', 'SALES_REVENUE'])(
    '%s は売上として扱う',
    (label) => {
      expect(isRevenueLabel(label)).toBe(true);
    }
  );

  it('売上原価の目標は、売上の金額として取り出さない', () => {
    const yearly = [{ year: 2027, revenue: 1_000_000_000, cogs: 620_000_000, sga: 258_000_000, op_income: 70_000_000, margin: 0.07 }];
    expect(extractMetricFromYearlyPL(yearly as any, '売上原価', 2027)).toBeUndefined();
    expect(extractMetricFromYearlyPL(yearly as any, '売上高', 2027)).toBe(1_000_000_000);
  });
});
