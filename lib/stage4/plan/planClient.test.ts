import {
  ID_MESSAGES,
  createRemotePlanStore,
  ensureStableProjectId,
  planStoreKindFrom,
  withProjectId,
  type IdentityApi,
  type ProjectView,
} from './planClient';
import { SAVE_FAILED } from './planService';

const KEY = { companyId: 'co', strategyId: 'st', projectId: 'p-1' };
const ACTOR = { userId: 'u', memberships: [] };
const TOKEN = async () => 't';

function fetchOf(status: number, json: unknown) {
  return jest.fn(async (_url: string, _init?: RequestInit) => new Response(JSON.stringify(json), { status }));
}

describe('保存先の選び方', () => {
  it('URLの指定が最優先、次に環境変数、無ければブラウザ内', () => {
    expect(planStoreKindFrom('?planStore=remote')).toBe('remote');
    expect(planStoreKindFrom('?planStore=local', 'remote')).toBe('local');
    expect(planStoreKindFrom('', 'remote')).toBe('remote');
    expect(planStoreKindFrom('')).toBe('local');
  });
});

describe('番号の付与（画面の手順）', () => {
  const view = (projects: ProjectView[], revision = 5) => ({ status: 'FOUND' as const, revision, projects });
  const base = { companyId: 'co', strategyId: 'st', departmentIndex: 0, projectIndex: 0, expectedTitle: '案件', newId: 'new' };
  const api = (readStrategy: IdentityApi['readStrategy'], assign?: IdentityApi['assign']) => {
    const calls: unknown[] = [];
    const a: IdentityApi = {
      readStrategy,
      assign: async (args) => (calls.push(args), assign ? assign(args) : { status: 'ASSIGNED', projectId: 'new', alreadyAssigned: false, revision: 6 }),
    };
    return { api: a, calls };
  };

  it('既に番号があれば、書き込まずにそれを使う', async () => {
    const { api: a, calls } = api(async () => view([{ departmentIndex: 0, projectIndex: 0, title: '案件', projectId: 'old' }]));
    expect(await ensureStableProjectId(a, base)).toEqual({ ok: true, projectId: 'old', alreadyAssigned: true });
    expect(calls).toHaveLength(0);
  });

  it('画面で見ていた名称と違えば、付けずに止める', async () => {
    const { api: a, calls } = api(async () => view([{ departmentIndex: 0, projectIndex: 0, title: '別の案件', projectId: null }]));
    expect(await ensureStableProjectId(a, base)).toEqual({ ok: false, message: ID_MESSAGES.titleChanged });
    expect(calls).toHaveLength(0);
  });

  it('読んだ版番号で付与を依頼する。版番号が変わっていたら、やり直しを求める', async () => {
    const { api: a, calls } = api(async () => view([{ departmentIndex: 0, projectIndex: 0, title: '案件', projectId: null }], 5), async () => ({ status: 'REVISION_CHANGED' }));
    const out = await ensureStableProjectId(a, base);
    expect(out).toEqual({ ok: false, message: ID_MESSAGES.revisionChanged });
    expect(calls[0]).toMatchObject({ expectedRevision: 5, newId: 'new' });
  });

  it('付与できれば、その番号を返す（保存はこの後に行う）', async () => {
    const { api: a } = api(async () => view([{ departmentIndex: 0, projectIndex: 0, title: '案件', projectId: null }]));
    expect(await ensureStableProjectId(a, base)).toEqual({ ok: true, projectId: 'new', alreadyAssigned: false });
  });

  it('権限が無ければ、権限の文言を返す', async () => {
    const { api: a } = api(async () => ({ status: 'DENIED' }));
    expect(await ensureStableProjectId(a, base)).toEqual({ ok: false, message: ID_MESSAGES.forbidden });
  });
});

