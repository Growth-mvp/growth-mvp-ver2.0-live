/* eslint-disable @typescript-eslint/no-explicit-any -- Supabase モックの型は意図的に緩く定義している */
jest.mock('server-only', () => ({}));
jest.mock('@/lib/supabaseAdmin', () => ({ getSupabaseAdmin: jest.fn() }));
jest.mock('@/lib/server/mfaGuard', () => ({
  requireAdminMfa: jest.fn(async () => ({ ok: true, userId: 'user-1', isAdmin: true })),
}));

import { PATCH } from './route';
import { getSupabaseAdmin } from '@/lib/supabaseAdmin';

type Row = Record<string, any>;
type Filter = [string, unknown];
type Failure = { table: string; op: 'select' | 'update'; message: string };

/**
 * 実DBに接続しない Supabase クライアントのモック。
 * eq / in / select / update / maybeSingle / single を PostgREST に近い形で再現する。
 */
function createFakeAdmin(opts: {
  db: Record<string, Row[]>;
  tokens: Record<string, string>;
  failures?: Failure[];
  beforeUpdate?: (db: Record<string, Row[]>) => void;
}) {
  const { db, tokens, failures = [], beforeUpdate } = opts;
  const updates: Array<{ table: string; filters: Filter[]; payload: Row }> = [];

  const takeFailure = (table: string, op: 'select' | 'update') => {
    const i = failures.findIndex((f) => f.table === table && f.op === op);
    return i < 0 ? null : failures.splice(i, 1)[0];
  };
  const matches = (row: Row, filters: Filter[]) => filters.every(([c, v]) => row[c] === v);

  const from = (table: string) => {
    const filters: Filter[] = [];
    let inFilter: { col: string; values: unknown[] } | null = null;
    let op: 'select' | 'update' = 'select';
    let payload: Row = {};
    let mode: 'many' | 'one' = 'many';

    const exec = async (): Promise<{ data: any; error: any }> => {
      if (op === 'update') {
        const failure = takeFailure(table, 'update');
        if (failure) return { data: null, error: { message: failure.message } };
        beforeUpdate?.(db);
        updates.push({ table, filters: [...filters], payload });
        const targets = (db[table] ?? []).filter((r) => matches(r, filters));
        targets.forEach((r) => Object.assign(r, payload));
        return { data: targets.map((r) => ({ ...r })), error: null };
      }

      const failure = takeFailure(table, 'select');
      if (failure) return { data: null, error: { message: failure.message } };
      const found = (db[table] ?? []).filter(
        (r) => matches(r, filters) && (!inFilter || inFilter.values.includes(r[inFilter.col]))
      );
      if (mode === 'one') return { data: found[0] ? { ...found[0] } : null, error: null };
      return { data: found.map((r) => ({ ...r })), error: null };
    };

    const builder: any = {
      select: () => builder,
      update: (p: Row) => {
        op = 'update';
        payload = p;
        return builder;
      },
      eq: (c: string, v: unknown) => {
        filters.push([c, v]);
        return builder;
      },
      in: (c: string, values: unknown[]) => {
        inFilter = { col: c, values };
        return builder;
      },
      limit: () => builder,
      maybeSingle: () => {
        mode = 'one';
        return exec();
      },
      single: () => {
        mode = 'one';
        return exec();
      },
      then: (resolve: any, reject: any) => exec().then(resolve, reject),
    };
    return builder;
  };

  const auth = {
    getUser: async (token: string) =>
      tokens[token]
        ? { data: { user: { id: tokens[token] } }, error: null }
        : { data: { user: null }, error: { message: 'invalid token' } },
  };

  return { client: { from, auth }, db, updates };
}

const COMPANY_A = '11111111-1111-4111-8111-111111111111';
const COMPANY_B = '22222222-2222-4222-8222-222222222222';
const INSIGHT_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const INSIGHT_B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const MISSING_INSIGHT = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';

const ADMIN_A = '99999999-9999-4999-8999-999999999999';
const MEMBER_A = '88888888-8888-4888-8888-888888888888';
const MULTI_MEMBER_A_ADMIN_B = '77777777-7777-4777-8777-777777777777';
const ADMIN_A_MEMBER_B = '66666666-6666-4666-8666-666666666666';

const TOKENS: Record<string, string> = {
  'tok-admin-a': ADMIN_A,
  'tok-member-a': MEMBER_A,
  'tok-multi': MULTI_MEMBER_A_ADMIN_B,
  'tok-admin-a-member-b': ADMIN_A_MEMBER_B,
};

