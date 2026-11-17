/* STAGE4からの「計画から外す」「中止する」の書き込みを、ストア実体で確認する（Supabase と認証のみモック）。
 * 会社・戦略・案件の照合、承認済み・実行中・未開始の拒否、保存成功、保存失敗時の巻き戻しを確かめる。 */

export {};

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

import { useStrategyStore } from '@/store/strategyStore';
import { writeProjectLifecycleToProject } from './lifecycleBridgeStore';

const NOW = '2026-11-17T00:00:00.000Z';
const TARGET = { id: 'p-target', title: '保守契約の更新', planStatus: 'draft' };
const OTHER = { id: 'p-other', title: '他社の施策' };

function setStore(saveResult: unknown = { ok: true, revision: 8 }) {
  const save = jest.fn(async () => saveResult);
  const departments = [
    { id: 'd1', name: '営業部', projects: [{ ...TARGET }, { ...OTHER }] },
    { id: 'd2', name: '企画部', projects: [] as unknown[] },
  ];
  useStrategyStore.setState({
    companyId: 'co-jnc',
    strategyId: 'st-1',
    pendingCompanyId: null,
    departments,
    saveStrategyData: save,
  } as never);
  return { save, departments };
}

const base = {
  companyId: 'co-jnc',
  strategyId: 'st-1',
  projectId: TARGET.id,
  nowIso: NOW,
  actorUserId: 'user-1',
};

describe('計画から外す・中止する（STAGE4の書き込み）', () => {
  beforeEach(() => jest.clearAllMocks());

  it('会社・戦略が一致しなければ、保存も書き込みもしない', async () => {
    const { save, departments } = setStore();
    const r = await writeProjectLifecycleToProject({ ...base, companyId: 'co-other', action: 'EXCLUDE', facts: { executing: false, started: false } });
    expect(r.ok).toBe(false);
    expect(save).not.toHaveBeenCalled();
    expect(useStrategyStore.getState().departments).toBe(departments);
  });

  it('施策が特定できなければ、保存しない', async () => {
    const { save } = setStore();
    const r = await writeProjectLifecycleToProject({ ...base, projectId: 'missing', action: 'EXCLUDE', facts: { executing: false, started: false } });
    expect(r.ok).toBe(false);
    expect(save).not.toHaveBeenCalled();
  });

  it('承認済みの計画は、計画から外せない（保存しない）', async () => {
    const { save } = setStore();
    useStrategyStore.setState({
      departments: [{ id: 'd1', name: '営業部', projects: [{ ...TARGET, planStatus: 'approved' }] }],
    } as never);
    const r = await writeProjectLifecycleToProject({ ...base, action: 'EXCLUDE', facts: { executing: false, started: false } });
    expect(r).toEqual({ ok: false, message: '承認済みの計画は、計画から外せません。承認を解除してから操作してください。' });
    expect(save).not.toHaveBeenCalled();
  });

  it('採用済み・実行中の計画は計画から外せず、中止にしてもらう（保存しない）', async () => {
    const { save } = setStore();
    const r = await writeProjectLifecycleToProject({ ...base, action: 'EXCLUDE', facts: { executing: true, started: true } });
    expect(r.ok).toBe(false);
    expect(save).not.toHaveBeenCalled();
  });

  it('実行を開始していない計画は中止できない（保存しない）', async () => {
    const { save } = setStore();
    const r = await writeProjectLifecycleToProject({ ...base, action: 'STOP', facts: { executing: false, started: false } });
    expect(r.ok).toBe(false);
    expect(save).not.toHaveBeenCalled();
  });

  it('計画から外すは、その施策だけに状態を付け、他の施策と位置は変えない', async () => {
    const { save } = setStore({ ok: true, revision: 8 });
    const r = await writeProjectLifecycleToProject({ ...base, action: 'EXCLUDE', facts: { executing: false, started: false } });
    expect(r).toEqual({ ok: true });
    expect(save).toHaveBeenCalledWith({ reason: 'stage4_project_lifecycle', force: true });
    const depts = useStrategyStore.getState().departments as Array<{ projects: Array<Record<string, unknown>> }>;
    expect(depts[0].projects[0]).toMatchObject({ id: 'p-target', lifecycle: { status: 'EXCLUDED', changedAt: NOW, changedBy: 'user-1' } });
    expect(depts[0].projects[1]).toEqual(OTHER);
    expect(depts[1].projects).toEqual([]);
  });

  it('中止は、中止時期を保持して、実行中の計画を止める', async () => {
    setStore({ ok: true, revision: 8 });
    const r = await writeProjectLifecycleToProject({ ...base, action: 'STOP', facts: { executing: true, started: true } });
    expect(r).toEqual({ ok: true });
    const depts = useStrategyStore.getState().departments as Array<{ projects: Array<Record<string, unknown>> }>;
    expect(depts[0].projects[0].lifecycle).toEqual({ status: 'STOPPED', changedAt: NOW, changedBy: 'user-1', stoppedAt: NOW });
  });

  it('保存に失敗したら、画面の状態を書き込み前に戻す（除外していない状態に戻る）', async () => {
    const { departments } = setStore({ ok: false, reason: 'api_error', error: 'boom' });
    const r = await writeProjectLifecycleToProject({ ...base, action: 'EXCLUDE', facts: { executing: false, started: false } });
    expect(r.ok).toBe(false);
    expect(useStrategyStore.getState().departments).toBe(departments);
    expect((useStrategyStore.getState().departments as Array<{ projects: Array<Record<string, unknown>> }>)[0].projects[0].lifecycle).toBeUndefined();
  });

  it('版の競合（他の人が先に保存した）は、保存できなかったことを伝え、画面を戻す', async () => {
    const { departments } = setStore({ ok: false, reason: 'revision_conflict_persist', error: 'conflict', code: 'REVISION_CONFLICT' });
    const r = await writeProjectLifecycleToProject({ ...base, action: 'EXCLUDE', facts: { executing: false, started: false } });
    expect(r.ok).toBe(false);
    expect(useStrategyStore.getState().departments).toBe(departments);
  });
});
