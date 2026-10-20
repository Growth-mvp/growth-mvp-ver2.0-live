import { normalizeStrategyData } from '@/utils/supabase/normalize';
import { FINANCE_PLAN_CALC_VERSION, buildStoredFinancePlan, readStoredFinancePlan } from './financePlanSnapshot';

const domain = {
  assumptions: {
    minCashYen: 200_000_000,
    taxRate: 0.3,
    depreciationYen: null,
    arRatio: null,
    inventoryRatio: null,
    apRatio: null,
    targetRevenueYen: null,
    targetOperatingIncomeYen: null,
    targetYear: null,
  },
  existingLoans: [],
  newLoans: [],
  dividendsYen: { 2026: 0 },
};

describe('保存データの読み込み時の保持（既存の保存経路）', () => {
  it('csv_finance_dataの既存の財務キーと、financePlanAssumptionsの両方が読み込み後も残る', () => {
    const stored = buildStoredFinancePlan({
      domain,
      companyId: 'company-A',
      meta: {
        calcVersion: FINANCE_PLAN_CALC_VERSION,
        companyId: 'company-A',
        baseYear: 2025,
        bsBaseYear: 2025,
        assumptionsHash: 'x',
        sourceHash: 'y',
        unconfirmed: { unapprovedReadyYen: 0, unclassifiedYen: 0, unscheduledYen: 0, candidateYen: 0, basisPendingYen: 0 },
        computedAt: '2026-10-20T00:00:00.000Z',
      },
      savedAt: '2026-10-20T00:00:00.000Z',
    });
    const row = JSON.parse(
      JSON.stringify({
        strategyId: 's1',
        companyId: 'company-A',
        csvFinanceData: { financeBS: [{ year: 2025, cash: 1 }], segmentPL: {}, financePlanAssumptions: stored },
      }),
    );
    const out = normalizeStrategyData(row) as unknown as { csvFinanceData: Record<string, unknown> };
    expect(out.csvFinanceData.financeBS).toEqual([{ year: 2025, cash: 1 }]);
    const read = readStoredFinancePlan(out.csvFinanceData.financePlanAssumptions, 'company-A');
    expect(read.kind).toBe('OK');
  });

  it('保存データがない古いcsv_finance_dataは従来どおり読み込まれる', () => {
    const out = normalizeStrategyData({ csvFinanceData: { financeBS: [] } }) as unknown as { csvFinanceData: Record<string, unknown> };
    expect(out.csvFinanceData.financePlanAssumptions).toBeUndefined();
    expect(readStoredFinancePlan(undefined, 'company-A').kind).toBe('NONE');
  });
});
