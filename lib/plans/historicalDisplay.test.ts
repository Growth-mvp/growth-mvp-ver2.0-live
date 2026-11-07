import type { FinancePLRow } from '@/types/strategy';
import { buildPlanData } from '@/utils/export/buildPlanData';
import { formatMillionYen } from './bankFinancialFormat';
import { formatHistoricalAmount, historicalUnitLabel } from './historicalDisplay';

describe('過去実績の円と百万円の表示', () => {
  it('円で確認済みの年度は百万円に換算し、3桁区切りで表示する', () => {
    expect(formatHistoricalAmount(107_222_000_000, '円')).toBe('107,222.0');
    expect(formatHistoricalAmount(8_358_000_000, '円')).toBe('8,358.0');
    expect(formatHistoricalAmount(1_234_000, '円')).toBe('1.2');
  });

  it('負の数と0は符号と値を保つ', () => {
    expect(formatHistoricalAmount(-4_055_200_000, '円')).toBe('-4,055.2');
    expect(formatHistoricalAmount(0, '円')).toBe('0.0');
  });

  it('単位が未確認の年度は換算せず、元の数値をそのまま表示する（カンマのみ追加）', () => {
    expect(formatHistoricalAmount(107_222_000_000, '未確認')).toBe('107,222,000,000');
    expect(formatHistoricalAmount(107_222_000_000, undefined)).toBe('107,222,000,000');
  });

  it('値がない項目は「-」と表示する', () => {
    expect(formatHistoricalAmount(undefined, '円')).toBe('-');
    expect(formatHistoricalAmount(null, '円')).toBe('-');
  });

  it('円からの換算は、銀行向けの金額表示（百万円）と同じ値になる', () => {
    for (const yen of [107_222_000_000, 8_358_000_000, -4_055_200_000]) {
      expect(formatHistoricalAmount(yen, '円')).toBe(formatMillionYen(yen));
    }
  });

  it('単位の表示は、確認済みを百万円、それ以外を未確認とする', () => {
    expect(historicalUnitLabel('円')).toBe('百万円');
    expect(historicalUnitLabel('未確認')).toBe('未確認');
    expect(historicalUnitLabel(undefined)).toBe('未確認');
  });
});

describe('過去実績の単位の判定（保存された確認記録）', () => {
  const financePL = [
    { year: 2024, revenue: 1_000_000_000, operatingIncome: 80_000_000 },
    { year: 2025, revenue: 1_100_000_000, operatingIncome: 90_000_000 },
  ] as FinancePLRow[];

  it('利用者が円で確認した年度だけ単位を「円」とする', () => {
    const plan = buildPlanData(
      { companyName: 'テスト株式会社', departments: [], financePL, financeUnitConfirmed: { pl: [2025] } } as never,
      'shareholder',
    );
    const byYear = new Map(plan.stage1.historicalFinances!.map((f) => [f.year, f]));
    expect(byYear.get(2025)!.unit).toBe('円');
    expect(byYear.get(2025)!.warning).toBeUndefined();
    expect(byYear.get(2024)!.unit).toBe('未確認');
    expect(byYear.get(2024)!.warning).toContain('保存単位が確定されていません');
  });

  it('確認記録がなければ、すべての年度を単位未確認のままにする', () => {
    const plan = buildPlanData({ companyName: 'テスト株式会社', departments: [], financePL } as never, 'bank');
    expect(plan.stage1.historicalFinances!.every((f) => f.unit === '未確認')).toBe(true);
  });

  it('元の数値は確認済みの年度でも変更しない', () => {
    const plan = buildPlanData(
      { companyName: 'テスト株式会社', departments: [], financePL, financeUnitConfirmed: { pl: [2025] } } as never,
      'shareholder',
    );
    const row = plan.stage1.historicalFinances!.find((f) => f.year === 2025)!;
    expect(row.revenue).toBe(1_100_000_000);
  });
});
