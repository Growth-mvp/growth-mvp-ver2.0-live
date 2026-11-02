export {};
/* 共通保存の競合（列ごと・モック）。ストアは本物を使い、DB の保存と読み取りだけをメモリ上のモックにする。
 * DB の保存は、画面の保存と同じ変換（状態 → DB 行）で行う。別の利用者の変更は、DB 行を読み、変更して書き戻すことで再現する。 */

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

type DbState = {
  row: Record<string, any>;
  triggerOn: boolean;
  saves: Array<{ ok: boolean; reason: string; revision: number | undefined }>;
  beforeSave: null | (() => void);
  beforeRead: null | (() => void);
  reads: number;
  clock: number;
};

const db: DbState = { row: {}, triggerOn: true, saves: [], beforeSave: null, beforeRead: null, reads: 0, clock: 0 };

const A = '11111111-1111-4111-8111-111111111111';
const S = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const S_OTHER = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';

const clone = <T,>(v: T): T => JSON.parse(JSON.stringify(v));
const tick = () => `2026-11-02T00:00:${String(++db.clock).padStart(2, '0')}Z`;

const actual = jest.requireActual('@/utils/supabase/strategy') as typeof import('@/utils/supabase/strategy');

/** 保存の模型。revision を指定した保存は、一致しなければ REVISION_CONFLICT（0 行）。全列を書く。 */
function mockSaveWithAudit(payload: any, _userId: unknown, companyId: string, revision: number | undefined, _opts: unknown, caller: string) {
  if (db.beforeSave) {
    const hook = db.beforeSave;
    db.beforeSave = null;
    hook();
  }
  const reason = String(caller ?? '');
  if (companyId !== A) {
    db.saves.push({ ok: false, reason: 'other_company', revision });
    return Promise.resolve({ data: null, error: { message: 'forbidden' } });
  }
  if (typeof revision === 'number' && revision !== db.row.revision) {
    db.saves.push({ ok: false, reason, revision });
    return Promise.resolve({
      data: null,
      error: { message: 'revision conflict', code: 'REVISION_CONFLICT', currentRevision: db.row.revision },
    });
  }
  const before = db.row.revision ?? 0;
  db.row = {
    ...db.row,
    ...actual.buildDbRowFromState(clone(payload) as any),
    id: S,
    company_id: A,
    revision: db.triggerOn ? before + 1 : before,
    updated_at: tick(),
  };
  db.saves.push({ ok: true, reason, revision });
  return Promise.resolve({ data: actual.buildStateFromDbRow(clone(db.row)) as any, error: null });
}

jest.mock('@/utils/persist/saveWithAudit', () => ({
  saveWithAudit: (payload: any, userId: unknown, companyId: string, revision: number | undefined, opts: unknown, caller: string) =>
    mockSaveWithAudit(payload, userId, companyId, revision, opts, caller),
}));

async function mockReadStrategy(strategyId: string, companyId: string) {
  db.reads += 1;
  if (db.beforeRead) {
    const hook = db.beforeRead;
    db.beforeRead = null;
    hook();
  }
  if (strategyId !== S || companyId !== A) return { data: null, error: new Error('not found') };
  return { data: actual.buildStateFromDbRow(clone(db.row)) as any, error: null };
}

jest.mock('@/utils/supabase/strategy', () => {
  const real = jest.requireActual('@/utils/supabase/strategy');
  return {
    ...real,
    getFullStrategyDataByCompany: jest.fn(async () => {
      throw new Error('unexpected call: getFullStrategyDataByCompany');
    }),
    getFullStrategyDataByStrategyId: (strategyId: string, companyId: string) => mockReadStrategy(strategyId, companyId),
  };
});

import { useStrategyStore, resetRevisionAnomalyForTests } from './strategyStore';

const get = () => useStrategyStore.getState() as any;

/** 別の利用者による変更（トリガー有りなら revision が +1、無しなら据え置き）。DB の行を読み、変更して書き戻す。 */
function otherUserChange(mutate: (st: any) => void) {
  const st = actual.buildStateFromDbRow(clone(db.row)) as any;
  mutate(st);
  const before = db.row.revision ?? 0;
  db.row = {
    ...db.row,
    ...actual.buildDbRowFromState(clone(st) as any),
    id: S,
    company_id: A,
    revision: db.triggerOn ? before + 1 : before,
    updated_at: tick(),
  };
}

