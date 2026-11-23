/* eslint-disable @typescript-eslint/no-explicit-any -- DB モックの型は意図的に緩く定義している */
jest.mock('server-only', () => ({}));
jest.mock('@/lib/supabaseAdmin', () => ({ getSupabaseAdmin: jest.fn() }));
jest.mock('@/lib/server/mfaGuard', () => ({
  requireAdminMfa: jest.fn(async () => ({ ok: true, userId: 'user-1', isAdmin: true })),
}));
jest.mock('@/lib/server/rbacGuard', () => ({ getAuthUserIdFromBearer: jest.fn() }));

import { POST } from './route';
import { getAuthUserIdFromBearer } from '@/lib/server/rbacGuard';
import { getSupabaseAdmin } from '@/lib/supabaseAdmin';
import { STRATEGY_DATA_RESET_VALUES } from '@/lib/server/companyDataReset';

/**
 * 削除APIの検証用モック（実DBには接続しない）。
 * 各テーブルの select / insert / update / delete と count を、PostgREST に近い形で再現する。
 */

type Row = Record<string, any>;
type Op = 'select' | 'insert' | 'update' | 'delete';
type Failure = { table: string; op: Op; error: { code?: string; message: string }; times: number; match?: (payload: Row) => boolean };

const COMPANY_A = '11111111-1111-4111-8111-111111111111';
const COMPANY_B = '22222222-2222-4222-8222-222222222222';
const COMPANY_C = '33333333-3333-4333-8333-333333333333';
const STRATEGY_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const STRATEGY_A_MOVED = 'abababab-abab-4aba-8aba-abababababab';
const STRATEGY_C = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const STRATEGY_B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const USER_ADMIN_A = '99999999-9999-4999-8999-999999999999';
const USER_MEMBER_A = '88888888-8888-4888-8888-888888888888';
const USER_ADMIN_B = '77777777-7777-4777-8777-777777777777';
const USER_MANAGER_A = '66666666-6666-4666-8666-666666666666';

function createDeleteAllDb(seed: Record<string, Row[]>) {
  const tables: Record<string, Row[]> = {};
  for (const [name, rows] of Object.entries(seed)) tables[name] = rows.map((r) => ({ ...r }));

  const failures: Failure[] = [];
  const missingTables = new Set<string>();
  const ignoredDeletes = new Set<string>();
  const calls: Array<{ table: string; op: Op; filters: Array<[string, unknown]> }> = [];

  const run = (q: { table: string; op: Op; payload?: Row; filters: Array<[string, unknown]>; head: boolean }) => {
    calls.push({ table: q.table, op: q.op, filters: q.filters });
    if (missingTables.has(q.table)) {
      return { data: null, count: null, error: { code: '42P01', message: `relation "public.${q.table}" does not exist` } };
    }
    const failure = failures.find((f) => f.table === q.table && f.op === q.op && f.times > 0 && (!f.match || f.match(q.payload ?? {})));
    if (failure) {
      failure.times -= 1;
      return { data: null, count: null, error: failure.error };
    }
    const rows = (tables[q.table] ??= []);
    const matched = rows.filter((r) => q.filters.every(([c, v]) => r[c] === v));
    switch (q.op) {
      case 'select':
        return { data: q.head ? null : matched.map((r) => ({ ...r })), count: matched.length, error: null };
      case 'insert':
        rows.push({ id: `row-${rows.length + 1}`, ...q.payload });
        return { data: null, count: null, error: null };
      case 'update':
        matched.forEach((r) => Object.assign(r, q.payload));
        return { data: matched.map((r) => ({ ...r })), count: null, error: null };
      case 'delete':
        if (!ignoredDeletes.has(q.table)) {
          for (const r of matched) rows.splice(rows.indexOf(r), 1);
        }
        return { data: null, count: matched.length, error: null };
    }
  };

  const from = (table: string) => {
    const q: { table: string; op: Op; payload?: Row; filters: Array<[string, unknown]>; head: boolean } = {
      table,
      op: 'select',
      filters: [],
      head: false,
    };
    const api: any = {
      select(_columns?: string, options?: { head?: boolean }) {
        if (options?.head) q.head = true;
        return api;
      },
      insert(payload: Row) {
        q.op = 'insert';
        q.payload = payload;
        return api;
      },
      update(payload: Row) {
        q.op = 'update';
        q.payload = payload;
        return api;
      },
      delete() {
        q.op = 'delete';
        return api;
      },
      eq(column: string, value: unknown) {
        q.filters.push([column, value]);
        return api;
      },
      order() {
        return api;
      },
      limit() {
        return api;
      },
      maybeSingle() {
        const result = run(q);
        const data = Array.isArray(result.data) ? result.data[0] ?? null : result.data;
        return Promise.resolve({ data, error: result.error });
      },
      then(resolve: (value: unknown) => unknown, reject?: (reason: unknown) => unknown) {
        return Promise.resolve(run(q)).then(resolve, reject);
      },
    };
    return api;
  };

  return {
    client: { from, auth: {} },
    tables,
    failures,
    missingTables,
    ignoredDeletes,
    calls,
  };
}

