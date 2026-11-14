/* eslint-disable @typescript-eslint/no-explicit-any, @typescript-eslint/no-unused-vars -- 評価用スタブ（既存のスタブと同じ書き方） */
/* 記録の追加・編集・削除・再読込の検証用（評価専用。通信しない）。
 * progress_logs と okrs を localStorage の表として扱い、ページの実際の Supabase 呼び出しをそのまま通す。
 * 行の並びは created_at の降順で返す（実DBの order と同じ）。
 * 初期の記録はこの案件のOKRに紐づく。OKRは最初の保存で作られるため、保存時にそのIDへ結び直す。 */
type Row = Record<string, any>;

const wr: any = typeof window !== 'undefined' ? window : globalThis;
const LOGS_KEY = 'record:progress_logs';
const OKRS_KEY = 'record:okrs';
const CO = 'FICTIONAL-CO';
const PENDING_OKR = '__PROJECT_OKR__';
const SEED: Row[] = [
  { id: 'fb-latest', company_id: CO, okr_id: PENDING_OKR, user_id: 'u-manager', created_at: '2026-11-13T09:00:00.000Z', content: '[FB]\n来週の引き継ぎの場は、まず対象の顧客を3件に絞って進めてください。', score: null, status: null },
  { id: 'fb-old', company_id: CO, okr_id: PENDING_OKR, user_id: 'u-manager', created_at: '2026-11-10T09:00:00.000Z', content: '[FB]\n更新案内の文面を一緒に確認しましょう。', score: null, status: null },
  { id: 'fb-mine', company_id: CO, okr_id: PENDING_OKR, user_id: 'u-test', created_at: '2026-11-12T08:00:00.000Z', content: '[FB]\n自分が書いたフィードバック（テスト用）', score: null, status: null },
  { id: 'memo-other', company_id: CO, okr_id: PENDING_OKR, user_id: 'u-other', created_at: '2026-11-12T09:00:00.000Z', content: '担当が変わった顧客を洗い出し中', score: null, status: null },
  { id: 'memo-mine', company_id: CO, okr_id: PENDING_OKR, user_id: 'u-test', created_at: '2026-11-11T09:00:00.000Z', content: '自分の共有投稿（テスト用）', score: null, status: null },
  { id: 'fb-other-project', company_id: CO, okr_id: 'okr-other-project', user_id: 'u-manager', created_at: '2026-11-12T10:00:00.000Z', content: '[FB]\n別の案件へのフィードバック（表示されてはいけない）', score: null, status: null },
];
const BASE_MS = Date.parse('2026-11-14T10:00:00.000Z');

function readRows(key: string, seed: Row[]): Row[] {
  const raw = wr.localStorage.getItem(key);
  if (raw) return JSON.parse(raw);
  const seeded = JSON.parse(JSON.stringify(seed));
  wr.localStorage.setItem(key, JSON.stringify(seeded));
  return seeded;
}

function writeRows(key: string, rows: Row[]): void {
  wr.localStorage.setItem(key, JSON.stringify(rows));
}

export async function saveProgressLog(input: any): Promise<{ data: Row; error: null }> {
  const rows = readRows(LOGS_KEY, SEED).map((r) => (r.okr_id === PENDING_OKR ? { ...r, okr_id: input.okrId } : r));
  const row: Row = {
    id: input.id ?? `pl-${rows.length + 1}`,
    company_id: input.companyIdOverride || CO,
    okr_id: input.okrId,
    user_id: input.userId,
    department_id: input.departmentId ?? null,
    project_id: input.projectId ?? null,
    created_at: new Date(BASE_MS + rows.length * 1000).toISOString(),
    content: input.content,
    score: input.score ?? null,
    status: null,
  };
  writeRows(LOGS_KEY, [...rows, row]);
  return { data: row, error: null };
}

export async function loadProgressLogs(..._args: unknown[]): Promise<unknown[]> {
  return [];
}

function query(name: string): any {
  const filters: Array<(r: Row) => boolean> = [];
  let sort: { col: string; asc: boolean } | null = null;
  let max: number | null = null;
  let mode: 'select' | 'update' | 'delete' = 'select';
  let patch: Row = {};

  const run = (): { data: any; error: null; count?: number } => {
    if (name === 'okrs') {
      const hit = readRows(OKRS_KEY, []).filter((r) => filters.every((f) => f(r)));
      return { data: hit, error: null, count: hit.length };
    }
    if (name !== 'progress_logs') return { data: [], error: null };
    const rows = readRows(LOGS_KEY, SEED);
    const hit = rows.filter((r) => filters.every((f) => f(r)));
    if (mode === 'update') {
      const next = rows.map((r) => (hit.includes(r) ? { ...r, ...patch } : r));
      writeRows(LOGS_KEY, next);
      return { data: next.filter((r) => hit.some((h) => h.id === r.id)), error: null };
    }
    if (mode === 'delete') {
      writeRows(LOGS_KEY, rows.filter((r) => !hit.includes(r)));
      return { data: null, error: null };
    }
    let out = [...hit];
    if (sort) {
      const { col, asc } = sort;
      out.sort((a, b) => {
        const x = String(a[col] ?? '');
        const y = String(b[col] ?? '');
        return (x < y ? -1 : x > y ? 1 : 0) * (asc ? 1 : -1);
      });
    }
    if (max !== null) out = out.slice(0, max);
    return { data: out, error: null };
  };

  const q: any = {
    select: () => q,
    update: (p: Row) => {
      mode = 'update';
      patch = p;
      return q;
    },
    delete: () => {
      mode = 'delete';
      return q;
    },
    eq: (k: string, v: unknown) => {
      filters.push((r) => r[k] === v);
      return q;
    },
    in: (k: string, vs: unknown[]) => {
      filters.push((r) => vs.includes(r[k]));
      return q;
    },
    order: (col: string, opts?: { ascending?: boolean }) => {
      sort = { col, asc: opts?.ascending !== false };
      return q;
    },
    limit: (n: number) => {
      max = n;
      return q;
    },
    single: async () => {
      const r = run();
      return { data: Array.isArray(r.data) ? (r.data[0] ?? null) : r.data, error: null };
    },
    maybeSingle: async () => {
      const r = run();
      return { data: Array.isArray(r.data) ? (r.data[0] ?? null) : r.data, error: null };
    },
    then: (res: any, rej: any) => Promise.resolve(run()).then(res, rej),
  };
  return q;
}

export const supabase: any = {
  from: (name: string) => query(name),
  auth: {
    getSession: async () => ({ data: { session: { access_token: 'test-token', user: { id: 'u-test' } } }, error: null }),
    getUser: async () => ({ data: { user: { id: 'u-test' } }, error: null }),
  },
};
