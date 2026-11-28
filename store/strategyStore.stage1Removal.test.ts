/* 事業の削除後も、保存の内容で事業ポートフォリオと事業セグメントが整合し、削除した事業が戻らないことを実際のストアで確認する。Supabase 通信のみモック。 */
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
const { useStrategyStore, buildSavePayload } = require('./strategyStore') as typeof import('./strategyStore');
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { applyStageOp } = require('@/lib/aiOperations/applyDirect') as typeof import('@/lib/aiOperations/applyDirect');
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { planRemoval } = require('@/lib/aiOperations/applyDirect') as typeof import('@/lib/aiOperations/applyDirect');
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { buildBusinessPortfolio, isGeneratedPortfolio } = require('@/lib/stage1/businessPortfolio') as typeof import('@/lib/stage1/businessPortfolio');
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { supabase } = require('@/utils/supabase/client') as typeof import('@/utils/supabase/client');

beforeEach(() => {
  jest.clearAllMocks();
  const segments = [
    { id: 'seg-1', name: '製造事業' },
    { id: 'seg-2', name: 'フィットネス' },
  ];
  useStrategyStore.setState({
    companyId: 'c1',
    strategyId: 's1',
    revision: 3,
    dirty: false,
    financePL: [{ year: 2024, revenue: 100 }],
    financeUnitConfirmed: { pl: [2024] },
    businessSegments: segments,
    segmentPL: {},
    segmentBS: {},
    stage1Issues: [{ title: '新規顧客の獲得が鈍い', description: '', linkedMetrics: [], scope: 'company' }],
    businessPortfolio: buildBusinessPortfolio({ segments }),
  } as any);
  global.fetch = jest.fn(async () => ({ ok: true, json: async () => ({ revision: 3 }) })) as unknown as typeof fetch;
  (supabase.auth.getSession as jest.Mock).mockResolvedValue({ data: { session: { access_token: 't', user: { id: 'u1' } } } });
});

describe('事業の削除後の保存内容（ポートフォリオとの整合）', () => {
  it('後から追加した未使用の事業を削除すると、保存の内容では事業セグメントとポートフォリオが一致し、削除した事業は戻らない', async () => {
    const plan = planRemoval({ type: 'segment', name: 'フィットネス' });
    expect(plan.ok).toBe(true);
    if (!plan.ok) return;
    const r = await applyStageOp(plan.op, { settleMs: 0 });
    expect(r.ok).toBe(true);

    const payload = JSON.parse(JSON.stringify(buildSavePayload(useStrategyStore.getState() as any))) as any;
    const names = payload.businessSegments.map((s: { name: string }) => s.name);
    expect(names).toEqual(['製造事業']);
    expect(payload.businessPortfolio.units.map((u: { name: string }) => u.name)).toEqual(['製造事業']);
    expect(isGeneratedPortfolio(payload.businessPortfolio, names)).toBe(true);
    expect(JSON.stringify(payload)).not.toContain('フィットネス');
  });

  it('削除した事業を含む再生成は、削除後の事業だけから作られる（復活しない）', () => {
    const remaining = [{ id: 'seg-1', name: '製造事業' }];
    const rebuilt = buildBusinessPortfolio({ segments: remaining, fallback: useStrategyStore.getState().businessPortfolio });
    expect(rebuilt?.units.map((u) => u.name)).toEqual(['製造事業']);
  });
});
