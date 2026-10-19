/* 直接保存の会社・戦略スコープ照合。Supabase 通信のみモック。ストアは実物を使う。 */

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
const { useStrategyStore } = require('@/store/strategyStore');
const { useUserStore } = require('@/store/userStore');
const { saveWithAudit } = require('@/utils/persist/saveWithAudit');
const {
  captureSaveScope,
  isSaveScopeCurrent,
  runInSaveScope,
  SAVE_SCOPE_CHANGED,
} = require('@/lib/strategy/saveScope');
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
const savePlain = () =>
  saveWithAudit(store(), 'user-1', COMPANY_A, undefined, {}, 'test');

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

describe('直接保存の会社・戦略スコープ', () => {
  it('1. 同じ会社の通常保存は従来どおり実行される', async () => {
    await switchTo(COMPANY_A);
    const scope = captureSaveScope();
    expect(scope).not.toBeNull();

    saveWithAudit.mockResolvedValueOnce({ data: { revision: 2, strategyId: 'S-A' }, error: null });
    const result = await runInSaveScope(scope, () => savePlain());

    expect(result).toEqual({ data: { revision: 2, strategyId: 'S-A' }, error: null });
    expect(saveWithAudit.mock.calls[0][2]).toBe(COMPANY_A);
    expect(isSaveScopeCurrent(scope)).toBe(true);
  });

  it('2. 会社Aの保存待機中にBへ切り替えても、Aの保存応答と再実行はBのデータに混入しない', async () => {
    await switchTo(COMPANY_A);
    const scopeA = captureSaveScope();

    const lateA = deferred<any>();
    saveWithAudit.mockImplementationOnce(() => lateA.promise);
    const savingA = runInSaveScope(scopeA, () => savePlain());

    await switchTo(COMPANY_B);
    lateA.resolve({ data: { strategyId: 'S-A-late', revision: 99 }, error: null });
    await savingA;

    expect(isSaveScopeCurrent(scopeA)).toBe(false);
    expect((store() as any).companyName).toBe('B');
    expect(store().companyId).toBe(COMPANY_B);
    expect(store().strategyId).not.toBe('S-A-late');

    const rerunA = await runInSaveScope(scopeA, () => savePlain());
    expect(rerunA).toBe(SAVE_SCOPE_CHANGED);
    expect(saveWithAudit).toHaveBeenCalledTimes(1);
    expect(saveWithAudit.mock.calls[0][2]).toBe(COMPANY_A);

    const scopeB = captureSaveScope();
    expect(scopeB?.companyId).toBe(COMPANY_B);
    expect(isSaveScopeCurrent(scopeB)).toBe(true);
  });

  it('3. 会社Aの保存が失敗した後にBへ切り替えると、Aのリトライは実行されない', async () => {
    await switchTo(COMPANY_A);
    const scopeA = captureSaveScope();

    saveWithAudit.mockRejectedValueOnce(new Error('network'));
    await expect(runInSaveScope(scopeA, () => savePlain())).rejects.toThrow('network');
    expect(isSaveScopeCurrent(scopeA)).toBe(true);

    await switchTo(COMPANY_B);
    const retry = await runInSaveScope(scopeA, () => savePlain());

    expect(retry).toBe(SAVE_SCOPE_CHANGED);
    expect(saveWithAudit).toHaveBeenCalledTimes(1);
  });

  it('4. A→B→Aと再切替しても、切替前に取得した古いスコープは再開されない', async () => {
    await switchTo(COMPANY_A);
    const scopeA = captureSaveScope();

    await switchTo(COMPANY_B);
    await switchTo(COMPANY_A);
    expect(store().companyId).toBe(COMPANY_A);
    expect((store() as any).companyName).toBe('A');

    expect(isSaveScopeCurrent(scopeA)).toBe(false);
    const stale = await runInSaveScope(scopeA, () => savePlain());
    expect(stale).toBe(SAVE_SCOPE_CHANGED);
    expect(saveWithAudit).not.toHaveBeenCalled();

    const fresh = captureSaveScope();
    expect(fresh?.companyId).toBe(COMPANY_A);
    expect(isSaveScopeCurrent(fresh)).toBe(true);
  });
});

describe('STAGE1 財務保存の会社間混入防止', () => {
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

  const financeSave = (rows: unknown[], scope: { userId: string; companyId: string }) =>
    saveWithAudit({ ...store(), csvFinanceData: rows }, scope.userId, scope.companyId, undefined, {}, 'step3Finance:uploadCSV');

  it('1. 通常の財務保存は、同じ会社のデータとして保存される', async () => {
    await switchTo(COMPANY_A);
    const scope = captureSaveScope();
    const rows = [{ year: 2024, revenue: 100 }];

    const result = await runInSaveScope(scope, () => financeSave(rows, scope));

    expect(result).toEqual({ data: null, error: null });
    expect(saveWithAudit.mock.calls[0][0].csvFinanceData).toEqual(rows);
    expect(saveWithAudit.mock.calls[0][2]).toBe(COMPANY_A);
  });

  it('2. 会社Aの保存待機中にBへ切り替えても、Bの状態にAの財務データが混入しない', async () => {
    await switchTo(COMPANY_A);
    const scopeA = captureSaveScope();

    const lateA = deferred<any>();
    saveWithAudit.mockImplementationOnce(() => lateA.promise);
    const savingA = runInSaveScope(scopeA, () => financeSave([{ year: 2023, note: 'A-finance' }], scopeA));

    await switchTo(COMPANY_B);
    lateA.resolve({ data: null, error: null });
    await savingA;

    expect(isSaveScopeCurrent(scopeA)).toBe(false);
    expect(store().companyId).toBe(COMPANY_B);
    expect(JSON.stringify(store().csvFinanceData ?? [])).not.toContain('A-finance');
    expect(saveWithAudit.mock.calls[0][2]).toBe(COMPANY_A);
  });

  it('3. A→B→Aと再切替しても、古い財務保存（CSV取込の応答を含む）は再開されない', async () => {
    await switchTo(COMPANY_A);
    const scopeA = captureSaveScope();

    await switchTo(COMPANY_B);
    await switchTo(COMPANY_A);

    expect(isSaveScopeCurrent(scopeA)).toBe(false);
    const stale = await runInSaveScope(scopeA, () => financeSave([{ year: 2022 }], scopeA));
    expect(stale).toBe(SAVE_SCOPE_CHANGED);
    expect(saveWithAudit).not.toHaveBeenCalled();
  });

  it('4. 保存対象の会社IDと財務データの取得元（ストア）が一致しない場合は保存を中断する', async () => {
    await switchTo(COMPANY_A);
    const scopeA = captureSaveScope();

    useUserStore.setState({ companyId: COMPANY_B } as any);

    expect(captureSaveScope()).toBeNull();
    expect(isSaveScopeCurrent(scopeA)).toBe(false);
    const result = await runInSaveScope(scopeA, () => financeSave([{ year: 2021 }], scopeA));
    expect(result).toBe(SAVE_SCOPE_CHANGED);
    expect(saveWithAudit).not.toHaveBeenCalled();
  });
});
