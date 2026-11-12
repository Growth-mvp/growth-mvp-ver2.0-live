/* 検証用の管理者クライアント：PGlite（ローカルのPostgreSQL）へ SQL を流す。本番の接続は使わない。 */
type Pg = { query: (s: string, p?: unknown[]) => Promise<{ rows: Record<string, unknown>[] }> };
type Err = { code?: string; message: string };

const pg = () => (globalThis as unknown as { __pg: Pg }).__pg;
const ident = (s: string) => s.replace(/[^a-z0-9_]/gi, '');
const jsonish = (v: unknown) => (typeof v === 'object' && v !== null ? JSON.stringify(v) : v);
const isJson = (v: unknown) => typeof v === 'object' && v !== null;

function builder(table: string) {
  let op: 'select' | 'insert' | 'update' = 'select';
  let cols = '*';
  let payload: Record<string, unknown> = {};
  let limit: number | null = null;
  const filters: Array<{ col: string; val: unknown }> = [];

  const exec = async (): Promise<{ data: unknown; error: Err | null }> => {
    const t = ident(table);
    const where = filters.length ? ' where ' + filters.map((f, i) => `${ident(f.col)} = $${i + 1}`).join(' and ') : '';
    const whereParams = filters.map((f) => jsonish(f.val));
    try {
      if (op === 'select') {
        const r = await pg().query(`select ${cols} from ${t}${where}${limit ? ` limit ${limit}` : ''}`, whereParams);
        return { data: r.rows, error: null };
      }
      const keys = Object.keys(payload);
      const vals = keys.map((k) => jsonish(payload[k]));
      if (op === 'insert') {
        const ph = keys.map((k, i) => (isJson(payload[k]) ? `$${i + 1}::jsonb` : `$${i + 1}`));
        await pg().query(`insert into ${t} (${keys.map(ident).join(',')}) values (${ph.join(',')})`, vals);
        return { data: null, error: null };
      }
      const sets = keys.map((k, i) => (isJson(payload[k]) ? `${ident(k)} = $${i + 1}::jsonb` : `${ident(k)} = $${i + 1}`));
      const shifted = where.replace(/\$(\d+)/g, (_m, n: string) => `$${Number(n) + keys.length}`);
      const r = await pg().query(`update ${t} set ${sets.join(', ')}${shifted} returning ${cols}`, [...vals, ...whereParams]);
      return { data: r.rows, error: null };
    } catch (e) {
      const err = e as { code?: string; message?: string };
      return { data: null, error: { code: err.code, message: String(err.message ?? '') } };
    }
  };

  const b = {
    select(c: string) {
      cols = c;
      return b;
    },
    insert(v: Record<string, unknown>) {
      op = 'insert';
      payload = v;
      return b;
    },
    update(v: Record<string, unknown>) {
      op = 'update';
      payload = v;
      return b;
    },
    eq(c: string, v: unknown) {
      filters.push({ col: c, val: v });
      return b;
    },
    limit(n: number) {
      limit = n;
      return b;
    },
    maybeSingle: async () => {
      const r = await exec();
      return { data: Array.isArray(r.data) ? r.data[0] ?? null : r.data, error: r.error };
    },
    then(resolve: (v: unknown) => unknown, reject?: (e: unknown) => unknown) {
      return exec().then(resolve, reject);
    },
  };
  return b;
}

export function getSupabaseAdmin() {
  return {
    from: (table: string) => builder(table),
    rpc: async (name: string, args: Record<string, unknown>) => {
      if (name !== 'stage3_confirm_strategy_book') return { data: null, error: { message: 'unknown rpc' } };
      try {
        const r = await pg().query(
          'select public.stage3_confirm_strategy_book($1::uuid, $2::uuid, $3::uuid, $4::int, $5::int, $6::jsonb, $7::jsonb) as result',
          [args.p_company_id, args.p_strategy_id, args.p_actor_user_id, args.p_expected_revision, args.p_expected_version, JSON.stringify(args.p_departments), JSON.stringify(args.p_state)],
        );
        return { data: r.rows[0].result, error: null };
      } catch (e) {
        return { data: null, error: { message: String((e as Error).message ?? '') } };
      }
    },
  };
}
