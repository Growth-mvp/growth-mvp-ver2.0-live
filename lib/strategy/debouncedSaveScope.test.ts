/* 保存待ち（デバウンス）後に呼ばれる店舗の保存が、会社切替をまたいで別の会社へ書かれないことを確認する。Supabase 通信のみモック。ストアは実物を使う。 */

export {};

const mockGetFull = jest.fn<any, any[]>();

jest.mock('@/utils/supabase/strategy', () => {
  const passthrough = (name: string) =>
    jest.fn(async () => {
      throw new Error(`unexpected call: ${name}`);
    });
  return {
    getFullStrategyDataByCompany: (...args: any[]) => mockGetFull(...args),
    saveStrategyData: passthrough('saveStrategyData'),
    countTotalProjects: (depts: any[]) =>
      (depts ?? []).reduce((n: number, d: any) => n + (d?.projects ?? []).length, 0),
    getFullStrategyDataByStrategyId: passthrough('getFullStrategyDataByStrategyId'),
    deleteStrategyData: passthrough('deleteStrategyData'),
    purgeLegacyTables: passthrough('purgeLegacyTables'),
    saveStoryAnswers2: passthrough('saveStoryAnswers2'),
    saveFinalStory: passthrough('saveFinalStory'),
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
const { useStrategyStore, COMPANY_SWITCH_SAVE_MESSAGE } = require('@/store/strategyStore');
const { useUserStore } = require('@/store/userStore');
const { saveWithAudit } = require('@/utils/persist/saveWithAudit');
/* eslint-enable @typescript-eslint/no-require-imports */

const COMPANY_A = 'a1000000-0000-4000-8000-000000000001';
const COMPANY_B = 'b1000000-0000-4000-8000-000000000002';

function row(companyId: string, marker: string) {
  return {
    data: { companyId, company_id: companyId, revision: 1, companyName: marker, departments: [] },
    error: null,
  };
}

function deferred<T>() {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

const store = () => useStrategyStore.getState();

async function switchTo(companyId: string) {
  useUserStore.setState({ companyId } as any);
  store().setCompanyScope(companyId);
  await store().refetchFromServer();
}

beforeEach(() => {
  mockGetFull.mockReset();
  mockGetFull.mockImplementation(async (id: string) =>
    row(id, id === COMPANY_A ? 'A' : id === COMPANY_B ? 'B' : 'other'),
  );
  saveWithAudit.mockReset();
  saveWithAudit.mockImplementation(async () => ({ data: null, error: null }));
  useUserStore.setState({ user: { id: 'user-1' }, companyId: null, membershipVerified: true } as any);
  useStrategyStore.setState({
    companyId: null,
    pendingCompanyId: undefined,
    restoreReady: false,
    __lastServerError: undefined,
  } as any);
});

describe('保存待ちの後に届く保存と会社切替', () => {
  it('切替が始まった後に届いた保存は、どの会社にも送られず、切替の表示が残る', async () => {
    await switchTo(COMPANY_A);
    store().setCompanyScope(COMPANY_B);

    const result = await store().saveStrategyData({ reason: 'stage4_snapshot_fields', force: true });

    expect(result).toMatchObject({ ok: false, skipped: true, reason: 'company_switching' });
    expect(saveWithAudit).not.toHaveBeenCalled();
    expect(store().saveError).toBe(COMPANY_SWITCH_SAVE_MESSAGE);
  });

  it('送信中に切り替えても、保存はAへ送られたままで、応答はBの状態に反映されない', async () => {
    await switchTo(COMPANY_A);
    const late = deferred<any>();
    saveWithAudit.mockImplementationOnce(() => late.promise);

    const saving = store().saveStrategyData({ reason: 'stage4_snapshot_fields', force: true });
    await new Promise((r) => setTimeout(r, 0));
    store().setCompanyScope(COMPANY_B);
    late.resolve({ data: { revision: 2 }, error: null });
    const result = await saving;

    expect(result).toMatchObject({ ok: false, skipped: true, reason: 'scope_changed' });
    expect(saveWithAudit).toHaveBeenCalledTimes(1);
    expect(saveWithAudit.mock.calls[0][2]).toBe(COMPANY_A);
    expect(store().companyId).not.toBe(COMPANY_A);
  });

  it('DB層が企業不一致で失敗を返したら、店舗は保存済みにせず失敗を表示する', async () => {
    await switchTo(COMPANY_A);
    useStrategyStore.setState({ dirty: true } as any);
    saveWithAudit.mockResolvedValueOnce({
      data: null,
      error: { status: 409, code: 'SAVE_SCOPE_MISMATCH', message: 'company scope mismatch: save blocked' },
    });

    const result = await store().saveStrategyData({ reason: 'stage4_snapshot_fields', force: true });

    expect(result).toMatchObject({ ok: false, reason: 'api_error' });
    expect(store().dirty).toBe(true);
    expect(store().saveError).toContain('保存に失敗しました');
  });
});