function baseSeed() {
  return {
    company_members: [
      { company_id: COMPANY_A, user_id: USER_ADMIN_A, role: 'admin', created_at: '2026-01-01' },
      { company_id: COMPANY_A, user_id: USER_MEMBER_A, role: 'member', created_at: '2026-01-01' },
      { company_id: COMPANY_B, user_id: USER_ADMIN_B, role: 'admin', created_at: '2026-01-01' },
    ],
    strategy_data: [
      { id: STRATEGY_A, company_id: COMPANY_A, final_story: [{ x: 1 }], story_draft: [], final_story_draft: [], final_story_final: [], stage3_strategy_bridge: null, answers2: [], answers12: [], departments: [{ name: '営業' }] },
      { id: STRATEGY_C, company_id: COMPANY_C, final_story: [{ x: 2 }], story_draft: [], final_story_draft: [], final_story_final: [], stage3_strategy_bridge: null, answers2: [], answers12: [], departments: [{ name: '開発' }] },
      { id: STRATEGY_B, company_id: COMPANY_B, final_story: [{ x: 3 }], story_draft: [], final_story_draft: [], final_story_final: [], stage3_strategy_bridge: null, answers2: [], answers12: [], departments: [{ name: '総務' }] },
    ],
    story_answers2: [],
    final_stories: [],
    progress_logs: [],
    story_versions: [],
    audit_log: [],
    generated_plans: [
      // 会社Aの現行の計画書
      { id: 'plan-a-current', company_id: COMPANY_A, strategy_id: STRATEGY_A, audience: 'bank' },
      // 会社Aの旧計画書（戦略が会社移動した後も company_id は A のまま残る）
      { id: 'plan-a-stale', company_id: COMPANY_A, strategy_id: STRATEGY_A_MOVED, audience: 'shareholder' },
      // 会社Cの計画書（移動先の会社）
      { id: 'plan-c', company_id: COMPANY_C, strategy_id: STRATEGY_C, audience: 'bank' },
      // 会社Bの計画書
      { id: 'plan-b', company_id: COMPANY_B, strategy_id: STRATEGY_C, audience: 'employee' },
    ],
  };
}

