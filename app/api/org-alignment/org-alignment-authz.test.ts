/* eslint-disable @typescript-eslint/no-explicit-any -- Supabase フェイクは PostgREST の形を緩く再現する */
jest.mock('server-only', () => ({}));
jest.mock('@/lib/supabaseAdmin', () => ({ getSupabaseAdmin: jest.fn() }));
jest.mock('@/lib/server/mfaGuard', () => ({
  requireAdminMfa: jest.fn(async () => ({ ok: true })),
}));
jest.mock('@/utils/supabase/org-alignment-stage-reflection-candidates-server', () => ({
  getPendingReflectionCandidates: jest.fn(async () => []),
  updateReflectionCandidateStatus: jest.fn(async () => ({ id: 'c1', status: 'accepted' })),
  createReflectionCandidates: jest.fn(async () => [{ id: 'c-new' }]),
}));
jest.mock('@/utils/supabase/org-alignment-shared-topics-server', () => ({
  getSharedTopicById: jest.fn(async () => ({
    id: 'topic-1',
    strategy_reflection: { stage3Status: '未反映', stage4Status: '未反映' },
  })),
  updateSharedTopicEditable: jest.fn(async () => ({})),
}));

import { NextRequest } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabaseAdmin';
import * as candidateWriters from '@/utils/supabase/org-alignment-stage-reflection-candidates-server';
import * as topicWriters from '@/utils/supabase/org-alignment-shared-topics-server';
import { POST as requestAlignment } from './cases/[id]/request-alignment/route';
import { PATCH as patchCandidates } from './shared/reflection-candidates/route';
import { PATCH as resetReflection } from './shared/topics/reset-reflection/route';
import { POST as createTopicCandidates } from './shared/topics/[id]/reflection-candidates/route';
import { PATCH as patchTopic } from './shared/topics/[id]/route';
import { PATCH as patchAdminRequest } from './admin/requests/[id]/route';
import { POST as createAdminSharedTopic } from './admin/shared-topics/route';

type Row = Record<string, any>;
type Write = { table: string; op: 'insert' | 'update' | 'delete'; payload?: Row };

const COMPANY_A = '11111111-1111-4111-8111-111111111111';
const COMPANY_B = '22222222-2222-4222-8222-222222222222';
const ADMIN = 'user-admin';
const MANAGER = 'user-manager';
const MEMBER = 'user-member';
const OTHER_MEMBER = 'user-other-member';
const OUTSIDER = 'user-outsider';
const MULTI = 'user-multi';
const CASE_1 = 'case-1';
const TOPIC_1 = 'topic-1';
const REQUEST_1 = 'request-1';
const CANDIDATE_1 = 'candidate-1';

const TOKENS: Record<string, string> = {
  'tok-admin': ADMIN,
  'tok-manager': MANAGER,
  'tok-member': MEMBER,
  'tok-other': OTHER_MEMBER,
  'tok-outsider': OUTSIDER,
  'tok-multi': MULTI,
};

function seedDb(): Record<string, Row[]> {
  return {
    // 所属の並び順は、複数所属時に requireMembership が先頭を選ぶ挙動の検証に使う
    company_members: [
      { company_id: COMPANY_A, user_id: MULTI, role: 'member', department_id: null },
      { company_id: COMPANY_B, user_id: MULTI, role: 'admin', department_id: null },
      { company_id: COMPANY_A, user_id: ADMIN, role: 'admin', department_id: null },
      { company_id: COMPANY_A, user_id: MANAGER, role: 'manager', department_id: null },
      { company_id: COMPANY_A, user_id: MEMBER, role: 'member', department_id: null },
      { company_id: COMPANY_A, user_id: OTHER_MEMBER, role: 'member', department_id: null },
    ],
    org_alignment_cases: [
      {
        id: CASE_1,
        company_id: COMPANY_A,
        created_by: MEMBER,
        visibility_mode: 'anonymous',
        status: 'generated',
      },
    ],
    org_alignment_requests: [{ id: REQUEST_1, company_id: COMPANY_A, case_id: CASE_1, status: 'pending' }],
    org_alignment_shared_topics: [{ id: TOPIC_1, company_id: COMPANY_A, status: 'published' }],
    org_alignment_stage_reflection_candidates: [
      { id: CANDIDATE_1, company_id: COMPANY_A, status: 'pending', shared_topic_id: TOPIC_1 },
    ],
  };
}

