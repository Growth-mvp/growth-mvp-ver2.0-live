/* 会社切替時の読み込み（refetch）の挙動をストア実体で確認する。Supabase 通信のみモック。 */

export {};

const mockUser: { user: { id: string } | null; companyId: string | null; membershipVerified: boolean } = {
  user: { id: 'user-1' },
  companyId: null,
  membershipVerified: true,
};
const mockListeners: Array<(u: typeof mockUser) => void> = [];
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
  const passthrough = (name: string) =>
    jest.fn(async () => {
      throw new Error(`unexpected call: ${name}`);
    });
  const actual = jest.requireActual('@/utils/supabase/strategy');
  return {
    getFullStrategyDataByCompany: (...args: any[]) => mockGetFull(...args),
    saveStrategyData: (...args: any[]) => mockSave(...args),
    buildStateFromDbRow: actual.buildStateFromDbRow,
    buildFinanceCsvUnitMeta: actual.buildFinanceCsvUnitMeta,
    countTotalProjects: (depts: any[]) =>
      (depts ?? []).reduce((n: number, d: any) => n + (d?.projects ?? []).length, 0),
    getFullStrategyDataByStrategyId: passthrough('getFullStrategyDataByStrategyId'),
    deleteStrategyData: passthrough('deleteStrategyData'),
  };
});