const request = (body: unknown = { companyId: COMPANY_A }) =>
  new Request('http://localhost/api/admin/data-management/delete-all', {
    method: 'POST',
    headers: { authorization: 'Bearer test-token', 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });

let fake: ReturnType<typeof createDeleteAllDb>;

beforeEach(() => {
  jest.clearAllMocks();
  jest.spyOn(console, 'log').mockImplementation(() => undefined);
  jest.spyOn(console, 'warn').mockImplementation(() => undefined);
  jest.spyOn(console, 'error').mockImplementation(() => undefined);
  // 検証の 1 秒待機を即時化する
  jest.spyOn(global, 'setTimeout').mockImplementation(((fn: () => void) => {
    fn();
    return 0 as any;
  }) as any);

  fake = createDeleteAllDb(baseSeed());
  (getSupabaseAdmin as jest.Mock).mockReturnValue(fake.client);
  (getAuthUserIdFromBearer as jest.Mock).mockResolvedValue(USER_ADMIN_A);
});

afterEach(() => {
  jest.restoreAllMocks();
});

const planIds = (companyId: string) =>
  fake.tables.generated_plans.filter((p) => p.company_id === companyId).map((p) => p.id).sort();

describe('POST /api/admin/data-management/delete-all（経営計画書）', () => {
  it('deletes every plan of the company, including stale rows left by a company move, and nothing else', async () => {
    const res = await POST(request());
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.ok).toBe(true);
    expect(json.separatedTableDeletions.generated_plans).toEqual({ deleted_count: 2, skipped: null, error: null });
    expect(planIds(COMPANY_A)).toEqual([]);
    expect(planIds(COMPANY_C)).toEqual(['plan-c']);
    expect(planIds(COMPANY_B)).toEqual(['plan-b']);
  });

  it('scopes the deletion by company_id only, never by a condition that could match other companies', async () => {
    await POST(request());

    const planDeletes = fake.calls.filter((c) => c.table === 'generated_plans' && c.op === 'delete');
    expect(planDeletes).toHaveLength(1);
    expect(planDeletes[0].filters).toEqual([['company_id', COMPANY_A]]);
  });

  it('does not report success when the plan deletion fails', async () => {
    fake.failures.push({
      table: 'generated_plans',
      op: 'delete',
      error: { code: '42501', message: 'permission denied for table generated_plans' },
      times: 1,
    });

    const res = await POST(request());
    const json = await res.json();

    expect(res.status).toBe(500);
    expect(json.ok).toBe(false);
    expect(json.error).toBe('Failed to delete generated_plans');
    expect(JSON.stringify(json)).not.toContain('"ok":true');
    expect(planIds(COMPANY_A)).toHaveLength(2);
  });

  it('treats a missing generated_plans table as skipped, not as a failure', async () => {
    fake.missingTables.add('generated_plans');

    const res = await POST(request());
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.ok).toBe(true);
    expect(json.separatedTableDeletions.generated_plans.skipped).toBe('table_missing');
  });

  it('skips when PostgREST reports PGRST205 for generated_plans', async () => {
    const missing = { code: 'PGRST205', message: 'Could not find the table public.generated_plans in the schema cache' };
    fake.failures.push(
      { table: 'generated_plans', op: 'delete', error: missing, times: 1 },
      { table: 'generated_plans', op: 'select', error: missing, times: 2 }
    );

    const res = await POST(request());
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.ok).toBe(true);
    expect(json.separatedTableDeletions.generated_plans.skipped).toBe('table_missing');
  });

  it('does not skip a permission error (42501) for generated_plans', async () => {
    fake.failures.push({
      table: 'generated_plans',
      op: 'delete',
      error: { code: '42501', message: 'permission denied for table generated_plans' },
      times: 1,
    });

    const res = await POST(request());
    const json = await res.json();

    expect(res.status).toBe(500);
    expect(json.ok).toBe(false);
    expect(json.separatedTableDeletions.generated_plans.skipped).toBeNull();
    expect(planIds(COMPANY_A)).toHaveLength(2);
  });

  it('does not skip a 42501 error whose message says the relation does not exist', async () => {
    fake.failures.push({
      table: 'generated_plans',
      op: 'delete',
      error: { code: '42501', message: 'relation "public.generated_plans" does not exist' },
      times: 1,
    });

    const res = await POST(request());
    const json = await res.json();

    expect(res.status).toBe(500);
    expect(json.ok).toBe(false);
    expect(json.separatedTableDeletions.generated_plans.skipped).toBeNull();
    expect(planIds(COMPANY_A)).toHaveLength(2);
  });

  it('does not skip an error without a code, even when its message says the table is missing', async () => {
    fake.failures.push({
      table: 'generated_plans',
      op: 'delete',
      error: { message: 'relation "public.generated_plans" does not exist' },
      times: 1,
    });

    const res = await POST(request());
    const json = await res.json();

    expect(res.status).toBe(500);
    expect(json.ok).toBe(false);
    expect(json.separatedTableDeletions.generated_plans.skipped).toBeNull();
    expect(planIds(COMPANY_A)).toHaveLength(2);
  });

  it('reports failure when rows remain after the delete call', async () => {
    fake.ignoredDeletes.add('generated_plans');

    const res = await POST(request());
    const json = await res.json();

    expect(res.status).toBe(500);
    expect(json.ok).toBe(false);
    expect(json.separatedTableDeletions.generated_plans.error.message).toContain('rows remain');
    expect(planIds(COMPANY_A)).toHaveLength(2);
  });

  it('keeps strategy_data intact when the final reset fails, and a retry completes the deletion', async () => {
    fake.failures.push({
      table: 'strategy_data',
      op: 'update',
      error: { code: '500', message: 'simulated update failure' },
      times: 1,
    });

    const res = await POST(request());
    const json = await res.json();

    expect(res.status).toBe(500);
    expect(json.ok).toBe(false);
    expect(json.error).toBe('Failed to update strategy_data');
    expect(fake.tables.strategy_data.find((r) => r.id === STRATEGY_A)?.final_story).toEqual([{ x: 1 }]);

    const retry = await POST(request());
    const retryJson = await retry.json();
    expect(retry.status).toBe(200);
    expect(retryJson.ok).toBe(true);
    expect(planIds(COMPANY_A)).toEqual([]);
    expect(fake.tables.strategy_data.find((r) => r.id === STRATEGY_A)?.final_story).toEqual([]);
  });

  it('rejects an unauthenticated request without any deletion', async () => {
    (getAuthUserIdFromBearer as jest.Mock).mockResolvedValue(null);

    const res = await POST(request());

    expect(res.status).toBe(401);
    expect(fake.calls.filter((c) => c.op === 'delete')).toHaveLength(0);
    expect(planIds(COMPANY_A)).toHaveLength(2);
  });

  it('rejects a non-admin member without any deletion', async () => {
    (getAuthUserIdFromBearer as jest.Mock).mockResolvedValue(USER_MEMBER_A);

    const res = await POST(request());

    expect(res.status).toBe(403);
    expect(fake.calls.filter((c) => c.op === 'delete')).toHaveLength(0);
    expect(planIds(COMPANY_A)).toHaveLength(2);
  });

  it('when company B is wiped, company A plans are left intact', async () => {
    (getAuthUserIdFromBearer as jest.Mock).mockResolvedValue(USER_ADMIN_B);

    const res = await POST(request({ companyId: COMPANY_B }));

    expect(res.status).toBe(200);
    expect(planIds(COMPANY_B)).toEqual([]);
    expect(planIds(COMPANY_A)).toHaveLength(2);
    expect(planIds(COMPANY_C)).toEqual(['plan-c']);
  });
});

