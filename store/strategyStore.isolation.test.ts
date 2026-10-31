/* 会社・strategy ID 間で状態が混ざらないことを、ストア実体で確認する。Supabase 通信と認証のみモック。 */

export {};

const mockUser: { user: { id: string } | null; companyId: string | null; membershipVerified: boolean } = {
  user: { id: 'user-1' },
  companyId: null,
  membershipVerified: true,
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

const COMPANY_A = '11111111-1111-4111-8111-111111111111';
const COMPANY_B = '22222222-2222-4222-8222-222222222222';
const STRATEGY_X = '33333333-3333-4333-8333-333333333333';
const STRATEGY_Y = '44444444-4444-4444-8444-444444444444';
const NOW = '2026-10-30T00:00:00.000Z';

const get = () => useStrategyStore.getState() as any;

function rowOf(over: Record<string, unknown>) {
  return {
    id: STRATEGY_X,
    company_id: COMPANY_A,
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

function deferred<T>() {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((r) => (resolve = r));
  return { promise, resolve };
}

const candidates = (texts: string[]) => ({ opportunity: texts, threat: [], generatedAt: NOW });

beforeEach(() => {
  jest.clearAllMocks();
  mockUser.companyId = null;
  useStrategyStore.setState({
    companyId: null,
    pendingCompanyId: undefined,
    strategyId: undefined,
    dirty: false,
    opportunity: '',
    threat: '',
    swotSuggestions: undefined,
  } as any);
});

describe('会社の切替と古い読み込み応答', () => {
  it('A→B→A と切り替えた後、先に出した読み込みの応答が遅れて届いても、新しい読み込みの内容を上書きしない', async () => {
    const first = deferred<any>();
    const second = deferred<any>();
    mockFetchByCompany.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);

    get().setCompanyScope(COMPANY_A);
    const p1 = get().refetchOnceFromServer().catch(() => {});
    get().setCompanyScope(COMPANY_B);
    get().setCompanyScope(COMPANY_A);
    const p2 = get().refetchOnceFromServer().catch(() => {});

    second.resolve(serverResult(rowOf({ opportunity: '新しい機会', revision: 2 })));
    await p2;
    first.resolve(serverResult(rowOf({ opportunity: '古い機会', revision: 1 })));
    await p1;

    expect(get().companyId).toBe(COMPANY_A);
    expect(get().opportunity).toBe('新しい機会');
  });

  it('会社Bへ切り替えている間に届いた会社Aの読み込み応答は、表示にも候補にも使わない', async () => {
    const aFetch = deferred<any>();
    mockFetchByCompany.mockReturnValueOnce(aFetch.promise);

    get().setCompanyScope(COMPANY_A);
    const pA = get().refetchOnceFromServer().catch(() => {});
    get().setCompanyScope(COMPANY_B);
    aFetch.resolve(serverResult(rowOf({ company_id: COMPANY_A, opportunity: 'A社の機会', swot_suggestions: candidates(['A社の候補']) })));
    await pA;

    expect(get().opportunity).not.toBe('A社の機会');
    expect(JSON.stringify(get().swotSuggestions ?? null)).not.toContain('A社の候補');
  });
});

describe('同じ会社の複数の strategy ID', () => {
  it('未保存の編集を持つ strategy X の状態へ、strategy Y の行を読み込んでも、X の候補と確定 SWOT を Y に持ち込まない', async () => {
    useStrategyStore.setState({
      companyId: COMPANY_A,
      pendingCompanyId: undefined,
      strategyId: STRATEGY_X,
      dirty: true,
      opportunity: 'X の確定機会',
      swotSuggestions: candidates(['X の候補']),
    } as any);
    mockFetchByCompany.mockResolvedValueOnce(
      serverResult(rowOf({ id: STRATEGY_Y, opportunity: 'Y の確定機会', swot_suggestions: candidates(['Y の候補']) }))
    );

    await get().refetchOnceFromServer();

    expect(get().strategyId).toBe(STRATEGY_Y);
    expect(get().opportunity).toBe('Y の確定機会');
    expect(get().swotSuggestions.opportunity).toEqual(['Y の候補']);
    expect(JSON.stringify(get().swotSuggestions)).not.toContain('X の候補');
  });

  it('strategy Y を読み込んだ後の保存は、Y の行と Y の候補だけを送る', async () => {
    get().setCompanyScope(COMPANY_A);
    mockFetchByCompany.mockResolvedValueOnce(
      serverResult(rowOf({ id: STRATEGY_Y, opportunity: 'Y の確定機会', swot_suggestions: candidates(['Y の候補']) }))
    );
    await get().refetchOnceFromServer();

    useStrategyStore.setState({ companyName: 'Y社' } as any);
    get().addSwotOpportunity('Y で追加した機会');
    await get().saveStrategyData({ force: true, reason: 'test' });

    expect(mockSave).toHaveBeenCalled();
    const [payload] = mockSave.mock.calls[mockSave.mock.calls.length - 1];
    expect(JSON.stringify(payload)).toContain(STRATEGY_Y);
    expect(JSON.stringify(payload)).not.toContain(STRATEGY_X);
    expect(JSON.stringify(payload)).not.toContain('X の候補');
  });
});
