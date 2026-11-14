/* eslint-disable @typescript-eslint/no-explicit-any, @typescript-eslint/no-unused-vars -- 評価用スタブ（既存のスタブと同じ書き方） */
/* 記録の検証用のOKR保存（評価専用）。通信しない。作成したOKR行は localStorage（record:okrs）に残し、再読込後も読めるようにする。 */
const w: any = typeof window !== 'undefined' ? window : globalThis;
w.__okrCalls = w.__okrCalls || [];
const OKRS_KEY = 'record:okrs';

export const okrService: any = {
  upsertOkr: async (input: any, projectId: string, companyId: string) => {
    w.__okrCalls.push({ method: 'upsertOkr', projectId, companyId, objective: input?.objective ?? null });
    const id = `okr-anchor-${projectId}`;
    const raw = w.localStorage.getItem(OKRS_KEY);
    const rows: any[] = raw ? JSON.parse(raw) : [];
    const row = {
      id,
      company_id: companyId,
      strategy_id: input?.strategy_id ?? null,
      department_id: input?.department_id ?? null,
      project_id: projectId,
      objective: input?.objective ?? '',
      is_deleted: false,
    };
    w.localStorage.setItem(OKRS_KEY, JSON.stringify([...rows.filter((r) => r.id !== id), row]));
    return { id, objective: row.objective, project_id: projectId, source: 'db' };
  },
  deleteOkr: async (..._a: unknown[]) => ({ ok: true }),
  reorderOkrs: async (..._a: unknown[]) => ({ ok: true }),
  resolveProjectsWithOkrs: async (..._a: unknown[]) => ({ resolvedOkrs: [] }),
};
