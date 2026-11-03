/**
 * STAGE6 Compute - Label matching functions test
 * - isRevenueLabel と isOperatingIncomeLabel が複数ラベルに対応しているか確認
 */

import { isRevenueLabel, isOperatingIncomeLabel } from './compute';

describe('STAGE6 Compute - Label Matching', () => {
  describe('isRevenueLabel', () => {
    const revenueLabels = [
      '売上',
      '売上高',
      'Revenue',
      'Sales',
      'sales',
      'revenue',
      'Sales Revenue',
      'sales_revenue',
      '営業収益',
    ];

    test.each(revenueLabels)('should match revenue label: %s', (label) => {
      expect(isRevenueLabel(label)).toBe(true);
    });

    const nonRevenueLabels = [
      '売上成長率',
      '売上成長',
      'Revenue Growth',
      '営業利益',
      'Operating Income',
      'Margin',
      'Unknown Metric',
    ];

    test.each(nonRevenueLabels)('should NOT match non-revenue label: %s', (label) => {
      expect(isRevenueLabel(label)).toBe(false);
    });
  });

  describe('isOperatingIncomeLabel', () => {
    const opIncomeLabels = [
      '営業利益',
      'Operating Income',
      'Operating Profit',
      'operating_profit',
      'operatingincome',
      'operatingprofit',
      'op ',
      'opProfit',
    ];

    test.each(opIncomeLabels)('should match operating income label: %s', (label) => {
      expect(isOperatingIncomeLabel(label)).toBe(true);
    });

    const nonOpIncomeLabels = [
      '営業利益率',
      'Operating Profit Rate',
      'Operating Income %',
      'Revenue',
      '売上',
      'Margin Rate',
    ];

    test.each(nonOpIncomeLabels)('should NOT match non-operating-income label: %s', (label) => {
      expect(isOperatingIncomeLabel(label)).toBe(false);
    });
  });

  describe('Label exclusion logic', () => {
    test('isRevenueLabel should exclude "成長" (growth)', () => {
      expect(isRevenueLabel('売上成長')).toBe(false);
      expect(isRevenueLabel('売上成長率')).toBe(false);
      expect(isRevenueLabel('Revenue Growth')).toBe(false);
    });

    test('isOperatingIncomeLabel should exclude "率" and "Rate"', () => {
      expect(isOperatingIncomeLabel('営業利益率')).toBe(false);
      expect(isOperatingIncomeLabel('Operating Profit Rate')).toBe(false);
      expect(isOperatingIncomeLabel('op rate')).toBe(false);
    });
  });

  describe('Case insensitivity', () => {
    test('isRevenueLabel should work with mixed case', () => {
      expect(isRevenueLabel('REVENUE')).toBe(true);
      expect(isRevenueLabel('Revenue')).toBe(true);
      expect(isRevenueLabel('ReVeNuE')).toBe(true);
      expect(isRevenueLabel('SALES')).toBe(true);
    });

    test('isOperatingIncomeLabel should work with mixed case', () => {
      expect(isOperatingIncomeLabel('OPERATING INCOME')).toBe(true);
      expect(isOperatingIncomeLabel('OperatingIncome')).toBe(true);
      expect(isOperatingIncomeLabel('OPERATINGPROFIT')).toBe(true);
    });
  });
});

describe('成長率の表記は売上・営業利益の金額として扱わない（表記揺れ）', () => {
  test.each([
    '売上成長率', '売上成長', '売上伸び率', '売上増加率', '売上変化率', '売上高成長率',
    'Revenue Growth', 'Sales Growth', 'Revenue CAGR', 'Sales CAGR', 'Growth Rate', 'Revenue Rate', 'Sales %', 'Revenue growth (%)',
  ])('isRevenueLabel は成長率を売上金額にしない: %s', (label) => {
    expect(isRevenueLabel(label)).toBe(false);
  });

  test.each([
    '営業利益成長率', '営業利益伸び率', '営業利益増加率', 'Operating Income Growth', 'Operating Income CAGR', 'Operating Profit Growth Rate',
  ])('isOperatingIncomeLabel は成長率を営業利益金額にしない: %s', (label) => {
    expect(isOperatingIncomeLabel(label)).toBe(false);
  });
});

describe('金額の表記は成長率の除外で落とさない（表記揺れ）', () => {
  test.each(['売上高', '売上（百万円）', '売上', 'Revenue', 'Sales', 'Total Sales', 'Net Sales', 'sales_revenue', '営業収益'])(
    'isRevenueLabel は売上金額を認める: %s',
    (label) => {
      expect(isRevenueLabel(label)).toBe(true);
    }
  );

  test.each(['営業利益', '営業利益（百万円）', 'Operating Income', 'Operating Profit', 'operating_profit'])(
    'isOperatingIncomeLabel は営業利益金額を認める: %s',
    (label) => {
      expect(isOperatingIncomeLabel(label)).toBe(true);
    }
  );
});
