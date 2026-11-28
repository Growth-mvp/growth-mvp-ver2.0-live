/* STAGE1の直接反映（applyStageOp）を実際のストアで確認する。
 * 手動入力と同じ単位確定状態になること、他の項目の未保存変更を守ること、権限確認中の変化で上書きしないこと。Supabase 通信のみモック。 */
/* eslint-disable @typescript-eslint/no-explicit-any -- テストデータは型を緩くしている */
export {};

jest.mock('./userStore', () => ({
  useUserStore: {
    getState: () => ({ user: { id: 'u1' }, role: 'manager', companyId: 'c1', membershipVerified: true }),
    subscribe: () => () => {},
  },
}));

jest.mock('@/utils/supabase/strategy', () => {
  const actual = jest.requireActual('@/utils/supabase/strategy');
  return {
    ...actual,
    getFullStrategyDataByCompany: jest.fn(async () => ({ data: null, error: null })),
    saveStrategyData: jest.fn(async () => ({ ok: true })),
  };
});

jest.mock('@/utils/supabase/client', () => ({
  supabase: {
    auth: { getSession: jest.fn(async () => ({ data: { session: { access_token: 't', user: { id: 'u1' } } } })) },
  },
  safeGetSession: async () => ({ data: { session: null }, error: null }),
  getCompanyIdFromCookie: () => null,
  setCompanyIdCookie: () => {},
  isValidUUID: () => false,
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
const { useStrategyStore } = require('./strategyStore') as typeof import('./strategyStore');
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { applyStageOp } = require('@/lib/aiOperations/applyDirect') as typeof import('@/lib/aiOperations/applyDirect');
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { supabase } = require('@/utils/supabase/client') as typeof import('@/utils/supabase/client');

const OP_2025: any = { kind: 'finance', table: 'pl', key: 'operatingIncome', label: '営業利益', year: 2025, yen: 5_000_000 };

function setScope(over: Record<string, unknown> = {}) {
  useStrategyStore.setState({
    companyId: 'c1',
    strategyId: 's1',
    revision: 3,
    dirty: false,
    financePL: [{ year: 2024, revenue: 100 }],
    financeUnitConfirmed: { pl: [2024] },
    ...over,
  } as any);
}

function authorizeOk(onCall?: () => void) {
  global.fetch = jest.fn(async () => {
    onCall?.();
    return { ok: true, json: async () => ({ revision: 3 }) };
  }) as unknown as typeof fetch;
}

beforeEach(() => {
  jest.clearAllMocks();
  setScope();
  authorizeOk();
});

describe('STAGE1の直接反映：財務データの単位確定状態', () => {
  it('AI反映の確定状態は、財務表の手動入力（同じ setFinancePL）と同じになる', async () => {
    const r = await applyStageOp(OP_2025);
    expect(r.ok).toBe(true);
    const aiRows = useStrategyStore.getState().financePL;
    const aiConfirmed = useStrategyStore.getState().financeUnitConfirmed?.pl;

    setScope();
    useStrategyStore.getState().setFinancePL(aiRows as any);

    expect(aiConfirmed).toEqual([2024, 2025]);
    expect(useStrategyStore.getState().financeUnitConfirmed?.pl).toEqual(aiConfirmed);
  });

  it('AI反映は、他の年度の値と、他の項目の未保存変更を変えない', async () => {
    setScope({ companyName: '未保存の社名', dirty: true, financePL: [{ year: 2024, revenue: 100, operatingIncome: 7 }] });
    const r = await applyStageOp(OP_2025);
    expect(r.ok).toBe(true);
    const s = useStrategyStore.getState() as any;
    expect(s.companyName).toBe('未保存の社名');
    expect(s.financePL).toEqual([
      { year: 2024, revenue: 100, operatingIncome: 7 },
      { year: 2025, operatingIncome: 5_000_000 },
    ]);
  });
});

describe('STAGE1の直接反映：権限確認中の変化', () => {
  it('同じ項目を手動で変えていたら、AIの反映で上書きしない', async () => {
    authorizeOk(() => {
      useStrategyStore.setState({ financePL: [{ year: 2024, revenue: 100 }, { year: 2025, operatingIncome: 2_000_000 }] } as any);
    });
    const r = await applyStageOp(OP_2025);
    expect(r.ok).toBe(false);
    expect((useStrategyStore.getState() as any).financePL).toEqual([
      { year: 2024, revenue: 100 },
      { year: 2025, operatingIncome: 2_000_000 },
    ]);
  });

  it('企業が切り替わっていたら反映しない', async () => {
    authorizeOk(() => {
      useStrategyStore.setState({ companyId: 'c2' } as any);
    });
    const r = await applyStageOp(OP_2025);
    expect(r.ok).toBe(false);
    expect((useStrategyStore.getState() as any).financePL).toEqual([{ year: 2024, revenue: 100 }]);
  });

  it('利用者が切り替わっていたら反映しない', async () => {
    (supabase.auth.getSession as jest.Mock).mockResolvedValueOnce({ data: { session: { access_token: 't', user: { id: 'u2' } } } });
    const r = await applyStageOp(OP_2025);
    expect(r.ok).toBe(false);
    expect((useStrategyStore.getState() as any).financePL).toEqual([{ year: 2024, revenue: 100 }]);
  });
});
