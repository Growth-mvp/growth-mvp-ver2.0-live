/**
 * テスト用のインメモリ Supabase 風クライアント（generated_plans / strategy_data のみ）。
 *
 * 再現する範囲:
 * - from().select/insert/update/eq/maybeSingle/single の連鎖
 * - generated_plans の一意制約（23505）
 * - DB トリガー相当の検査: 戦略が会社に属さない書き込みは 42501、識別子の変更は 42501
 * - UPDATE 時の version 検査と +1
 * - 故意の失敗注入（一時的エラー・競合の模擬）
 */

type Row = Record<string, any>;
type Op = 'select' | 'insert' | 'update';

export type InjectedFailure = {
  table: string;
  op: Op;
  times: number;
  error: { code?: string; message: string };
};

export type FakeDb = {
  rows: { generated_plans: Row[]; strategy_data: Row[] };
  failures: InjectedFailure[];
  /** UPDATE 直前に一度だけ呼ばれる（別の操作による版の進行を模擬する） */
  beforeNextUpdate: ((rows: Row[]) => void) | null;
  /** INSERT 直前に一度だけ呼ばれる（読み取り後に別の操作が行を作る競合を模擬する） */
  beforeNextInsert: ((rows: Row[]) => void) | null;
  calls: Array<{ table: string; op: Op }>;
  client: { from: (table: string) => any };
};

const IDENTITY_COLUMNS = ['id', 'company_id', 'strategy_id', 'audience', 'created_by', 'created_at'];

let sequence = 0;
function fakeUuid(): string {
  sequence += 1;
  return `00000000-0000-4000-8000-${String(sequence).padStart(12, '0')}`;
}

export function createFakeDb(init: { strategy_data?: Row[]; generated_plans?: Row[] } = {}): FakeDb {
  const db: FakeDb = {
    rows: {
      generated_plans: (init.generated_plans ?? []).map((r) => ({ ...r })),
      strategy_data: (init.strategy_data ?? []).map((r) => ({ ...r })),
    },
    failures: [],
    beforeNextUpdate: null,
    beforeNextInsert: null,
    calls: [],
    client: { from: () => null },
  };

  const takeFailure = (table: string, op: Op) => {
    const hit = db.failures.find((f) => f.table === table && f.op === op && f.times > 0);
    if (!hit) return null;
    hit.times -= 1;
    return hit.error;
  };

  const strategyBelongsTo = (strategyId: unknown, companyId: unknown) =>
    db.rows.strategy_data.some((s) => s.id === strategyId && s.company_id === companyId);

  const checkGuard = (row: Row): { code: string; message: string } | null => {
    if (!strategyBelongsTo(row.strategy_id, row.company_id)) {
      return { code: '42501', message: 'generated_plans: strategy does not belong to the company' };
    }
    return null;
  };

  const from = (table: string) => {
    const query: { op: Op; payload: Row | null; filters: Array<[string, unknown]> } = {
      op: 'select',
      payload: null,
      filters: [],
    };
    const matches = (rows: Row[]) => rows.filter((r) => query.filters.every(([c, v]) => r[c] === v));

    const execInsert = () => {
      db.calls.push({ table, op: 'insert' });
      const injected = takeFailure(table, 'insert');
      if (injected) return { data: null, error: injected };
      const payload = query.payload ?? {};
      if (db.beforeNextInsert) {
        const hook = db.beforeNextInsert;
        db.beforeNextInsert = null;
        hook(db.rows.generated_plans);
      }
      const duplicate = db.rows.generated_plans.some(
        (r) =>
          r.company_id === payload.company_id &&
          r.strategy_id === payload.strategy_id &&
          r.audience === payload.audience
      );
      if (duplicate) return { data: null, error: { code: '23505', message: 'duplicate key' } };
      const row: Row = {
        id: fakeUuid(),
        version: 1,
        created_at: '2026-01-01T00:00:00.000Z',
        updated_at: '2026-01-01T00:00:00.000Z',
        ...payload,
      };
      const guard = checkGuard(row);
      if (guard) return { data: null, error: guard };
      db.rows.generated_plans.push(row);
      return { data: { version: row.version, updated_at: row.updated_at }, error: null };
    };

    const execUpdate = () => {
      db.calls.push({ table, op: 'update' });
      const injected = takeFailure(table, 'update');
      if (injected) return { data: null, error: injected };
      const payload = query.payload ?? {};
      if (IDENTITY_COLUMNS.some((c) => c in payload)) {
        return { data: null, error: { code: '42501', message: 'identity columns are immutable' } };
      }
      if (db.beforeNextUpdate) {
        const hook = db.beforeNextUpdate;
        db.beforeNextUpdate = null;
        hook(db.rows.generated_plans);
      }
      const targets = matches(db.rows.generated_plans);
      const updated: Row[] = [];
      for (const row of targets) {
        const next: Row = {
          ...row,
          ...payload,
          version: row.version + 1,
          updated_at: '2026-01-02T00:00:00.000Z',
        };
        const guard = checkGuard(next);
        if (guard) return { data: null, error: guard };
        Object.assign(row, next);
        updated.push({ version: row.version, updated_at: row.updated_at });
      }
      return { data: updated, error: null };
    };

    const chain: any = {
      select: () => {
        if (query.op === 'insert') return chain;
        if (query.op === 'update') return execUpdate();
        return chain;
      },
      eq: (column: string, value: unknown) => {
        query.filters.push([column, value]);
        return chain;
      },
      insert: (payload: Row) => {
        query.op = 'insert';
        query.payload = payload;
        return chain;
      },
      update: (payload: Row) => {
        query.op = 'update';
        query.payload = payload;
        return chain;
      },
      single: () => {
        if (query.op === 'insert') {
          const result = execInsert();
          return result.error ? result : { data: result.data, error: null };
        }
        return chain.maybeSingle();
      },
      maybeSingle: () => {
        db.calls.push({ table, op: 'select' });
        const injected = takeFailure(table, 'select');
        if (injected) return { data: null, error: injected };
        const rows = matches(db.rows[table as keyof FakeDb['rows']] ?? []);
        return { data: rows[0] ?? null, error: null };
      },
    };
    return chain;
  };

  db.client = { from };
  return db;
}

export function planRow(overrides: Row): Row {
  return {
    id: fakeUuid(),
    version: 1,
    created_at: '2026-01-01T00:00:00.000Z',
    updated_at: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}
