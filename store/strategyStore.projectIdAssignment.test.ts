export {};
/* STAGE3 のプロジェクトID（保存時の付与・並び替え・競合・失敗・既存ID・重複の検出）。
 * ストアは本物を使い、DBの読み書きと読み込みだけをメモリ上のモックにする（departmentsConflict.test.ts と同じ方式）。 */

const mockUser: { user: { id: string } | null; companyId: string | null; membershipVerified: boolean } = {
  user: { id: 'user-1' },
  companyId: null,
  membershipVerified: true,
};

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

type DbRow = { id: string; company_id: string; revision: number; departments: any[]; updated_at: string };

const db: { row: DbRow; clock: number; failNextWrite: boolean; writes: number } = {
  row: { id: '', company_id: '', revision: 0, departments: [], updated_at: '' },
  clock: 0,
  failNextWrite: false,
  writes: 0,
};

const clone = <T,>(v: T): T => JSON.parse(JSON.stringify(v));
const tick = () => `2026-11-10T00:00:${String(++db.clock).padStart(2, '0')}Z`;

jest.mock('@/utils/persist/saveWithAudit', () => ({
  saveWithAudit: (payload: any, _userId: unknown, companyId: string, revision: number | undefined) => {
    if (db.failNextWrite) {
      db.failNextWrite = false;
      return Promise.resolve({ data: null, error: { message: 'network down', code: 'ERROR' } });
    }
    if (companyId !== db.row.company_id) return Promise.resolve({ data: null, error: { message: 'forbidden' } });
    if (typeof revision === 'number' && revision !== db.row.revision) {
      return Promise.resolve({
        data: null,
        error: { message: 'revision conflict', code: 'REVISION_CONFLICT', currentRevision: db.row.revision },
      });
    }
    db.writes += 1;
    db.row.departments = clone(payload.departments ?? []);
    db.row.updated_at = tick();
    db.row.revision += 1;
    return Promise.resolve({ data: clone(db.row) as any, error: null });
  },
}));

jest.mock('@/utils/supabase/strategy', () => {
  const actual = jest.requireActual('@/utils/supabase/strategy');
  const read = async (strategyId: string, companyId: string) => {
    if (strategyId !== db.row.id || companyId !== db.row.company_id) return { data: null, error: new Error('not found') };
    return { data: actual.buildStateFromDbRow(clone(db.row)), error: null };
  };
  return {
    ...actual,
    getFullStrategyDataByCompany: jest.fn(async (companyId: string) => read(db.row.id, companyId)),
    getFullStrategyDataByStrategyId: read,
  };
});

import { ensureStableProjectId, withProjectId, type IdentityApi } from '@/lib/stage4/plan/planClient';
import * as storeModule from './strategyStore';

let useStrategyStore: typeof storeModule.useStrategyStore = storeModule.useStrategyStore;
let resetRevisionAnomalyForTests: typeof storeModule.resetRevisionAnomalyForTests = storeModule.resetRevisionAnomalyForTests;

const A = '11111111-1111-4111-8111-111111111111';
const S = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

const get = () => useStrategyStore.getState() as any;
const storeDepts = () => get().departments as any[];
const idsOf = (depts: any[], di: number) => (depts[di]?.projects ?? []).map((p: any) => p.id);
const allIds = (depts: any[]) => depts.flatMap((d: any) => (d.projects ?? []).map((p: any) => p.id));
const titleOf = (depts: any[], di: number, pi: number) => depts[di]?.projects?.[pi]?.title;

/** 画面を開いた直後の状態にする（DBの内容を読み、同期済みの版を確定させる） */
async function openStage3(departments: any[]) {
  db.row = { id: S, company_id: A, revision: 5, departments: clone(departments), updated_at: tick() };
  db.writes = 0;
  db.failNextWrite = false;
  resetRevisionAnomalyForTests();
  mockUser.companyId = A;
  useStrategyStore.setState({
    companyId: A,
    pendingCompanyId: undefined,
    strategyId: S,
    hydrated: true,
    restoreReady: true,
    loaded: true,
    isRestoring: false,
    boot: { isHydrating: false, isHydrated: true, isSaving: false, isRestoring: false },
    departments: clone(departments),
    revision: 5,
    dirty: false,
    saveError: undefined,
  } as any);
  const init = await get().saveStrategyData({ force: true, reason: 'manual-save-button' });
  expect(init.ok).toBe(true);
}

/** 他の利用者の変更（トリガーで revision が +1） */
function serverChange(mutate: (departments: any[]) => any[]) {
  db.row.departments = mutate(clone(db.row.departments));
  db.row.revision += 1;
  db.row.updated_at = tick();
}

function editLocal(mutate: (departments: any[]) => any[]) {
  useStrategyStore.setState({ departments: mutate(clone(storeDepts())), dirty: true } as any);
}

