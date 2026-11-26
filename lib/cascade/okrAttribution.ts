/* OKRの所属（部門ID・プロジェクトID）が、現在の正式データの部門・プロジェクトに実在するかを判定する。
 * 実在しないOKRは、どの部門・計画の集計・表示にも数えない（削除・帰属不明のデータを誤って取り込まないため）。 */

type OkrRef = { department_id?: unknown; project_id?: unknown };

const textOf = (v: unknown): string => (v === undefined || v === null ? '' : String(v).trim());

export function attributableProjectKeys(departments: unknown): Set<string> {
  const keys = new Set<string>();
  if (!Array.isArray(departments)) return keys;
  for (const dept of departments) {
    const deptId = textOf((dept as { id?: unknown } | null)?.id);
    const projects = Array.isArray((dept as { projects?: unknown } | null)?.projects)
      ? ((dept as { projects: unknown[] }).projects)
      : [];
    if (!deptId) continue;
    for (const project of projects) {
      const projectId = textOf((project as { id?: unknown } | null)?.id);
      if (projectId) keys.add(`${deptId}|${projectId}`);
    }
  }
  return keys;
}

export function attributableOkrs<T extends OkrRef>(okrs: T[], departments: unknown): T[] {
  const keys = attributableProjectKeys(departments);
  return okrs.filter((okr) => keys.has(`${textOf(okr.department_id)}|${textOf(okr.project_id)}`));
}