const dbJson = () => JSON.stringify(actual.buildStateFromDbRow(clone(db.row)));

const INITIAL = {
  financeSummary: [{ year: 2025, revenue: 1000, operatingIncome: 100 }],
  answers12: [{ id: 'ch0-q1', question: 'Q1', answer: '元の回答' }],
  simulationResults: [{ id: 'sim-1', label: '元のシミュレーション' }],
  departments: [
    {
      name: '営業部',
      mission: '顧客を広げる',
      projects: [
        {
          id: 'proj-1',
          title: '新規顧客開拓',
          planStatus: 'approved',
          executionHumanInvestments: [{ id: 'h1', person: '山田', months: 2 }],
          okrs: [],
        },
      ],
    },
  ],
};

/** 読み込み済みの状態（revision 5）を作り、初回の保存で「最後に同期した版」を確定させる。 */
async function loadedStore(triggerOn: boolean) {
  db.triggerOn = triggerOn;
  db.saves = [];
  db.beforeSave = null;
  db.beforeRead = null;
  db.reads = 0;
  mockUser.companyId = A;
  db.row = {
    ...actual.buildDbRowFromState(clone(INITIAL) as any),
    id: S,
    company_id: A,
    revision: 5,
    updated_at: tick(),
  };
  useStrategyStore.setState({
    companyId: A,
    pendingCompanyId: undefined,
    strategyId: S,
    hydrated: true,
    restoreReady: true,
    loaded: true,
    isRestoring: false,
    boot: { isHydrating: false, isHydrated: true, isSaving: false, isRestoring: false },
    ...clone(INITIAL),
    revision: 5,
    dirty: false,
    saveError: undefined,
  } as any);
  const init = await get().saveStrategyData({ force: true, reason: 'manual-save-button' });
  expect(init.ok).toBe(true);
  db.saves = [];
  db.reads = 0;
}

/** この利用者の未保存の変更（ローカルの状態を書き換える）。 */
function localChange(patch: Record<string, unknown>) {
  useStrategyStore.setState({ ...patch, dirty: true } as any);
}

const localDepts = () => clone(get().departments as any[]);

beforeEach(() => {
  jest.clearAllMocks();
  resetRevisionAnomalyForTests();
});

describe('正常な単独保存（競合なし）', () => {
  it('STAGE1 の財務だけを変えて保存すれば、1回で成功し、再取得は行わない', async () => {
    await loadedStore(true);
    localChange({ financeSummary: [{ year: 2025, revenue: 2000, operatingIncome: 150 }] });
    const res = await get().saveStrategyData({ force: true, reason: 'manual-save-button' });
    expect(res.ok).toBe(true);
    expect(db.saves).toHaveLength(1);
    expect(db.reads).toBe(0);
    expect(dbJson()).toContain('2000');
    expect(get().dirty).toBe(false);
  });
});

