/* eslint-disable @typescript-eslint/no-explicit-any -- テストのモックとテストデータは型を緩くしている */
jest.mock('server-only', () => ({}));

import { buildCandidatesFromTable } from './candidateBuilder';
import type { ExtractedTable } from './excelCsvImporter';
import { nonYenUnitsBySource, sourcesWithoutUnitNotation } from '@/utils/finance/financeInputUnits';
import { formatMillionYen } from '@/lib/plans/bankFinancialFormat';
import { buildFinanceCsvUnitMeta, buildStateFromDbRow } from '@/utils/supabase/strategy';
import { buildCashFlowPlan } from '@/utils/stage6/cashflow';

const SOURCE = 'upload.csv';

function csvTable(sheetName: string, revenue: number): ExtractedTable {
  return {
    sheetName,
    headers: ['項目名', '2024'],
    rows: [{ '項目名': '売上高', '2024': revenue }],
    sourceRef: SOURCE,
  } as unknown as ExtractedTable;
}

/** 取込 → 円のまま保存 → 再読込（F5）までを通す。取込元の確認は利用者が行ったものとして扱う */
function importAndRestore(sheetName: string, revenue: number) {
  const candidates = buildCandidatesFromTable(csvTable(sheetName, revenue));
  const savedFinancePL = [{ year: 2024, revenue: (candidates[0] as any).fields.revenue as number }];
  const csvFinanceData = buildFinanceCsvUnitMeta({ financeUnitConfirmed: { pl: [2024] } });
  const restored = buildStateFromDbRow({ finance_pl: savedFinancePL, csv_finance_data: csvFinanceData }) as any;
  return { revenueYen: restored.financePL[0].revenue as number, restored, csvFinanceData };
}

describe('CSV取込の単位（円以外は取込を止め、円の金額は保存・再読込で変えない）', () => {
  it('円以外の単位（千円）が明示された資料は、取込を止める対象になる', () => {
    const candidates = buildCandidatesFromTable(csvTable('全社PL（単位：千円）', 5_000));
    expect(nonYenUnitsBySource(candidates as any[])).toEqual({ [SOURCE]: ['千円'] });
    expect(sourcesWithoutUnitNotation(candidates as any[])).toEqual([]);
  });

  it('円以外の単位が明示されていない資料は、円であることを利用者に確認させる対象になる', () => {
    const candidates = buildCandidatesFromTable(csvTable('全社PL', 5_000_000));
    expect(nonYenUnitsBySource(candidates as any[])).toEqual({});
    expect(sourcesWithoutUnitNotation(candidates as any[])).toEqual([SOURCE]);
  });

  it('円建ての少額（50万円）は100万倍されず、50万円のまま復元される', () => {
    expect(importAndRestore('全社PL（円）', 500_000).revenueYen).toBe(500_000);
  });

  it('再読込（F5）を繰り返しても、円の金額は変わらない（二重換算しない）', () => {
    const first = importAndRestore('全社PL', 5_000_000);
    const again = buildStateFromDbRow({
      finance_pl: first.restored.financePL,
      csv_finance_data: first.csvFinanceData,
    }) as any;
    expect(again.financePL[0].revenue).toBe(5_000_000);
  });

  it('復元後の円の金額を計画書の百万円表示にすると、同じ金額（5百万円）になる', () => {
    expect(formatMillionYen(importAndRestore('全社PL', 5_000_000).revenueYen)).toBe('5.0');
  });
});

describe('復元後の財務値はSTAGE6の運転資金計算で円同士で比較される', () => {
  it('売上（円）と売掛金（円）の比率が 0.15（売掛金÷売上）になる', () => {
    const restored = buildStateFromDbRow({
      finance_pl: [{ year: 2025, revenue: 1_000_000_000, operatingIncome: 100_000_000, interest: 5_000_000, tax: 28_500_000, netIncome: 66_500_000, depreciation: 20_000_000 }],
      csv_finance_data: {
        ...buildFinanceCsvUnitMeta({ financeUnitConfirmed: { pl: [2025] } }),
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
