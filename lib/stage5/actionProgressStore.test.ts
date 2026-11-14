/* 実施事項の進捗の書き込みを、ストア実体で確認する（Supabase と認証のみモック）。
 * 会社・戦略・プロジェクトの分離、未知の実施事項・他案件のKRの拒否、保存失敗時の巻き戻し、
 * 競合時の再読込、戦略全体ではなく対象の案件だけを書くことを確かめる。 */

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

type Row = { id: string; revision: number; departments: any[] };
const mockDb: { row: Row | null; writes: Array<{ expectedRevision: number; departments: any[] }>; failNextWrite: boolean; conflictNextWrite: boolean } = {
  row: null,
  writes: [],
  failNextWrite: false,
  conflictNextWrite: false,
};

jest.mock('@/utils/supabase/strategyPartial', () => ({
  strategyPartialIo: {
    read: async (companyId: string) => ({ row: companyId === 'co-jnc' && mockDb.row ? JSON.parse(JSON.stringify(mockDb.row)) : null, error: null }),
    write: async ({ companyId, expectedRevision, departments }: { companyId: string; expectedRevision: number; departments: any[] }) => {
      mockDb.writes.push({ expectedRevision, departments });
      if (mockDb.failNextWrite) {
        mockDb.failNextWrite = false;
        return { row: null, error: { message: 'denied' } };
      }
      if (mockDb.conflictNextWrite) {
        mockDb.conflictNextWrite = false;
        if (mockDb.row) mockDb.row = { ...mockDb.row, revision: mockDb.row.revision + 1 };
        return { row: null, error: null };
      }
      if (companyId !== 'co-jnc' || !mockDb.row || mockDb.row.revision !== expectedRevision) return { row: null, error: null };
      mockDb.row = { ...mockDb.row, revision: expectedRevision + 1, departments };
      return { row: JSON.parse(JSON.stringify(mockDb.row)), error: null };
    },
  },
}));

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

function setStore() {
  const departments = [{ id: 'd1', name: '営業部', projects: [{ ...PROJECT }, { ...OTHER }] }];
  mockDb.row = { id: 'row-1', revision: 8, departments: JSON.parse(JSON.stringify(departments)) };
  mockDb.writes = [];
  mockDb.failNextWrite = false;
  mockDb.conflictNextWrite = false;
  useStrategyStore.setState({
    companyId: 'co-jnc',
    strategyId: 'st-1',
    pendingCompanyId: null,
    revision: 8,
    dirty: false,
    departments,
  } as any);
  return { departments };
}

const base = { companyId: 'co-jnc', strategyId: 'st-1', projectId: 'p-coating', allowedKeys: KEYS, userId: 'user-1' };

describe('実施事項の進捗の書き込み（ストア）', () => {
  beforeEach(() => jest.clearAllMocks());

  it('会社・戦略が一致しなければ、保存しない', async () => {
    setStore();
    const r = await writeActionProgress({ ...base, companyId: 'co-other', actionKey: KEYS[0], patch: { status: 'DONE' } });
    expect(r.ok).toBe(false);
    expect(mockDb.writes).toHaveLength(0);
  });

  it('開始された計画にない実施事項は、保存しない', async () => {
    setStore();
    const r = await writeActionProgress({ ...base, actionKey: 'no-such-action', patch: { status: 'DONE' } });
    expect(r.ok).toBe(false);
    expect(mockDb.writes).toHaveLength(0);
  });

  it('同じ案件にないKRとは、紐づけて保存しない（他の案件のKRの混入防止）', async () => {
    setStore();
    const r = await writeActionProgress({ ...base, actionKey: KEYS[0], patch: { krIds: ['k-other'] } });
    expect(r.ok).toBe(false);
    expect(mockDb.writes).toHaveLength(0);
  });

  it('保存に成功すると、その案件の実施事項の記録だけを部分更新で書く。戦略の他の項目・他の案件・KRは変わらない', async () => {
    setStore();
    const r = await writeActionProgress({
      ...base,
      actionKey: KEYS[0],
      patch: { status: 'IN_PROGRESS', krIds: ['k-proposals'], result: '提案を3件作成', issue: '担当者が不足', nextAction: '来週の打ち合わせで決める' },
    });
    expect(r).toMatchObject({ ok: true, changed: true, revision: 9 });
    expect(mockDb.writes).toHaveLength(1);
    expect(mockDb.writes[0].expectedRevision).toBe(8);

    const written = mockDb.writes[0].departments[0];
    const p = written.projects[0];
    expect(p.executionProgress[KEYS[0]]).toMatchObject({
      status: 'IN_PROGRESS',
      krIds: ['k-proposals'],
      result: '提案を3件作成',
      issue: '担当者が不足',
      nextAction: '来週の打ち合わせで決める',
      updatedBy: 'user-1',
    });
    expect(p.okrsV2).toEqual(PROJECT.okrsV2);
    expect(written.projects[1]).toEqual(OTHER);
    expect(written.name).toBe('営業部');
    expect(useStrategyStore.getState().revision).toBe(9);
  });

  it('保存に失敗したら、画面の状態を書き込み前に戻す', async () => {
    const { departments } = setStore();
    mockDb.failNextWrite = true;
    const r = await writeActionProgress({ ...base, actionKey: KEYS[1], patch: { status: 'DONE' } });
    expect(r.ok).toBe(false);
    expect(useStrategyStore.getState().departments).toBe(departments);
  });

  it('他の更新と競合したら、最新を読み直して書き直す（古い状態では書かない）', async () => {
    setStore();
    mockDb.conflictNextWrite = true;
    const r = await writeActionProgress({ ...base, actionKey: KEYS[0], patch: { status: 'DONE' } });
    expect(r.ok).toBe(true);
    expect(mockDb.writes.map((w) => w.expectedRevision)).toEqual([8, 9]);
  });

  it('変更がなければ保存しない', async () => {
    setStore();
    await writeActionProgress({ ...base, actionKey: KEYS[0], patch: { status: 'DONE' } });
    mockDb.writes = [];
    const again = await writeActionProgress({ ...base, actionKey: KEYS[0], patch: { status: 'DONE' } });
    expect(again).toEqual({ ok: true, changed: false });
    expect(mockDb.writes).toHaveLength(0);
  });
});
