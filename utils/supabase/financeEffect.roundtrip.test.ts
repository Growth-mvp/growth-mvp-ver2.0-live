import { buildDbRowFromState, buildStateFromDbRow } from './strategy';
import { buildStoredFinancePlan, readStoredFinancePlan, type CalcSnapshotMeta, type FinancePlanDomain } from '@/utils/stage6/financePlanSnapshot';
import { guardFinanceEffectConfirmation } from '@/lib/financeEffect';

const M = 1_000_000;

const meta = {
  calcVersion: 'phase4a-v1',
  companyId: 'c1',
  baseYear: 2024,
  bsBaseYear: 2024,
  assumptionsHash: 'h',
  sourceHash: 'h',
  unconfirmed: { unapprovedReadyYen: 0, unclassifiedYen: 0, unscheduledYen: 0, candidateYen: 0, basisPendingYen: 0 },
  computedAt: '2026-11-01T00:00:00.000Z',
} as CalcSnapshotMeta;

const domain: FinancePlanDomain = {
  assumptions: {
    minCashYen: 50 * M,
    taxRate: 0.3,
    depreciationYen: null,
    arRatio: null,
    inventoryRatio: null,
    apRatio: null,
    targetRevenueYen: 1_200 * M,
    targetOperatingIncomeYen: null,
    targetYear: 2027,
    baseScenario: {
      2026: { revenueYen: 20 * M, operatingIncomeYen: null },
      2027: { revenueYen: null, operatingIncomeYen: -5 * M },
    },
  },
  existingLoans: [],
  newLoans: [],
  dividendsYen: {},
};

const roundTrip = (state: unknown) => buildStateFromDbRow(JSON.parse(JSON.stringify(buildDbRowFromState(state as never)))) as any;

describe('財務効果の候補・営業利益の増分・既存事業の増減は、保存→読込で保持される', () => {
  it('旧見込みから作った未確認の候補は、未確認のまま、金額・営業利益の入力が残る', () => {
    const candidate = guardFinanceEffectConfirmation(undefined, {
      kind: 'REVENUE_UP',
      method: 'DIRECT_AMOUNT',
      directAmountYen: 60 * M,
      operatingIncomeEffectYen: 10 * M,
      source: 'USER_INPUT',
      confirmed: false,
    });
    const before = { departments: [{ id: 'd', name: '営業部', projects: [{ id: 'p', title: '新規開拓', financeEffect: candidate }] }] };
    const after = roundTrip(before);
    const p = after.departments[0].projects[0];
    expect(p.financeEffect).toMatchObject({ kind: 'REVENUE_UP', directAmountYen: 60 * M, operatingIncomeEffectYen: 10 * M, confirmed: false });
  });

  it('既存事業の年度別増減（直近実績比）と経営目標は、保存された前提として読み戻せる', () => {
    const stored = JSON.parse(JSON.stringify(buildStoredFinancePlan({ domain, companyId: 'c1', meta, savedAt: '2026-11-01T00:00:00.000Z' })));
    const before = { csvFinanceData: { financePlanAssumptions: stored }, departments: [] };
    const after = roundTrip(before);
    const read = readStoredFinancePlan(after.csvFinanceData.financePlanAssumptions, 'c1');
    expect(read.kind).toBe('OK');
    if (read.kind !== 'OK') return;
    expect(read.domain.assumptions.baseScenario).toEqual(domain.assumptions.baseScenario);
    expect(read.domain.assumptions.targetYear).toBe(2027);
  });
});
