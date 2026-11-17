/* STAGE4からの「計画から外す」「中止する」の画面側の処理を確かめる。
 * 書き込みはサーバーの経路（authFetchJson）に任せ、ここでは呼び出しの内容、会社・戦略の照合、
 * サーバーの拒否理由の表示、成功時に保存後の版と部門を画面に反映することを確かめる。 */

export {};

const mockFetch = jest.fn();
jest.mock('@/utils/authFetch', () => {
  const actual = jest.requireActual('@/utils/authFetch');
  return {
    ...actual,
    authFetchJson: (...args: unknown[]) => mockFetch(...args),
  };
});

jest.mock('@/store/userStore', () => ({
  useUserStore: {
    getState: () => ({ user: { id: 'user-1' }, companyId: 'co-jnc', membershipVerified: true }),
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
    getFullStrategyDataByCompany: jest.fn(),
    saveStrategyData: jest.fn(async () => ({ ok: true })),
    buildStateFromDbRow: actual.buildStateFromDbRow,
    buildFinanceCsvUnitMeta: actual.buildFinanceCsvUnitMeta,
    countTotalProjects: () => 0,
  };
});

import { AuthFetchError } from '@/utils/authFetch';
import { useStrategyStore } from '@/store/strategyStore';
import { writeProjectLifecycleToProject } from './lifecycleBridgeStore';

const TARGET = { id: 'p-target', title: '保守契約の更新', planStatus: 'draft' };
const OTHER = { id: 'p-other', title: '他社の施策' };
const DEPARTMENTS = [
  { id: 'd1', name: '営業部', projects: [{ ...TARGET }, { ...OTHER }] },
  { id: 'd2', name: '企画部', projects: [] as unknown[] },
];

function setStore(over: Record<string, unknown> = {}) {
  const syncPartialSave = jest.fn(() => true);
  useStrategyStore.setState({
    companyId: 'co-jnc',
    strategyId: 'st-1',
    pendingCompanyId: null,
    departments: DEPARTMENTS,
    revision: 5,
    syncPartialSave,
    ...over,
  } as never);
  return { syncPartialSave };
}

const base = {
  companyId: 'co-jnc',
  strategyId: 'st-1',
  projectId: TARGET.id,
  facts: { executing: false, started: false },
};

const serverRefusal = (error: string, status = 409) =>
  new AuthFetchError(`HTTP error: ${status}`, 'HTTP_ERROR', { status, bodyText: JSON.stringify({ ok: false, error }) });

describe('計画から外す・中止する（STAGE4の画面側）', () => {
  beforeEach(() => mockFetch.mockReset());

  it('会社・戦略が一致しなければ、サーバーへ送らない', async () => {
    setStore();
    const r = await writeProjectLifecycleToProject({ ...base, companyId: 'co-other', action: 'EXCLUDE' });
    expect(r.ok).toBe(false);
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('施策が特定できなければ、サーバーへ送らない', async () => {
    setStore();
    const r = await writeProjectLifecycleToProject({ ...base, projectId: 'missing', action: 'EXCLUDE' });
    expect(r.ok).toBe(false);
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('画面の判定で明らかに外せない（承認済み）なら、サーバーへ送らず理由を出す', async () => {
    setStore({ departments: [{ id: 'd1', name: '営業部', projects: [{ ...TARGET, planStatus: 'approved' }] }] });
    const r = await writeProjectLifecycleToProject({ ...base, action: 'EXCLUDE' });
    expect(r).toEqual({ ok: false, message: '承認済みの計画は、計画から外せません。承認を解除してから操作してください。' });
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('成功すると、版と送られた部門の状態を、画面の状態に反映する（書き込み前の版で送る）', async () => {
    const { syncPartialSave } = setStore();
    const departments = [{ id: 'd1', name: '営業部', projects: [{ ...TARGET, lifecycle: { status: 'EXCLUDED' } }, { ...OTHER }] }];
    mockFetch.mockResolvedValueOnce({ ok: true, revision: 6, departments });
    const r = await writeProjectLifecycleToProject({ ...base, action: 'EXCLUDE' });
    expect(r).toEqual({ ok: true });
    expect(mockFetch).toHaveBeenCalledWith(
      '/api/stage4/project-lifecycle',
      expect.objectContaining({
        method: 'POST',
        json: { companyId: 'co-jnc', strategyId: 'st-1', projectId: TARGET.id, action: 'EXCLUDE', expectedRevision: 5 },
      }),
    );
    expect(syncPartialSave).toHaveBeenCalledWith({ departments, revision: 6 });
  });

  it('サーバーが管理者・管理職以外と判定したら、その理由を出し、画面を変えない', async () => {
    const { syncPartialSave } = setStore();
    mockFetch.mockRejectedValueOnce(serverRefusal('insufficient_role', 403));
    const r = await writeProjectLifecycleToProject({ ...base, action: 'EXCLUDE' });
    expect(r).toEqual({ ok: false, message: '計画から外す・中止は、管理者と管理職だけが行えます。' });
    expect(syncPartialSave).not.toHaveBeenCalled();
  });

  it('版が変わっていれば（他の人が先に変更）、読み直しを案内する', async () => {
    const { syncPartialSave } = setStore();
    mockFetch.mockRejectedValueOnce(serverRefusal('revision_changed'));
    const r = await writeProjectLifecycleToProject({ ...base, action: 'EXCLUDE' });
    expect(r).toEqual({ ok: false, message: '他の人が先に変更しました。画面を読み直してから、もう一度お試しください。' });
    expect(syncPartialSave).not.toHaveBeenCalled();
  });

  it('サーバーが実行中と判定したら、中止を案内する', async () => {
    setStore();
    mockFetch.mockRejectedValueOnce(serverRefusal('executing'));
    const r = await writeProjectLifecycleToProject({ ...base, action: 'EXCLUDE' });
    expect(r).toEqual({ ok: false, message: '採用済み・実行中の計画は、計画から外せません。「プロジェクトを中止する」を使ってください。' });
  });

  it('中止はサーバーに送り、成功したら画面に反映する', async () => {
    const { syncPartialSave } = setStore();
    const departments = [{ id: 'd1', name: '営業部', projects: [{ ...TARGET, lifecycle: { status: 'STOPPED' } }] }];
    mockFetch.mockResolvedValueOnce({ ok: true, revision: 6, departments });
    const r = await writeProjectLifecycleToProject({ ...base, action: 'STOP', facts: { executing: true, started: true } });
    expect(r).toEqual({ ok: true });
    expect(mockFetch.mock.calls[0][1].json.action).toBe('STOP');
    expect(syncPartialSave).toHaveBeenCalledWith({ departments, revision: 6 });
  });

  it('予期しない失敗は、保存できなかったことだけを伝える（画面は変えない）', async () => {
    const { syncPartialSave } = setStore();
    mockFetch.mockRejectedValueOnce(new Error('network down'));
    const r = await writeProjectLifecycleToProject({ ...base, action: 'EXCLUDE' });
    expect(r).toEqual({ ok: false, message: '計画の変更を保存できませんでした。もう一度お試しください。' });
    expect(syncPartialSave).not.toHaveBeenCalled();
  });
});
