/* 永続化された会社データ（localStorage）が、会社切替・ログアウト後に別会社へ残らないことを確認する。 */

export {};

const mockUser: {
  user: { id: string } | null;
  companyId: string | null;
  membershipVerified: boolean;
  setMembership: (m: { companyId?: string; departmentId?: string }) => void;
} = {
  user: { id: 'user-1' },
  companyId: null,
  membershipVerified: true,
  setMembership: (m) => {
    mockUser.companyId = m.companyId ?? null;
  },
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

const COMPANY_A = '11111111-1111-4111-8111-111111111111';
const COMPANY_B = '22222222-2222-4222-8222-222222222222';
const PERSIST_KEY = 'strategy-store-v5';

const memory = new Map<string, string>();
const memoryStorage = {
  getItem: (k: string) => memory.get(k) ?? null,
  setItem: (k: string, v: string) => {
    memory.set(k, v);
  },
  removeItem: (k: string) => {
    memory.delete(k);
  },
  clear: () => memory.clear(),
  key: (i: number) => Array.from(memory.keys())[i] ?? null,
  get length() {
    return memory.size;
  },
};
(globalThis as any).localStorage = memoryStorage;

let useStore: any;
beforeAll(() => {
  jest.isolateModules(() => {
    useStore = require('./strategyStore').useStrategyStore;
  });
});

const get = () => useStore.getState();
const persistedText = () => memory.get(PERSIST_KEY) ?? '';

function seedPersistedCompanyA() {
  memory.set(
    PERSIST_KEY,
    JSON.stringify({
      state: { companyId: COMPANY_A, companyName: 'A社', pendingCompanyId: undefined },
      version: 40,
    })
  );
}

beforeEach(() => {
  jest.clearAllMocks();
  memory.clear();
  mockUser.companyId = null;
});

describe('R5: 永続化された会社Aのデータが会社Bの画面・保存に残らない', () => {
  it('会社Aの永続値を復元した後に会社Bへ切り替えると、永続領域から会社Aのデータが消える', async () => {
    seedPersistedCompanyA();
    await useStore.persist.rehydrate();

    get().setCompanyScope(COMPANY_B);

    expect(persistedText()).not.toContain('A社');
    expect(persistedText()).not.toContain(COMPANY_A);
  });

  it('会社Aの永続値を復元した後、検証前のリロードでは永続値を消さない（既存データの保全）', async () => {
    seedPersistedCompanyA();
    await useStore.persist.rehydrate();
    await new Promise((r) => setTimeout(r, 0));

    expect(persistedText()).toContain('A社');
  });

  it('復元した会社Aの永続値を持ったままリセットすると、会社Aのデータは永続領域に書き戻されない', async () => {
    seedPersistedCompanyA();
    await useStore.persist.rehydrate();

    get().reset();

    expect(persistedText()).not.toContain('A社');
    expect(persistedText()).not.toContain(COMPANY_A);
  });
});

describe('所属確認前の永続データの保存', () => {
  it('永続化から復元した会社Aのデータは、所属確認の前に force でも保存しない', async () => {
    seedPersistedCompanyA();
    await useStore.persist.rehydrate();
    mockUser.companyId = COMPANY_A;

    const res = await get().saveStrategyData({ force: true, reason: 'test-unverified' });

    expect(res.ok).toBe(false);
    expect(res.reason).toBe('persisted_scope_unverified');
    expect(mockSave).not.toHaveBeenCalled();
  });
});

describe('会社切替途中の非同期応答', () => {
  it('会社Aの読み込みが遅れて届いても、会社Bへ切り替えた後の状態には反映されない', async () => {
    let resolveA!: (v: any) => void;
    mockFetchByCompany.mockReturnValueOnce(new Promise((r) => (resolveA = r)));

    get().setCompanyScope(COMPANY_A);
    const pA = get().refetchOnceFromServer().catch(() => {});
    get().setCompanyScope(COMPANY_B);
    resolveA({ data: { companyId: COMPANY_A, companyName: 'A社', strategyId: 'x' }, error: null });
    await pA;

    expect(get().companyId).not.toBe(COMPANY_A);
    expect(get().companyName).not.toBe('A社');
  });
});