describe('POST /api/admin/data-management/delete-all（対象会社の指定と権限）', () => {
  beforeEach(() => {
    // 利用者 A は、会社 A と会社 B の両方で admin（従来の「最新の管理者所属会社」を選ぶ処理では B が選ばれる状況）
    fake.tables.company_members.push({ company_id: COMPANY_B, user_id: USER_ADMIN_A, role: 'admin', created_at: '2026-06-01' });
    fake.tables.progress_logs.push({ id: 'pl-a', company_id: COMPANY_A }, { id: 'pl-b', company_id: COMPANY_B });
  });

  it('admin of both A and B: requesting A deletes only company A', async () => {
    const res = await POST(request({ companyId: COMPANY_A }));
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.ok).toBe(true);
    expect(planIds(COMPANY_A)).toEqual([]);
    expect(planIds(COMPANY_B)).toEqual(['plan-b']);
    expect(fake.tables.progress_logs.map((r) => r.id)).toEqual(['pl-b']);
    expect(fake.tables.strategy_data.find((r) => r.id === STRATEGY_B)?.departments).toEqual([{ name: '総務' }]);
  });

  it('admin of both A and B: requesting B deletes only company B', async () => {
    const res = await POST(request({ companyId: COMPANY_B }));

    expect(res.status).toBe(200);
    expect(planIds(COMPANY_B)).toEqual([]);
    expect(planIds(COMPANY_A)).toHaveLength(2);
    expect(fake.tables.progress_logs.map((r) => r.id)).toEqual(['pl-a']);
    expect(fake.tables.strategy_data.find((r) => r.id === STRATEGY_A)?.departments).toEqual([{ name: '営業' }]);
  });

  it('generated_plans deletion is limited to the requested company ID', async () => {
    await POST(request({ companyId: COMPANY_B }));

    const planDeletes = fake.calls.filter((c) => c.table === 'generated_plans' && c.op === 'delete');
    expect(planDeletes).toHaveLength(1);
    expect(planDeletes[0].filters).toEqual([['company_id', COMPANY_B]]);
  });

  it('rejects a request without companyId with 400 and deletes nothing', async () => {
    const res = await POST(request({}));

    expect(res.status).toBe(400);
    expect(fake.calls.filter((c) => c.op === 'delete')).toHaveLength(0);
    expect(planIds(COMPANY_A)).toHaveLength(2);
  });

  it('rejects a request without a body with 400 and deletes nothing', async () => {
    const res = await POST(
      new Request('http://localhost/api/admin/data-management/delete-all', {
        method: 'POST',
        headers: { authorization: 'Bearer test-token' },
      }),
    );

    expect(res.status).toBe(400);
    expect(fake.calls.filter((c) => c.op === 'delete')).toHaveLength(0);
  });

  it('rejects a companyId that is not a UUID with 400', async () => {
    const res = await POST(request({ companyId: 'not-a-uuid' }));

    expect(res.status).toBe(400);
    expect(fake.calls.filter((c) => c.op === 'delete')).toHaveLength(0);
  });

  it('rejects a company the user does not belong to with 403 and deletes nothing', async () => {
    const res = await POST(request({ companyId: COMPANY_C }));

    expect(res.status).toBe(403);
    expect(fake.calls.filter((c) => c.op === 'delete')).toHaveLength(0);
    expect(planIds(COMPANY_C)).toEqual(['plan-c']);
    expect(planIds(COMPANY_A)).toHaveLength(2);
  });

  it('rejects a member of the requested company with 403 and deletes nothing', async () => {
    (getAuthUserIdFromBearer as jest.Mock).mockResolvedValue(USER_MEMBER_A);

    const res = await POST(request({ companyId: COMPANY_A }));

    expect(res.status).toBe(403);
    expect(fake.calls.filter((c) => c.op === 'delete')).toHaveLength(0);
    expect(planIds(COMPANY_A)).toHaveLength(2);
  });

  it('rejects a manager of the requested company with 403 and deletes nothing', async () => {
    fake.tables.company_members.push({ company_id: COMPANY_A, user_id: USER_MANAGER_A, role: 'manager', created_at: '2026-01-01' });
    (getAuthUserIdFromBearer as jest.Mock).mockResolvedValue(USER_MANAGER_A);

    const res = await POST(request({ companyId: COMPANY_A }));

    expect(res.status).toBe(403);
    expect(fake.calls.filter((c) => c.op === 'delete')).toHaveLength(0);
    expect(planIds(COMPANY_A)).toHaveLength(2);
  });
});