const save = () => get().saveStrategyData({ force: true, reason: 'manual-save-button' });

const legacy = (): any[] => [
  { name: '設計部', mission: '品質', projects: [{ title: '点検工程', okrs: [] }, { title: '新規顧客開拓', okrs: [] }] },
  { name: '営業部', mission: '販売', projects: [{ title: '既存の販路', okrs: [] }] },
];

/* STAGE4 の番号付与（Stage3ReadPanel と同じ手順）。サーバーは RPC と同じ規則で、IDだけ書き換え revision を +1 する */
function stage4AssignId(departmentIndex: number, projectIndex: number, newId: string) {
  const identity: IdentityApi = {
    async readStrategy() {
      return {
        status: 'FOUND',
        revision: db.row.revision,
        projects: db.row.departments.flatMap((d: any, di: number) =>
          (d.projects ?? []).map((p: any, pi: number) => ({ departmentIndex: di, projectIndex: pi, title: p.title, projectId: p.id ?? null }))
        ),
      };
    },
    async assign(args) {
      const target = db.row.departments[args.departmentIndex]?.projects?.[args.projectIndex];
      if (!target || target.title !== args.expectedTitle) return { status: 'TITLE_CHANGED' };
      if (db.row.revision !== args.expectedRevision) return { status: 'REVISION_CHANGED', revision: db.row.revision };
      const next = clone(db.row.departments);
      next[args.departmentIndex].projects[args.projectIndex].id = args.newId;
      db.row.departments = next;
      db.row.revision += 1;
      return { status: 'ASSIGNED', projectId: args.newId, alreadyAssigned: false, revision: db.row.revision };
    },
  };
  return ensureStableProjectId(identity, {
    companyId: A,
    strategyId: S,
    departmentIndex,
    projectIndex,
    expectedTitle: db.row.departments[departmentIndex].projects[projectIndex].title,
    newId,
  }).then((ensured) => {
    if (!ensured.ok) throw new Error(ensured.message);
    useStrategyStore.setState({ departments: withProjectId(get().departments, departmentIndex, projectIndex, ensured.projectId) } as never);
    return ensured.projectId;
  });
}

