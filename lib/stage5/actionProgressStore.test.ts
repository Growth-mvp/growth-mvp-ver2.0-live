/* 実施事項の進捗の書き込みを、ストア実体で確認する（Supabase と認証のみモック）。
 * 会社・戦略・プロジェクトの分離、未知の実施事項・他案件のKRの拒否、保存失敗時の巻き戻し、切替時の扱いを確かめる。 */

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
import { actionKeysFor } from './actionProgress';
import { writeActionProgress } from './actionProgressStore';

const START = '2026-12-01T00:00:00.000Z';
const DRAFT = {
  plan: {
    section2: {
      actions: [
        { order: 1, title: '現状の数値と原因を集める', dueYm: '2027-01', ownerRole: '塗料営業責任者', supportsKpiKeys: ['S1'] },
        { order: 2, title: '原因に効く打ち手を一つ試す', dueYm: '2027-03', ownerRole: '塗料営業責任者', supportsKpiKeys: ['S2'] },
      ],
    },
  },
};
const KEYS = actionKeysFor(START, DRAFT).map((x) => x.key);

const PROJECT = {
  id: 'p-coating',
  title: '塗料メーカー向けプロジェクト',
  okrsV2: [{ id: 'k-proposals', label: '設計段階の有効提案数', target: 6, unit: '件' }],
};
const OTHER = { id: 'p-other', title: '別の案件', okrsV2: [{ id: 'k-other', label: '他社', target: 10, unit: '件' }] };

function setStore(saveResult: any = { ok: true, revision: 9 }) {
  const save = jest.fn(async () => saveResult);
  const departments = [
    { id: 'd1', name: '営業部', projects: [{ ...PROJECT }, { ...OTHER }] },
  ];
  useStrategyStore.setState({
    companyId: 'co-jnc',
    strategyId: 'st-1',
    pendingCompanyId: null,
    departments,
    saveStrategyData: save,
  } as any);
  return { save, departments };
}

const base = { companyId: 'co-jnc', strategyId: 'st-1', projectId: 'p-coating', allowedKeys: KEYS, userId: 'user-1' };

describe('実施事項の進捗の書き込み（ストア）', () => {
  beforeEach(() => jest.clearAllMocks());

  it('会社・戦略が一致しなければ、保存しない', async () => {
    const { save } = setStore();
    const r = await writeActionProgress({ ...base, companyId: 'co-other', actionKey: KEYS[0], patch: { status: 'DONE' } });
    expect(r.ok).toBe(false);
    expect(save).not.toHaveBeenCalled();
  });

  it('開始された計画にない実施事項は、保存しない', async () => {
    const { save } = setStore();
    const r = await writeActionProgress({ ...base, actionKey: 'no-such-action', patch: { status: 'DONE' } });
    expect(r.ok).toBe(false);
    expect(save).not.toHaveBeenCalled();
  });

  it('同じ案件にないKRとは、紐づけて保存しない（他の案件のKRの混入防止）', async () => {
    const { save } = setStore();
    const r = await writeActionProgress({ ...base, actionKey: KEYS[0], patch: { krIds: ['k-other'] } });
    expect(r.ok).toBe(false);
    expect(save).not.toHaveBeenCalled();
  });

  it('保存に成功すると、その実施事項の記録だけを書き、他の案件・KRは変わらない', async () => {
    const { save } = setStore({ ok: true, revision: 9 });
    const r = await writeActionProgress({ ...base, actionKey: KEYS[0], patch: { status: 'IN_PROGRESS', krIds: ['k-proposals'], result: '提案を3件作成' } });
    expect(r).toMatchObject({ ok: true, changed: true, revision: 9 });
    expect(save).toHaveBeenCalledWith({ reason: 'stage5_action_progress', force: true });
    const depts = useStrategyStore.getState().departments as any[];
    const p = depts[0].projects[0];
    expect(p.executionProgress[KEYS[0]]).toMatchObject({ status: 'IN_PROGRESS', krIds: ['k-proposals'], result: '提案を3件作成', updatedBy: 'user-1' });
    expect(p.okrsV2).toEqual(PROJECT.okrsV2);
    expect(depts[0].projects[1]).toEqual(OTHER);
  });

  it('保存に失敗したら、画面の状態を書き込み前に戻す', async () => {
    const { departments } = setStore({ ok: false, reason: 'api_error', error: 'x' });
    const r = await writeActionProgress({ ...base, actionKey: KEYS[1], patch: { status: 'DONE' } });
    expect(r.ok).toBe(false);
    expect(useStrategyStore.getState().departments).toBe(departments);
  });

  it('会社切替によって保存されなかった（scope_changed）場合は、切替後の画面を巻き戻さず、切替の案内を出す', async () => {
    setStore({ ok: false, skipped: true, reason: 'scope_changed' });
    const r = await writeActionProgress({ ...base, actionKey: KEYS[0], patch: { status: 'DONE' } });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.message).toContain('切り替わった');
    expect(useStrategyStore.getState().companyId).toBe('co-jnc');
  });

  it('変更がなければ保存しない', async () => {
    const { save } = setStore();
    await writeActionProgress({ ...base, actionKey: KEYS[0], patch: { status: 'DONE' } });
    jest.clearAllMocks();
    const again = await writeActionProgress({ ...base, actionKey: KEYS[0], patch: { status: 'DONE' } });
    expect(again).toEqual({ ok: true, changed: false });
    expect(save).not.toHaveBeenCalled();
  });
});