describe('監査ログ（削除の前後の記録と、記録失敗時の扱い）', () => {
  const auditRows = () => fake.tables.audit_logs.filter((r) => r.action === 'data:delete-all');
  const mutationCalls = () => fake.calls.filter((c) => c.op === 'update' || c.op === 'delete');

  it('does not start the deletion when the start audit cannot be recorded (503, nothing changed)', async () => {
    fake.failures.push({
      table: 'audit_logs',
      op: 'insert',
      error: { message: 'audit table unavailable' },
      times: 1,
      match: (p) => p.metadata?.phase === 'started',
    });

    const res = await POST(request());
    const json = await res.json();

    expect(res.status).toBe(503);
    expect(json.error).toBe('audit_unavailable');
    expect(mutationCalls()).toHaveLength(0);
    expect(fake.tables.strategy_data.find((r) => r.id === STRATEGY_A)?.final_story).toEqual([{ x: 1 }]);
    expect(fake.tables.generated_plans.filter((p) => p.company_id === COMPANY_A)).toHaveLength(2);
  });

  it('records a start and a success row, and the success row matches the response counts', async () => {
    const res = await POST(request());
    const json = await res.json();

    expect(res.status).toBe(200);
    const rows = auditRows();
    const started = rows.find((r) => r.metadata?.phase === 'started');
    const success = rows.find((r) => r.metadata?.phase === 'success');
    expect(started).toBeDefined();
    expect(success).toBeDefined();
    expect(started?.company_id).toBe(COMPANY_A);
    expect(started?.actor_user_id).toBe(USER_ADMIN_A);
    expect(success?.metadata.deletedCount).toBe(json.updatedCount);
    expect(success?.metadata.separatedTableDeletions).toEqual(json.separatedTableDeletions);
  });

  it('reports the deletion as completed (500, not a silent success) when the success audit fails', async () => {
    fake.failures.push({
      table: 'audit_logs',
      op: 'insert',
      error: { message: 'audit table unavailable' },
      times: 1,
      match: (p) => p.metadata?.phase === 'success',
    });

    const res = await POST(request());
    const json = await res.json();

    expect(res.status).toBe(500);
    expect(json.ok).toBe(false);
    expect(json.error).toBe('audit_record_failed_after_deletion');
    expect(json.deletionCompleted).toBe(true);
    expect(fake.tables.strategy_data.find((r) => r.id === STRATEGY_A)?.final_story).toEqual([]);
  });

  it('records a failure row with the steps completed so far when a later deletion step fails', async () => {
    fake.failures.push({
      table: 'story_answers2',
      op: 'delete',
      error: { code: '42501', message: 'permission denied for table story_answers2' },
      times: 1,
    });

    const res = await POST(request());
    const json = await res.json();

    expect(res.status).toBe(500);
    expect(json.auditRecorded).toBe(true);
    const failure = auditRows().find((r) => r.metadata?.phase === 'failure');
    expect(failure).toBeDefined();
    expect(String(failure?.metadata.reason)).toContain('story_answers2');
    expect(failure?.metadata.beforeState).toBeDefined();
  });
});

