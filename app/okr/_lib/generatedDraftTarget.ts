type ProjectSelection = { deptIdx: number; projIdx: number } | null;

export function isDraftTargetSelected(deptIdx: number, projIdx: number, selected: ProjectSelection): boolean {
  return !!selected && selected.deptIdx === deptIdx && selected.projIdx === projIdx;
}

// 安定IDのない旧プロジェクトは照合できないため、選択中の添字だけで判定する
export function isDraftProjectMatch(draftProjectId: string, project: object | null | undefined): boolean {
  if (!project) return false;
  if (!draftProjectId) return true;
  return String((project as { id?: unknown }).id ?? '') === draftProjectId;
}
