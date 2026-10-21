/* eslint-disable @typescript-eslint/no-explicit-any -- Supabase モックの型は意図的に緩く定義している */
jest.mock('server-only', () => ({}));
jest.mock('@/lib/supabaseAdmin', () => ({ getSupabaseAdmin: jest.fn() }));

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
const TOPIC_A = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
const TOPIC_B = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';
const MISSING_TOPIC = 'ffffffff-ffff-4fff-8fff-ffffffffffff';
const SOURCE_INSIGHT = '12121212-1212-4121-8121-121212121212';

const ADMIN_A = '99999999-9999-4999-8999-999999999999';
const MEMBER_A = '88888888-8888-4888-8888-888888888888';
const MULTI_MEMBER_A_ADMIN_B = '77777777-7777-4777-8777-777777777777';
const ADMIN_A_MEMBER_B = '66666666-6666-4666-8666-666666666666';
const RESTRICTED_AUTHOR = '55555555-5555-4555-8555-555555555555';

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
    org_alignment_shared_topics: [
      {
        id: TOPIC_A,
        company_id: COMPANY_A,
        source_alignment_insight_id: SOURCE_INSIGHT,
        status: 'in_alignment',
        announcement_text: null,
      },
      {
        id: TOPIC_B,
        company_id: COMPANY_B,
        source_alignment_insight_id: null,
        status: 'in_alignment',
        announcement_text: null,
      },
    ] as Row[],
    org_alignment_insight_sources: [
      {
        insight_id: SOURCE_INSIGHT,
        case_id: 'case-1',
        org_alignment_cases: { created_by: RESTRICTED_AUTHOR, visibility_mode: 'anonymous' },
      },
    ] as Row[],
    profiles: [
      { id: RESTRICTED_AUTHOR, full_name: '匿名 太郎', email: 'restricted@example.com' },
    ] as Row[],
  };
}

const VALID_TEXT = '来月から新しい取り組みを始めます。';

function setup(extra: Partial<Parameters<typeof createFakeAdmin>[0]> = {}) {
  const fake = createFakeAdmin({ db: seed(), tokens: TOKENS, ...extra });
  (getSupabaseAdmin as jest.Mock).mockReturnValue(fake.client);
  return fake;
}

function patch(id: string, token: string | null, body: unknown = { announcementText: VALID_TEXT }) {
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (token) headers.authorization = `Bearer ${token}`;
  const req = new Request(`http://localhost/api/org-alignment/admin/shared-topics/${id}/announcement`, {
    method: 'PATCH',
    headers,
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });
  return PATCH(req as any, { params: { id } });
}