describe('異なる列を、別々の利用者が同時に変えた場合（両方を残す）', () => {
  it('他の利用者は STAGE2 の全社戦略と STAGE6 のシミュレーションを変え、自分は STAGE4 の実行計画を変える → 両方が保存される', async () => {
    await loadedStore(true);
    otherUserChange((st) => {
      st.answers12 = [{ id: 'ch0-q1', question: 'Q1', answer: '他の利用者が更新した回答' }];
      st.simulationResults = [{ id: 'sim-1', label: '他の利用者が作ったシミュレーション' }];
    });
    const depts = localDepts();
    depts[0].projects[0].executionHumanInvestments.push({ id: 'h2', person: '佐藤', months: 1 });
    localChange({ departments: depts });

    const res = await get().saveStrategyData({ force: true, reason: 'manual-save-button' });
    expect(res.ok).toBe(true);
    const json = dbJson();
    expect(json).toContain('他の利用者が更新した回答');
    expect(JSON.stringify(db.row.simulation_results)).toContain('他の利用者が作ったシミュレーション');
    expect(json).toContain('佐藤');
    expect(JSON.stringify(get().answers12)).toContain('他の利用者が更新した回答');
  });

  it('他の利用者は STAGE3 の部門戦略（ミッション）を変え、自分は STAGE1 の財務を変える → 両方が保存される', async () => {
    await loadedStore(true);
    otherUserChange((st) => {
      st.departments[0].mission = '他の利用者が書いたミッション';
    });
    localChange({ financeSummary: [{ year: 2025, revenue: 3000, operatingIncome: 300 }] });

    const res = await get().saveStrategyData({ force: true, reason: 'manual-save-button' });
    expect(res.ok).toBe(true);
    expect(dbJson()).toContain('他の利用者が書いたミッション');
    expect(dbJson()).toContain('3000');
  });

  it('他の利用者は STAGE6 のシミュレーションを変え、自分は STAGE1 の財務を変える → 他の利用者のシミュレーションを古い値で戻さない', async () => {
    await loadedStore(true);
    otherUserChange((st) => {
      st.simulationResults = [{ id: 'sim-1', label: '他の利用者の新しいシミュレーション' }];
    });
    localChange({ financeSummary: [{ year: 2025, revenue: 4000, operatingIncome: 400 }] });

    const res = await get().saveStrategyData({ force: true, reason: 'manual-save-button' });
    expect(res.ok).toBe(true);
    expect(JSON.stringify(db.row.simulation_results)).toContain('他の利用者の新しいシミュレーション');
    expect(JSON.stringify(db.row.simulation_results)).not.toContain('元のシミュレーション');
    expect(dbJson()).toContain('4000');
  });
});

describe('同じ列・同じ項目を両方が変えた場合（自動で選ばず、保存を止める）', () => {
  it('STAGE1 の財務を両方が違う内容に変えたら、保存せず、利用者の編集を残して通知する', async () => {
    await loadedStore(true);
    otherUserChange((st) => {
      st.financeSummary = [{ year: 2025, revenue: 5000, operatingIncome: 500 }];
    });
    localChange({ financeSummary: [{ year: 2025, revenue: 6000, operatingIncome: 600 }] });

    const res = await get().saveStrategyData({ force: true, reason: 'manual-save-button' });
    expect(res.ok).toBe(false);
    expect((res as any).reason).toBe('field_conflict');
    expect(dbJson()).toContain('5000');
    expect(dbJson()).not.toContain('6000');
    expect(JSON.stringify(get().financeSummary)).toContain('6000');
    expect(get().dirty).toBe(true);
    expect(String(get().saveError)).toContain('財務・会社情報（STAGE1）');
    expect(String(get().saveError)).toContain('未保存の変更は画面に残しています');
  });

  it('STAGE2 の回答を両方が違う内容に変えたら、保存を止める', async () => {
    await loadedStore(true);
    otherUserChange((st) => {
      st.answers12 = [{ id: 'ch0-q1', question: 'Q1', answer: '他の回答' }];
    });
    localChange({ answers12: [{ id: 'ch0-q1', question: 'Q1', answer: '自分の回答' }] });

    const res = await get().saveStrategyData({ force: true, reason: 'manual-save-button' });
    expect(res.ok).toBe(false);
    expect(dbJson()).toContain('他の回答');
    expect(JSON.stringify(get().answers12)).toContain('自分の回答');
  });

  it('同じプロジェクトの承認（他の利用者）と人的投資（自分）は、勝手に統合せず、保存を止める', async () => {
    await loadedStore(true);
    otherUserChange((st) => {
      st.departments[0].projects[0].planStatus = 'review';
    });
    const depts = localDepts();
    depts[0].projects[0].executionHumanInvestments.push({ id: 'h2', person: '佐藤', months: 1 });
    localChange({ departments: depts });

    const res = await get().saveStrategyData({ force: true, reason: 'manual-save-button' });
    expect(res.ok).toBe(false);
    expect((res as any).reason).toBe('departments_conflict');
    expect(dbJson()).toContain('review');
    expect(dbJson()).not.toContain('佐藤');
  });
});

