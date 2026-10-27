/* eslint-disable @typescript-eslint/no-explicit-any -- テスト用の偽クライアント。本番コードからは読まれない */

/**
 * テスト用の Supabase 管理クライアントの偽物（company_members のみ）。
 * - PostgREST の主な振る舞い（maybeSingle の複数行エラー、count、upsert）を模す。
 * - 最後の管理者の保護は、DB トリガーの振る舞い（P0001 / last_admin）として模す。
 * - 本物の RLS は再現しない（サービスロールは RLS を迂回するため、API 側の検査を確認する）。
 */

export type FakeMember = {
  company_id: string;
  user_id: string;
  role: string;
  department_id?: string | null;
};

export type FakeUser = { id: string; aal?: 'aal1' | 'aal2' };

export type FakeAdminOptions = {
  members: FakeMember[];
  /** Bearer トークン → ユーザー */
  users: Record<string, FakeUser>;
  /** ユーザーID → MFA 要素 */
  factors?: Record<string, { status: 'verified' | 'unverified' }[]>;
  /** company_members の読み取りを失敗させる（503 の確認用） */
  failMemberReads?: boolean;
};

function adminCount(rows: FakeMember[], companyId: string): number {
  return rows.filter((r) => r.company_id === companyId && r.role === 'admin').length;
}

/** 文の前後で、どの会社も admin が 0 人になっていないことを確認する（DB トリガーの模擬） */
function assertAdminInvariant(before: FakeMember[], after: FakeMember[]) {
  const companies = new Set([...before, ...after].map((r) => r.company_id));
  for (const c of companies) {
    if (adminCount(before, c) > 0 && adminCount(after, c) === 0) {
      return { code: 'P0001', message: 'last_admin: 会社には管理者が 1 人以上必要です' };
    }
  }
  return null;
}

export function createFakeAdmin(opts: FakeAdminOptions) {
  let members: FakeMember[] = opts.members.map((m) => ({ ...m }));
  const usersByToken = opts.users;

  const auth = {
    getUser: async (token: string) => {
      const u = usersByToken[token];
      return u ? { data: { user: { id: u.id } }, error: null } : { data: { user: null }, error: { message: 'invalid' } };
    },
    getClaims: async (token: string) => {
      const u = usersByToken[token];
      if (!u) return { data: null, error: { message: 'invalid' } };
      const claims: Record<string, unknown> = { sub: u.id };
      if (u.aal) claims.aal = u.aal;
      return { data: { claims }, error: null };
    },
    admin: {
      listUsers: async () => ({
        data: { users: [...new Set(Object.values(usersByToken).map((u) => u.id))].map((id) => ({ id })) },
        error: null,
      }),
      mfa: {
        listFactors: async ({ userId }: { userId: string }) => ({
          data: { factors: (opts.factors ?? {})[userId] ?? [] },
          error: null,
        }),
      },
    },
  };

  function from(table: string) {
    if (table !== 'company_members') throw new Error(`fakeAdmin: unexpected table ${table}`);

    let op: 'select' | 'update' | 'delete' | 'upsert' = 'select';
    const filters: Array<(r: FakeMember) => boolean> = [];
    let payload: any = null;
    let upsertOptions: { onConflict?: string } | undefined;
    let countHead = false;
    let wantSingle = false;
    let limitN: number | null = null;

    const api: any = {
      select(_cols?: string, o?: { count?: string; head?: boolean }) {
        if (o?.head) countHead = true;
        return api;
      },
      eq(col: keyof FakeMember, val: unknown) {
        filters.push((r) => r[col] === val);
        return api;
      },
      neq(col: keyof FakeMember, val: unknown) {
        filters.push((r) => r[col] !== val);
        return api;
      },
      limit(n: number) {
        limitN = n;
        return api;
      },
      maybeSingle() {
        wantSingle = true;
        return api;
      },
      update(values: Partial<FakeMember>) {
        op = 'update';
        payload = values;
        return api;
      },
      delete() {
        op = 'delete';
        return api;
      },
      upsert(rows: FakeMember[], o?: { onConflict?: string }) {
        op = 'upsert';
        payload = rows;
        upsertOptions = o;
        return api;
      },
      then(resolve: (v: unknown) => unknown, reject: (e: unknown) => unknown) {
        return Promise.resolve(run()).then(resolve, reject);
      },
    };

    function matched(): FakeMember[] {
      return members.filter((r) => filters.every((f) => f(r)));
    }

    function run(): { data: any; error: any; count?: number } {
      if (op === 'select') {
        if (opts.failMemberReads) return { data: null, error: { message: 'db unavailable' } };
        const rows = matched();
        if (countHead) return { data: null, error: null, count: rows.length };
        if (wantSingle) {
          if (rows.length > 1) {
            return { data: null, error: { code: 'PGRST116', message: 'JSON object requested, multiple (or no) rows returned' } };
          }
          return { data: rows[0] ? { ...rows[0] } : null, error: null };
        }
        const out = limitN !== null ? rows.slice(0, limitN) : rows;
        return { data: out.map((r) => ({ ...r })), error: null };
      }

      if (op === 'delete') {
        const target = new Set(matched());
        const next = members.filter((r) => !target.has(r));
        const violation = assertAdminInvariant(members, next);
        if (violation) return { data: null, error: violation };
        members = next;
        return { data: null, error: null };
      }

      if (op === 'update') {
        const target = new Set(matched());
        const next = members.map((r) => (target.has(r) ? { ...r, ...payload } : r));
        const violation = assertAdminInvariant(members, next);
        if (violation) return { data: null, error: violation };
        members = next;
        return { data: null, error: null };
      }

      // upsert（onConflict は company_id,user_id を前提とする）
      const rows: FakeMember[] = Array.isArray(payload) ? payload : [payload];
      const next = members.map((r) => ({ ...r }));
      for (const row of rows) {
        const idx = next.findIndex((r) => r.company_id === row.company_id && r.user_id === row.user_id);
        if (idx >= 0) next[idx] = { ...next[idx], ...row };
        else next.push({ ...row });
      }
      void upsertOptions;
      const violation = assertAdminInvariant(members, next);
      if (violation) return { data: null, error: violation };
      members = next;
      return { data: null, error: null };
    }

    return api;
  }

  return {
    auth,
    from,
    /** テスト用：現在の company_members のスナップショット */
    snapshot(): FakeMember[] {
      return members.map((r) => ({ ...r }));
    },
  };
}
