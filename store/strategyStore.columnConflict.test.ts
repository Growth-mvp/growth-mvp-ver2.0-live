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

/** 予約された再保存（setTimeout で起動）が終わるまで待つ */
async function waitForSaves(count: number) {
  for (let i = 0; i < 200 && db.saves.length < count; i++) await new Promise((r) => setTimeout(r, 0));
}

describe('保存中に加わった編集（保存済みと判定しない）', () => {
  it('保存の途中で利用者が編集したら、その編集は未保存のまま残り、dirty は true のまま', async () => {
    await loadedStore(true);
    localChange({ financeSummary: [{ year: 2025, revenue: 2000, operatingIncome: 150 }] });
    db.beforeSave = () => localChange({ financeSummary: [{ year: 2025, revenue: 9999, operatingIncome: 150 }] });

    const res = await get().saveStrategyData({ force: true, reason: 'manual-save-button' });

    expect(res.ok).toBe(true);
    expect(dbJson()).toContain('2000');
    expect(dbJson()).not.toContain('9999');
    expect(get().financeSummary[0].revenue).toBe(9999);
    expect(get().dirty).toBe(true);
    await waitForSaves(2);
  });

  it('保存中の編集は、予約された再保存で DB に入り、そのあと未保存とはしない（再読み込みで消えない）', async () => {
    await loadedStore(true);
    localChange({ financeSummary: [{ year: 2025, revenue: 2000, operatingIncome: 150 }] });
    db.beforeSave = () => localChange({ financeSummary: [{ year: 2025, revenue: 9999, operatingIncome: 150 }] });
    await get().saveStrategyData({ force: true, reason: 'manual-save-button' });
    await waitForSaves(2);

    expect(db.saves.map((s) => s.ok)).toEqual([true, true]);
    expect(dbJson()).toContain('9999');
    expect(get().dirty).toBe(false);
  });

  it('保存中の編集が保存された内容と同じなら、未保存とはしない', async () => {
    await loadedStore(true);
    localChange({ financeSummary: [{ year: 2025, revenue: 2000, operatingIncome: 150 }] });
    db.beforeSave = () => localChange({ financeSummary: [{ year: 2025, revenue: 2000, operatingIncome: 150 }] });

    const res = await get().saveStrategyData({ force: true, reason: 'manual-save-button' });

    expect(res.ok).toBe(true);
    expect(get().dirty).toBe(false);
  });

  it('予約された再保存の前に戦略が切り替わったら、切り替え先へは保存しない', async () => {
    await loadedStore(true);
    localChange({ financeSummary: [{ year: 2025, revenue: 2000, operatingIncome: 150 }] });
    db.beforeSave = () => localChange({ financeSummary: [{ year: 2025, revenue: 9999, operatingIncome: 150 }] });
    await get().saveStrategyData({ force: true, reason: 'manual-save-button' });
    useStrategyStore.setState({ strategyId: S_OTHER } as any);

    await waitForSaves(2);
    await new Promise((r) => setTimeout(r, 20));

    expect(db.saves).toHaveLength(1);
    expect(db.saves[0].ok).toBe(true);
    expect(get().strategyId).toBe(S_OTHER);
  });

  it('予約された再保存の前に企業が切り替わったら、切り替え先へは保存しない', async () => {
    await loadedStore(true);
    localChange({ financeSummary: [{ year: 2025, revenue: 2000, operatingIncome: 150 }] });
    db.beforeSave = () => localChange({ financeSummary: [{ year: 2025, revenue: 9999, operatingIncome: 150 }] });
    await get().saveStrategyData({ force: true, reason: 'manual-save-button' });
    useStrategyStore.setState({ companyId: 'co-other' } as any);

    await waitForSaves(2);
    await new Promise((r) => setTimeout(r, 20));

    expect(db.saves).toHaveLength(1);
    expect(get().companyId).toBe('co-other');
  });
});

