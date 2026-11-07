/* 会社切替中の非同期応答・読込の再試行・保存拒否の通知を、ストア実体で確認する。Supabase 通信と認証のみモック。 */

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
const mockSave = jest.fn<any, any[]>(async () => ({ data: { revision: ((useStrategyStore.getState() as any).revision ?? 0) + 1 }, error: null }));
const mockSaveFinal = jest.fn<any, any[]>(async () => ({ ok: true }));
const mockSaveAnswers2 = jest.fn<any, any[]>(async () => ({ ok: true }));

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
    saveFinalStory: (...args: any[]) => mockSaveFinal(...args),
    saveStoryAnswers2: (...args: any[]) => mockSaveAnswers2(...args),
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

import {
  COMPANY_SWITCH_SAVE_MESSAGE,
  SCOPE_LOAD_FAILED_SAVE_MESSAGE,
  useStrategyStore,
} from './strategyStore';
import { buildStateFromDbRow } from '@/utils/supabase/strategy';
import { hardResetForCompanySwitch } from '@/utils/resetAll';
import { captureSaveScope, isSaveScopeCurrent } from '@/lib/strategy/saveScope';

const COMPANY_A = '11111111-1111-4111-8111-111111111111';
const COMPANY_B = '22222222-2222-4222-8222-222222222222';
const STRATEGY_A = '33333333-3333-4333-8333-333333333333';
const STRATEGY_B = '44444444-4444-4444-8444-444444444444';
const NOW = '2026-10-30T00:00:00.000Z';

const get = () => useStrategyStore.getState() as any;

function rowOf(over: Record<string, unknown>) {
  return {
    id: STRATEGY_B,
    company_id: COMPANY_B,
    revision: 1,
    updated_at: NOW,
    opportunity: '',
    threat: '',
    ...over,
  };
}

function serverResult(row: Record<string, unknown>) {
  const state = buildStateFromDbRow(row as any) as any;
  return { data: { ...state, companyId: row.company_id }, error: null };
}

async function flush(rounds = 30) {
  for (let i = 0; i < rounds; i++) await Promise.resolve();
}

beforeEach(() => {
  jest.clearAllMocks();
  mockUser.companyId = null;
  get().resetAll();
});

describe('保存世代: reset / resetAll で古い非同期応答を無効にする', () => {
  it('reset の前に取得した保存スコープは、reset の後には有効でない', () => {
    mockUser.companyId = COMPANY_A;
    useStrategyStore.setState({ companyId: COMPANY_A, pendingCompanyId: undefined, strategyId: STRATEGY_A } as any);
    const scope = captureSaveScope();
    expect(scope).not.toBeNull();
    expect(isSaveScopeCurrent(scope!)).toBe(true);

    get().resetAll();

    expect(isSaveScopeCurrent(scope!)).toBe(false);
  });

  it('保存中に resetAll が呼ばれ、後から届いた会社Aの保存応答は店舗の状態を書き換えない', async () => {
    mockUser.companyId = COMPANY_A;
    useStrategyStore.setState({ companyId: COMPANY_A, pendingCompanyId: undefined, strategyId: STRATEGY_A, companyName: 'A社', dirty: true } as any);
    let resolveSave!: (v: any) => void;
    mockSave.mockReturnValueOnce(new Promise((r) => (resolveSave = r)));

    const pending = get().saveStrategyData({ force: true, reason: 'test-reset-during-save' });
    await flush();
    get().resetAll();
    resolveSave({ data: { revision: 99, strategyId: STRATEGY_A }, error: null });
    await pending;

    expect(get().revision).not.toBe(99);
    expect(get().companyName).toBe('');
  });
});

describe('会社切替中の文章・SWOT以外の即時保存（setFinalStory / setAnswers2）', () => {
  it('切替が保留中に setFinalStory を呼んでも、保留の会社の行へ書かない', async () => {
    mockUser.companyId = COMPANY_A;
    useStrategyStore.setState({ companyId: COMPANY_A, pendingCompanyId: undefined } as any);
    get().setCompanyScope(COMPANY_B);

    get().setFinalStory([{ id: 'c1', title: 'A社の最終ストーリー' } as any]);
    get().setAnswers2([]);
    await flush();

    expect(mockSaveFinal).not.toHaveBeenCalled();
    expect(mockSaveAnswers2).not.toHaveBeenCalled();
  });

  it('保存の準備中に会社が切り替わった場合、旧会社の行へ切替後の内容を書かない', async () => {
    mockUser.companyId = COMPANY_A;
    useStrategyStore.setState({ companyId: COMPANY_A, pendingCompanyId: undefined } as any);

    get().setFinalStory([{ id: 'c1', title: 'A社の最終ストーリー' } as any]);
    get().setCompanyScope(COMPANY_B);
    await flush();

    expect(mockSaveFinal.mock.calls.filter((c) => c[2]?.companyId === COMPANY_A)).toHaveLength(0);
    expect(mockSaveFinal.mock.calls.filter((c) => c[2]?.companyId === COMPANY_B)).toHaveLength(0);
  });

  it('正常時は、現在の会社の行へ最新の内容を保存する', async () => {
    mockUser.companyId = COMPANY_A;
    useStrategyStore.setState({ companyId: COMPANY_A, pendingCompanyId: undefined } as any);

    get().setFinalStory([{ id: 'c1', title: '最新' } as any]);
    await flush();

    expect(mockSaveFinal).toHaveBeenCalled();
    const last = mockSaveFinal.mock.calls[mockSaveFinal.mock.calls.length - 1];
    expect(last[2]).toEqual({ companyId: COMPANY_A });
    expect(last[1]).toEqual([{ id: 'c1', title: '最新' }]);
  });
});

