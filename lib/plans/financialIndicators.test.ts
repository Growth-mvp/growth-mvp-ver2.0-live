import type { FinanceBSRow, FinancePLRow } from '@/types/strategy';
import { buildFinancialIndicatorBlock } from './financialIndicators';

const financePL: FinancePLRow[] = [
  { year: 2024, revenue: 1_000_000_000, operatingIncome: 80_000_000, netIncome: 50_000_000, depreciation: 20_000_000, interest: 5_000_000, tax: 15_000_000 },
  { year: 2025, revenue: 1_100_000_000, operatingIncome: 90_000_000, netIncome: 55_000_000, depreciation: 20_000_000, interest: 5_000_000, tax: 16_000_000 },
] as FinancePLRow[];

const financeBS: FinanceBSRow[] = [
  { year: 2025, cash: 100_000_000, ar: 150_000_000, inventory: 80_000_000, ap: 60_000_000, interestBearingDebt: 300_000_000 },
] as FinanceBSRow[];

describe('株主向けの財務指標ブロック', () => {
  it('入力が何もなければ空文字を返す', () => {
    expect(buildFinancialIndicatorBlock({})).toBe('');
  });

  it('上場区分が未入力のときは「未入力」と示し、PBRを出さない', () => {
    const block = buildFinancialIndicatorBlock({ financePL, financeBS });
    expect(block).toContain('【財務指標（現状分析の計算値）】');
    expect(block).toContain('上場区分：未入力');
    expect(block).not.toContain('PBR');
  });

  it('非上場の企業にはPBRを出さない', () => {
    const block = buildFinancialIndicatorBlock({ financePL, financeBS, isListed: false, pbrManual: '1.2' });
    expect(block).toContain('上場区分：非上場');
    expect(block).not.toContain('PBR');
  });

  it('上場企業にはPBRの行を出す', () => {
    const block = buildFinancialIndicatorBlock({ financePL, financeBS, isListed: true, pbrManual: '1.2' });
    expect(block).toContain('上場区分：上場');
    expect(block).toContain('PBR（株価純資産倍率）：');
  });

  it('経営者が入力したWACCをそのまま示す', () => {
    const block = buildFinancialIndicatorBlock({ financePL, financeBS, stage1Benchmarks: { waccManual: 6 } });
    expect(block).toContain('WACC（資本コスト・経営者の入力値）：6.0%');
  });

  it('計算できない指標は未算出と示し、数値を補わない', () => {
    const block = buildFinancialIndicatorBlock({ financePL: [financePL[1]] });
    expect(block).toContain('売上高の年平均成長率（2025年度）：未算出');
    expect(block).toContain('WACC（資本コスト・経営者の入力値）：未算出');
    expect(block).toContain('未算出の指標は未算出と書き、数値を補わないこと');
  });

  it('計算値は既存の計算関数の結果をそのまま使い、期間を年度で示す', () => {
    const block = buildFinancialIndicatorBlock({ financePL, financeBS });
    expect(block).toContain('営業利益率（2025年度）：8.2%');
    expect(block).toContain('売上高の年平均成長率（2024〜2025年度）：10.0%');
  });

  it('PBRは算定できた場合だけ表示する', () => {
    const block = buildFinancialIndicatorBlock({ financePL, financeBS, isListed: true });
    expect(block).not.toContain('PBR（株価純資産倍率）：未算出');
  });
});
