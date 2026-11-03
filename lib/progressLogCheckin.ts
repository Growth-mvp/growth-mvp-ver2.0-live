export type ProgressLogCheckinFields = {
  content?: unknown;
  score?: unknown;
  status?: unknown;
};

/** 本文・評価・ステータスのいずれかに有効な値がある記録だけを確認ありとする（空の値は数えない） */
export function isProgressLogCheckin(log: ProgressLogCheckinFields | null | undefined): boolean {
  if (!log) return false;
  if (typeof log.score === 'number' && Number.isFinite(log.score)) return true;
  if (typeof log.status === 'string' && log.status.trim().length > 0) return true;
  if (typeof log.content === 'string' && log.content.trim().length > 0) return true;
  return false;
}
