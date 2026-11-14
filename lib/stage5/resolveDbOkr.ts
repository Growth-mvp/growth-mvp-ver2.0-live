export const normalizeObjectiveKey = (s?: string): string =>
  String(s ?? '')
    .trim()
    .replace(/\s+/g, ' ')
    .replace(/[　]+/g, ' ')
    .toLowerCase();

export const isUuidLike = (v: unknown): v is string =>
  typeof v === 'string' &&
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(v.trim());

export type DbOkrRow = {
  id?: string | null;
  objective?: string | null;
  project_id?: string | null;
};

export type ResolveDbOkrInput = {
  dbOkrId?: string;
  okrId?: string;
  progressOkrId?: string;
  displayOkrId?: string;
  objective: string;
  projectId: string;
  companyId: string;
  strategyId: string;
};

export type ResolveDbOkrCache = {
  dbOkrMap: Record<string, string | undefined>;
  cachedRows: DbOkrRow[];
};

export type OkrReadDeps = {
  findOkrById: (id: string) => Promise<string | null>;
  listProjectOkrs: (scope: { companyId: string; strategyId: string; projectId: string }) => Promise<DbOkrRow[] | null>;
};

export type ResolvedDbOkr = { id: string; direct: boolean };

export async function resolveExistingDbOkrId(
  input: ResolveDbOkrInput,
  cache: ResolveDbOkrCache,
  deps: OkrReadDeps,
): Promise<ResolvedDbOkr | null> {
  const direct = String(input.dbOkrId ?? '').trim();
  if (direct) return { id: direct, direct: true };

  const { companyId, strategyId, projectId } = input;
  const objectiveKey = normalizeObjectiveKey(input.objective);
  const hasScope = Boolean(companyId && strategyId && projectId && objectiveKey);

  if (hasScope) {
    const mapKey = `${companyId}::${strategyId}::${projectId}::${objectiveKey}`;
    const mapped = String(cache.dbOkrMap[mapKey] ?? '').trim();
    if (mapped) return { id: mapped, direct: false };
  }

  const sameProject = cache.cachedRows.filter(
    (row) => String(row?.project_id ?? '').trim() === projectId && normalizeObjectiveKey(row?.objective ?? '') === objectiveKey,
  );
  if (sameProject.length === 1 && sameProject[0]?.id) {
    return { id: String(sameProject[0].id).trim(), direct: false };
  }

  const candidates = [input.progressOkrId, input.okrId, input.displayOkrId]
    .map((v) => String(v ?? '').trim())
    .filter(Boolean);
  for (const candidate of candidates) {
    if (!isUuidLike(candidate)) continue;
    const found = await deps.findOkrById(candidate);
    if (found) return { id: found, direct: false };
  }

  if (hasScope) {
    const rows = await deps.listProjectOkrs({ companyId, strategyId, projectId });
    if (rows) {
      const sameObjective = rows.filter((row) => normalizeObjectiveKey(row?.objective ?? '') === objectiveKey);
      if (sameObjective.length === 1 && sameObjective[0]?.id) {
        return { id: String(sameObjective[0].id).trim(), direct: false };
      }
      if (sameObjective.length === 0 && rows.length === 1 && rows[0]?.id) {
        return { id: String(rows[0].id).trim(), direct: false };
      }
    }
  }

  return null;
}