describe('PATCH /api/org-alignment/admin/shared-topics/[id]/announcement', () => {
  beforeEach(() => {
    (getSupabaseAdmin as jest.Mock).mockReset();
  });

  describe('正常系', () => {
    it('会社Aのadminは会社Aの共有トピックに告知を設定できる', async () => {
      const fake = setup();
      const res = await patch(TOPIC_A, 'tok-admin-a');

      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ success: true });
      const row = fake.db.org_alignment_shared_topics[0];
      expect(row.announcement_text).toBe(VALID_TEXT);
      expect(row.status).toBe('published');
      expect(row.announcement_updated_by).toBe(ADMIN_A);
      expect(row.published_by).toBe(ADMIN_A);
      expect(row.published_at).toEqual(expect.any(String));
    });

    it('複数会社に所属し、対象会社でadminのユーザーは対象会社の共有トピックに告知を設定できる', async () => {
      const fake = setup();
      const res = await patch(TOPIC_B, 'tok-multi');

      expect(res.status).toBe(200);
      expect(fake.db.org_alignment_shared_topics[1].announcement_text).toBe(VALID_TEXT);
    });

    it('更新条件に id と company_id の両方を使う', async () => {
      const fake = setup();
      await patch(TOPIC_A, 'tok-admin-a');

      expect(fake.updates).toHaveLength(1);
      expect(fake.updates[0].table).toBe('org_alignment_shared_topics');
      expect(fake.updates[0].filters).toEqual(
        expect.arrayContaining([
          ['id', TOPIC_A],
          ['company_id', COMPANY_A],
        ])
      );
    });
  });

  describe('異常系（認可）', () => {
    it('会社Aのadminは会社Bの共有トピックに告知を設定できない', async () => {
      const fake = setup();
      const before = JSON.parse(JSON.stringify(fake.db));
      const res = await patch(TOPIC_B, 'tok-admin-a');

      expect(res.status).toBe(403);
      expect(fake.updates).toHaveLength(0);
      expect(fake.db).toEqual(before);
    });

    it('会社Aではadminでも、会社Bでは一般メンバーなら会社Bの共有トピックに告知を設定できない', async () => {
      const fake = setup();
      const before = JSON.parse(JSON.stringify(fake.db));
      const res = await patch(TOPIC_B, 'tok-admin-a-member-b');

      expect(res.status).toBe(403);
      expect(fake.updates).toHaveLength(0);
      expect(fake.db).toEqual(before);
    });

    it('同じ会社の一般メンバーは告知を設定できない', async () => {
      const fake = setup();
      const before = JSON.parse(JSON.stringify(fake.db));
      const res = await patch(TOPIC_A, 'tok-member-a');

      expect(res.status).toBe(403);
      expect(fake.updates).toHaveLength(0);
      expect(fake.db).toEqual(before);
    });

    it('複数会社所属でも、対象会社で一般メンバーなら告知を設定できない', async () => {
      const fake = setup();
      const res = await patch(TOPIC_A, 'tok-multi');

      expect(res.status).toBe(403);
      expect(fake.updates).toHaveLength(0);
    });

    it('未認証（トークンなし）は 401 で更新しない', async () => {
      const fake = setup();
      const res = await patch(TOPIC_A, null);

      expect(res.status).toBe(401);
      expect(fake.updates).toHaveLength(0);
    });

    it('無効なトークンは 401 で更新しない', async () => {
      const fake = setup();
      const res = await patch(TOPIC_A, 'tok-unknown');

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
      const res = await patch(MISSING_TOPIC, 'tok-admin-a');

      expect(res.status).toBe(404);
      expect(fake.updates).toHaveLength(0);
    });

    it('対象の取得でDBエラーが起きた場合は 500 で、更新しない', async () => {
      const fake = setup({
        failures: [{ table: 'org_alignment_shared_topics', op: 'select', message: 'db down' }],
      });
      const res = await patch(TOPIC_A, 'tok-admin-a');

      expect(res.status).toBe(500);
      expect(fake.updates).toHaveLength(0);
    });

    it('更新でDBエラーが起きた場合は 500 で、既存データを変更しない', async () => {
      const fake = setup({
        failures: [{ table: 'org_alignment_shared_topics', op: 'update', message: 'write failed' }],
      });
      const before = JSON.parse(JSON.stringify(fake.db));
      const res = await patch(TOPIC_A, 'tok-admin-a');

      expect(res.status).toBe(500);
      expect(fake.db).toEqual(before);
    });

    it('更新の対象が0件になった場合は成功扱いしない', async () => {
      const fake = setup({
        beforeUpdate: (db) => {
          db.org_alignment_shared_topics[0].company_id = COMPANY_B;
        },
      });
      const res = await patch(TOPIC_A, 'tok-admin-a');

      expect(res.status).toBe(404);
      expect(fake.db.org_alignment_shared_topics[0].announcement_text).toBeNull();
    });
  });

  describe('回帰確認', () => {
    it('announcementText が文字列でなければ 400 で、更新しない', async () => {
      const fake = setup();
      const res = await patch(TOPIC_A, 'tok-admin-a', { announcementText: 123 });

      expect(res.status).toBe(400);
      expect(fake.updates).toHaveLength(0);
    });

    it('不正なJSONは 400 で、更新しない', async () => {
      const fake = setup();
      const res = await patch(TOPIC_A, 'tok-admin-a', '{not json');

      expect(res.status).toBe(400);
      expect(fake.updates).toHaveLength(0);
    });

    it('匿名投稿者の名前やメールを含む告知は従来どおり 400 で拒否し、更新しない', async () => {
      const fake = setup();
      const res = await patch(TOPIC_A, 'tok-admin-a', {
        announcementText: '連絡先は restricted@example.com です',
      });

      expect(res.status).toBe(400);
      expect(fake.updates).toHaveLength(0);
    });

    it('別会社の共有トピックは更新されない', async () => {
      const fake = setup();
      await patch(TOPIC_A, 'tok-admin-a');

      expect(fake.db.org_alignment_shared_topics[1]).toEqual(seed().org_alignment_shared_topics[1]);
    });
  });
});
