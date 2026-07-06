/**
 * STAGE6 Baseline 関連の純粋関数テスト
 * - mkBaseFigures と mkBaselineTrajectory が複数キー名に対応しているか確認
 */

import { mkBaseFigures, mkBaselineTrajectory } from './baseline';

describe('STAGE6 Baseline - Multiple Key Name Support', () => {
  // テストデータ: prompt.txt で指定されているデータセット
  const testFinancePL = [
    {
      year: 2023,
      revenue: 28_097_000_000,
      operatingIncome: 987_000_000,
      cogs: 10_000_000_000,
      sga: 5_000_000_000,
    },
    {
      year: 2024,
      revenue: 26_783_000_000,
      operatingIncome: 3_360_000_000,
      cogs: 9_500_000_000,
      sga: 4_800_000_000,
    },
    {
      year: 2025,
      revenue: 32_295_000_000,
      operatingIncome: 3_047_000_000,
      cogs: 11_000_000_000,
      sga: 5_200_000_000,
    },
  ];

  // テストケース1: 標準的なキー名
  describe('Standard key names (revenue, operatingIncome)', () => {
    const state = { financePL: testFinancePL };

    test('mkBaseFigures should pick 2025 (latest year)', () => {
      const result = mkBaseFigures(state);
      expect(result).not.toBeNull();
      expect(result?.revenue).toBe(32_295_000_000);
      expect(result?.operatingIncome).toBe(3_047_000_000);
    });

    test('mkBaselineTrajectory should pick 2025 (latest year)', () => {
      const result = mkBaselineTrajectory(state);
      expect(result).not.toBeNull();
      expect(result?.startYm).toBe('2025-01');
      expect(result?.endYm).toBe('2028-12');
    });
  });

  // テストケース2: 代替キー名（sales, operatingProfit）
  describe('Alternative key names (sales, operatingProfit)', () => {
    const testFinancePLAlt = [
      {
        year: 2023,
        sales: 28_097_000_000,
        operatingProfit: 987_000_000,
        cogs: 10_000_000_000,
        sga: 5_000_000_000,
      },
      {
        year: 2024,
        sales: 26_783_000_000,
        operatingProfit: 3_360_000_000,
        cogs: 9_500_000_000,
        sga: 4_800_000_000,
      },
      {
        year: 2025,
        sales: 32_295_000_000,
        operatingProfit: 3_047_000_000,
        cogs: 11_000_000_000,
        sga: 5_200_000_000,
      },
    ];

    const state = { financePL: testFinancePLAlt };

    test('mkBaseFigures should recognize sales and operatingProfit', () => {
      const result = mkBaseFigures(state);
      expect(result).not.toBeNull();
      expect(result?.revenue).toBe(32_295_000_000);
      expect(result?.operatingIncome).toBe(3_047_000_000);
    });

    test('mkBaselineTrajectory should recognize sales and operatingProfit', () => {
      const result = mkBaselineTrajectory(state);
      expect(result).not.toBeNull();
      // Should successfully create trajectory
      expect(result?.startYm).toBe('2025-01');
    });
  });

  // テストケース3: 日本語キー名
  describe('Japanese key names (売上, 営業利益)', () => {
    const testFinancePLJP = [
      {
        year: 2023,
        '売上': 28_097_000_000,
        '営業利益': 987_000_000,
        cogs: 10_000_000_000,
        sga: 5_000_000_000,
      },
      {
        year: 2024,
        '売上': 26_783_000_000,
        '営業利益': 3_360_000_000,
        cogs: 9_500_000_000,
        sga: 4_800_000_000,
      },
      {
        year: 2025,
        '売上': 32_295_000_000,
        '営業利益': 3_047_000_000,
        cogs: 11_000_000_000,
        sga: 5_200_000_000,
      },
    ];

    const state = { financePL: testFinancePLJP };

    test('mkBaseFigures should recognize Japanese 売上 and 営業利益', () => {
      const result = mkBaseFigures(state);
      expect(result).not.toBeNull();
      expect(result?.revenue).toBe(32_295_000_000);
      expect(result?.operatingIncome).toBe(3_047_000_000);
    });

    test('mkBaselineTrajectory should recognize Japanese key names', () => {
      const result = mkBaselineTrajectory(state);
      expect(result).not.toBeNull();
      expect(result?.startYm).toBe('2025-01');
    });
  });

  // テストケース4: 最新年度選択の確認（営業利益が重要）
  describe('Year selection: Latest valid year (revenue or operatingIncome present)', () => {
    const testFinancePLPartial = [
      {
        year: 2023,
        revenue: 28_097_000_000,
        operatingIncome: 987_000_000,
        cogs: 10_000_000_000,
        sga: 5_000_000_000,
      },
      {
        year: 2024,
        // revenue 無し、operatingIncome のみ
        operatingIncome: 3_360_000_000,
        cogs: 9_500_000_000,
        sga: 4_800_000_000,
      },
      {
        year: 2025,
        revenue: 32_295_000_000,
        operatingIncome: 3_047_000_000,
        cogs: 11_000_000_000,
        sga: 5_200_000_000,
      },
    ];

    const state = { financePL: testFinancePLPartial };

    test('mkBaseFigures should select 2025 even when 2024 has operatingIncome only', () => {
      const result = mkBaseFigures(state);
      expect(result).not.toBeNull();
      expect(result?.revenue).toBe(32_295_000_000);
      expect(result?.operatingIncome).toBe(3_047_000_000);
    });
  });

  // テストケース5: Empty or invalid input
  describe('Edge cases', () => {
    test('mkBaseFigures should return null for empty financePL', () => {
      const result = mkBaseFigures({ financePL: [] });
      expect(result).toBeNull();
    });

    test('mkBaseFigures should return null for no valid rows', () => {
      const result = mkBaseFigures({
        financePL: [
          { year: 2023 },
          { year: 2024 },
        ],
      });
      expect(result).toBeNull();
    });

    test('mkBaselineTrajectory should return null for missing sga/cogs', () => {
      const result = mkBaselineTrajectory({
        financePL: [
          {
            year: 2025,
            revenue: 32_295_000_000,
            operatingIncome: 3_047_000_000,
            // sga と cogs が無い
          },
        ],
      });
      expect(result).toBeNull();
    });
  });
});
