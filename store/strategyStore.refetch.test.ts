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
  return {
    getFullStrategyDataByCompany: (...args: any[]) => mockGetFull(...args),
    saveStrategyData: (...args: any[]) => mockSave(...args),
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
