/* 検証用の部分更新（評価専用）。保存済みの行（DB役）を保持し、revision の条件が合う時だけ書く（実装と同じ契約）。
 * 画面の楽観的な変更は読まない。書いた結果は、画面が syncPartialSave で受け取る。 */
import { useStrategyStore } from '@/store/strategyStore';

type Row = { revision: number; departments: any[] };
const clone = <T,>(x: T): T => JSON.parse(JSON.stringify(x));

/* 読み込み時（操作の前）の状態を、保存済みの行とする */
let db: Row | null = (() => {
  const st: any = useStrategyStore.getState();
  return { revision: Number(st.revision ?? 0), departments: clone(st.departments ?? []) };
})();

function ensure(): Row {
  return db as Row;
}

export const strategyPartialIo = {
  async read(_companyId: string) {
    const row = ensure();
    return { row: { id: 'mem-row', revision: row.revision, departments: clone(row.departments) }, error: null };
  },
  async write({ expectedRevision, departments }: { expectedRevision: number; departments: unknown[] }) {
    const row = ensure();
    if (row.revision !== expectedRevision) return { row: null, error: null };
    db = { revision: expectedRevision + 1, departments: clone(departments) };
    return { row: { id: 'mem-row', revision: db.revision, departments: clone(db.departments) }, error: null };
  },
};
