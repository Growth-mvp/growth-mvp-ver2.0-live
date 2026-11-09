/* STAGE3 のプロジェクトIDの付与と検出。
 * IDのないプロジェクトには、配列の位置に依存しない新しいIDを一度だけ付ける。既にIDがあるものは変えない。
 * 重複したIDは自動で直さず、検出して報告する（別のプロジェクトの計画書と混ざらないことを優先する）。 */

type AnyRecord = Record<string, any>;

const isBlank = (v: unknown): boolean => v === undefined || v === null || String(v).trim() === '';

/** 保存で使うプロジェクトIDの値（id が無ければ projectId）。無ければ null */
export function effectiveProjectId(project: AnyRecord): string | null {
  if (!isBlank(project?.id)) return String(project.id).trim();
  if (!isBlank(project?.projectId)) return String(project.projectId).trim();
  return null;
}

export function newProjectId(): string {
  const c = (globalThis as unknown as { crypto?: { randomUUID?: () => string } }).crypto;
  return c?.randomUUID ? c.randomUUID() : `p-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

/** IDのないプロジェクトだけに新しいIDを付ける。変更がなければ元の配列をそのまま返す（元の配列は書き換えない） */
export function assignMissingProjectIds<T extends AnyRecord>(
  departments: T[],
  newId: () => string = newProjectId
): { departments: T[]; assigned: number } {
  let assigned = 0;
  const next = departments.map((d) => {
    const projects = Array.isArray(d?.projects) ? (d.projects as AnyRecord[]) : null;
    if (!projects) return d;
    let changed = false;
    const nextProjects = projects.map((p) => {
      if (effectiveProjectId(p) !== null) return p;
      changed = true;
      assigned += 1;
      return { ...p, id: newId() };
    });
    return changed ? { ...d, projects: nextProjects } : d;
  });
  return assigned === 0 ? { departments, assigned } : { departments: next, assigned };
}

export type DuplicateProjectId = { id: string; locations: Array<{ departmentIndex: number; projectIndex: number }> };

/** 同じIDを複数のプロジェクトが持っている場合を返す（直さない） */
export function findDuplicateProjectIds(departments: AnyRecord[]): DuplicateProjectId[] {
  const byId = new Map<string, DuplicateProjectId['locations']>();
  departments.forEach((d, departmentIndex) => {
    (Array.isArray(d?.projects) ? (d.projects as AnyRecord[]) : []).forEach((p, projectIndex) => {
      const id = effectiveProjectId(p);
      if (id === null) return;
      const list = byId.get(id) ?? [];
      list.push({ departmentIndex, projectIndex });
      byId.set(id, list);
    });
  });
  return [...byId.entries()].filter(([, locations]) => locations.length > 1).map(([id, locations]) => ({ id, locations }));
}
