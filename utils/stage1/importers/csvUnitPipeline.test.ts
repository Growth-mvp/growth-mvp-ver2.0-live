/* eslint-disable @typescript-eslint/no-explicit-any -- テストのモックとテストデータは型を緩くしている */
jest.mock('server-only', () => ({}));

import { buildCandidatesFromTable } from './candidateBuilder';
import type { ExtractedTable } from './excelCsvImporter';
import { resolveCandidatesToYen } from '@/utils/finance/financeInputUnits';
import { formatMillionYen } from '@/lib/plans/bankFinancialFormat';
import { buildFinanceCsvUnitMeta, buildStateFromDbRow } from '@/utils/supabase/strategy';
import { buildCashFlowPlan } from '@/utils/stage6/cashflow';

function csvTable(sheetName: string, revenue: number): ExtractedTable {
  return {
    sheetName,
    headers: ['項目名', '2024'],
    rows: [{ '項目名': '売上高', '2024': revenue }],
    sourceRef: 'upload.csv',
  } as unknown as ExtractedTable;
}

/** 取込→円への換算→保存形式（版数・入力単位つき）→復元までを通す */
function importAndRestore(sheetName: string, revenue: number) {
  const candidates = buildCandidatesFromTable(csvTable(sheetName, revenue));
  const { candidates: yen, unresolvedCount } = resolveCandidatesToYen(candidates as any[], {
    'upload.csv': candidates[0] && (candidates[0] as any).sheetUnit,
  });
  expect(unresolvedCount).toBe(0);
  const fields = (yen[0] as any).fields as { revenue: number };
  const savedFinancePL = [{ year: 2024, revenue: fields.revenue }];
  const csvFinanceData = buildFinanceCsvUnitMeta({
    financeInputUnit: (candidates[0] as any).sheetUnit,
    financeUnitConfirmed: { pl: [2024] },
  });
  const restored = buildStateFromDbRow({ finance_pl: savedFinancePL, csv_finance_data: csvFinanceData }) as any;
  return { revenueYen: restored.financePL[0].revenue as number, restored, csvFinanceData };
}

describe('CSV取込 → 円へ換算 → 保存 → F5復元（円の一貫性）', () => {
  it('円建てCSVの売上（50万円）は、100万倍されず50万円のまま復元される', () => {
    expect(importAndRestore('全社PL（単位：円）', 500_000).revenueYen).toBe(500_000);
  });

  it('千円建てCSVの売上（5,000千円＝500万円）は、5,000,000円として復元される', () => {
    expect(importAndRestore('全社PL（単位：千円）', 5_000).revenueYen).toBe(5_000_000);
  });

  it('百万円建てCSVの売上（5百万円）は、5,000,000円として復元される', () => {
    expect(importAndRestore('全社PL（単位：百万円）', 5).revenueYen).toBe(5_000_000);
  });

  it('円・千円・百万円で同じ金額を取り込むと、復元後の金額は一致する', () => {
    const yen = importAndRestore('全社PL（単位：円）', 5_000_000).revenueYen;
    const thousand = importAndRestore('全社PL（単位：千円）', 5_000).revenueYen;
    const million = importAndRestore('全社PL（単位：百万円）', 5).revenueYen;
    expect([yen, thousand, million]).toEqual([5_000_000, 5_000_000, 5_000_000]);
  });

  it('再読込（F5）を繰り返しても、金額は変わらない（二重換算しない）', () => {
    const first = importAndRestore('全社PL（単位：千円）', 5_000);
    const again = buildStateFromDbRow({
      finance_pl: first.restored.financePL,
      csv_finance_data: first.csvFinanceData,
    }) as any;
    expect(again.financePL[0].revenue).toBe(5_000_000);
  });

  it('復元後の金額を計画書の百万円表示にすると、同じ金額（5百万円）になる', () => {
    expect(formatMillionYen(importAndRestore('全社PL（単位：千円）', 5_000).revenueYen)).toBe('5.0');
  });

  it('単位が確定していない取込は、金額を保存せず未確定として数える', () => {
    const candidates = buildCandidatesFromTable(csvTable('全社PL', 5_000));
    const { candidates: yen, unresolvedCount } = resolveCandidatesToYen(candidates as any[], {});
    expect(unresolvedCount).toBe(1);
    expect((yen[0] as any).fields).toEqual({});
  });
});

describe('復元後の財務値はSTAGE6の運転資金計算で円同士で比較される', () => {
  it('売上（円）と売掛金（円）の比率が 0.15（売掛金÷売上）になる', () => {
    const restored = buildStateFromDbRow({
      finance_pl: [{ year: 2025, revenue: 1_000_000_000, operatingIncome: 100_000_000, interest: 5_000_000, tax: 28_500_000, netIncome: 66_500_000, depreciation: 20_000_000 }],
      csv_finance_data: {
        ...buildFinanceCsvUnitMeta({ financeInputUnit: 'million_yen', financeUnitConfirmed: { pl: [2025] } }),
        financeBS: [{ year: 2025, cash: 300_000_000, ar: 150_000_000, inventory: 80_000_000, ap: 90_000_000 }],
      },
    }) as any;
    const plan = buildCashFlowPlan(
      {
        financePL: restored.financePL,
        financeBS: restored.financeBS,
        investment: { yearlyByCategory: [], unclassifiedYen: 0, unscheduledYen: 0, candidateYen: 0, basisPendingYen: 0 },
        assumptions: {
          minCashYen: null, taxRate: 0.3, depreciationYen: null, arRatio: null, inventoryRatio: null,
          apRatio: null, targetRevenueYen: null, targetOperatingIncomeYen: null, targetYear: null,
        },
        horizonYears: 3,
      },
      2026,
    );
    const history = plan.historicalWorkingCapital.find((h) => h.year === 2025);
    expect(history?.ar).toBeCloseTo(0.15, 6);
  });
});
