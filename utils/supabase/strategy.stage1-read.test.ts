import { buildStateFromDbRow } from './strategy';
import { computeStage1ValueAnalysis } from '@/utils/valueAnalysis';

describe('STAGE1 5指標の入力は、DB の行から復元される', () => {
  it('finance_pl・csv の financeBS・pbr_manual・stage1_benchmarks から同じ 5 指標を算出できる', () => {
    const row = {
      id: 'strategy-a',
      company_id: 'company-a',
      finance_pl: [
        { year: 2021, revenue: 1_000_000_000, operatingIncome: 50_000_000 },
        { year: 2022, revenue: 1_100_000_000, operatingIncome: 66_000_000 },
        { year: 2023, revenue: 1_210_000_000, operatingIncome: 84_700_000 },
        { year: 2024, revenue: 1_331_000_000, operatingIncome: 106_480_000 },
      ],
      csv_finance_data: {
        financeBS: [{ year: 2024, netAssets: 500_000_000, interestBearingDebt: 200_000_000 }],
      },
      pbr_manual: '1.5',
      stage1_benchmarks: { waccManual: 8 },
    };

    const state = buildStateFromDbRow(row) as any;
    expect(state.financePL).toHaveLength(4);
    expect(state.financeBS).toHaveLength(1);
    expect(state.pbrManual).toBe('1.5');
    expect(state.stage1Benchmarks?.waccManual).toBe(8);

    const { company } = computeStage1ValueAnalysis({
      financePL: state.financePL,
      financeBS: state.financeBS,
      financeSummary: state.financeSummary,
      segmentPL: state.segmentPL,
      segmentBS: state.segmentBS,
      pbrManual: state.pbrManual,
    });
    expect(company.revenueCagrPct).toBeCloseTo(10, 6);
    expect(company.operatingMarginPctLatest).toBeCloseTo(8, 6);
    expect(company.roic).toBeCloseTo(10.648, 6);
    expect(company.pbr).toBe(1.5);
  });
});