describe('会社・戦略が切り替わった後は、旧データを保存しない', () => {
  it('突き合わせの途中で戦略が切り替わったら、再試行せず、旧データを保存しない', async () => {
    await loadedStore(true);
    otherUserChange((st) => {
      st.financeSummary = [{ year: 2025, revenue: 7000 }];
    });
    localChange({ financeSummary: [{ year: 2025, revenue: 8000 }] });
    db.beforeRead = () => useStrategyStore.setState({ strategyId: S_OTHER } as any);

    const res = await get().saveStrategyData({ force: true, reason: 'manual-save-button' });
    expect((res as any).reason).toBe('scope_changed');
    expect(db.saves.filter((s) => s.ok)).toHaveLength(0);
    expect(dbJson()).not.toContain('8000');
    expect(get().strategyId).toBe(S_OTHER);
  });
});

describe('revision が分からない場合（無条件の上書きをしない）', () => {
  it('revision が未取得のまま既存の行へ保存しようとしたら、保存せず、画面の再読み込みを求める', async () => {
    await loadedStore(true);
    localChange({ financeSummary: [{ year: 2025, revenue: 9000 }] });
    useStrategyStore.setState({ revision: undefined } as any);

    const res = await get().saveStrategyData({ force: true, reason: 'manual-save-button' });
    expect((res as any).reason).toBe('revision_unknown');
    expect(db.saves).toHaveLength(0);
    expect(dbJson()).not.toContain('9000');
    expect(String(get().saveError)).toContain('画面を再読み込み');
  });
});

describe('revision トリガーの有無', () => {
  it('トリガー有り: 他の利用者の STAGE1 の変更は、古い画面の STAGE4 の保存で消えない', async () => {
    await loadedStore(true);
    otherUserChange((st) => {
      st.financeSummary = [{ year: 2025, revenue: 1500 }];
    });
    const depts = localDepts();
    depts[0].projects[0].executionHumanInvestments.push({ id: 'h2', person: '佐藤', months: 1 });
    localChange({ departments: depts });

    const res = await get().saveStrategyData({ force: true, reason: 'manual-save-button' });
    expect(res.ok).toBe(true);
    expect(dbJson()).toContain('1500');
    expect(dbJson()).toContain('佐藤');
  });

  it('トリガー無し: 保存後に revision が進まないと検出し、以後の保存を止める（他の利用者の STAGE1 の変更を上書きしない）', async () => {
    await loadedStore(false);
    otherUserChange((st) => {
      st.financeSummary = [{ year: 2025, revenue: 1500 }];
    });
    const depts = localDepts();
    depts[0].projects[0].executionHumanInvestments.push({ id: 'h2', person: '佐藤', months: 1 });
    localChange({ departments: depts });

    const res = await get().saveStrategyData({ force: true, reason: 'manual-save-button' });
    expect((res as any).reason).toBe('revision_anomaly');
    expect(db.saves).toHaveLength(0);
    expect(dbJson()).toContain('1500');
    expect(String(get().saveError)).toContain('想定どおり進みませんでした');
    expect(get().dirty).toBe(true);
  });
});

describe('revision 異常時の保護', () => {
  it('トリガー無しで保存が成功しても、「保存は完了」と表示し、未保存とは断定しない（保存は実際に行われている）', async () => {
    await loadedStore(false);
    expect(db.row.revision).toBe(5);
    expect(String(get().saveError)).toContain('保存は完了しました');
    expect(get().dirty).toBe(false);
  });

  it('異常の後の新しい編集は保存されず、画面に残る（既存の DB の値は変わらない）', async () => {
    await loadedStore(false);
    const before = dbJson();
    localChange({ financeSummary: [{ year: 2025, revenue: 9999 }] });
    const res = await get().saveStrategyData({ force: true, reason: 'manual-save-button' });
    expect((res as any).reason).toBe('revision_anomaly');
    expect(dbJson()).toBe(before);
    expect(JSON.stringify(get().financeSummary)).toContain('9999');
    expect(get().dirty).toBe(true);
  });

  it('トリガー有りでは異常は起きず、保存は続けられる', async () => {
    await loadedStore(true);
    localChange({ financeSummary: [{ year: 2025, revenue: 7777 }] });
    const res = await get().saveStrategyData({ force: true, reason: 'manual-save-button' });
    expect(res.ok).toBe(true);
    expect(get().saveError).toBeUndefined();
    expect(dbJson()).toContain('7777');
  });
});