jest.mock('@/utils/supabase/client', () => ({
  safeGetSession: async () => ({ data: { session: { user: { id: 'user-1' } } }, error: null }),
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

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { useStrategyStore, COMPANY_SWITCH_SAVE_MESSAGE } = require('./strategyStore') as typeof import('./strategyStore');
const { saveWithAudit: mockSaveWithAudit } = require('@/utils/persist/saveWithAudit') as {
  saveWithAudit: jest.Mock;
};

const COMPANY_A = 'a1000000-0000-4000-8000-000000000001';
const COMPANY_B = 'b1000000-0000-4000-8000-000000000002';
const COMPANY_X = 'c1000000-0000-4000-8000-000000000003';

function row(companyId: string, marker: string) {
  return {
    data: {
      companyId,
      company_id: companyId,
      revision: 1,
      companyName: marker,
      departments: [],
    },
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

beforeEach(() => {
  mockGetFull.mockReset();
  mockSave.mockClear();
  mockUser.companyId = null;
  mockUser.membershipVerified = true;
  mockListeners.forEach((l) => l(mockUser));
  mockGetFull.mockImplementation(async (id: string) => row(id, id === COMPANY_A ? 'A' : id === COMPANY_B ? 'B' : 'other'));
  useStrategyStore.setState({
    companyId: null,
    pendingCompanyId: undefined,
    restoreReady: false,
    __lastServerError: undefined,
  } as any);
});

describe('refetchFromServer（会社スコープ）', () => {
  it('1社所属: 選択会社のデータを読み込み、restoreReady を立てる', async () => {
    mockUser.companyId = COMPANY_A;
    await store().refetchFromServer();
    expect(mockGetFull).toHaveBeenCalledTimes(1);
    expect(mockGetFull).toHaveBeenCalledWith(COMPANY_A);
    expect(store().companyId).toBe(COMPANY_A);
    expect(store().restoreReady).toBe(true);
    expect(store().pendingCompanyId).toBeUndefined();
  });

  it('同時に複数回呼ばれても、要求は捨てられず最後の状態まで読み込まれる', async () => {
    mockUser.companyId = COMPANY_A;
    await Promise.all([store().refetchFromServer(), store().refetchFromServer(), store().refetchFromServer()]);
    expect(mockGetFull).toHaveBeenCalled();
    expect(mockGetFull.mock.calls.every((c) => c[0] === COMPANY_A)).toBe(true);
    expect(store().restoreReady).toBe(true);
    expect(store().companyId).toBe(COMPANY_A);
  });

  it('切替中に届いた旧会社の応答は破棄し、新会社のデータだけを反映する', async () => {
    mockUser.companyId = COMPANY_A;
    await store().refetchFromServer();
    expect(store().companyId).toBe(COMPANY_A);

    const holdA = deferred<ReturnType<typeof row>>();
    mockGetFull.mockImplementationOnce(() => holdA.promise);

    const pA = store().refetchFromServer();
    mockUser.companyId = COMPANY_B;
    store().setCompanyScope(COMPANY_B);
    const pB = store().refetchFromServer();

    holdA.resolve(row(COMPANY_A, 'A-late'));
    await Promise.all([pA, pB]);

    expect(store().companyId).toBe(COMPANY_B);
    expect(store().restoreReady).toBe(true);
    expect((store() as any).companyName).toBe('B');
    expect((store() as any).companyName).not.toBe('A-late');
    expect(mockGetFull.mock.calls.at(-1)?.[0]).toBe(COMPANY_B);
  });

  it('レイアウトが選択会社の変更を反映した後は、旧会社の応答を破棄して新会社を読み込む', async () => {
    mockUser.companyId = COMPANY_A;
    await store().refetchFromServer();

    const holdB = deferred<ReturnType<typeof row>>();
    mockGetFull.mockImplementationOnce(() => holdB.promise);
    mockUser.companyId = COMPANY_B;
    store().setCompanyScope(COMPANY_B);
    const pB = store().refetchFromServer();

    mockUser.companyId = COMPANY_X;
    store().setCompanyScope(COMPANY_X);
    holdB.resolve(row(COMPANY_B, 'B-stale'));
    await pB;

    expect(store().companyId).toBe(COMPANY_X);
    expect((store() as any).companyName).toBe('other');
    expect(mockGetFull.mock.calls.at(-1)?.[0]).toBe(COMPANY_X);
  });

  it('DB の応答の会社IDが要求先と一致しない場合は反映せず、エラー状態にする', async () => {
    mockUser.companyId = COMPANY_A;
    mockGetFull.mockImplementationOnce(async () => row(COMPANY_X, 'mismatch'));

    await expect(store().refetchFromServer()).rejects.toThrow('会社データの照合に失敗しました');
    expect(store().restoreReady).toBe(false);
    expect(store().companyId).not.toBe(COMPANY_X);
    expect((store().__lastServerError as Error | undefined)?.message).toBe('company_mismatch');
  });

  it('切替先に戦略行がない場合、旧会社のデータを新会社の行へ保存しない', async () => {
    mockUser.companyId = COMPANY_A;
    await store().refetchFromServer();
    expect(store().companyId).toBe(COMPANY_A);

    mockUser.companyId = COMPANY_B;
    store().setCompanyScope(COMPANY_B);
    mockGetFull.mockImplementation(async () => ({ data: null, error: null }));

    await expect(store().refetchFromServer()).rejects.toThrow();
    expect(mockSave).toHaveBeenCalled();
    for (const call of mockSave.mock.calls) {
      const payload = call[0] as any;
      expect(payload.companyName).not.toBe('A');
      expect(payload.companyId ?? null).not.toBe(COMPANY_A);
    }
  });

  it('切替中（pending）は選択会社の表示用フラグを立てたまま、完了後に解除される', async () => {
    mockUser.companyId = COMPANY_A;
    await store().refetchFromServer();

    const holdB = deferred<ReturnType<typeof row>>();
    mockGetFull.mockImplementationOnce(() => holdB.promise);
    mockUser.companyId = COMPANY_B;
    store().setCompanyScope(COMPANY_B);
    const p = store().refetchFromServer();

    expect(store().pendingCompanyId).toBe(COMPANY_B);
    expect(store().restoreReady).toBe(false);

    holdB.resolve(row(COMPANY_B, 'B'));
    await p;
    expect(store().pendingCompanyId).toBeUndefined();
    expect(store().restoreReady).toBe(true);
  });
});

const flush = () => new Promise((r) => setTimeout(r, 0));

function persistCompany(companyId: string, companyName: string) {
  memoryStorage.set(
    'strategy-store-v5',
    JSON.stringify({ state: { companyId, companyName, departments: [] }, version: 40 }),
  );
}

async function rehydrateFromStorage() {
  await useStrategyStore.persist.rehydrate();
  await flush();
}

describe('永続化された会社データの表示ゲート', () => {
  it('所属確認前は、永続化された旧会社の名前を表示せず、保存領域も書き換えない', async () => {
    persistCompany(COMPANY_B, 'B');
    await rehydrateFromStorage();
    expect(store().companyId).toBeNull();
    expect((store() as any).companyName).toBe('');
    expect(JSON.parse(memoryStorage.get('strategy-store-v5')!).state.companyName).toBe('B');
  });

  it('所属確認後は、選択中の会社（A）のデータだけを読み込み、旧会社（B）は読み込まない', async () => {
    persistCompany(COMPANY_B, 'B');
    await rehydrateFromStorage();
    mockUser.companyId = COMPANY_A;
    await store().refetchFromServer();
    expect(mockGetFull.mock.calls.every((c) => c[0] === COMPANY_A)).toBe(true);
    expect(store().companyId).toBe(COMPANY_A);
    expect((store() as any).companyName).toBe('A');
    expect(JSON.parse(memoryStorage.get('strategy-store-v5')!).state.companyName).toBe('A');
  });

  it('所属確認前の読み込みは取得せず、確認後に選択中の会社を読み込む', async () => {
    persistCompany(COMPANY_B, 'B');
    await rehydrateFromStorage();
    mockUser.membershipVerified = false;
    mockUser.companyId = COMPANY_B;
    await store().refetchFromServer();
    expect(mockGetFull).not.toHaveBeenCalled();
    expect((store() as any).companyName).toBe('');

    mockUser.membershipVerified = true;
    mockUser.companyId = COMPANY_A;
    mockListeners.forEach((l) => l(mockUser));
    await flush();
    await flush();
    expect(mockGetFull.mock.calls.at(-1)?.[0]).toBe(COMPANY_A);
    expect((store() as any).companyName).toBe('A');
  });

  it('所属がなくなった場合は、永続化された会社データを消して保存領域からも削除する', async () => {
    persistCompany(COMPANY_B, 'B');
    await rehydrateFromStorage();
    mockUser.membershipVerified = true;
    mockUser.companyId = null;
    mockListeners.forEach((l) => l(mockUser));
    await flush();
    expect((store() as any).companyName).toBe('');
    expect(JSON.parse(memoryStorage.get('strategy-store-v5')!).state.companyName).toBe('');
  });

  it('会社を切り替えた瞬間、旧会社の表示データを消す', async () => {
    mockUser.companyId = COMPANY_A;
    await store().refetchFromServer();
    expect((store() as any).companyName).toBe('A');

    const holdB = deferred<ReturnType<typeof row>>();
    mockGetFull.mockImplementationOnce(() => holdB.promise);
    mockUser.companyId = COMPANY_B;
    store().setCompanyScope(COMPANY_B);
    expect((store() as any).companyName).toBe('');

    holdB.resolve(row(COMPANY_B, 'B'));
    await flush();
  });
});

const STRATEGY_A = 'strategy-A';

describe('保存応答と会社・戦略の切替', () => {
  beforeEach(() => {
    mockSaveWithAudit.mockReset();
    mockSaveWithAudit.mockImplementation(async () => ({ data: null, error: null }));
  });

  it('同じ会社の通常保存では、保存応答の戦略IDとリビジョンを反映する', async () => {
    mockUser.companyId = COMPANY_A;
    await store().refetchFromServer();

    mockSaveWithAudit.mockImplementationOnce(async () => ({
      data: { strategyId: STRATEGY_A, revision: 7, updatedAt: '2026-10-19T00:00:00.000Z' },
      error: null,
    }));
    const result = await store().saveStrategyData({ force: true, reason: 'manual' });

    expect(result.ok).toBe(true);
    expect(store().companyId).toBe(COMPANY_A);
    expect(store().strategyId).toBe(STRATEGY_A);
    expect(store().revision).toBe(7);
    expect(store()._loadingSave).toBe(false);
  });

  it('会社Aの保存中にBへ切り替え、Aの応答が後から届いてもBのストアは書き換わらない', async () => {
    mockUser.companyId = COMPANY_A;
    await store().refetchFromServer();

    const lateA = deferred<any>();
    mockSaveWithAudit.mockImplementationOnce(() => lateA.promise);
    const saving = store().saveStrategyData({ force: true, reason: 'manual' });
    await flush();
    expect(mockSaveWithAudit.mock.calls[0][2]).toBe(COMPANY_A);

    mockUser.companyId = COMPANY_B;
    store().setCompanyScope(COMPANY_B);
    await store().refetchFromServer();
    const before = {
      strategyId: store().strategyId,
      revision: store().revision,
    };
    expect((store() as any).companyName).toBe('B');

    lateA.resolve({
      data: {
        strategyId: 'strategy-A-late',
        revision: 99,
        updatedAt: '2026-10-19T00:00:00.000Z',
        financePL: [{ year: '2020', revenue: 111 }],
        stage3_strategy_bridge: { strategicCore: { marker: 'A-bridge' } },
      },
      error: null,
    });
    const result = await saving;

    expect(result).toMatchObject({ ok: false, reason: 'scope_changed' });
    expect(store().companyId).toBe(COMPANY_B);
    expect((store() as any).companyName).toBe('B');
    expect(store().strategyId).toBe(before.strategyId);
    expect(store().revision).toBe(before.revision);
    expect(JSON.stringify(store().stage3_strategy_bridge ?? null)).not.toContain('A-bridge');
    expect(JSON.stringify((store() as any).financePL ?? [])).not.toContain('111');
    expect(store()._loadingSave).toBe(false);
  });

  it('会社A→B→Aと切り替えた後、切替前の保存応答は現在のAの状態を壊さない', async () => {
    mockUser.companyId = COMPANY_A;
    await store().refetchFromServer();

    const lateOldA = deferred<any>();
    mockSaveWithAudit.mockImplementationOnce(() => lateOldA.promise);
    const saving = store().saveStrategyData({ force: true, reason: 'manual' });
    await flush();

    mockUser.companyId = COMPANY_B;
    store().setCompanyScope(COMPANY_B);
    await store().refetchFromServer();

    mockUser.companyId = COMPANY_A;
    store().setCompanyScope(COMPANY_A);
    await store().refetchFromServer();
    expect(store().companyId).toBe(COMPANY_A);
    expect((store() as any).companyName).toBe('A');
    const current = {
      strategyId: store().strategyId,
      revision: store().revision,
    };

    lateOldA.resolve({
      data: {
        strategyId: 'strategy-A-old',
        revision: 50,
        financePL: [{ year: '2019', revenue: 222 }],
        stage3_strategy_bridge: { strategicCore: { marker: 'A-old-bridge' } },
      },
      error: null,
    });
    const result = await saving;

    expect(result).toMatchObject({ ok: false, reason: 'scope_changed' });
    expect(store().companyId).toBe(COMPANY_A);
    expect((store() as any).companyName).toBe('A');
    expect(store().strategyId).toBe(current.strategyId);
    expect(store().revision).toBe(current.revision);
    expect(JSON.stringify(store().stage3_strategy_bridge ?? null)).not.toContain('A-old-bridge');
    expect(JSON.stringify((store() as any).financePL ?? [])).not.toContain('222');
  });
});

describe('STAGE1 財務入力状態の会社間分離', () => {
  const ROWS_A = [{ year: 2024, revenue_actual: 111, operating_income_actual: 11 }];

  it('1. 会社Aの手入力財務は、Aの状態に保持され、同じ会社の再読み込みでも維持される', async () => {
    mockUser.companyId = COMPANY_A;
    await store().refetchFromServer();
    useStrategyStore.setState({ financeActual: ROWS_A } as any);
    expect(store().financeActual).toEqual(ROWS_A);

    await store().refetchFromServer();
    expect(store().financeActual).toEqual(ROWS_A);
  });

  it('2. A→B切替後、Aの手入力財務はBの状態に残らない', async () => {
    mockUser.companyId = COMPANY_A;
    await store().refetchFromServer();
    useStrategyStore.setState({ financeActual: ROWS_A, financePlan: [{ year: 2025, revenue_plan: 222 }] } as any);

    mockUser.companyId = COMPANY_B;
    store().setCompanyScope(COMPANY_B);
    expect(store().financeActual).toBeUndefined();
    expect(store().financePlan).toBeUndefined();

    await store().refetchFromServer();
    expect(store().companyId).toBe(COMPANY_B);
    expect(store().financeActual).toBeUndefined();
    expect(store().financePlan).toBeUndefined();
  });

  it('3. A→B→Aと再切替しても、Aの手入力財務は戻らない', async () => {
    mockUser.companyId = COMPANY_A;
    await store().refetchFromServer();
    useStrategyStore.setState({ financeActual: ROWS_A } as any);

    mockUser.companyId = COMPANY_B;
    store().setCompanyScope(COMPANY_B);
    await store().refetchFromServer();
    mockUser.companyId = COMPANY_A;
    store().setCompanyScope(COMPANY_A);
    await store().refetchFromServer();

    expect(store().companyId).toBe(COMPANY_A);
    expect(store().financeActual).toBeUndefined();
  });

  it('4. 手入力財務は永続化された会社データに含まれない（既存の保存・復元経路は変えない）', async () => {
    mockUser.companyId = COMPANY_A;
    await store().refetchFromServer();
    useStrategyStore.setState({ financeActual: ROWS_A } as any);

    const persisted = memoryStorage.get('strategy-store-v5') ?? '';
    expect(persisted).not.toBe('');
    expect(persisted).not.toContain('financeActual');
    expect(persisted).not.toContain('111');
  });
});

describe('一括削除の対象会社の確認', () => {
  const originalFetch = globalThis.fetch;
  let fetchMock: jest.Mock;

  beforeEach(async () => {
    mockUser.companyId = COMPANY_A;
    await store().refetchFromServer();
    fetchMock = jest.fn(async () => new Response(JSON.stringify({ ok: true }), { status: 200 }));
    (globalThis as any).fetch = fetchMock;
  });

  afterEach(() => {
    (globalThis as any).fetch = originalFetch;
    memoryStorage.delete('__deleting_company__');
  });

  it('確認した会社と現在の会社が異なる場合は、削除APIを呼ばず、削除フラグも立てない', async () => {
    await expect(store().deleteAllOnServer(COMPANY_B)).rejects.toThrow('company changed before deletion');
    expect(fetchMock).not.toHaveBeenCalled();
    expect(memoryStorage.get('__deleting_company__')).toBeUndefined();
  });

  it('確認した会社と現在の会社が一致する場合は、削除APIに対象会社IDを送る', async () => {
    await store().deleteAllOnServer(COMPANY_A).catch(() => {});
    expect(fetchMock).toHaveBeenCalled();
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('/api/admin/data-management/delete-all');
    expect(init.body).toBe(JSON.stringify({ companyId: COMPANY_A }));
  });
});

describe('会社切替中の保存ガード（strategy_data 直接保存）', () => {
  async function loadCompany(companyId: string) {
    mockUser.companyId = companyId;
    await store().refetchFromServer();
    expect(store().companyId).toBe(companyId);
    expect(store().pendingCompanyId).toBeFalsy();
  }

  function saveCallsSince(before: number) {
    return mockSaveWithAudit.mock.calls.slice(before) as unknown[][];
  }

  function markStage6FinanceInput() {
    useStrategyStore.setState({ csvFinanceData: { financeBS: [{ year: '2026', amount: 1 }] } } as never);
  }

  it('A: 読込済みのA社は強制保存でも通常どおり保存され、A社の行を対象にする', async () => {
    await loadCompany(COMPANY_A);
    const before = mockSaveWithAudit.mock.calls.length;

    const result = await store().saveStrategyData({ force: true, reason: 'manual' });

    expect(result).toMatchObject({ ok: true });
    const calls = saveCallsSince(before);
    expect(calls).toHaveLength(1);
    expect(calls[0][2]).toBe(COMPANY_A);
  });

  it('C: 切替開始後・読込完了前の強制保存は、A社の行にもB社の行にも書き込まない', async () => {
    await loadCompany(COMPANY_A);
    const before = mockSaveWithAudit.mock.calls.length;

    store().setCompanyScope(COMPANY_B);
    expect(store().pendingCompanyId).toBe(COMPANY_B);

    const result = await store().saveStrategyData({ force: true, reason: 'manual' });

    expect(result).toMatchObject({ ok: false, skipped: true });
    expect(saveCallsSince(before)).toHaveLength(0);
  });

  it('G: 切替途中に財務データを添えた強制保存（STAGE6の手動保存相当）でも、B社の行を上書きしない', async () => {
    await loadCompany(COMPANY_A);
    store().setCompanyScope(COMPANY_B);
    markStage6FinanceInput();
    const before = mockSaveWithAudit.mock.calls.length;

    const result = await store().saveStrategyData({ force: true, reason: 'manual' });

    expect(result).toMatchObject({ ok: false, skipped: true });
    expect(saveCallsSince(before)).toHaveLength(0);
  });

  it('D: B社の読込完了後は、B社への保存が通常どおり再開される', async () => {
    await loadCompany(COMPANY_A);
    store().setCompanyScope(COMPANY_B);

    mockUser.companyId = COMPANY_B;
    await store().refetchFromServer();
    expect(store().companyId).toBe(COMPANY_B);
    expect(store().pendingCompanyId).toBeFalsy();

    const before = mockSaveWithAudit.mock.calls.length;
    const result = await store().saveStrategyData({ force: true, reason: 'manual' });

    expect(result).toMatchObject({ ok: true });
    const calls = saveCallsSince(before);
    expect(calls).toHaveLength(1);
    expect(calls[0][2]).toBe(COMPANY_B);
  });

  it('E: strategyId が未設定の状態で切替中に強制保存しても、どの会社の行にも書き込まない', async () => {
    await loadCompany(COMPANY_A);
    expect(store().strategyId).toBeFalsy();

    store().setCompanyScope(COMPANY_B);
    markStage6FinanceInput();
    const before = mockSaveWithAudit.mock.calls.length;

    const result = await store().saveStrategyData({ force: true, reason: 'manual' });

    expect(result).toMatchObject({ ok: false, skipped: true });
    expect(saveCallsSince(before)).toHaveLength(0);
  });

  it('F: 保留中の保存の再実行が、切替開始後に走っても対象外の会社へ書き込まない', async () => {
    await loadCompany(COMPANY_A);
    useStrategyStore.setState({ _pendingSave: true, _pendingSaveReason: 'pending' } as never);

    await store().saveStrategyData({ reason: 'manual' });
    const atSwitch = mockSaveWithAudit.mock.calls.length;

    store().setCompanyScope(COMPANY_B);
    markStage6FinanceInput();
    await flush();
    await flush();

    expect(mockSaveWithAudit.mock.calls.length).toBe(atSwitch);
  });

  it('H: 切替中に拒否された保存は保存済みとして表示されず、切替完了後に表示が解除される', async () => {
    await loadCompany(COMPANY_A);
    store().setCompanyScope(COMPANY_B);

    const result = await store().saveStrategyData({ force: true, reason: 'manual-save-button' });
    expect(result).toMatchObject({ ok: false, skipped: true, reason: 'company_switching' });
    expect(store().saveError).toBe(COMPANY_SWITCH_SAVE_MESSAGE);
    expect(COMPANY_SWITCH_SAVE_MESSAGE).toBe(
      '会社の切り替え中のため、保存されませんでした。切り替えが完了してから、もう一度保存してください。',
    );
    expect(COMPANY_SWITCH_SAVE_MESSAGE).not.toContain('company_switching');

    mockUser.companyId = COMPANY_B;
    await store().refetchFromServer();
    expect(store().companyId).toBe(COMPANY_B);
    expect(store().saveError).toBeUndefined();
  });
});

describe('A→B→A高速切替', () => {
  // layoutClient の 2.3 同期の比較（現行: store の companyId のみ）を再現する
  function layoutScopeSyncCurrent() {
    const userCompanyId = mockUser.companyId;
    if (store().companyId === userCompanyId) return;
    store().setCompanyScope(userCompanyId);
  }

  async function loadCompany(companyId: string) {
    mockUser.companyId = companyId;
    await store().refetchFromServer();
    expect(store().companyId).toBe(companyId);
  }

  it('B読込中にAへ戻すと、保留の切替先は最後に選んだAになり、Bは残らない', async () => {
    await loadCompany(COMPANY_A);

    mockUser.companyId = COMPANY_B;
    layoutScopeSyncCurrent();
    expect(store().pendingCompanyId).toBe(COMPANY_B);

    mockUser.companyId = COMPANY_A;
    layoutScopeSyncCurrent();
    expect(store().pendingCompanyId).toBe(COMPANY_A);

    await store().refetchFromServer();
    expect(store().companyId).toBe(COMPANY_A);
    expect(store().pendingCompanyId).toBeFalsy();
    expect(store().companyName).toBe('A');
  });

  it('B読込中にAへ戻し、遅れて届いたBの応答はA社の表示を上書きしない', async () => {
    await loadCompany(COMPANY_A);

    const holdB = deferred<ReturnType<typeof row>>();
    mockGetFull.mockImplementationOnce(() => holdB.promise);
    mockUser.companyId = COMPANY_B;
    layoutScopeSyncCurrent();
    const pB = store().refetchFromServer();

    mockUser.companyId = COMPANY_A;
    layoutScopeSyncCurrent();
    const pA = store().refetchFromServer();

    holdB.resolve(row(COMPANY_B, 'B-late'));
    await Promise.allSettled([pB, pA]);

    expect(store().companyId).toBe(COMPANY_A);
    expect(store().pendingCompanyId).toBeFalsy();
    expect(store().companyName).toBe('A');
    expect(store().companyName).not.toBe('B-late');
  });

  it('A→B→A後は、切替途中の保存を拒否し、読込完了後はA社へ保存できる', async () => {
    await loadCompany(COMPANY_A);

    mockUser.companyId = COMPANY_B;
    layoutScopeSyncCurrent();
    mockUser.companyId = COMPANY_A;
    layoutScopeSyncCurrent();

    const midSwitch = await store().saveStrategyData({ force: true, reason: 'manual' });
    expect(midSwitch).toMatchObject({ ok: false, skipped: true });

    await store().refetchFromServer();
    expect(store().companyId).toBe(COMPANY_A);

    const before = mockSaveWithAudit.mock.calls.length;
    const after = await store().saveStrategyData({ force: true, reason: 'manual' });
    expect(after).toMatchObject({ ok: true });
    const calls = mockSaveWithAudit.mock.calls.slice(before) as unknown[][];
    expect(calls.length).toBeGreaterThan(0);
    expect(calls.every((c) => c[2] === COMPANY_A)).toBe(true);
  });

  it('setCompanyScope で A→B→A と切り替えると、保留の切替先は最後に選んだAになる', async () => {
    await loadCompany(COMPANY_A);
    store().setCompanyScope(COMPANY_B);
    expect(store().pendingCompanyId).toBe(COMPANY_B);

    store().setCompanyScope(COMPANY_A);

    expect(store().pendingCompanyId).toBe(COMPANY_A);
    expect(store().companyId).not.toBe(COMPANY_B);
  });
});

describe('STAGE1 財務値の保存（円単位・桁による換算なし）', () => {
  beforeEach(() => {
    mockUser.companyId = COMPANY_A;
    useStrategyStore.setState({ companyId: COMPANY_A, restoreReady: true } as any);
  });

  it('会社PLは、円の値を桁で100万倍せず、そのまま保存する', () => {
    store().setFinancePL([{ year: 2024, revenue: 500_000, operatingIncome: 200_000, cogs: 300_000 }] as any);
    const row = (store().financePL as any[])[0];
    expect(row.revenue).toBe(500_000);
    expect(row.operatingIncome).toBe(200_000);
    expect(row.cogs).toBe(300_000);
  });

  it('会社PLの大きな円の値は、変換せずそのまま保存する', () => {
    store().setFinancePL([{ year: 2024, revenue: 1_234_567_890 }] as any);
    expect(((store().financePL as any[])[0]).revenue).toBe(1_234_567_890);
  });

  it('会社BS・セグメントPL/BSの値は、渡された円の値をそのまま保存する', () => {
    store().setFinanceBS([{ year: 2024, ar: 500_000, inventory: 0 }] as any);
    expect(((store().financeBS as any[])[0]).ar).toBe(500_000);
    store().setSegmentPL({ 'A事業': [{ year: 2024, revenue: 300_000 }] } as any);
    expect(store().segmentPL?.['A事業']?.[0]).toMatchObject({ revenue: 300_000 });
    store().setSegmentBS({ 'A事業': [{ year: 2024, ar: 40_000 }] } as any);
    expect(store().segmentBS?.['A事業']?.[0]).toMatchObject({ ar: 40_000 });
  });

  it('会社を切り替えると、前の会社の財務金額（円）は別会社へ混ざらない', async () => {
    mockUser.companyId = COMPANY_A;
    await store().refetchFromServer();
    store().setFinanceBS([{ year: 2024, ar: 500_000 }] as any);

    mockUser.companyId = COMPANY_B;
    store().setCompanyScope(COMPANY_B);
    await store().refetchFromServer();
    expect(store().companyId).toBe(COMPANY_B);
    expect(store().financeBS ?? []).toEqual([]);
  });

  it('STAGE1の財務金額は単位の選択を持たず、円の値のまま保持される', () => {
    store().setFinanceBS([{ year: 2024, ar: 500_000 }] as any);
    expect((store().financeBS as any[])[0].ar).toBe(500_000);
    expect((store() as any).setFinanceInputUnit).toBeUndefined();
    expect((store() as any).financeInputUnit).toBeUndefined();
  });
});

describe('旧財務データ（版数なし）の年度別保存（未更新年度は保存値を維持する）', () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const strategyModule = require('@/utils/supabase/strategy') as {
    buildStateFromDbRow: (row: any) => any;
    buildFinanceCsvUnitMeta: (state: any, existingCsv?: Record<string, unknown>) => Record<string, unknown>;
  };
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { FINANCE_PL_YEAR_ISSUE_MESSAGE } = require('@/utils/finance/financeInputUnits') as {
    FINANCE_PL_YEAR_ISSUE_MESSAGE: string;
  };

  const LEGACY_PL_RAW = [
    { year: 2024, revenue: 500_000, operatingIncome: 20_000 },
    { year: 2025, revenue: 300 },
    { year: 2026, revenue: 2_000_000 },
  ];

  const { FINANCE_PL_LEGACY_PARTIAL_MESSAGE } = require('@/utils/finance/financeInputUnits') as {
    FINANCE_PL_LEGACY_PARTIAL_MESSAGE: string;
  };

  let dbRows: Record<string, any>;

  function legacyRow(companyId: string) {
    return {
      company_id: companyId,
      revision: 1,
      finance_pl: JSON.parse(JSON.stringify(LEGACY_PL_RAW)),
      csv_finance_data: {},
    };
  }

  /** 読込は実物の buildStateFromDbRow を通す（F5 相当） */
  function readFromDb(companyId: string) {
    return { data: strategyModule.buildStateFromDbRow(dbRows[companyId]), error: null };
  }

  /** 保存は strategy.ts の更新と同じ列の扱いで DB 行へ反映する（finance_pl は会社PLを書く保存のときだけ置き換え） */
  function writeToDb(companyId: string, payload: any) {
    const existingCsv = (dbRows[companyId].csv_finance_data ?? {}) as Record<string, unknown>;
    dbRows[companyId] = {
      ...dbRows[companyId],
      revision: (dbRows[companyId].revision ?? 0) + 1,
      finance_pl: payload.financePL ?? dbRows[companyId].finance_pl,
      csv_finance_data: { ...existingCsv, ...strategyModule.buildFinanceCsvUnitMeta(payload, existingCsv) },
    };
  }

  function resetStoreAsFreshPage() {
    useStrategyStore.setState({
      companyId: null,
      pendingCompanyId: undefined,
      financePL: undefined,
      legacyFinancePLRaw: undefined,
      financeUnitConfirmed: undefined,
      restoreReady: false,
      dirty: false,
    } as any);
  }

  async function loadAs(companyId: string) {
    mockUser.companyId = companyId;
    store().setCompanyScope(companyId);
    await store().refetchFromServer();
    expect(store().companyId).toBe(companyId);
    expect(store().restoreReady).toBe(true);
  }

  async function saveAndPersist(): Promise<any> {
    const before = mockSaveWithAudit.mock.calls.length;
    const result = await store().saveStrategyData({ force: true, reason: 'manual' });
    expect(result).toMatchObject({ ok: true });
    const calls = mockSaveWithAudit.mock.calls.slice(before) as unknown[][];
    expect(calls).toHaveLength(1);
    const [payload, , companyId] = calls[0] as [any, unknown, string];
    writeToDb(companyId, payload);
    return payload;
  }

  const plRevenues = () => ((store().financePL ?? []) as any[]).map((r) => r.revenue);

  beforeEach(() => {
    dbRows = { [COMPANY_A]: legacyRow(COMPANY_A) };
    mockGetFull.mockImplementation(async (id: string) => readFromDb(id));
    mockSaveWithAudit.mockClear();
    resetStoreAsFreshPage();
  });

  it('旧データは換算後の値で表示し、保存用に換算前の年度を保持する（保存値と表示値は異なる）', async () => {
    await loadAs(COMPANY_A);
    expect(plRevenues()).toEqual([500_000_000_000, 300_000_000, 2_000_000]);
    expect(store().legacyFinancePLRaw).toEqual(LEGACY_PL_RAW);
    expect(store().financeUnitConfirmed?.pl).toEqual([]);
  });

  it('STAGE2など財務以外を保存しても、旧データのPLはDBの値のまま変わらない', async () => {
    await loadAs(COMPANY_A);
    useStrategyStore.setState({ ceoIntent: '経営者の思い', dirty: true } as any);

    const payload = await saveAndPersist();

    expect(payload.financePL).toEqual(LEGACY_PL_RAW);
    expect(dbRows[COMPANY_A].finance_pl).toEqual(LEGACY_PL_RAW);
    resetStoreAsFreshPage();
    await loadAs(COMPANY_A);
    expect(plRevenues()).toEqual([500_000_000_000, 300_000_000, 2_000_000]);
  });

  it('2026年度だけ円で更新すると、2026年度だけ円の値で保存され、2024・2025年度はDBの値のまま', async () => {
    await loadAs(COMPANY_A);
    const next = (store().financePL as any[]).map((r) => (r.year === 2026 ? { ...r, revenue: 500_000 } : r));
    store().setFinancePL(next);

    const payload = await saveAndPersist();

    expect(payload.financePL.slice(0, 2)).toEqual([
      { year: 2024, revenue: 500_000, operatingIncome: 20_000 },
      { year: 2025, revenue: 300 },
    ]);
    expect(payload.financePL[2]).toMatchObject({ year: 2026, revenue: 500_000 });
    expect(dbRows[COMPANY_A].finance_pl).toEqual(payload.financePL);
    expect(dbRows[COMPANY_A].csv_finance_data.financeUnitConfirmed.pl).toEqual([2026]);

    resetStoreAsFreshPage();
    await loadAs(COMPANY_A);
    expect(plRevenues()).toEqual([500_000_000_000, 300_000_000, 500_000]);
    expect(store().legacyFinancePLRaw).toEqual([
      { year: 2024, revenue: 500_000, operatingIncome: 20_000 },
      { year: 2025, revenue: 300 },
    ]);
  });

  it('2025年度だけ手入力で編集しても、他の年度の金額は変わらず、F5後も3年度とも正しく復元される', async () => {
    await loadAs(COMPANY_A);
    const next = (store().financePL as any[]).map((r) => (r.year === 2025 ? { ...r, revenue: 800 } : r));
    store().setFinancePL(next);

    await saveAndPersist();

    const dbPl = dbRows[COMPANY_A].finance_pl;
    expect(dbPl[0]).toEqual({ year: 2024, revenue: 500_000, operatingIncome: 20_000 });
    expect(dbPl[1]).toMatchObject({ year: 2025, revenue: 800 });
    expect(dbPl[2]).toEqual({ year: 2026, revenue: 2_000_000 });
    expect(dbRows[COMPANY_A].csv_finance_data.financeUnitConfirmed.pl).toEqual([2025]);

    resetStoreAsFreshPage();
    await loadAs(COMPANY_A);
    expect(plRevenues()).toEqual([500_000_000_000, 800, 2_000_000]);
  });

  it('表示値を変えずに会社PLを書き込んでも、未更新の年度は確定扱いにならない', async () => {
    await loadAs(COMPANY_A);
    store().setFinancePL((store().financePL as any[]).map((r) => ({ ...r })));

    const payload = await saveAndPersist();

    expect(payload.financePL).toEqual(LEGACY_PL_RAW);
    expect(store().financeUnitConfirmed?.pl).toEqual([]);
    expect(dbRows[COMPANY_A].csv_finance_data.financeUnitConfirmed?.pl).toEqual([]);
  });

  it('全体保存（会社BS・セグメントを含む）でも、未更新の旧年度は変わらない', async () => {
    await loadAs(COMPANY_A);
    store().setFinanceBS([{ year: 2024, ar: 40_000 }] as any);
    store().setSegmentPL({ 'A事業': [{ year: 2024, revenue: 300_000 }] } as any);

    const payload = await saveAndPersist();

    expect(payload.financePL).toEqual(LEGACY_PL_RAW);
    expect(payload.financeBS).toEqual([{ year: 2024, ar: 40_000 }]);
    expect(dbRows[COMPANY_A].finance_pl).toEqual(LEGACY_PL_RAW);
    expect(dbRows[COMPANY_A].csv_finance_data.financeUnitConfirmed).toMatchObject({ bs: true, segmentPL: [], pl: [] });
    resetStoreAsFreshPage();
    await loadAs(COMPANY_A);
    expect(plRevenues()).toEqual([500_000_000_000, 300_000_000, 2_000_000]);
  });

  it('PLの一部年度だけ更新しても、未確定の会社BS・セグメントは確定扱いにならない', async () => {
    await loadAs(COMPANY_A);
    const next = (store().financePL as any[]).map((r) => (r.year === 2026 ? { ...r, revenue: 500_000 } : r));
    store().setFinancePL(next);

    const payload = await saveAndPersist();

    expect(payload.financeUnitConfirmed?.bs ?? false).toBe(false);
    expect(payload.financeUnitConfirmed?.segmentPL ?? []).toEqual([]);
    expect(payload.financeUnitConfirmed?.segmentBS ?? []).toEqual([]);
  });

  it('年度の重複がある会社PLは更新を受け付けず、理由を表示し、保存もしない', async () => {
    dbRows[COMPANY_A] = {
      ...legacyRow(COMPANY_A),
      finance_pl: [
        { year: 2025, revenue: 300 },
        { year: 2025, revenue: 400 },
      ],
    };
    await loadAs(COMPANY_A);
    const before = [...(store().financePL as any[])];

    store().setFinancePL([{ year: 2025, revenue: 900 }] as any);

    expect(store().saveError).toBe(FINANCE_PL_YEAR_ISSUE_MESSAGE);
    expect(store().financePL).toEqual(before);
    const payload = await saveAndPersist();
    expect(payload).not.toHaveProperty('financePL');
  });

  it('会社を切り替えると、旧会社の年度別の確定と換算前の値は新会社の保存に使われない', async () => {
    await loadAs(COMPANY_A);
    const next = (store().financePL as any[]).map((r) => (r.year === 2026 ? { ...r, revenue: 500_000 } : r));
    store().setFinancePL(next);
    await saveAndPersist();

    dbRows[COMPANY_B] = {
      company_id: COMPANY_B,
      revision: 1,
      finance_pl: [{ year: 2024, revenue: 700_000 }],
      csv_finance_data: { financeUnitConfirmed: { pl: [2024] } },
    };
    await loadAs(COMPANY_B);

    expect(store().legacyFinancePLRaw).toBeUndefined();
    expect(plRevenues()).toEqual([700_000]);
    const payload = await saveAndPersist();
    expect(payload.financePL).toEqual([{ year: 2024, revenue: 700_000 }]);
    expect(payload.financeUnitConfirmed.pl).toEqual([2024]);
  });

  it('取り消しで編集前の状態に戻すと、未確定の年度は換算前の値のまま保存され、確定もしない', async () => {
    await loadAs(COMPANY_A);
    const before = {
      financePL: store().financePL as any[],
      legacyFinancePLRaw: store().legacyFinancePLRaw,
      confirmedYears: [] as number[],
    };
    store().setFinancePL((store().financePL as any[]).map((r) => (r.year === 2025 ? { ...r, revenue: 800 } : r)));

    store().restoreFinancePLState(before);
    const payload = await saveAndPersist();

    expect(payload.financePL).toEqual(LEGACY_PL_RAW);
    expect(dbRows[COMPANY_A].finance_pl).toEqual(LEGACY_PL_RAW);
    expect(store().financeUnitConfirmed?.pl).toEqual([]);
  });

  it('未確定の旧年度で売上だけを更新しても、その年度は適用されず、営業利益も円として確定されない', async () => {
    await loadAs(COMPANY_A);
    store().setFinancePL((store().financePL as any[]).map((r) => (r.year === 2024 ? { ...r, revenue: 600_000 } : r)));

    expect(store().saveError).toBe(FINANCE_PL_LEGACY_PARTIAL_MESSAGE);
    expect(plRevenues()[0]).toBe(500_000_000_000);
    const payload = await saveAndPersist();
    expect(payload.financePL).toEqual(LEGACY_PL_RAW);
    expect(dbRows[COMPANY_A].finance_pl).toEqual(LEGACY_PL_RAW);
    expect(store().financeUnitConfirmed?.pl).toEqual([]);
  });

  it('旧年度の必要項目をまとめて更新すると、その年度だけ円で保存され、F5後も変わらない', async () => {
    await loadAs(COMPANY_A);
    store().setFinancePL(
      (store().financePL as any[]).map((r) =>
        r.year === 2024 ? { ...r, revenue: 600_000, operatingIncome: 30_000 } : r,
      ),
    );
    expect(store().saveError).toBeUndefined();

    const payload = await saveAndPersist();
    expect(payload.financePL[0]).toMatchObject({ year: 2024, revenue: 600_000, operatingIncome: 30_000 });
    expect(dbRows[COMPANY_A].finance_pl.slice(1)).toEqual(LEGACY_PL_RAW.slice(1));
    expect(dbRows[COMPANY_A].csv_finance_data.financeUnitConfirmed.pl).toEqual([2024]);

    resetStoreAsFreshPage();
    await loadAs(COMPANY_A);
    expect(plRevenues()).toEqual([600_000, 300_000_000, 2_000_000]);
    expect((store().financePL as any[])[0].operatingIncome).toBe(30_000);
  });

  it('確定済みの年度では、一部の項目だけの編集と新しい年度の追加ができる', async () => {
    await loadAs(COMPANY_A);
    store().setFinancePL(
      (store().financePL as any[]).map((r) =>
        r.year === 2024 ? { ...r, revenue: 600_000, operatingIncome: 30_000 } : r,
      ),
    );
    store().setFinancePL((store().financePL as any[]).map((r) => (r.year === 2024 ? { ...r, revenue: 700_000 } : r)));
    expect(store().saveError).toBeUndefined();
    store().setFinancePL([...(store().financePL as any[]), { year: 2027, revenue: 1_000 }]);
    expect(store().saveError).toBeUndefined();

    const payload = await saveAndPersist();
    expect(payload.financePL[0]).toMatchObject({ year: 2024, revenue: 700_000, operatingIncome: 30_000 });
    expect(payload.financePL[3]).toEqual({ year: 2027, revenue: 1_000 });
    expect(payload.financeUnitConfirmed.pl).toEqual([2024, 2027]);
  });

  it('取り消し・やり直しで会社PLの確定状態が壊れず、保存値も一致する', async () => {
    await loadAs(COMPANY_A);
    const before = {
      financePL: store().financePL as any[],
      legacyFinancePLRaw: store().legacyFinancePLRaw,
      confirmedYears: [] as number[],
    };
    store().setFinancePL(
      (store().financePL as any[]).map((r) =>
        r.year === 2024 ? { ...r, revenue: 600_000, operatingIncome: 30_000 } : r,
      ),
    );
    const after = {
      financePL: store().financePL as any[],
      legacyFinancePLRaw: store().legacyFinancePLRaw,
      confirmedYears: [2024],
    };

    store().restoreFinancePLState(before);
    const undone = await saveAndPersist();
    expect(undone.financePL).toEqual(LEGACY_PL_RAW);
    expect(store().financeUnitConfirmed?.pl).toEqual([]);

    store().restoreFinancePLState(after);
    const redone = await saveAndPersist();
    expect(redone.financePL[0]).toMatchObject({ year: 2024, revenue: 600_000, operatingIncome: 30_000 });
    expect(redone.financePL.slice(1)).toEqual(LEGACY_PL_RAW.slice(1));
    expect(store().financeUnitConfirmed?.pl).toEqual([2024]);
  });

  it('会社を切り替えると、旧会社の部分更新の案内は残らない', async () => {
    await loadAs(COMPANY_A);
    store().setFinancePL((store().financePL as any[]).map((r) => (r.year === 2024 ? { ...r, revenue: 600_000 } : r)));
    expect(store().saveError).toBe(FINANCE_PL_LEGACY_PARTIAL_MESSAGE);

    dbRows[COMPANY_B] = {
      company_id: COMPANY_B,
      revision: 1,
      finance_pl: [{ year: 2024, revenue: 700_000 }],
      csv_finance_data: { financeUnitConfirmed: { pl: [2024] } },
    };
    await loadAs(COMPANY_B);

    expect(store().saveError).toBeUndefined();
    expect(plRevenues()).toEqual([700_000]);
  });

  it('表示単位の確定が不明な会社PLは保存に含めず、保存済みの値を残す', async () => {
    await loadAs(COMPANY_A);
    useStrategyStore.setState({ financeUnitConfirmed: undefined, legacyFinancePLRaw: undefined } as any);

    const payload = await saveAndPersist();

    expect(payload).not.toHaveProperty('financePL');
  });
});
