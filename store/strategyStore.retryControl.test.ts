/* 会社ID・セッション不足時の再試行制御を、フェイクタイマーで検証する。Supabase 通信のみモック。 */

export {};

const mockUser: { user: { id: string } | null; companyId: string | null; membershipVerified: boolean } = {
  user: { id: 'user-1' },
  companyId: null,
  membershipVerified: true,
};
const mockListeners: Array<(u: typeof mockUser) => void> = [];
const mockSession = { usable: true };
const mockSessionCalls = { count: 0 };
const mockGetFull = jest.fn<any, any[]>();
const mockSave = jest.fn<any, any[]>(async () => ({ ok: true }));

jest.mock('./userStore', () => ({
  useUserStore: {
    getState: () => mockUser,
    subscribe: (fn: (u: unknown) => void) => {
      mockListeners.push(fn as (u: typeof mockUser) => void);
      return () => {};
    },
  },
}));

jest.mock('@/utils/supabase/strategy', () => {
  const actual = jest.requireActual('@/utils/supabase/strategy');
  return {
    getFullStrategyDataByCompany: (...args: any[]) => mockGetFull(...args),
    saveStrategyData: (...args: any[]) => mockSave(...args),
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
  safeGetSession: async () => {
    mockSessionCalls.count += 1;
    return {
      data: { session: mockSession.usable ? { user: { id: 'user-1' } } : null },
      error: null,
    };
  },
  getCompanyIdFromCookie: () => null,
  setCompanyIdCookie: () => {},
  isValidUUID: (v: unknown) => typeof v === 'string' && /^[0-9a-f-]{36}$/i.test(v),
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

const COMPANY_A = 'a1000000-0000-4000-8000-000000000001';
const COMPANY_B = 'b1000000-0000-4000-8000-000000000002';
const NO_COMPANY_ERROR = '会社IDまたは認証情報が見つかりません';

function row(companyId: string, marker: string) {
  return {
    data: { companyId, company_id: companyId, revision: 1, companyName: marker, departments: [] },
    error: null,
  };
}

// モジュール内の再試行タイマー状態をテストごとに分けるため、ストアを読み直す
function loadStore(): typeof import('./strategyStore') {
  let mod!: typeof import('./strategyStore');
  jest.isolateModules(() => {
    mod = require('./strategyStore') as typeof import('./strategyStore');
  });
  return mod;
}

const realTimers = jest.requireActual<typeof import('timers')>('timers');
// フェイクタイマー下でも実 I/O ターンを回し、未処理の rejection 通知を待つ
const flushReal = () => new Promise<void>((resolve) => realTimers.setImmediate(resolve));

const unhandledReasons: unknown[] = [];
const onUnhandled = (reason: unknown) => {
  unhandledReasons.push(reason);
};

beforeAll(() => {
  process.on('unhandledRejection', onUnhandled);
});

afterAll(() => {
  process.off('unhandledRejection', onUnhandled);
});

beforeEach(() => {
  jest.useFakeTimers();
  memoryStorage.clear();
  unhandledReasons.length = 0;
  mockGetFull.mockReset();
  mockGetFull.mockImplementation(async (id: string) => row(id, id === COMPANY_A ? 'A' : 'B'));
  mockSave.mockClear();
  mockSession.usable = true;
  mockSessionCalls.count = 0;
  mockUser.companyId = null;
  mockUser.membershipVerified = true;
  mockListeners.length = 0;
  jest.spyOn(console, 'warn').mockImplementation(() => {});
  jest.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  jest.clearAllTimers();
  jest.useRealTimers();
  jest.restoreAllMocks();
});

describe('会社ID・セッション不足時の再試行制御', () => {
  it('会社IDがない場合は未処理の rejection を出さず、再試行も予約しない', async () => {
    const { useStrategyStore } = loadStore();

    await expect(useStrategyStore.getState().refetchFromServer()).rejects.toThrow(NO_COMPANY_ERROR);
    expect(jest.getTimerCount()).toBe(0);

    const callsBefore = mockSessionCalls.count;
    await jest.advanceTimersByTimeAsync(10 * 60_000);
    await flushReal();

    expect(mockSessionCalls.count).toBe(callsBefore);
    expect(unhandledReasons).toHaveLength(0);
  });

  it('セッションが確立しない場合の再試行は上限で止まる', async () => {
    const { useStrategyStore } = loadStore();
    mockUser.companyId = COMPANY_A;
    mockSession.usable = false;

    await expect(useStrategyStore.getState().refetchFromServer()).rejects.toThrow(NO_COMPANY_ERROR);
    await jest.advanceTimersByTimeAsync(10 * 60_000);
    await flushReal();

    // 初回 1 回 + 再試行 4 回の計 5 回で止まる
    expect(mockSessionCalls.count).toBe(5);
    expect(mockGetFull).not.toHaveBeenCalled();
    expect(jest.getTimerCount()).toBe(0);
    expect(unhandledReasons).toHaveLength(0);
  });

  it('再試行の途中でセッションが確立すると、再取得が完了する', async () => {
    const { useStrategyStore } = loadStore();
    mockUser.companyId = COMPANY_A;
    mockSession.usable = false;

    await expect(useStrategyStore.getState().refetchFromServer()).rejects.toThrow(NO_COMPANY_ERROR);
    mockSession.usable = true;
    await jest.advanceTimersByTimeAsync(1500);
    await flushReal();

    expect(mockGetFull).toHaveBeenCalledTimes(1);
    expect(mockGetFull.mock.calls[0][0]).toBe(COMPANY_A);
    expect(useStrategyStore.getState().companyId).toBe(COMPANY_A);
    expect(unhandledReasons).toHaveLength(0);
  });

  it('会社IDが後から確立した場合、通常の再取得で読み込まれる', async () => {
    const { useStrategyStore } = loadStore();

    await expect(useStrategyStore.getState().refetchFromServer()).rejects.toThrow(NO_COMPANY_ERROR);
    expect(mockGetFull).not.toHaveBeenCalled();

    mockUser.companyId = COMPANY_A;
    await useStrategyStore.getState().refetchFromServer();

    expect(mockGetFull).toHaveBeenCalledTimes(1);
    expect(mockGetFull.mock.calls[0][0]).toBe(COMPANY_A);
    expect(useStrategyStore.getState().companyId).toBe(COMPANY_A);
  });

  it('会社を切り替えた後の再試行は新しい会社だけを取得し、旧会社のデータを取得しない', async () => {
    const { useStrategyStore } = loadStore();
    mockUser.companyId = COMPANY_A;
    mockSession.usable = false;

    await expect(useStrategyStore.getState().refetchFromServer()).rejects.toThrow(NO_COMPANY_ERROR);

    mockUser.companyId = COMPANY_B;
    useStrategyStore.getState().setCompanyScope(COMPANY_B);
    mockSession.usable = true;
    await jest.advanceTimersByTimeAsync(1500);
    await flushReal();

    expect(mockGetFull).toHaveBeenCalled();
    for (const call of mockGetFull.mock.calls) {
      expect(call[0]).toBe(COMPANY_B);
    }
    expect(useStrategyStore.getState().companyId).not.toBe(COMPANY_A);
  });

  it('正常な再取得は1回で完了し、再試行は予約されない', async () => {
    const { useStrategyStore } = loadStore();
    mockUser.companyId = COMPANY_A;

    await useStrategyStore.getState().refetchFromServer();
    await jest.advanceTimersByTimeAsync(10 * 60_000);
    await flushReal();

    expect(mockGetFull).toHaveBeenCalledTimes(1);
    expect(mockGetFull.mock.calls[0][0]).toBe(COMPANY_A);
    expect(useStrategyStore.getState().companyId).toBe(COMPANY_A);
    expect(jest.getTimerCount()).toBe(0);
    expect(unhandledReasons).toHaveLength(0);
  });

  it('再試行中の想定外のエラーは握りつぶさず、エラーとしてログに残す', async () => {
    const { useStrategyStore } = loadStore();
    const errorSpy = console.error as unknown as jest.Mock;
    mockUser.companyId = COMPANY_A;
    mockSession.usable = false;

    await expect(useStrategyStore.getState().refetchFromServer()).rejects.toThrow(NO_COMPANY_ERROR);

    mockSession.usable = true;
    mockGetFull.mockImplementation(async () => {
      throw new Error('network down');
    });
    await jest.advanceTimersByTimeAsync(1500);
    await flushReal();

    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('[refetchFromServer:retry-timer]'), expect.anything());
    expect(unhandledReasons).toHaveLength(0);
  });
});