function seed() {
  return {
    company_members: [
      { company_id: COMPANY_A, user_id: ADMIN_A, role: 'admin' },
      { company_id: COMPANY_A, user_id: MEMBER_A, role: 'member' },
      { company_id: COMPANY_A, user_id: MULTI_MEMBER_A_ADMIN_B, role: 'member' },
      { company_id: COMPANY_B, user_id: MULTI_MEMBER_A_ADMIN_B, role: 'admin' },
      { company_id: COMPANY_A, user_id: ADMIN_A_MEMBER_B, role: 'admin' },
      { company_id: COMPANY_B, user_id: ADMIN_A_MEMBER_B, role: 'member' },
    ] as Row[],
    org_alignment_insights: [
      {
        id: INSIGHT_A,
        company_id: COMPANY_A,
        insights: [
          { title: 'A-論点1', nextActions: [] },
          { title: 'A-論点2', nextActions: [] },
        ],
        updated_at: '2026-01-01T00:00:00.000Z',
      },
      {
        id: INSIGHT_B,
        company_id: COMPANY_B,
        insights: [{ title: 'B-論点1', nextActions: [] }],
        updated_at: '2026-01-01T00:00:00.000Z',
      },
    ] as Row[],
  };
}

const VALID_BODY = { insightIndex: 0, nextActions: [{ title: '次の一手' }] };

function setup(extra: Partial<Parameters<typeof createFakeAdmin>[0]> = {}) {
  const fake = createFakeAdmin({ db: seed(), tokens: TOKENS, ...extra });
  (getSupabaseAdmin as jest.Mock).mockReturnValue(fake.client);
  return fake;
}

function patch(id: string, token: string | null, body: unknown = VALID_BODY) {
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (token) headers.authorization = `Bearer ${token}`;
  const req = new Request(`http://localhost/api/org-alignment/admin/insights/${id}/actions`, {
    method: 'PATCH',
    headers,
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });
  return PATCH(req as any, { params: { id } });
}

