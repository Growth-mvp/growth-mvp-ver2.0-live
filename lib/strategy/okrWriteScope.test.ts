export {};

/* STAGE4 OKR 書き込みの会社・戦略・所属確認。Supabase 通信のみモック。ストアは実物を使う。 */

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
const { captureOkrWriteScope, isOkrOwnedByScope } = require('@/lib/strategy/okrWriteScope');
const { isSaveScopeCurrent } = require('@/lib/strategy/saveScope');
/* eslint-enable @typescript-eslint/no-require-imports */

const COMPANY_A = 'a1000000-0000-4000-8000-000000000001';
const COMPANY_B = 'b1000000-0000-4000-8000-000000000002';
const PROJECT = 'project-1';

function row(companyId: string, marker: string) {
  return {
    data: { companyId, company_id: companyId, revision: 1, companyName: marker, departments: [] },
    error: null,
  };
}

async function switchTo(companyId: string, strategyId: string) {
  useUserStore.setState({ companyId } as any);
  useStrategyStore.getState().setCompanyScope(companyId);
  await useStrategyStore.getState().refetchFromServer();
  useStrategyStore.setState({ strategyId } as any);
}

beforeEach(() => {
  mockGetFull.mockReset();
  mockGetFull.mockImplementation(async (id: string) =>
    row(id, id === COMPANY_A ? 'A' : id === COMPANY_B ? 'B' : 'other'),
  );
  useUserStore.setState({ user: { id: 'user-1' }, companyId: null, membershipVerified: true } as any);
  useStrategyStore.setState({
    companyId: null,
    pendingCompanyId: undefined,
    restoreReady: false,
    strategyId: undefined,
    __lastServerError: undefined,
  } as any);
});

describe('STAGE4 OKR 書き込みの会社・戦略・所属確認', () => {
  it('1. 同一会社での正常保存は、会社・戦略・OKRの所属が揃って許可される', async () => {
    await switchTo(COMPANY_A, 'S-A');

    const scope = captureOkrWriteScope(COMPANY_A, 'S-A');
    expect(scope).not.toBeNull();
    expect(scope.companyId).toBe(COMPANY_A);
    expect(isSaveScopeCurrent(scope)).toBe(true);
    expect(isOkrOwnedByScope({ company_id: COMPANY_A, strategy_id: 'S-A', project_id: PROJECT }, scope, PROJECT)).toBe(true);
  });

  it('2. A→B切替中（保存待機中）に、Aのスコープ由来の保存応答は採用されない', async () => {
    await switchTo(COMPANY_A, 'S-A');
    const scopeA = captureOkrWriteScope(COMPANY_A, 'S-A');

    await switchTo(COMPANY_B, 'S-B');

    expect(isSaveScopeCurrent(scopeA)).toBe(false);
    const scopeB = captureOkrWriteScope(COMPANY_B, 'S-B');
    expect(scopeB?.companyId).toBe(COMPANY_B);
    expect(isOkrOwnedByScope({ company_id: COMPANY_A, strategy_id: 'S-A', project_id: PROJECT }, scopeB, PROJECT)).toBe(false);
  });

  it('3. A→B→Aと再切替しても、切替前のAのスコープと古い保存応答は採用されない', async () => {
    await switchTo(COMPANY_A, 'S-A');
    const oldScopeA = captureOkrWriteScope(COMPANY_A, 'S-A');

    await switchTo(COMPANY_B, 'S-B');
    await switchTo(COMPANY_A, 'S-A');

    expect(isSaveScopeCurrent(oldScopeA)).toBe(false);
    const freshA = captureOkrWriteScope(COMPANY_A, 'S-A');
    expect(freshA).not.toBeNull();
    expect(isSaveScopeCurrent(freshA)).toBe(true);
  });

  it('4. 会社ID・戦略ID・OKRの所属が一致しない場合は、保存を拒否する', async () => {
    await switchTo(COMPANY_A, 'S-A');

    // 所属会社（userStore）とストアの会社が食い違う
    useUserStore.setState({ companyId: COMPANY_B } as any);
    expect(captureOkrWriteScope(COMPANY_B, 'S-A')).toBeNull();
    useUserStore.setState({ companyId: COMPANY_A } as any);

    // 画面の戦略IDがストアの戦略と一致しない
    expect(captureOkrWriteScope(COMPANY_A, 'S-OTHER')).toBeNull();

    const scope = captureOkrWriteScope(COMPANY_A, 'S-A');
    // 他社のOKR、他の戦略のOKR、他のプロジェクトのOKRは所属が一致しない
    expect(isOkrOwnedByScope({ company_id: COMPANY_B, strategy_id: 'S-A', project_id: PROJECT }, scope, PROJECT)).toBe(false);
    expect(isOkrOwnedByScope({ company_id: COMPANY_A, strategy_id: 'S-OTHER', project_id: PROJECT }, scope, PROJECT)).toBe(false);
    expect(isOkrOwnedByScope({ company_id: COMPANY_A, strategy_id: 'S-A', project_id: 'project-2' }, scope, PROJECT)).toBe(false);
  });
});
