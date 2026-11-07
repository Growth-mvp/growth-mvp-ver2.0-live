/* revision 不明（REVISION_UNKNOWN）の保存拒否が、利用者に分かる状態として残り、再操作で解消されることを検証する。
 * 保存の通信（saveWithAudit）と会社・セッションだけをモックする。 */

export {};

const mockUser: { user: { id: string } | null; companyId: string | null; membershipVerified: boolean } = {
  user: { id: 'user-1' },
  companyId: null,
  membershipVerified: true,
};

jest.mock('./userStore', () => ({
  useUserStore: {
    getState: () => mockUser,
    subscribe: () => () => {},
  },
}));

jest.mock('@/utils/supabase/strategy', () => {
  const actual = jest.requireActual('@/utils/supabase/strategy');
  return {
    getFullStrategyDataByCompany: jest.fn(async () => ({ data: null, error: null })),
    saveStrategyData: jest.fn(async () => ({ data: null, error: null })),
    buildStateFromDbRow: actual.buildStateFromDbRow,
    buildFinanceCsvUnitMeta: actual.buildFinanceCsvUnitMeta,
    countTotalProjects: (depts: any[]) =>
      (depts ?? []).reduce((n: number, d: any) => n + (d?.projects ?? []).length, 0),
    getFullStrategyDataByStrategyId: jest.fn(async () => {
      throw new Error('unexpected call: getFullStrategyDataByStrategyId');
    }),
    deleteStrategyData: jest.fn(async () => {
      throw new Error('unexpected call: deleteStrategyData');
    }),
  };
});

jest.mock('@/utils/supabase/client', () => ({
  safeGetSession: async () => ({ data: { session: { user: { id: 'user-1' } } }, error: null }),
  getCompanyIdFromCookie: () => null,
  setCompanyIdCookie: () => {},
  isValidUUID: (v: unknown) => typeof v === 'string' && /^[0-9a-f-]{36}$/i.test(v),
}));

jest.mock('@/utils/persist/saveWithAudit', () => ({
  saveWithAudit: jest.fn(async () => ({ data: null, error: null })),
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

/* eslint-disable @typescript-eslint/no-require-imports */
const { saveWithAudit } = require('@/utils/persist/saveWithAudit') as { saveWithAudit: jest.Mock };
/* eslint-enable @typescript-eslint/no-require-imports */

const COMPANY_A = 'a1000000-0000-4000-8000-000000000001';
const COMPANY_B = 'b1000000-0000-4000-8000-000000000002';
const REVISION_UNKNOWN_MESSAGE =
  'データの確認が完了していないため、保存できませんでした。未保存の入力内容は、再読み込みすると失われる可能性があります。必要な内容を控えてから再読み込みしてください。';

function loadStore(): typeof import('./strategyStore') {
  let mod!: typeof import('./strategyStore');
  jest.isolateModules(() => {
    mod = require('./strategyStore') as typeof import('./strategyStore');
  });
  return mod;
}

function readyStore(store: typeof import('./strategyStore')) {
  store.useStrategyStore.setState({
    companyId: COMPANY_A,
    strategyId: null,
    revision: undefined,
    hydrated: true,
    restoreReady: true,
    isRestoring: false,
    companyName: 'テスト株式会社',
    departments: [{ name: '営業部', projects: [{ title: 'P1' }] }],
  } as any);
}

describe('revision 不明の保存は、保存されなかったことを利用者に伝え、再読み込み後に保存できる', () => {
  beforeEach(() => {
    memoryStorage.clear();
    saveWithAudit.mockReset();
    saveWithAudit.mockResolvedValue({ data: null, error: null });
  });

  it('REVISION_UNKNOWN を受けた保存は、再試行や競合の調停をせず、案内文を saveError に残す', async () => {
    const store = loadStore();
    readyStore(store);
    saveWithAudit.mockResolvedValueOnce({
      data: null,
      error: { status: 409, code: 'REVISION_UNKNOWN', message: REVISION_UNKNOWN_MESSAGE },
    });

    const result: any = await store.useStrategyStore.getState().saveStrategyData({ reason: 'manual', force: true });

    expect(result.ok).toBe(false);
    expect(result.reason).toBe('revision_unknown');
    expect(result.code).toBe('REVISION_UNKNOWN');
    expect(saveWithAudit).toHaveBeenCalledTimes(1);
    expect(store.useStrategyStore.getState().saveError).toBe(REVISION_UNKNOWN_MESSAGE);
  });

  it('再読み込みで revision が入った後の保存は成功し、案内文の saveError を消す（再操作できる）', async () => {
    const store = loadStore();
    readyStore(store);
    saveWithAudit.mockResolvedValueOnce({
      data: null,
      error: { status: 409, code: 'REVISION_UNKNOWN', message: REVISION_UNKNOWN_MESSAGE },
    });
    await store.useStrategyStore.getState().saveStrategyData({ reason: 'manual', force: true });

    store.useStrategyStore.setState({ revision: 5 } as any);
    saveWithAudit.mockResolvedValueOnce({ data: { revision: 6, id: 'S-1', companyId: COMPANY_A }, error: null });
    const result: any = await store.useStrategyStore.getState().saveStrategyData({ reason: 'manual', force: true });

    expect({ reason: result.reason, ok: result.ok }).toEqual({ reason: undefined, ok: true });
    expect(store.useStrategyStore.getState().saveError).toBeUndefined();
  });

  it('企業切替中は、revision に関係なく保存を開始せず、通信もしない', async () => {
    const store = loadStore();
    readyStore(store);
    store.useStrategyStore.setState({ pendingCompanyId: COMPANY_B } as any);

    const result: any = await store.useStrategyStore.getState().saveStrategyData({ reason: 'manual', force: true });

    expect(result.reason).toBe('company_switching');
    expect(saveWithAudit).not.toHaveBeenCalled();
  });

  it('読込が終わっていない（restoreReady が無い）通常保存は、通信せず拒否する', async () => {
    const store = loadStore();
    readyStore(store);
    store.useStrategyStore.setState({ restoreReady: false, revision: 5 } as any);

    const result: any = await store.useStrategyStore.getState().saveStrategyData({ reason: 'autosave' });

    expect(result.reason).toBe('restore_not_ready');
    expect(saveWithAudit).not.toHaveBeenCalled();
  });
});