beforeEach(() => {
  jest.clearAllMocks();
  jest.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => {
  jest.restoreAllMocks();
});

describe('新規保存：IDのないプロジェクト', () => {
  it('保存で位置に依らないUUIDが付き、画面とDBのIDが一致する（proj_配列位置 は付かない）', async () => {
    await openStage3(legacy());
    const dbIds = allIds(db.row.departments);
    expect(dbIds.every((id) => UUID.test(id))).toBe(true);
    expect(dbIds.some((id) => /^proj_/.test(id))).toBe(false);
    expect(allIds(storeDepts())).toEqual(dbIds);
  });
});

describe('並び替え・追加・削除・部門間移動', () => {
  it('既存のIDは変わらず、新しく追加した項目だけに新しいIDが付き、重複しない', async () => {
    await openStage3(legacy());
    const before = Object.fromEntries(
      [...db.row.departments.flatMap((d: any) => d.projects)].map((p: any) => [p.title, p.id])
    );
    editLocal((d) => {
      const moved = d[0].projects.splice(1, 1)[0];
      d[1].projects.push(moved);
      d[0].projects.unshift({ title: '新しい案件', okrs: [] });
      return d;
    });
    const res = await save();
    expect(res.ok).toBe(true);
    const after = Object.fromEntries(db.row.departments.flatMap((d: any) => d.projects).map((p: any) => [p.title, p.id]));
    expect(after['点検工程']).toBe(before['点検工程']);
    expect(after['新規顧客開拓']).toBe(before['新規顧客開拓']);
    expect(after['既存の販路']).toBe(before['既存の販路']);
    expect(after['新しい案件']).toMatch(UUID);
    const ids = allIds(db.row.departments);
    expect(new Set(ids).size).toBe(ids.length);
    expect(allIds(storeDepts())).toEqual(ids);
  });

  it('同じ位置に別のプロジェクトを入れ直しても、古い項目のIDを引き継がない', async () => {
    await openStage3(legacy());
    const [removedId, keptId] = idsOf(db.row.departments, 0);
    editLocal((d) => {
      d[0].projects.shift();
      d[0].projects.push({ title: '末尾の追加', okrs: [] });
      return d;
    });
    expect((await save()).ok).toBe(true);
    const ids = idsOf(db.row.departments, 0);
    expect(ids[0]).toBe(keptId);
    expect(ids[1]).toMatch(UUID);
    expect(ids[1]).not.toBe(removedId);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe('保存失敗と再試行', () => {
  it('保存に失敗しても、画面の新しいIDと他の未保存の変更は残り、再試行で同じIDが保存される', async () => {
    await openStage3(legacy());
    editLocal((d) => {
      d[0].projects.push({ title: '失敗する追加', okrs: [] });
      d[1].projects[0].title = '既存の販路（未保存）';
      return d;
    });
    db.failNextWrite = true;
    const failed = await save();
    expect(failed.ok).toBe(false);
    const idOnScreen = storeDepts()[0].projects[2].id;
    expect(idOnScreen).toMatch(UUID);
    expect(db.row.departments[0].projects).toHaveLength(2);
    expect(titleOf(storeDepts(), 1, 0)).toBe('既存の販路（未保存）');
    expect(get().dirty).toBe(true);

    const retried = await save();
    expect(retried.ok).toBe(true);
    expect(db.row.departments[0].projects[2].id).toBe(idOnScreen);
    expect(titleOf(db.row.departments, 1, 0)).toBe('既存の販路（未保存）');
  });
});

describe('revision 競合', () => {
  it('他の利用者が別の部門を変えていても、画面の新しいIDと両方の変更が残る', async () => {
    await openStage3(legacy());
    editLocal((d) => {
      d[0].projects.push({ title: '自分の追加', okrs: [] });
      return d;
    });
    serverChange((d) => {
      d[1].projects[0].title = '既存の販路（他の利用者）';
      return d;
    });
    const res = await save();
    expect(res.ok).toBe(true);
    expect(titleOf(db.row.departments, 0, 2)).toBe('自分の追加');
    expect(titleOf(db.row.departments, 1, 0)).toBe('既存の販路（他の利用者）');
    const ids = allIds(db.row.departments);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe('STAGE4 で番号を付けた後の STAGE3 の保存', () => {
  it('STAGE4 が付けた番号を、STAGE3 の保存が上書きしない（未保存の編集も残る）', async () => {
    jest.resetModules();
    const fresh = require('./strategyStore') as typeof storeModule;
    useStrategyStore = fresh.useStrategyStore;
    resetRevisionAnomalyForTests = fresh.resetRevisionAnomalyForTests;
    db.row = { id: S, company_id: A, revision: 5, departments: legacy(), updated_at: tick() };
    mockUser.companyId = A;
    resetRevisionAnomalyForTests();
    useStrategyStore.setState({
      companyId: A,
      strategyId: S,
      hydrated: true,
      restoreReady: true,
      loaded: true,
      isRestoring: false,
      boot: { isHydrating: false, isHydrated: true, isSaving: false, isRestoring: false },
      dirty: false,
    } as any);
    await get().refetchOnceFromServer();
    expect(storeDepts()[0].projects[0].id).toBeUndefined();

    const stage4Id = '33333333-3333-4333-8333-333333333333';
    const assigned = await stage4AssignId(0, 0, stage4Id);
    expect(assigned).toBe(stage4Id);
    editLocal((d) => {
      d[0].projects[1].title = '新規顧客開拓（未保存）';
      return d;
    });
    const res = await save();
    expect(res.ok).toBe(true);
    expect(db.row.departments[0].projects[0].id).toBe(stage4Id);
    expect(db.row.departments[0].projects[1].title).toBe('新規顧客開拓（未保存）');
    expect(allIds(db.row.departments).filter((id) => id === stage4Id)).toHaveLength(1);
  });
});

describe('既存のIDの保持と重複の検出', () => {
  it('既存のID（位置由来の proj_0_0 を含む）は、保存しても変わらない', async () => {
    const depts = legacy();
    depts[0].projects[0] = { id: 'proj_0_0', title: '点検工程', okrs: [] };
    depts[0].projects[1] = { id: 'proj-sales-1', title: '新規顧客開拓', okrs: [] };
    await openStage3(depts);
    expect(idsOf(db.row.departments, 0)).toEqual(['proj_0_0', 'proj-sales-1']);
    editLocal((d) => {
      d[1].projects[0].title = '既存の販路（改訂）';
      return d;
    });
    expect((await save()).ok).toBe(true);
    expect(idsOf(db.row.departments, 0)).toEqual(['proj_0_0', 'proj-sales-1']);
  });

  it('同じIDが複数あれば、検出して報告し、自動では直さない（保存は行う）', async () => {
    const depts = legacy();
    depts[0].projects[0] = { id: 'dup-1', title: '点検工程', okrs: [] };
    depts[1].projects[0] = { id: 'dup-1', title: '既存の販路', okrs: [] };
    await openStage3(depts);
    expect(idsOf(db.row.departments, 0)).toEqual(['dup-1', expect.any(String)]);
    expect(db.row.departments[1].projects[0].id).toBe('dup-1');
    expect(console.error).toHaveBeenCalledWith(
      '[stage3:duplicate-project-id] 同じIDのプロジェクトが複数あります（自動では直しません）',
      [expect.objectContaining({ id: 'dup-1' })]
    );
  });
});
