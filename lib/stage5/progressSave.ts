export type SavedProgressRow = {
  id: string;
  user_id?: string | null;
  company_id?: string | null;
  okr_id?: string | null;
  created_at?: string | null;
  content?: string | null;
  score?: number | string | null;
  status?: string | null;
};

export type ProgressWriteResult = { data: SavedProgressRow | null; error: unknown };

export type ProgressSubmission = {
  userId: string;
  companyId: string;
  okrId: string;
  content: string;
  score: number | null;
};

export type InsertProgressDeps = {
  insert: (id: string, submission: ProgressSubmission) => Promise<ProgressWriteResult>;
  fetchById: (id: string) => Promise<ProgressWriteResult>;
};

export type InsertProgressOutcome = { ok: true; row: SavedProgressRow } | { ok: false; error: unknown };

export function createSingleFlight() {
  let busy = false;
  return async function run(task: () => Promise<void>): Promise<void> {
    if (busy) return;
    busy = true;
    try {
      await task();
    } finally {
      busy = false;
    }
  };
}

export function createPendingInsert(newId: () => string = () => crypto.randomUUID()) {
  let pending: { key: string; id: string; submission: ProgressSubmission } | null = null;
  return {
    attempt(key: string, build: () => ProgressSubmission): { id: string; submission: ProgressSubmission } {
      if (!pending || pending.key !== key) pending = { key, id: newId(), submission: build() };
      return { id: pending.id, submission: pending.submission };
    },
    settle(): void {
      pending = null;
    },
  };
}

export function isDuplicateKeyError(error: unknown): boolean {
  return typeof error === 'object' && error !== null && (error as { code?: unknown }).code === '23505';
}

function sameText(a: unknown, b: string): boolean {
  return typeof a === 'string' && b.trim() !== '' && a.trim().toLowerCase() === b.trim().toLowerCase();
}

function sameScore(a: SavedProgressRow['score'], b: number | null): boolean {
  if (a === null || a === undefined) return b === null;
  if (b === null) return false;
  return Number(a) === b;
}

export function matchesSubmission(row: SavedProgressRow, submission: ProgressSubmission): boolean {
  return (
    sameText(row.user_id, submission.userId) &&
    sameText(row.company_id, submission.companyId) &&
    sameText(row.okr_id, submission.okrId) &&
    row.content === submission.content &&
    sameScore(row.score, submission.score)
  );
}

export async function insertProgressRowOnce(
  id: string,
  submission: ProgressSubmission,
  deps: InsertProgressDeps,
): Promise<InsertProgressOutcome> {
  const first = await deps.insert(id, submission);
  if (!first.error && first.data?.id) return { ok: true, row: first.data };
  if (!first.error) {
    return { ok: false, error: { code: 'SAVED_ID_MISSING', message: '保存結果を確認できませんでした。' } };
  }
  if (!isDuplicateKeyError(first.error)) return { ok: false, error: first.error };

  const existing = await deps.fetchById(id);
  if (!existing.data?.id) return { ok: false, error: existing.error ?? first.error };
  if (!matchesSubmission(existing.data, submission)) {
    return {
      ok: false,
      error: { code: 'ID_CONFLICT', message: '同じ保存要求と一致しない既存の記録があるため、保存を確認できませんでした。' },
    };
  }
  return { ok: true, row: existing.data };
}

export function toAssistProgress(workProgressPct: number | null | undefined): number | undefined {
  if (typeof workProgressPct !== 'number' || !Number.isFinite(workProgressPct)) return undefined;
  return Math.min(100, Math.max(0, workProgressPct)) / 100;
}
