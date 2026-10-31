/* 事業セグメントの主な事業展開地域が、追加・削除・名称変更の後も他の事業に残ることをストア実体で確認する。Supabase 通信のみモック。 */
/* eslint-disable @typescript-eslint/no-explicit-any -- テストデータは型を緩くしている */
export {};

jest.mock('./userStore', () => ({
  useUserStore: {
    getState: () => ({ user: null, companyId: null, membershipVerified: false }),
    subscribe: () => () => {},
  },
}));

jest.mock('@/utils/supabase/strategy', () => {
  const actual = jest.requireActual('@/utils/supabase/strategy');
  return {
    ...actual,
    getFullStrategyDataByCompany: jest.fn(async () => ({ data: null, error: null })),
    saveStrategyData: jest.fn(async () => ({ ok: true })),
  };
});

jest.mock('@/utils/supabase/client', () => ({
  safeGetSession: async () => ({ data: { session: null }, error: null }),
  getCompanyIdFromCookie: () => null,
  setCompanyIdCookie: () => {},
  isValidUUID: () => false,
}));

jest.mock('@/utils/persist/saveWithAudit', () => ({
  saveWithAudit: jest.fn(async () => ({ ok: true })),
}));

const memoryStorage = new Map<string, string>();
Object.defineProperty(globalThis, 'localStorage', {
  configurable: true,
  value: {
    getItem: (k: string) => memoryStorage.get(k) ?? null,
    setItem: (k: string, v: string) => {
      memoryStorage.set(k, v);
    },
    removeItem: (k: string) => {
      memoryStorage.delete(k);
    },
    clear: () => memoryStorage.clear(),
    key: () => null,
    length: 0,
  },
});

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { useStrategyStore } = require('./strategyStore') as typeof import('./strategyStore');

const SEG_DOMESTIC = { id: 'seg-a', name: 'A事業', expansionScope: 'domestic' };
const SEG_OVERSEAS = { id: 'seg-b', name: 'B事業', expansionScope: 'overseas', overseasRegionsNote: 'ベトナム' };
const SEG_UNSET = { id: 'seg-c', name: 'C事業' };

const store = () => useStrategyStore.getState() as any;

beforeEach(() => {
  useStrategyStore.setState({
    businessSegments: [SEG_DOMESTIC, SEG_OVERSEAS, SEG_UNSET],
    segmentPL: { A事業: [], B事業: [], C事業: [] },
    segmentBS: { A事業: [], B事業: [], C事業: [] },
    financeUnitConfirmed: { pl: [], bs: false, segmentPL: [], segmentBS: [] },
    financeInputUnit: 'yen',
  } as any);
});

describe('事業展開地域は追加・削除・名称変更で他の事業に影響しない', () => {
  it('名称変更では、対象の事業の地域設定を変えつつ、他の事業の設定を保つ', () => {
    const next = store().businessSegments.map((s: any) => (s.id === 'seg-b' ? { ...s, name: 'B事業（改称）' } : s));
    store().setProfile({ businessSegments: next });

    const byId = Object.fromEntries(store().businessSegments.map((s: any) => [s.id, s]));
    expect(byId['seg-b']).toMatchObject({ name: 'B事業（改称）', expansionScope: 'overseas', overseasRegionsNote: 'ベトナム' });
    expect(byId['seg-a'].expansionScope).toBe('domestic');
    expect(byId['seg-c'].expansionScope).toBeUndefined();
  });

  it('追加では、既存の事業の地域設定と未指定の状態を保つ', () => {
    store().setProfile({ businessSegments: [...store().businessSegments, { id: 'seg-d', name: 'D事業' }] });

    const byId = Object.fromEntries(store().businessSegments.map((s: any) => [s.id, s]));
    expect(byId['seg-a'].expansionScope).toBe('domestic');
    expect(byId['seg-b'].overseasRegionsNote).toBe('ベトナム');
    expect('expansionScope' in byId['seg-c']).toBe(false);
    expect(byId['seg-d'].expansionScope).toBeUndefined();
  });

  it('削除では、残った事業の地域設定を保つ', () => {
    store().setProfile({ businessSegments: store().businessSegments.filter((s: any) => s.id !== 'seg-a') });

    const byId = Object.fromEntries(store().businessSegments.map((s: any) => [s.id, s]));
    expect(Object.keys(byId)).toEqual(['seg-b', 'seg-c']);
    expect(byId['seg-b']).toMatchObject({ expansionScope: 'overseas', overseasRegionsNote: 'ベトナム' });
  });
});
