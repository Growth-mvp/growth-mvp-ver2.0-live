/* 親（strategy_data）の保存結果で、子テーブル（最終ストーリー・STAGE2 回答）を書くかどうかを決めることを検証する。
 * Supabase 通信はすべてモック。 */

export {};

import { REVISION_UNKNOWN_SAVE_MESSAGE } from '@/lib/strategy/revisionUnknown';

const mockUser: { user: { id: string } | null; companyId: string | null; membershipVerified: boolean } = {
  user: { id: 'user-1' },
  companyId: null,
  membershipVerified: true,
};
const mockSaveStrategy = jest.fn<any, any[]>(async () => ({ data: { id: 'S-1', revision: 0 }, error: null }));
const mockSaveFinal = jest.fn<any, any[]>(async () => ({ ok: true, error: null }));
const mockSaveAnswers2 = jest.fn<any, any[]>(async () => ({ ok: true, error: null }));
const mockSaveWithAudit = jest.fn<any, any[]>(async () => ({ data: null, error: null }));

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
    saveStrategyData: (...args: any[]) => mockSaveStrategy(...args),
    saveFinalStory: (...args: any[]) => mockSaveFinal(...args),
    saveStoryAnswers2: (...args: any[]) => mockSaveAnswers2(...args),
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
  saveWithAudit: (...args: any[]) => mockSaveWithAudit(...args),
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
const FINAL = [{ id: 'c1', title: '最終ストーリー', body: '本文' }] as any;
const ANSWERS = [{ chapterTitle: '会社の歩み', steps: [{ stepNumber: 1, question: 'q', answer: 'a' }] }] as any;

function loadStore(): typeof import('./strategyStore') {
  let mod!: typeof import('./strategyStore');
  jest.isolateModules(() => {
    mod = require('./strategyStore') as typeof import('./strategyStore');
  });
  return mod;
}

/** 親が存在しない（revision 不明・未読込）の状態。初回の保存を想定する。 */
function unloadedStore(store: typeof import('./strategyStore')) {
  store.useStrategyStore.setState({
    companyId: COMPANY_A,
    strategyId: null,
    revision: undefined,
    loaded: false,
    hydrated: false,
    pendingCompanyId: undefined,
    companyName: 'テスト株式会社',
    departments: [{ name: '営業部', projects: [{ title: 'P1' }] }],
  } as any);
}

const realTimers = jest.requireActual<typeof import('timers')>('timers');
/** 非同期に始まる子テーブル保存（即時実行の async）が終わるまで、実 I/O ターンを回す */
const settle = async () => {
  for (let i = 0; i < 25; i++) await new Promise<void>((resolve) => realTimers.setImmediate(resolve));
};