describe('strategy_data の業務列と関連テーブルの全削除', () => {
  const seedRows = (table: string, rows: Row[]) => {
    fake.tables[table] = [...(fake.tables[table] ?? []), ...rows];
  };
  const rowsOf = (table: string, companyId: string) =>
    (fake.tables[table] ?? []).filter((r) => r.company_id === companyId);

  const SEPARATED_TABLES = [
    'story_answers2',
    'final_stories',
    'story_versions',
    'progress_logs',
    'okrs',
    'stage4_plan_document_events',
    'stage4_plan_documents',
    'stage3_strategy_books',
    'generated_plans',
  ];

  beforeEach(() => {
    seedRows('story_answers2', [{ id: 'sa-a', company_id: COMPANY_A }, { id: 'sa-b', company_id: COMPANY_B }]);
    seedRows('final_stories', [{ id: 'fs-a', company_id: COMPANY_A }, { id: 'fs-b', company_id: COMPANY_B }]);
    seedRows('story_versions', [{ id: 'sv-a', company_id: COMPANY_A }, { id: 'sv-b', company_id: COMPANY_B }]);
    seedRows('progress_logs', [{ id: 'pl-a2', company_id: COMPANY_A }, { id: 'pl-b2', company_id: COMPANY_B }]);
    seedRows('okrs', [{ id: 'okr-a', company_id: COMPANY_A }, { id: 'okr-b', company_id: COMPANY_B }]);
    seedRows('stage4_plan_documents', [{ id: 'd-a', company_id: COMPANY_A }, { id: 'd-b', company_id: COMPANY_B }]);
    seedRows('stage4_plan_document_events', [{ id: 'e-a', company_id: COMPANY_A }, { id: 'e-b', company_id: COMPANY_B }]);
    seedRows('stage3_strategy_books', [{ strategy_id: STRATEGY_A, company_id: COMPANY_A }, { strategy_id: STRATEGY_B, company_id: COMPANY_B }]);
  });

  it('resets every business column of the company row and keeps identity columns', async () => {
    const res = await POST(request());
    expect(res.status).toBe(200);

    const row = fake.tables.strategy_data.find((r) => r.id === STRATEGY_A) as Row;
    for (const [column, expected] of Object.entries(STRATEGY_DATA_RESET_VALUES)) {
      expect({ column, value: row[column] }).toEqual({ column, value: expected });
    }
    expect(row.id).toBe(STRATEGY_A);
    expect(row.company_id).toBe(COMPANY_A);
  });

  it('deletes the STAGE2〜6 related tables of the company only', async () => {
    const res = await POST(request());
    expect(res.status).toBe(200);

    for (const table of SEPARATED_TABLES) {
      expect({ table, rows: rowsOf(table, COMPANY_A) }).toEqual({ table, rows: [] });
    }
    expect(rowsOf('story_answers2', COMPANY_B)).toHaveLength(1);
    expect(rowsOf('okrs', COMPANY_B)).toHaveLength(1);
    expect(rowsOf('stage3_strategy_books', COMPANY_B)).toHaveLength(1);
    expect(rowsOf('stage4_plan_documents', COMPANY_B)).toHaveLength(1);
  });

  it('runs the strategy_data reset after every separated table deletion', async () => {
    await POST(request());

    const mutations = fake.calls.filter((c) => c.op === 'update' || c.op === 'delete');
    expect(mutations[mutations.length - 1]).toMatchObject({ table: 'strategy_data', op: 'update' });
  });

  it('treats a company with no strategy row as already empty and succeeds', async () => {
    fake.tables.strategy_data = fake.tables.strategy_data.filter((r) => r.company_id !== COMPANY_A);

    const res = await POST(request());
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.ok).toBe(true);
    expect(json.updatedCount).toBe(0);
    expect(rowsOf('story_answers2', COMPANY_A)).toEqual([]);
  });

  it('skips an optional table that does not exist yet and still completes', async () => {
    fake.missingTables.add('stage4_plan_documents');

    const res = await POST(request());
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.ok).toBe(true);
    expect(json.separatedTableDeletions.stage4_plan_documents.skipped).toBe('table_missing');
  });

  it('does not skip a required table that is missing', async () => {
    fake.missingTables.add('story_versions');

    const res = await POST(request());
    const json = await res.json();

    expect(res.status).toBe(500);
    expect(json.ok).toBe(false);
    expect(json.error).toBe('Failed to delete story_versions');
    expect(fake.tables.strategy_data.find((r) => r.id === STRATEGY_A)?.final_story).toEqual([{ x: 1 }]);
  });

  it('keeps strategy_data intact when a separated table deletion fails', async () => {
    fake.failures.push({
      table: 'okrs',
      op: 'delete',
      error: { code: '42501', message: 'permission denied for table okrs' },
      times: 1,
    });

    const res = await POST(request());
    const json = await res.json();

    expect(res.status).toBe(500);
    expect(json.error).toBe('Failed to delete okrs');
    expect(fake.calls.filter((c) => c.table === 'strategy_data' && c.op === 'update')).toHaveLength(0);
    expect(fake.tables.strategy_data.find((r) => r.id === STRATEGY_A)?.final_story).toEqual([{ x: 1 }]);
  });

  it('reports failure when rows remain in a separated table after deletion', async () => {
    fake.ignoredDeletes.add('story_versions');

    const res = await POST(request());
    const json = await res.json();

    expect(res.status).toBe(500);
    expect(json.ok).toBe(false);
    expect(json.error).toBe('Failed to delete story_versions');
    expect(json.separatedTableDeletions.story_versions.error.message).toContain('rows remain');
  });
});