describe('API経由の保存先（結果を画面の型に変える）', () => {
  it('作成：草案は生成の経路だけが作るため、画面からの作成は通信せず権限なしを返す', async () => {
    let called = false;
    const store = createRemotePlanStore({
      baseUrl: 'http://x',
      getToken: TOKEN,
      fetchFn: (async () => {
        called = true;
        return new Response('{}', { status: 201 });
      }) as never,
    });
    expect((await store.create(ACTOR, KEY, { aiDraft: {}, userEdits: {}, adopted: false })).status).toBe('DENIED');
    expect(called).toBe(false);
  });

  it('読み込み：公開前（APIが無効の503）は、失敗ではなく無効として返す', async () => {
    const disabled = createRemotePlanStore({ baseUrl: 'http://x', getToken: TOKEN, fetchFn: fetchOf(503, { status: 'DISABLED' }) as never });
    expect((await disabled.load(ACTOR, KEY)).status).toBe('DISABLED');
  });

  it('保存：409 は競合、403 は権限なし、通信の失敗は保存できなかった', async () => {
    const conflict = createRemotePlanStore({ baseUrl: 'http://x', getToken: TOKEN, fetchFn: fetchOf(409, { status: 'CONFLICT', current: { version: 2 } }) as never });
    expect((await conflict.update(ACTOR, KEY, 1, { userEdits: {} } as never)).status).toBe('CONFLICT');
    const denied = createRemotePlanStore({ baseUrl: 'http://x', getToken: TOKEN, fetchFn: fetchOf(403, { status: 'DENIED' }) as never });
    expect((await denied.update(ACTOR, KEY, 1, { userEdits: {} } as never)).status).toBe('DENIED');
    const down = createRemotePlanStore({
      baseUrl: 'http://x',
      getToken: TOKEN,
      fetchFn: (async () => {
        throw new TypeError('network');
      }) as never,
    });
    expect(await down.update(ACTOR, KEY, 1, { userEdits: {} } as never)).toEqual({ status: 'FAILED', message: SAVE_FAILED });
  });

  it('読み込み：FOUND と NONE を区別する。トークンが無ければ通信しない', async () => {
    const found = createRemotePlanStore({ baseUrl: 'http://x', getToken: TOKEN, fetchFn: fetchOf(200, { status: 'FOUND', record: { version: 3 } }) as never });
    expect((await found.load(ACTOR, KEY)).status).toBe('FOUND');
    const none = createRemotePlanStore({ baseUrl: 'http://x', getToken: TOKEN, fetchFn: fetchOf(200, { status: 'NONE' }) as never });
    expect((await none.load(ACTOR, KEY)).status).toBe('NONE');
    const spy = fetchOf(200, {});
    const noToken = createRemotePlanStore({ baseUrl: 'http://x', getToken: async () => null, fetchFn: spy as never });
    expect((await noToken.load(ACTOR, KEY)).status).toBe('FAILED');
    expect(spy).not.toHaveBeenCalled();
  });

  it('送るのは、利用者のトークンと、会社・戦略・プロジェクトの指定', async () => {
    const spy = fetchOf(200, { status: 'NONE' });
    const store = createRemotePlanStore({ baseUrl: 'http://x', getToken: TOKEN, fetchFn: spy as never });
    await store.load(ACTOR, KEY);
    const [url, init] = spy.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toContain('/api/stage4/plan-documents?');
    expect(url).toContain('projectId=p-1');
    expect((init.headers as Record<string, string>).authorization).toBe('Bearer t');
  });
});

describe('番号を入れた部門の作成（元の状態は変えない）', () => {
  it('対象の項目の番号だけが変わる', () => {
    const before = [{ name: 'a', projects: [{ title: 'x' }, { title: 'y' }] }];
    const after = withProjectId(before, 0, 1, 'NEW') as typeof before & Array<{ projects: Array<Record<string, unknown>> }>;
    expect(after[0].projects[1]).toEqual({ title: 'y', id: 'NEW' });
    expect(after[0].projects[0]).toEqual({ title: 'x' });
    expect(before[0].projects[1]).toEqual({ title: 'y' });
  });
});
