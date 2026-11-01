/* 会社切替・ログアウト・保存で、別会社のデータが表示・保存に混ざらないことをストア実体で確認する。Supabase 通信と認証のみモック。 */

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
const mockSave = jest.fn<any, any[]>(async () => ({ ok: true }));

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

import { useStrategyStore } from './strategyStore';
import { buildStateFromDbRow } from '@/utils/supabase/strategy';
import { hardResetForCompanySwitch } from '@/utils/resetAll';

const COMPANY_A = '11111111-1111-4111-8111-111111111111';
const COMPANY_B = '22222222-2222-4222-8222-222222222222';
const STRATEGY_A = '33333333-3333-4333-8333-333333333333';
const STRATEGY_B = '44444444-4444-4444-8444-444444444444';
const NOW = '2026-10-30T00:00:00.000Z';
const MIDTERM_A = { priorityStrategicThemes: ['A社だけの中計テーマ'] } as any;

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

function lastSavePayloadText(): string {
  const call = mockSave.mock.calls[mockSave.mock.calls.length - 1];
  return JSON.stringify(call);
}

beforeEach(() => {
  jest.clearAllMocks();
  mockUser.companyId = null;
  get().resetAll();
});

describe('R1: 会社Aの中計が会社Bの保存に混ざらない', () => {
  it('会社Aの中計を持ったまま会社Bへ切り替えて保存すると、会社Aの中計は会社Bの行に送られない', async () => {
    get().setCompanyScope(COMPANY_A);
    useStrategyStore.setState({ companyId: COMPANY_A, pendingCompanyId: undefined, midtermStrategy: MIDTERM_A } as any);
    mockUser.companyId = COMPANY_A;

    hardResetForCompanySwitch(COMPANY_B);
    mockFetchByCompany.mockResolvedValueOnce(serverResult(rowOf({ company_id: COMPANY_B, opportunity: 'B社の機会' })));
    await get().refetchOnceFromServer();
    useStrategyStore.setState({ companyName: 'B社', dirty: true } as any);
    await get().saveStrategyData({ force: true, reason: 'test-r1' });

    expect(mockSave).toHaveBeenCalled();
    expect(lastSavePayloadText()).not.toContain('A社だけの中計テーマ');
    expect(lastSavePayloadText()).toContain(COMPANY_B);
  });

  it('会社Aの中計は、リセット後の状態から消えている', () => {
    get().setCompanyScope(COMPANY_A);
    useStrategyStore.setState({ companyId: COMPANY_A, pendingCompanyId: undefined, midtermStrategy: MIDTERM_A } as any);

    hardResetForCompanySwitch(COMPANY_B);

    expect(get().midtermStrategy).toBeUndefined();
  });
});

describe('R2: 会社切替のリセット後も store アクションが動く', () => {
  it('resetAll の後に setCompanyScope を呼ぶと、切替先の会社が保留状態に入る', () => {
    get().resetAll();
    get().setCompanyScope(COMPANY_B);

    expect(get().pendingCompanyId).toBe(COMPANY_B);
  });

  it('hardResetForCompanySwitch の後、切替先の会社が保留状態に入る', () => {
    useStrategyStore.setState({ companyId: COMPANY_A, pendingCompanyId: undefined } as any);

    hardResetForCompanySwitch(COMPANY_B);

    expect(get().pendingCompanyId).toBe(COMPANY_B);
    expect(get().companyId).toBeNull();
  });
});

describe('R3: 未初期化・切替途中の保存を拒否する', () => {
  it('会社IDのない状態（resetAll 直後）では、force でも保存しない', async () => {
    get().resetAll();
    mockUser.companyId = null;

    const res = await get().saveStrategyData({ force: true, reason: 'test-r3-uninit' });

    expect(res.ok).toBe(false);
    expect(res.reason).toBe('company_scope_missing');
    expect(mockSave).not.toHaveBeenCalled();
  });

  it('会社切替中（保留の会社がある）は、force でも保存せず DB に触れない', async () => {
    useStrategyStore.setState({ companyId: COMPANY_A, pendingCompanyId: COMPANY_B } as any);
    mockUser.companyId = COMPANY_A;

    const res = await get().saveStrategyData({ force: true, reason: 'test-r3-switching' });

    expect(res.ok).toBe(false);
    expect(res.reason).toBe('company_switching');
    expect(mockSave).not.toHaveBeenCalled();
  });

  it('表示中の会社と保存対象の会社が食い違う場合も保存しない', async () => {
    useStrategyStore.setState({ companyId: COMPANY_A, pendingCompanyId: undefined } as any);
    mockUser.companyId = COMPANY_B;

    const res = await get().saveStrategyData({ force: true, reason: 'test-r3-mismatch' });

    expect(res.ok).toBe(false);
    expect(mockSave).not.toHaveBeenCalled();
  });
});

describe('R4: ログアウト後の reset で会社データが残らない', () => {
  it('reset の後、中計と会社データは消える', () => {
    get().setCompanyScope(COMPANY_A);
    useStrategyStore.setState({
      companyId: COMPANY_A,
      pendingCompanyId: undefined,
      companyName: 'A社',
      midtermStrategy: MIDTERM_A,
    } as any);

    get().reset();

    expect(get().companyId).toBeNull();
    expect(get().companyName).toBe('');
    expect(get().midtermStrategy).toBeUndefined();
  });
});

describe('A→B→A の切替', () => {
  it('会社Aに戻っても、会社Bで作った保存対象の値は残らず、会社Aの中計も残らない', () => {
    get().setCompanyScope(COMPANY_A);
    useStrategyStore.setState({ companyId: COMPANY_A, pendingCompanyId: undefined, midtermStrategy: MIDTERM_A } as any);

    hardResetForCompanySwitch(COMPANY_B);
    useStrategyStore.setState({ companyId: COMPANY_B, pendingCompanyId: undefined, companyName: 'B社', midtermStrategy: { priorityStrategicThemes: ['B社の中計'] } } as any);

    hardResetForCompanySwitch(COMPANY_A);

    expect(get().companyId).toBeNull();
    expect(get().pendingCompanyId).toBe(COMPANY_A);
    expect(get().companyName).toBe('');
    expect(get().midtermStrategy).toBeUndefined();
  });
});

describe('保存失敗時の既存データ', () => {
  it('保存が失敗しても、画面上の既存の値は消えない', async () => {
    useStrategyStore.setState({ companyId: COMPANY_B, pendingCompanyId: undefined, companyName: 'B社', midtermStrategy: { priorityStrategicThemes: ['B社の中計'] } } as any);
    mockUser.companyId = COMPANY_B;
    mockSave.mockResolvedValueOnce({ error: new Error('network down') } as any);

    await get().saveStrategyData({ force: true, reason: 'test-save-failure' });

    expect(get().companyName).toBe('B社');
    expect(get().midtermStrategy).toEqual({ priorityStrategicThemes: ['B社の中計'] });
  });
});
