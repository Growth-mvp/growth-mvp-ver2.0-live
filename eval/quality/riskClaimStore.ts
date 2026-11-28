/* 経営点検の実行枠（companion_risk_claims）のインメモリ実装。テスト用。
 * 主キー（company_id, claim_date）の一意制約、企業ごとの絞り込み、非同期の順序を再現する。 */

type Row = Record<string, any>;

export type ClaimStoreOptions = { failInsert?: boolean; delayMs?: number };

export function createClaimStore(options: ClaimStoreOptions = {}) {
  const rows = new Map<string, Row>();
  const stats = { inserts: 0, updates: 0, selects: 0 };
  const wait = () => new Promise<void>((resolve) => setTimeout(resolve, options.delayMs ?? 0));
  const keyOf = (companyId: string, day: string) => `${companyId}|${day}`;

  const from = (table: string) => {
    if (table !== 'companion_risk_claims') throw new Error(`unexpected table: ${table}`);
    return {
      insert: async (row: Row) => {
        stats.inserts += 1;
        await wait();
        if (options.failInsert) return { error: { code: 'XX000', message: 'database unavailable' } };
        const k = keyOf(row.company_id, row.claim_date);
        if (rows.has(k)) return { error: { code: '23505', message: 'duplicate key value violates unique constraint' } };
        rows.set(k, { ...row, ai_finding: null });
        return { error: null };
      },
      select: (_columns: string) => {
        stats.selects += 1;
        const filters: Record<string, unknown> = {};
        const query = {
          eq(column: string, value: unknown) {
            filters[column] = value;
            return query;
          },
          maybeSingle: async () => {
            await wait();
            const found = [...rows.values()].find((r) => Object.entries(filters).every(([c, v]) => r[c] === v));
            return { data: found ? { ...found } : null, error: null };
          },
        };
        return query;
      },
      update: (values: Row) => {
        const filters: Record<string, unknown> = {};
        const query = {
          eq(column: string, value: unknown) {
            filters[column] = value;
            return query;
          },
          then(resolve: (v: { error: null }) => void) {
            stats.updates += 1;
            const target = [...rows.entries()].find(([, r]) => Object.entries(filters).every(([c, v]) => r[c] === v));
            if (target) rows.set(target[0], { ...target[1], ...values });
            resolve({ error: null });
          },
        };
        return query;
      },
    };
  };

  return { admin: { from } as any, rows, stats };
}