describe('STAGE2: 再生成→結論生成→確定保存（自分の操作で保存競合を起こさない）', () => {
  const chapters = (tag: string) => [1, 2, 3, 4].map((i) => ({ title: `章${i}`, body: `${tag}の本文${i}` }));
  const bridge = (tag: string) => ({
    keyThemes: [{ title: tag }],
    departmentIssues: [],
    kpiCriteria: [],
    commonBehaviorChanges: [],
    generatedAt: '2026-11-26T00:00:00.000Z',
    strategicCore: { concreteDomains: [tag] },
  });
  const docEdits = (tag: string, confirmedAt: string) => ({
    assumptions: [{ id: 'a1', text: tag }],
    confirmed: { at: confirmedAt, chapters: chapters(tag) },
  });
  const failedSaves = () => db.saves.filter((s) => !s.ok);
  const saveWithAuditMock = () =>
    jest.requireMock('@/utils/persist/saveWithAudit').saveWithAudit as (...args: unknown[]) => Promise<any>;

  /* 結論生成APIはDBを直接更新する（revision も +1）。画面は返った revision を保存基準に取り込む。 */
  const conclusionFromApi = (conclusion: string, generatedAt: string, sync: boolean) => {
    db.row = {
      ...db.row,
      final_story_conclusion: { conclusion, generated_at: generatedAt, source: 'ai', story_fingerprint: 'fp' },
      revision: (db.row.revision ?? 0) + 1,
    };
    get().setStage2FinalGeneratedConclusion(conclusion);
    if (sync) get().markSavedPayload({ stage2FinalGeneratedConclusion: conclusion, stage2FinalGeneratedConclusionAt: generatedAt }, db.row.revision);
  };

  async function regenerate() {
    const before = get();
    const payload = { ...before, finalStory: [], finalStoryEdited: chapters('新'), finalStoryDraft: chapters('新') };
    const regen = await saveWithAuditMock()(payload, 'user-1', A, before.revision, {}, 'stage2:generateFinal');
    expect(regen.error).toBeNull();
    get().markSavedPayload(payload, regen.data?.revision);
    get().setFinalStoryEdited(chapters('新'));
    get().setFinalStory([]);
  }

  it('既存の確定版がない状態で、再生成→結論生成→確定しても、保存競合は起きず保存できる', async () => {
    await loadedStore(true);
    await regenerate();
    conclusionFromApi('新しい結論', '2026-11-26T01:00:00.000Z', true);

    localChange({ finalStoryFinal: chapters('新'), finalStoryEdited: chapters('新'), finalStory: chapters('新') });
    const res = await get().saveStrategyData({ force: true, reason: 'stage2:confirmAndBridge' });

    expect(res.ok).toBe(true);
    expect(failedSaves()).toHaveLength(0);
    expect(db.row.final_story_conclusion.conclusion).toBe('新しい結論');
  });

  it('結論生成の後に画面の保存基準を同期しないと、確定保存は競合になる（同期の必要性）', async () => {
    await loadedStore(true);
    await regenerate();
    conclusionFromApi('新しい結論', '2026-11-26T01:00:00.000Z', false);

    localChange({ finalStoryFinal: chapters('新'), finalStoryEdited: chapters('新'), finalStory: chapters('新') });
    await get().saveStrategyData({ force: true, reason: 'stage2:confirmAndBridge' });

    expect(failedSaves().length).toBeGreaterThan(0);
  });

  it('既存の確定版を持つ状態で、再生成・結論再生成・再確定しても、保存競合は起きず新しい版が保存される', async () => {
    await loadedStore(true);
    conclusionFromApi('最初の結論', '2026-11-20T00:00:00.000Z', true);
    localChange({
      finalStoryFinal: chapters('旧'),
      finalStoryEdited: chapters('旧'),
      finalStory: chapters('旧'),
      stage3_strategy_bridge: bridge('旧'),
      stage2FinalDocumentEdits: docEdits('旧', '2026-11-21T00:00:00.000Z'),
    });
    expect((await get().saveStrategyData({ force: true, reason: 'stage2:confirmAndBridge' })).ok).toBe(true);

    db.saves = [];
    await regenerate();
    conclusionFromApi('新しい結論', '2026-11-26T01:00:00.000Z', true);
    localChange({
      finalStoryFinal: chapters('新'),
      finalStoryEdited: chapters('新'),
      finalStory: chapters('新'),
      stage3_strategy_bridge: bridge('新'),
      stage2FinalDocumentEdits: docEdits('新', '2026-11-26T02:00:00.000Z'),
    });
    const res = await get().saveStrategyData({ force: true, reason: 'stage2:confirmAndBridge' });

    expect(res.ok).toBe(true);
    expect(failedSaves()).toHaveLength(0);
    const saved = actual.buildStateFromDbRow(clone(db.row)) as any;
    expect(saved.finalStoryFinal).toEqual(chapters('新'));
    expect(saved.stage3_strategy_bridge.keyThemes).toEqual([{ title: '新' }]);
    expect(saved.stage2FinalGeneratedConclusion).toBe('新しい結論');
  });
});