/** PostgREST に近い最小限の Supabase フェイク。書き込みは writes に記録する。 */
function createFakeAdmin(db: Record<string, Row[]>) {
  const writes: Write[] = [];
  const rows = (table: string) => (db[table] ??= []);

  const from = (table: string) => {
    const filters: Array<[string, unknown]> = [];
    let inFilter: { col: string; values: unknown[] } | null = null;
    let op: 'select' | 'insert' | 'update' | 'delete' = 'select';
    let payload: Row = {};
    let mode: 'many' | 'one' = 'many';

    const matched = () =>
      rows(table).filter(
        (r) =>
          filters.every(([c, v]) => r[c] === v) &&
          (!inFilter || inFilter.values.includes(r[inFilter.col]))
      );

    const exec = async (): Promise<{ data: any; error: any }> => {
      if (op === 'select') {
        const found = matched().map((r) => ({ ...r }));
        return { data: mode === 'one' ? found[0] ?? null : found, error: null };
      }
      writes.push({ table, op, payload });
      if (op === 'insert') {
        const row = { id: `new-${table}-${rows(table).length + 1}`, ...payload };
        rows(table).push(row);
        return { data: mode === 'one' ? { ...row } : [{ ...row }], error: null };
      }
      if (op === 'update') {
        const targets = matched();
        targets.forEach((r) => Object.assign(r, payload));
        return { data: targets.map((r) => ({ ...r })), error: null };
      }
      const targets = matched();
      db[table] = rows(table).filter((r) => !targets.includes(r));
      return { data: targets, error: null };
    };

    const builder: any = {
      select: () => builder,
      insert: (p: Row) => {
        op = 'insert';
        payload = p;
        return builder;
      },
      update: (p: Row) => {
        op = 'update';
        payload = p;
        return builder;
      },
      delete: () => {
        op = 'delete';
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
      is: () => builder,
      order: () => builder,
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
      TOKENS[token]
        ? { data: { user: { id: TOKENS[token] } }, error: null }
        : { data: { user: null }, error: { message: 'invalid token' } },
  };

  return { client: { from, auth }, db, writes };
}

let fake: ReturnType<typeof createFakeAdmin>;

beforeEach(() => {
  jest.clearAllMocks();
  fake = createFakeAdmin(seedDb());
  (getSupabaseAdmin as jest.Mock).mockReturnValue(fake.client);
});

function request(url: string, token: string | null, method: string, body?: unknown): NextRequest {
  return new NextRequest(url, {
    method,
    headers: {
      'content-type': 'application/json',
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

const URL_BASE = 'http://localhost/api/org-alignment';
const tokenOf: Record<string, string> = {
  [ADMIN]: 'tok-admin',
  [MANAGER]: 'tok-manager',
  [MEMBER]: 'tok-member',
  [OTHER_MEMBER]: 'tok-other',
  [OUTSIDER]: 'tok-outsider',
  [MULTI]: 'tok-multi',
};

function writesTo(table: string): Write[] {
  return fake.writes.filter((w) => w.table === table);
}

describe('組織変革ルーム：すり合わせ依頼（POST /cases/[id]/request-alignment）', () => {
  const call = (userId: string, visibilityMode = 'named') =>
    requestAlignment(
      request(`${URL_BASE}/cases/${CASE_1}/request-alignment`, tokenOf[userId], 'POST', { visibilityMode }),
      { params: Promise.resolve({ id: CASE_1 }) }
    );

  it('作成者本人は、自分のケースの依頼を作成できる', async () => {
    const res = await call(MEMBER);
    expect(res.status).toBe(201);
    expect(writesTo('org_alignment_requests').some((w) => w.op === 'insert')).toBe(true);
  });

  it('会社の管理者は、他人のケースの依頼を作成できる', async () => {
    const res = await call(ADMIN);
    expect(res.status).toBe(201);
  });

  it('会社に所属しない利用者は、依頼を作成できず、ケースも書き換えられない', async () => {
    const res = await call(OUTSIDER);
    expect(res.status).toBe(403);
    expect(writesTo('org_alignment_cases')).toEqual([]);
  });

  it.failing(
    '【要修正】同じ会社の一般社員は、他人のケースに依頼を作成できない（現状は 201 で成功する）',
    async () => {
      const res = await call(OTHER_MEMBER);
      expect(res.status).toBe(403);
      expect(writesTo('org_alignment_cases')).toEqual([]);
      expect(writesTo('org_alignment_requests')).toEqual([]);
    }
  );

  it('【現状の記録】依頼によって、他人のケースの visibility_mode と status が書き換えられる', async () => {
    const res = await call(OTHER_MEMBER, 'named');
    expect(res.status).toBe(201);
    const update = writesTo('org_alignment_cases').find((w) => w.op === 'update');
    expect(update?.payload).toMatchObject({ visibility_mode: 'named', status: 'alignment_requested' });
  });
});

describe('組織変革ルーム：反映候補の承認・却下（PATCH /shared/reflection-candidates）', () => {
  const call = (userId: string) =>
    patchCandidates(
      request(
        `${URL_BASE}/shared/reflection-candidates?companyId=${COMPANY_A}`,
        tokenOf[userId],
        'PATCH',
        { id: CANDIDATE_1, status: 'accepted' }
      )
    );

  it('会社の管理者は、候補の状態を変更できる', async () => {
    const res = await call(ADMIN);
    expect(res.status).toBe(200);
    expect(candidateWriters.updateReflectionCandidateStatus).toHaveBeenCalledTimes(1);
  });

  it('所属しない利用者は、候補の状態を変更できない', async () => {
    const res = await call(OUTSIDER);
    expect(res.status).toBe(403);
    expect(candidateWriters.updateReflectionCandidateStatus).not.toHaveBeenCalled();
  });

  it.failing(
    '【要修正】一般社員は、候補の状態を変更できない（DB 側の方針は管理者のみ。現状は 200）',
    async () => {
      const res = await call(MEMBER);
      expect(res.status).toBe(403);
      expect(candidateWriters.updateReflectionCandidateStatus).not.toHaveBeenCalled();
    }
  );

  it.failing(
    '【要判断】管理職も、候補の状態を変更できない（DB 側の方針は管理者のみ。現状は 200）',
    async () => {
      const res = await call(MANAGER);
      expect(res.status).toBe(403);
      expect(candidateWriters.updateReflectionCandidateStatus).not.toHaveBeenCalled();
    }
  );
});

describe('組織変革ルーム：反映のリセット（PATCH /shared/topics/reset-reflection）', () => {
  const call = (userId: string) =>
    resetReflection(
      request(`${URL_BASE}/shared/topics/reset-reflection`, tokenOf[userId], 'PATCH', {
        shared_topic_id: TOPIC_1,
      })
    );

  it('会社の管理者は、反映をリセットできる', async () => {
    const res = await call(ADMIN);
    expect(res.status).toBe(200);
    expect(writesTo('org_alignment_stage_reflection_candidates').some((w) => w.op === 'update')).toBe(true);
  });

  it.failing(
    '【要修正】一般社員は、反映をリセットできない（現状は 200 で候補を書き換える）',
    async () => {
      const res = await call(MEMBER);
      expect(res.status).toBe(403);
      expect(writesTo('org_alignment_stage_reflection_candidates')).toEqual([]);
    }
  );
});

describe('組織変革ルーム：反映候補の作成（POST /shared/topics/[id]/reflection-candidates）', () => {
  const call = (userId: string) =>
    createTopicCandidates(
      request(`${URL_BASE}/shared/topics/${TOPIC_1}/reflection-candidates`, tokenOf[userId], 'POST', {
        target_stage: 'stage3',
      }),
      { params: { id: TOPIC_1 } }
    );

  it('会社の管理者は、反映候補を作成できる', async () => {
    const res = await call(ADMIN);
    expect(res.status).toBe(200);
    expect(candidateWriters.createReflectionCandidates).toHaveBeenCalledTimes(1);
  });

  it.failing(
    '【要修正】一般社員は、反映候補を作成できない（現状は 200 で候補を作成する）',
    async () => {
      const res = await call(MEMBER);
      expect(res.status).toBe(403);
      expect(candidateWriters.createReflectionCandidates).not.toHaveBeenCalled();
    }
  );
});

describe('組織変革ルーム：論点の編集（PATCH /shared/topics/[id]・管理者のみ）', () => {
  const call = (userId: string) =>
    patchTopic(
      request(`${URL_BASE}/shared/topics/${TOPIC_1}`, tokenOf[userId], 'PATCH', {
        alignment_result: '結論',
      }),
      { params: { id: TOPIC_1 } } as any
    );

  it.each([
    ['一般社員', MEMBER],
    ['管理職', MANAGER],
  ])('%s は論点を編集できず、403 になる', async (_label, userId) => {
    const res = await call(userId);
    expect(res.status).toBe(403);
    expect(topicWriters.updateSharedTopicEditable).not.toHaveBeenCalled();
  });

  it('管理者は、権限チェックを通過する（403 にならない）', async () => {
    const res = await call(ADMIN);
    expect(res.status).not.toBe(403);
  });
});

describe('組織変革ルーム：管理画面の書き込み（管理者のみ）', () => {
  it('一般社員は、依頼のステータスを変更できない', async () => {
    const res = await patchAdminRequest(
      request(`${URL_BASE}/admin/requests/${REQUEST_1}`, tokenOf[MEMBER], 'PATCH', { status: 'resolved' }),
      { params: Promise.resolve({ id: REQUEST_1 }) } as any
    );
    expect(res.status).toBe(403);
  });

  it.each([
    ['一般社員', MEMBER],
    ['管理職', MANAGER],
  ])('%s は、論点ドラフトを作成できない', async (_label, userId) => {
    const res = await createAdminSharedTopic(
      request(`${URL_BASE}/admin/shared-topics`, tokenOf[userId], 'POST', { insightIndex: 0 })
    );
    expect(res.status).toBe(403);
    expect(writesTo('org_alignment_shared_topics')).toEqual([]);
  });
});

describe('組織変革ルーム：複数所属の利用者（companyId 省略時の判定）', () => {
  it('【現状の記録】複数所属の利用者は、所属の先頭の企業の権限で判定される（B社の管理者でも A社の一般社員として扱われる）', async () => {
    const res = await patchTopic(
      request(`${URL_BASE}/shared/topics/${TOPIC_1}`, tokenOf[MULTI], 'PATCH', {
        alignment_result: '結論',
      }),
      { params: { id: TOPIC_1 } } as any
    );
    expect(res.status).toBe(403);
  });
});