describe('親の保存結果で、子テーブル（最終ストーリー）を書くかを決める', () => {
  beforeEach(() => {
    memoryStorage.clear();
    mockUser.user = { id: 'user-1' };
    mockSaveStrategy.mockReset();
    mockSaveStrategy.mockResolvedValue({ data: { id: 'S-1', revision: 0 }, error: null });
    mockSaveFinal.mockClear();
    mockSaveAnswers2.mockClear();
  });

  it('正常: 親の保存（新規戦略の初回）が成功すれば、子テーブルも保存する', async () => {
    const store = loadStore();
    unloadedStore(store);

    store.useStrategyStore.getState().setFinalStory(FINAL);
    await settle();

    expect(mockSaveStrategy).toHaveBeenCalledTimes(1);
    expect(mockSaveFinal).toHaveBeenCalledTimes(1);
    expect(mockSaveFinal.mock.calls[0][2]).toEqual({ companyId: COMPANY_A });
    expect(store.useStrategyStore.getState().saveError).toBeUndefined();
  });

  it('正常: 親が既に読込済み（revision あり）なら親の再送はせず、子テーブルを保存する', async () => {
    const store = loadStore();
    unloadedStore(store);
    store.useStrategyStore.setState({ revision: 5, loaded: true, hydrated: true } as any);

    store.useStrategyStore.getState().setFinalStory(FINAL);
    await settle();

    expect(mockSaveStrategy).not.toHaveBeenCalled();
    expect(mockSaveFinal).toHaveBeenCalledTimes(1);
  });

  it('revision 不明で親が拒否されたら、子テーブルは書かず、保存されなかったことを saveError で示す', async () => {
    const store = loadStore();
    unloadedStore(store);
    mockSaveStrategy.mockResolvedValueOnce({
      data: null,
      error: { status: 409, code: 'REVISION_UNKNOWN', message: 'x' },
    });

    store.useStrategyStore.getState().setFinalStory(FINAL);
    await settle();

    expect(mockSaveStrategy).toHaveBeenCalledTimes(1);
    expect(mockSaveFinal).not.toHaveBeenCalled();
    expect(store.useStrategyStore.getState().saveError).toBe(REVISION_UNKNOWN_SAVE_MESSAGE);
  });

  it('DB読込の失敗（親の保存がエラーを返す）では、保存可否が不明なので子テーブルは書かない', async () => {
    const store = loadStore();
    unloadedStore(store);
    mockSaveStrategy.mockResolvedValueOnce({
      data: null,
      error: { code: 'NETWORK_ERROR', message: 'fetch failed' },
    });

    store.useStrategyStore.getState().setFinalStory(FINAL);
    await settle();

    expect(mockSaveFinal).not.toHaveBeenCalled();
    expect(store.useStrategyStore.getState().saveError).toBe('保存に失敗しました: fetch failed');
  });

  it('保存がスキップされた（データ null・エラー無し）場合は、親の存在を確認できないので子テーブルは書かない', async () => {
    const store = loadStore();
    unloadedStore(store);
    mockSaveStrategy.mockResolvedValueOnce({ data: null, error: null });

    store.useStrategyStore.getState().setFinalStory(FINAL);
    await settle();

    expect(mockSaveStrategy).toHaveBeenCalledTimes(1);
    expect(mockSaveFinal).not.toHaveBeenCalled();
    expect(store.useStrategyStore.getState().saveError).toBe('保存に失敗しました: 不明なエラー');
  });

  it('親の保存が例外で失敗し、再送も失敗したら、子テーブルは書かない', async () => {
    const store = loadStore();
    unloadedStore(store);
    mockSaveStrategy.mockRejectedValue(new Error('network down'));

    store.useStrategyStore.getState().setFinalStory(FINAL);
    await settle();

    expect(mockSaveFinal).not.toHaveBeenCalled();
    expect(store.useStrategyStore.getState().saveError).toBe('保存に失敗しました: network down');
  });

  it('親の保存が例外でも、再送（従来の互換呼び出し）が成功すれば、子テーブルを保存する', async () => {
    const store = loadStore();
    unloadedStore(store);
    mockSaveStrategy.mockRejectedValueOnce(new Error('primary signature failed'));
    mockSaveStrategy.mockResolvedValueOnce({ data: { id: 'S-1', revision: 0 }, error: null });

    store.useStrategyStore.getState().setFinalStory(FINAL);
    await settle();

    expect(mockSaveStrategy).toHaveBeenCalledTimes(2);
    expect(mockSaveFinal).toHaveBeenCalledTimes(1);
  });

  it('会社の切替が保留中なら、親の保存も子テーブルの保存もしない', async () => {
    const store = loadStore();
    unloadedStore(store);
    store.useStrategyStore.setState({ pendingCompanyId: COMPANY_B } as any);

    store.useStrategyStore.getState().setFinalStory(FINAL);
    await settle();

    expect(mockSaveStrategy).not.toHaveBeenCalled();
    expect(mockSaveFinal).not.toHaveBeenCalled();
  });
});

describe('親の保存結果で、STAGE2 回答（answers2）を書くかを決める', () => {
  beforeEach(() => {
    memoryStorage.clear();
    mockUser.user = { id: 'user-1' };
    mockSaveStrategy.mockReset();
    mockSaveStrategy.mockResolvedValue({ data: { id: 'S-1', revision: 0 }, error: null });
    mockSaveAnswers2.mockClear();
  });

  it('正常: 親の保存が成功すれば、回答を保存する', async () => {
    const store = loadStore();
    unloadedStore(store);

    store.useStrategyStore.getState().setAnswers2(ANSWERS);
    await settle();

    expect(mockSaveAnswers2).toHaveBeenCalledTimes(1);
    expect(mockSaveAnswers2.mock.calls[0][2]).toEqual({ companyId: COMPANY_A });
  });

  it('revision 不明で親が拒否されたら、回答は書かず、saveError で示す', async () => {
    const store = loadStore();
    unloadedStore(store);
    mockSaveStrategy.mockResolvedValueOnce({
      data: null,
      error: { status: 409, code: 'REVISION_UNKNOWN', message: 'x' },
    });

    store.useStrategyStore.getState().setAnswers2(ANSWERS);
    await settle();

    expect(mockSaveAnswers2).not.toHaveBeenCalled();
    expect(store.useStrategyStore.getState().saveError).toBe(REVISION_UNKNOWN_SAVE_MESSAGE);
  });
});
