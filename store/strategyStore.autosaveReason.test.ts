/* 自動保存の保存ガード。未変更の画面を開いただけでは書き込まず、変更があるときだけ書くことを、ストア実体で確認する。Supabase 通信のみモック。 */

export {};

const mockUser: { user: { id: string } | null; companyId: string | null; membershipVerified: boolean } = {
  user: { id: 'user-1' },
  companyId: 'co-1',
  membershipVerified: true,
};

/* 既存行の保存は、版番号が1つ進んだ行を返す（店側の版の検証に合わせる） */
const mockSave = jest.fn<any, any[]>(async (_payload: any, _userId: any, _companyId: any, revisionBefore: any) => ({
  data: { id: 'st-1', revision: (typeof revisionBefore === 'number' ? revisionBefore : 0) + 1, updated_at: new Date().toISOString() },
  error: null,
}));

jest.mock('./userStore', () => ({
  useUserStore: {
    getState: () => mockUser,
    subscribe: () => () => {},
  },
}));

jest.mock('@/utils/supabase/strategy', () => {
  const actual = jest.requireActual('@/utils/supabase/strategy');
  return {
    getFullStrategyDataByCompany: jest.fn(),
    saveStrategyData: (...args: any[]) => mockSave(...args),
    buildStateFromDbRow: actual.buildStateFromDbRow,
    buildFinanceCsvUnitMeta: actual.buildFinanceCsvUnitMeta,
    countTotalProjects: (depts: any[]) => (depts ?? []).reduce((n: number, d: any) => n + (d?.projects ?? []).length, 0),
    getFullStrategyDataByStrategyId: jest.fn(),
    deleteStrategyData: jest.fn(),
  };
});

import { useStrategyStore } from './strategyStore';

const get = () => useStrategyStore.getState() as any;

const loadedState = (dirty: boolean) =>
  ({
    companyId: 'co-1',
    strategyId: 'st-1',
    hydrated: true,
    restoreReady: true,
    isRestoring: false,
    revision: 3,
    dirty,
    __isFetchingFromServer: false,
    boot: { isHydrating: false, isHydrated: true, isSaving: false },
    departments: [{ id: 'd1', name: '営業部', projects: [{ id: 'p1', title: '開拓' }] }],
    __lastSavedHash: undefined,
  }) as any;

describe('自動保存の保存ガード（dirty・同一ハッシュ）', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    useStrategyStore.setState(loadedState(false));
  });

  it('未変更の状態で自動保存（reason: autosave）を呼んでも、DBへは書き込まない', async () => {
    const res = await get().saveStrategyData({ reason: 'autosave' });
    expect(res).toMatchObject({ ok: false, skipped: true, reason: 'dirty_false' });
    expect(mockSave).not.toHaveBeenCalled();
  });

  it('変更がある状態で自動保存（reason: autosave）を呼ぶと、書き込む', async () => {
    useStrategyStore.setState(loadedState(true));
    await get().saveStrategyData({ reason: 'autosave' });
    expect(mockSave).toHaveBeenCalledTimes(1);
  });

  it('理由を省いた呼び出しは既定の手動保存として扱われ、未変更でも書き込む（従来の自動保存の原因）', async () => {
    await get().saveStrategyData();
    expect(mockSave).toHaveBeenCalledTimes(1);
  });
});
