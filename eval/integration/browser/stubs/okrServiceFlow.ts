/* 検証用のOKR保存（評価専用）。通信しない。作成の要求を記録し、OKR行のIDを返す。 */
const w: any = typeof window !== 'undefined' ? window : globalThis;
w.__okrCalls = w.__okrCalls || [];

export const okrService: any = {
  upsertOkr: async (input: any, projectId: string, companyId: string) => {
    w.__okrCalls.push({ method: 'upsertOkr', projectId, companyId, objective: input?.objective ?? null });
    return { id: `okr-anchor-${projectId}`, objective: input?.objective ?? '', project_id: projectId, source: 'db' };
  },
  deleteOkr: async (..._a: unknown[]) => ({ ok: true }),
  reorderOkrs: async (..._a: unknown[]) => ({ ok: true }),
  resolveProjectsWithOkrs: async (..._a: unknown[]) => ({ resolvedOkrs: [] }),
};
