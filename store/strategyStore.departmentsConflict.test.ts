export {};
/* departments を含む保存の競合（モック）。ストアは本物を使い、DB の保存と読み取りだけをメモリ上のモックにする。
 * トリガー有り・無しの両方で、古い departments による上書きが起きないこと、利用者の未保存編集が残ることを確認する。 */

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
type SaveCall = { ok: boolean; revision: number | undefined; departments: any[]; reason: string };

const db: {
  row: DbRow;
  triggerOn: boolean;
  saves: SaveCall[];
  beforeSave: null | (() => void);
  beforeRead: null | (() => void);
  reads: number;
  clock: number;
} = {
  row: { id: '', company_id: '', revision: 0, departments: [], updated_at: '' },
  triggerOn: true,
  saves: [],
  beforeSave: null,
  beforeRead: null,
  reads: 0,
  clock: 0,
};

const clone = <T,>(v: T): T => JSON.parse(JSON.stringify(v));
const tick = () => `2026-11-02T00:00:${String(++db.clock).padStart(2, '0')}Z`;

jest.mock('@/utils/persist/saveWithAudit', () => ({
  saveWithAudit: (payload: any, userId: unknown, companyId: string, revision: number | undefined, opts: unknown, caller: string) =>
    mockSaveWithAudit(payload, userId, companyId, revision, opts, caller),
}));

/** 保存（UPDATE）の模型。revision を指定した保存は、一致しなければ 0 行（REVISION_CONFLICT）。 */
function mockSaveWithAudit(payload: any, _userId: unknown, companyId: string, revision: number | undefined, _opts: unknown, caller: string) {
  if (db.beforeSave) {
    const hook = db.beforeSave;
    db.beforeSave = null;
    hook();
  }
  const reason = String(caller ?? '');
  if (companyId !== db.row.company_id) {
    db.saves.push({ ok: false, revision, departments: payload.departments, reason: 'other_company' });
    return Promise.resolve({ data: null, error: { message: 'forbidden' } });
  }
  if (typeof revision === 'number' && revision !== db.row.revision) {
    db.saves.push({ ok: false, revision, departments: payload.departments, reason });
    return Promise.resolve({
      data: null,
      error: { message: 'revision conflict', code: 'REVISION_CONFLICT', currentRevision: db.row.revision },
    });
  }
  const before = db.row.revision;
  db.row.departments = clone(payload.departments ?? []);
  db.row.updated_at = tick();
  db.row.revision = db.triggerOn ? before + 1 : before;
  db.saves.push({ ok: true, revision, departments: clone(db.row.departments), reason });
  return Promise.resolve({ data: clone(db.row) as any, error: null });
}

jest.mock('@/utils/supabase/strategy', () => {
  const actual = jest.requireActual('@/utils/supabase/strategy');
  return {
    ...actual,
    getFullStrategyDataByCompany: jest.fn(async () => {
      throw new Error('unexpected call: getFullStrategyDataByCompany');
    }),
    getFullStrategyDataByStrategyId: (strategyId: string, companyId: string) => mockReadStrategy(strategyId, companyId),
  };
});

/** 競合の確認のための読み取り（最新の行）。読み取りの途中で別の操作が入る状況も再現できる。 */
async function mockReadStrategy(strategyId: string, companyId: string) {
  db.reads += 1;
  if (db.beforeRead) {
    const hook = db.beforeRead;
    db.beforeRead = null;
    hook();
  }
  if (strategyId !== db.row.id || companyId !== db.row.company_id) return { data: null, error: new Error('not found') };
  const actual = jest.requireActual('@/utils/supabase/strategy');
  return { data: actual.buildStateFromDbRow(clone(db.row)), error: null };
}

import { useStrategyStore, resetRevisionAnomalyForTests } from './strategyStore';

const A = '11111111-1111-4111-8111-111111111111';
const S = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';

const existingSales = {
  id: 'proj-sales-1',
  title: '既存の新規顧客開拓',
  planStatus: 'approved',
  executionHumanInvestments: [{ id: 'h1', person: '山田', months: 2 }],
  okrs: [],
};
const ADDED = { id: 'proj-added-1', title: '新しい販路開拓', okrs: [] };