describe('保存拒否時のユーザー通知（saveError）', () => {
  it('会社IDが無い状態での保存は、保存されなかったことを saveError で示す', async () => {
    mockUser.companyId = null;
    const res = await get().saveStrategyData({ force: true, reason: 'test-notify-missing' });

    expect(res.ok).toBe(false);
    expect(get().saveError).toBeTruthy();
    expect(mockSave).not.toHaveBeenCalled();
  });

  it('切替中の保存は、切替中であることを saveError で示し、読込を要求する', async () => {
    mockUser.companyId = COMPANY_A;
    useStrategyStore.setState({ companyId: COMPANY_A, pendingCompanyId: COMPANY_B } as any);

    const res = await get().saveStrategyData({ force: true, reason: 'test-notify-switching' });

    expect(res.reason).toBe('company_switching');
    expect(get().saveError).toBe(COMPANY_SWITCH_SAVE_MESSAGE);
    expect(mockSave).not.toHaveBeenCalled();
  });

  it('読込が成功すると、保存拒否の通知は消え、保存が再開される', async () => {
    mockUser.companyId = COMPANY_B;
    useStrategyStore.setState({ companyId: COMPANY_A, pendingCompanyId: COMPANY_B } as any);
    await get().saveStrategyData({ force: true, reason: 'test-before-load' });
    expect(get().saveError).toBe(COMPANY_SWITCH_SAVE_MESSAGE);

    mockFetchByCompany.mockResolvedValueOnce(serverResult(rowOf({ company_id: COMPANY_B, opportunity: 'B社の機会' })));
    await get().refetchOnceFromServer();
    useStrategyStore.setState({ companyName: 'B社', dirty: true } as any);
    const res = await get().saveStrategyData({ force: true, reason: 'test-after-load' });

    expect(get().saveError).toBeUndefined();
    expect(res.ok).toBe(true);
    expect(mockSave).toHaveBeenCalled();
  });
});

describe('読込失敗・タイムアウト・再試行', () => {
  beforeEach(() => {
    jest.useFakeTimers({ doNotFake: ['nextTick', 'setImmediate'] });
  });
  afterEach(() => {
    jest.useRealTimers();
  });

  it('読込がタイムアウトしても保存は許可されず、通知と再試行の経路が残る', async () => {
    mockUser.companyId = COMPANY_B;
    get().setCompanyScope(COMPANY_B);
    mockFetchByCompany.mockReturnValueOnce(new Promise(() => {}));

    const refetch = get().refetchOnceFromServer().catch(() => {});
    await jest.advanceTimersByTimeAsync(15000);
    await refetch;

    expect(get().pendingCompanyId).toBe(COMPANY_B);
    expect(get().saveError).toBe(SCOPE_LOAD_FAILED_SAVE_MESSAGE);
    const res = await get().saveStrategyData({ force: true, reason: 'test-timeout' });
    expect(res.ok).toBe(false);
    expect(mockSave).not.toHaveBeenCalled();
  });

  it('タイムアウト後に届いた古い応答は破棄される', async () => {
    mockUser.companyId = COMPANY_B;
    get().setCompanyScope(COMPANY_B);
    let resolveLate!: (v: any) => void;
    mockFetchByCompany.mockReturnValueOnce(new Promise((r) => (resolveLate = r)));

    const refetch = get().refetchOnceFromServer().catch(() => {});
    await jest.advanceTimersByTimeAsync(15000);
    await refetch;
    resolveLate(serverResult(rowOf({ company_id: COMPANY_A, companyName: 'A社' } as any)));
    await flush();

    expect(get().companyId).not.toBe(COMPANY_A);
    expect(get().companyName).not.toBe('A社');
  });

  it('retryScopeLoad で再読込すると、成功後に会社スコープが確定し保存が再開する', async () => {
    mockUser.companyId = COMPANY_B;
    get().setCompanyScope(COMPANY_B);
    mockFetchByCompany.mockReturnValueOnce(new Promise(() => {}));
    const first = get().refetchOnceFromServer().catch(() => {});
    await jest.advanceTimersByTimeAsync(15000);
    await first;
    expect(get().pendingCompanyId).toBe(COMPANY_B);

    mockFetchByCompany.mockResolvedValueOnce(serverResult(rowOf({ company_id: COMPANY_B, opportunity: 'B社の機会' })));
    get().retryScopeLoad();
    await jest.advanceTimersByTimeAsync(100);
    await flush();

    expect(get().pendingCompanyId).toBeUndefined();
    expect(get().companyId).toBe(COMPANY_B);
    expect(get().saveError).toBeUndefined();
  });

  it('一時的な読込失敗は、上限付きで自動的に再試行される', async () => {
    mockUser.companyId = COMPANY_B;
    get().setCompanyScope(COMPANY_B);
    mockFetchByCompany.mockResolvedValue({ data: null, error: { code: 'NETWORK_ERROR', message: 'offline' } });

    const first = get().refetchOnceFromServer().catch(() => {});
    await first;
    await jest.advanceTimersByTimeAsync(1500);
    await flush();

    expect(mockFetchByCompany.mock.calls.length).toBeGreaterThanOrEqual(2);
    expect(get().pendingCompanyId).toBe(COMPANY_B);
  });
});
