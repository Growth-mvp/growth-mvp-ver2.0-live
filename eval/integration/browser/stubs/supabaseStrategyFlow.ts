/* 検証用の活動ログ保存（評価専用）。通信しない。保存の要求を記録し、保存された行を返す。 */
const w: any = typeof window !== 'undefined' ? window : globalThis;
w.__progressInserts = w.__progressInserts || [];

export async function saveProgressLog(input: any): Promise<{ data: any; error: null }> {
  w.__progressInserts.push({ okrId: input.okrId, id: input.id ?? null, content: input.content, score: input.score ?? null });
  return {
    data: { id: input.id ?? `pl-${w.__progressInserts.length}`, created_at: '2026-11-14T00:00:00.000Z', content: input.content, score: input.score ?? null, status: null, okr_id: input.okrId },
    error: null,
  };
}

export async function loadProgressLogs(..._args: unknown[]): Promise<unknown[]> {
  return [];
}
