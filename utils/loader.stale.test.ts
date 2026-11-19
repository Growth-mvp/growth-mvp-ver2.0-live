type FakeState = {
  companyId: string | null;
  pendingCompanyId?: string;
  restoreReady: boolean;
  loaded: boolean;
  hydrated: boolean;
  markLoaded: jest.Mock;
  setHydrating: jest.Mock;
  setCompanyScope: jest.Mock;
  refetchFromServer: jest.Mock;
};

let fake: FakeState;

jest.doMock('@/store/strategyStore', () => ({
  useStrategyStore: {
    getState: () => fake,
    setState: (patch: Partial<FakeState> | ((s: FakeState) => Partial<FakeState>)) => {
      Object.assign(fake, typeof patch === 'function' ? patch(fake) : patch);
    },
  },
}));

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { loadAndHydrate } = require('./loader') as typeof import('./loader');

function freshState(): FakeState {
  return {
    companyId: null,
    pendingCompanyId: undefined,
    restoreReady: false,
    loaded: false,
    hydrated: false,
    markLoaded: jest.fn(),
    setHydrating: jest.fn(),
    setCompanyScope: jest.fn((id: string) => {
      fake.pendingCompanyId = id;
    }),
    refetchFromServer: jest.fn(),
  };
}

beforeEach(() => {
  fake = freshState();
  jest.spyOn(console, 'warn').mockImplementation(() => undefined);
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe('会社の読み込み（loader）の後始末（第1弾の残存リスク）', () => {
  it('読み込みが成功したら、その会社で保存可能な状態にする', async () => {
    fake.refetchFromServer.mockImplementation(async () => {
      fake.companyId = 'A';
      fake.pendingCompanyId = undefined;
      fake.restoreReady = true;
    });
    await loadAndHydrate('A');
    expect(fake.markLoaded).toHaveBeenCalledTimes(1);
    expect(fake.setHydrating).toHaveBeenCalledWith(false);
  });

  it('読み込み中に別の会社へ切り替わったら、古い会社の結果で新しい会社の状態を変えない', async () => {
    fake.refetchFromServer.mockImplementation(async () => {
      // 後から会社Bの読み込みが始まった
      fake.pendingCompanyId = 'B';
      fake.companyId = 'A';
      fake.restoreReady = true;
    });
    await loadAndHydrate('A');
    expect(fake.markLoaded).not.toHaveBeenCalled();
    expect(fake.setHydrating).not.toHaveBeenCalledWith(false);
    expect(fake.loaded).toBe(false);
    expect(fake.hydrated).toBe(false);
  });

  it('失敗しても、保存は止めたままにする（復元の成功として扱わない）', async () => {
    fake.refetchFromServer.mockRejectedValue(new Error('network'));
    await expect(loadAndHydrate('A')).rejects.toThrow();
    expect(fake.markLoaded).not.toHaveBeenCalled();
    expect(fake.loaded).toBe(true);
    expect(fake.hydrated).toBe(false);
  });
});