const get = () => useStrategyStore.getState() as any;
const storeDepts = () => get().departments as any[];
const hasAdded = (depts: any[]) => depts.some((d) => (d.projects ?? []).some((p: any) => p.id === ADDED.id));
const humanIds = (depts: any[]) =>
  ((depts[0]?.projects?.[0]?.executionHumanInvestments ?? []) as any[]).map((h) => h.id);

/** 別の利用者による更新（トリガー有りなら revision が +1、無しなら据え置き）。 */
function serverChange(mutate: (departments: any[]) => any[]) {
  const before = db.row.revision;
  db.row.departments = mutate(clone(db.row.departments));
  db.row.updated_at = tick();
  db.row.revision = db.triggerOn ? before + 1 : before;
}

/** 別の利用者による STAGE3 の採用（route と同じ規則）。 */
function serverAdopt(project: any) {
  serverChange((d) => {
    d[0].projects.push(clone(project));
    return d;
  });
}

function resetDb(triggerOn: boolean) {
  db.triggerOn = triggerOn;
  db.saves = [];
  db.beforeSave = null;
  db.beforeRead = null;
  db.reads = 0;
  db.row = {
    id: S,
    company_id: A,
    revision: 5,
    departments: [{ name: '営業部', mission: '顧客を広げる', projects: [clone(existingSales)] }],
    updated_at: tick(),
  };
}

/** 読み込み済みの状態にし、保存に成功させて「最後に同期した版」を確定させる。 */
async function loadedStore(triggerOn: boolean) {
  resetDb(triggerOn);
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
    departments: clone(db.row.departments),
    revision: 5,
    dirty: false,
    saveError: undefined,
  } as any);
  const init = await get().saveStrategyData({ force: true, reason: 'manual-save-button' });
  expect(init.ok).toBe(true);
  db.saves = [];
}

/** STAGE4 の利用者が、古い画面で実行計画（人的投資）を編集した状態。 */
function stage4Edit(extraHumanId: string) {
  const edited = clone(storeDepts());
  edited[0].projects[0].executionHumanInvestments.push({ id: extraHumanId, person: '佐藤', months: 1 });
  useStrategyStore.setState({ departments: edited, dirty: true } as any);
}

beforeEach(() => {
  jest.clearAllMocks();
  resetRevisionAnomalyForTests();
});

describe('1〜5. STAGE3 の採用と STAGE4 の古い画面の保存（トリガー有り）', () => {
  it('STAGE3 の採用の後、古い STAGE4 の保存は、採用したプロジェクトを消さない（古い departments で上書きしない）', async () => {
    await loadedStore(true);
    serverAdopt(ADDED);
    stage4Edit('h2');
    const res = await get().saveStrategyData({ force: true, reason: 'manual-save-button' });
    expect(res.ok).toBe(true);
    expect(hasAdded(db.row.departments)).toBe(true);
    expect(hasAdded(storeDepts())).toBe(true);
  });

  it('古いローカルの departments で成功した保存が無い（採用の後の成功した保存は、すべて採用した案を含む）', async () => {
    await loadedStore(true);
    serverAdopt(ADDED);
    stage4Edit('h2');
    await get().saveStrategyData({ force: true, reason: 'manual-save-button' });
    const successes = db.saves.filter((s) => s.ok);
    expect(successes.length).toBeGreaterThan(0);
    expect(successes.every((s) => hasAdded(s.departments))).toBe(true);
  });

  it('STAGE4 の未保存の編集（人的投資の追加）は失われず、保存される', async () => {
    await loadedStore(true);
    serverAdopt(ADDED);
    stage4Edit('h2');
    await get().saveStrategyData({ force: true, reason: 'manual-save-button' });
    expect(humanIds(db.row.departments)).toEqual(['h1', 'h2']);
    expect(humanIds(storeDepts())).toEqual(['h1', 'h2']);
    expect(get().dirty).toBe(false);
  });

  it('同じプロジェクトを別の利用者が同時に変えた場合は、保存せず、利用者の編集を残して通知する', async () => {
    await loadedStore(true);
    serverChange((d) => {
      d[0].projects[0].planStatus = 'review';
      return d;
    });
    stage4Edit('h2');
    const res = await get().saveStrategyData({ force: true, reason: 'manual-save-button' });
    expect(res.ok).toBe(false);
    expect((res as any).reason).toBe('departments_conflict');
    expect(db.row.departments[0].projects[0].planStatus).toBe('review');
    expect(humanIds(storeDepts())).toEqual(['h1', 'h2']);
    expect(get().dirty).toBe(true);
    expect(String(get().saveError)).toContain('未保存の変更は画面に残しています');
  });
});

