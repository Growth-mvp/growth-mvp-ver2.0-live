export const ORG_ALIGNMENT_VISIBILITY_MODES = ['anonymous', 'manager_only', 'named'] as const;

export type OrgAlignmentVisibilityMode = (typeof ORG_ALIGNMENT_VISIBILITY_MODES)[number];

export function isOrgAlignmentVisibilityMode(value: unknown): value is OrgAlignmentVisibilityMode {
  return typeof value === 'string' && (ORG_ALIGNMENT_VISIBILITY_MODES as readonly string[]).includes(value);
}

/**
 * 外部レスポンスに出してよい作成者 ID。匿名（および公開範囲が不明な投稿）は null。
 * 内部の参照（名前の取得など）には created_by をそのまま使う。
 */
export function externalCreatorId(
  visibilityMode: string | null | undefined,
  createdBy: string | null | undefined
): string | null {
  if (visibilityMode !== 'manager_only' && visibilityMode !== 'named') return null;
  return createdBy ?? null;
}
