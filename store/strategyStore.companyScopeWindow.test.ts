/* 企業切替の途中で、パネルが送信時に読む状態（userStore の companyId と strategyStore の strategyId）がどう見えるかを確認する。 */

export {};

const mockUser: { user: { id: string } | null; companyId: string | null; membershipVerified: boolean } = {
  user: { id: 'user-1' },
  companyId: null,
  membershipVerified: true,
};
const mockFetchByCompany = jest.fn<any, any[]>();
const mockSave = jest.fn<any, any[]>(async () => ({ ok: true }));

jest.mock('./userStore', () => ({
  useUserStore: {
    getState: () => mockUser,
    subscribe: () => () => {},
  },
}));

jest.mock('@/utils/supabase/client', () => ({
  ...jest.requireActual('@/utils/supabase/client'),
  safeGetSession: async () => ({ error: null, data: { session: { user: { id: 'user-1' } } } }),
}));

jest.mock('@/utils/supabase/strategy', () => {
  const actual = jest.requireActual('@/utils/supabase/strategy');
  return {
    getFullStrategyDataByCompany: (...args: any[]) => mockFetchByCompany(...args),
    saveStrategyData: (...args: any[]) => mockSave(...args),
    buildStateFromDbRow: actual.buildStateFromDbRow,
    buildFinanceCsvUnitMeta: actual.buildFinanceCsvUnitMeta,
    countTotalProjects: () => 0,
    getFullStrategyDataByStrategyId: jest.fn(async () => {
      throw new Error('unexpected call: getFullStrategyDataByStrategyId');
    }),
    deleteStrategyData: jest.fn(async () => {
      throw new Error('unexpected call: deleteStrategyData');
    }),
  };
});

import { useStrategyStore } from './strategyStore';

const COMPANY_A = '11111111-1111-4111-8111-111111111111';
const COMPANY_B = '22222222-2222-4222-8222-222222222222';
const STRATEGY_OF_A = '33333333-3333-4333-8333-333333333333';

const get = () => useStrategyStore.getState() as any;

beforeEach(() => {
  jest.clearAllMocks();
  mockUser.companyId = COMPANY_A;
  useStrategyStore.setState({
    companyId: COMPANY_A,
    pendingCompanyId: undefined,
    strategyId: STRATEGY_OF_A,
    dirty: false,
  } as any);
});

describe('企業切替の途中でパネルが読む状態', () => {
  it('【現状再現】userStore が B に変わった直後、strategyStore はまだ A の companyId と strategyId を持つ', () => {
    mockUser.companyId = COMPANY_B;

    const panelCompanyId = mockUser.companyId;
    const sentStrategyId = get().strategyId;

    expect(panelCompanyId).toBe(COMPANY_B);
    expect(get().companyId).toBe(COMPANY_A);
    expect(sentStrategyId).toBe(STRATEGY_OF_A);
  });

  it('【現状】setCompanyScope(B) の後は strategyId が消えるため、strategyId == null のパネルは送信しない', () => {
    mockUser.companyId = COMPANY_B;
    get().setCompanyScope(COMPANY_B);

    expect(get().strategyId).toBeUndefined();
    expect(get().pendingCompanyId).toBe(COMPANY_B);
    expect(get().restoreReady).toBe(false);
  });

  it('【現状】同じ企業への setCompanyScope は strategyId を消さない', () => {
    get().setCompanyScope(COMPANY_A);

    expect(get().strategyId).toBe(STRATEGY_OF_A);
  });
});