describe('PATCH /api/org-alignment/admin/insights/[id]/actions', () => {
  beforeEach(() => {
    (getSupabaseAdmin as jest.Mock).mockReset();
  });

  describe('正常系', () => {
    it('会社Aのadminは会社Aのインサイトを更新できる', async () => {
      const fake = setup();
      const res = await patch(INSIGHT_A, 'tok-admin-a');

      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ success: true });
      const row = fake.db.org_alignment_insights[0];
      expect(row.insights[0].nextActions).toEqual(VALID_BODY.nextActions);
      expect(row.insights[1].nextActions).toEqual([]);
      expect(row.updated_at).not.toBe('2026-01-01T00:00:00.000Z');
    });

    it('複数会社に所属し、対象会社でadminのユーザーは対象会社のインサイトを更新できる', async () => {
      const fake = setup();
      const res = await patch(INSIGHT_B, 'tok-multi');

      expect(res.status).toBe(200);
      expect(fake.db.org_alignment_insights[1].insights[0].nextActions).toEqual(VALID_BODY.nextActions);
    });

    it('更新条件に id と company_id の両方を使う', async () => {
      const fake = setup();
      await patch(INSIGHT_A, 'tok-admin-a');

      expect(fake.updates).toHaveLength(1);
      expect(fake.updates[0].table).toBe('org_alignment_insights');
      expect(fake.updates[0].filters).toEqual(
        expect.arrayContaining([
          ['id', INSIGHT_A],
          ['company_id', COMPANY_A],
        ])
      );
    });
  });

  describe('異常系（認可）', () => {
    it('会社Aのadminは会社Bのインサイトを更新できない', async () => {
      const fake = setup();
      const before = JSON.parse(JSON.stringify(fake.db));
      const res = await patch(INSIGHT_B, 'tok-admin-a');

      expect(res.status).toBe(403);
      expect(fake.updates).toHaveLength(0);
      expect(fake.db).toEqual(before);
    });

    it('会社Aではadminでも、会社Bでは一般メンバーなら会社Bのインサイトを更新できない', async () => {
      const fake = setup();
      const before = JSON.parse(JSON.stringify(fake.db));
      const res = await patch(INSIGHT_B, 'tok-admin-a-member-b');

      expect(res.status).toBe(403);
      expect(fake.updates).toHaveLength(0);
      expect(fake.db).toEqual(before);
    });

    it('同じ会社の一般メンバーは更新できない', async () => {
      const fake = setup();
      const before = JSON.parse(JSON.stringify(fake.db));
      const res = await patch(INSIGHT_A, 'tok-member-a');

      expect(res.status).toBe(403);
      expect(fake.updates).toHaveLength(0);
      expect(fake.db).toEqual(before);
    });

    it('複数会社所属でも、対象会社で一般メンバーなら更新できない', async () => {
      const fake = setup();
      const res = await patch(INSIGHT_A, 'tok-multi');

      expect(res.status).toBe(403);
      expect(fake.updates).toHaveLength(0);
    });

    it('未認証（トークンなし）は 401 で更新しない', async () => {
      const fake = setup();
      const res = await patch(INSIGHT_A, null);

      expect(res.status).toBe(401);
      expect(fake.updates).toHaveLength(0);
    });

    it('無効なトークンは 401 で更新しない', async () => {
      const fake = setup();
      const res = await patch(INSIGHT_A, 'tok-unknown');

      expect(res.status).toBe(401);
      expect(fake.updates).toHaveLength(0);
    });
  });

  describe('異常系（ID・DB）', () => {
    it('不正なIDは 400 で、DBを更新しない', async () => {
      const fake = setup();
      const res = await patch('not-a-uuid', 'tok-admin-a');

      expect(res.status).toBe(400);
      expect(fake.updates).toHaveLength(0);
    });

    it('存在しないIDは 404 で、DBを更新しない', async () => {
      const fake = setup();
      const res = await patch(MISSING_INSIGHT, 'tok-admin-a');

      expect(res.status).toBe(404);
      expect(fake.updates).toHaveLength(0);
    });

    it('対象の取得でDBエラーが起きた場合は 500 で、更新しない', async () => {
      const fake = setup({
        failures: [{ table: 'org_alignment_insights', op: 'select', message: 'db down' }],
      });
      const res = await patch(INSIGHT_A, 'tok-admin-a');

      expect(res.status).toBe(500);
      expect(fake.updates).toHaveLength(0);
    });

    it('更新でDBエラーが起きた場合は 500 で、既存データを変更しない', async () => {
      const fake = setup({
        failures: [{ table: 'org_alignment_insights', op: 'update', message: 'write failed' }],
      });
      const before = JSON.parse(JSON.stringify(fake.db));
      const res = await patch(INSIGHT_A, 'tok-admin-a');

      expect(res.status).toBe(500);
      expect(fake.db).toEqual(before);
    });

    it('更新の対象が0件になった場合は成功扱いしない', async () => {
      const fake = setup({
        beforeUpdate: (db) => {
          db.org_alignment_insights[0].company_id = COMPANY_B;
        },
      });
      const res = await patch(INSIGHT_A, 'tok-admin-a');

      expect(res.status).toBe(404);
      expect(fake.db.org_alignment_insights[0].insights[0].nextActions).toEqual([]);
    });
  });

  describe('回帰確認', () => {
    it('insightIndex が範囲外なら 400 で、更新しない', async () => {
      const fake = setup();
      const res = await patch(INSIGHT_A, 'tok-admin-a', { insightIndex: 5, nextActions: [] });

      expect(res.status).toBe(400);
      expect(fake.updates).toHaveLength(0);
    });

    it('nextActions が配列でなければ 400 で、更新しない', async () => {
      const fake = setup();
      const res = await patch(INSIGHT_A, 'tok-admin-a', { insightIndex: 0, nextActions: 'x' });

      expect(res.status).toBe(400);
      expect(fake.updates).toHaveLength(0);
    });

    it('不正なJSONは 400 で、更新しない', async () => {
      const fake = setup();
      const res = await patch(INSIGHT_A, 'tok-admin-a', '{not json');

      expect(res.status).toBe(400);
      expect(fake.updates).toHaveLength(0);
    });

    it('指定した論点以外の内容と既存の構造は変わらない', async () => {
      const fake = setup();
      await patch(INSIGHT_A, 'tok-admin-a', { insightIndex: 1, nextActions: [{ title: 'X' }] });

      const row = fake.db.org_alignment_insights[0];
      expect(row.insights).toHaveLength(2);
      expect(row.insights[0]).toEqual({ title: 'A-論点1', nextActions: [] });
      expect(row.insights[1]).toEqual({ title: 'A-論点2', nextActions: [{ title: 'X' }] });
      expect(row.company_id).toBe(COMPANY_A);
    });

    it('別会社のインサイトは更新されない', async () => {
      const fake = setup();
      await patch(INSIGHT_A, 'tok-admin-a');

      expect(fake.db.org_alignment_insights[1]).toEqual(seed().org_alignment_insights[1]);
    });
  });
});