describe('6. 正常な保存は従来どおり成功する', () => {
  it('競合が無ければ、1回の保存で成功し、基準を更新する（再取得は呼ばれない）', async () => {
    await loadedStore(true);
    stage4Edit('h2');
    const res = await get().saveStrategyData({ force: true, reason: 'manual-save-button' });
    expect(res.ok).toBe(true);
    expect(db.saves).toHaveLength(1);
    expect(db.reads).toBe(0);
    expect(humanIds(db.row.departments)).toEqual(['h1', 'h2']);
    expect(db.row.revision).toBe(7);
  });
});

describe('7. 他の段階の保存に回帰がない（列の変更・revision の一致）', () => {
  it('STAGE1 の財務の変更（departments 以外）も、revision が一致すれば従来どおり保存される', async () => {
    await loadedStore(true);
    useStrategyStore.setState({ dirty: true, financeSummary: [{ year: 2025, revenue: 100 }] } as any);
    const res = await get().saveStrategyData({ force: true, reason: 'manual-save-button' });
    expect(res.ok).toBe(true);
    expect(db.saves[0].ok).toBe(true);
    expect(db.reads).toBe(0);
  });
});

describe('8. 会社・戦略が切り替わった後は、旧会社の編集内容を保存しない', () => {
  it('突き合わせの途中で戦略が切り替わったら、保存を再試行せず、旧会社の内容を反映しない', async () => {
    await loadedStore(true);
    serverAdopt(ADDED);
    stage4Edit('h2');
    db.beforeRead = () => useStrategyStore.setState({ strategyId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb' } as any);
    const res = await get().saveStrategyData({ force: true, reason: 'manual-save-button' });
    expect((res as any).reason).toBe('scope_changed');
    expect(db.saves.filter((s) => s.ok)).toHaveLength(0);
    expect(get().strategyId).toBe('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb');
  });
});

describe('9. revision トリガーが無い場合の危険性', () => {
  it('トリガー無し: 採用の後の保存は保存前に止まり、採用した案を上書きしない（危険を検出して保存を止める）', async () => {
    await loadedStore(false);
    serverAdopt(ADDED);
    stage4Edit('h2');
    const res = await get().saveStrategyData({ force: true, reason: 'manual-save-button' });
    expect((res as any).reason).toBe('revision_anomaly');
    expect(db.saves).toHaveLength(0);
    expect(hasAdded(db.row.departments)).toBe(true);
    expect(get().dirty).toBe(true);
  });

  it('トリガー有りでは、保存後の revision は進み、警告は出ない', async () => {
    await loadedStore(true);
    const warn = jest.spyOn(console, 'error').mockImplementation(() => undefined);
    stage4Edit('h2');
    await get().saveStrategyData({ force: true, reason: 'manual-save-button' });
    expect(warn.mock.calls.some((c) => String(c[0]).includes('想定どおり進みませんでした'))).toBe(false);
    warn.mockRestore();
  });
});

describe('10. 同じ競合が続いても、無限に再試行しない', () => {
  it('毎回別の保存が割り込む場合、保存は最大3回で止まり、利用者の編集は残る', async () => {
    await loadedStore(true);
    stage4Edit('h2');
    const noisy = () => {
      db.row.departments[0].projects.push({ id: `proj-noise-${db.row.revision}`, title: '割り込み', okrs: [] });
      db.row.revision += 1;
      db.beforeSave = noisy;
    };
    db.beforeSave = noisy;
    const res = await get().saveStrategyData({ force: true, reason: 'manual-save-button' });
    expect(res.ok).toBe(false);
    expect(db.saves.length).toBeLessThanOrEqual(3);
    expect(humanIds(storeDepts())).toEqual(['h1', 'h2']);
  });
});

describe('非ダーティ（未保存の変更が無い）の画面の場合', () => {
  it('未保存の変更が無い古い画面でも、最新の departments を取り込んでから保存し、採用した案を消さない', async () => {
    await loadedStore(true);
    serverAdopt(ADDED);
    expect(get().dirty).toBe(false);
    const res = await get().saveStrategyData({ force: true, reason: 'manual-save-button' });
    expect(res.ok).toBe(true);
    expect(hasAdded(db.row.departments)).toBe(true);
  });
});
