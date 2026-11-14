import { recordKrActual } from '@/lib/stage5/krActual';
import type { KrActual } from '@/types/strategy';

export type StoredRow = { id: string; revision: number; departments: unknown[] };

export type StrategyIo = {
  read: (companyId: string) => Promise<{ row: StoredRow | null; error: unknown }>;
  write: (args: {
    companyId: string;
    rowId: string;
    expectedRevision: number;
    departments: unknown[];
    actorId: string;
  }) => Promise<{ row: StoredRow | null; error: unknown }>;
};

export type ApplyResult = { ok: true; departments: unknown[] } | { ok: false; reason: string };

export type PatchOutcome =
  | { ok: true; revision: number; departments: unknown[] }
  | { ok: false; reason: 'read_failed' | 'row_not_found' | 'write_failed' | 'revision_conflict' | string };

type StoredProject = Record<string, unknown> & { id?: unknown };
type StoredDepartment = Record<string, unknown> & { projects?: unknown };

function projectsOf(dept: unknown): unknown[] {
  const projects = (dept as StoredDepartment | null)?.projects;
  return Array.isArray(projects) ? projects : [];
}

export function locateProject(
  departments: unknown[],
  projectId: string,
): { ok: true; di: number; pi: number } | { ok: false; reason: string } {
  const id = projectId.trim();
  if (!id) return { ok: false, reason: 'project-missing-id' };

  const hits: Array<{ di: number; pi: number }> = [];
  departments.forEach((dept, di) => {
    projectsOf(dept).forEach((project, pi) => {
      const pid = (project as StoredProject | null)?.id;
      if (typeof pid === 'string' && pid.trim() === id) hits.push({ di, pi });
    });
  });
  if (hits.length === 0) return { ok: false, reason: 'project-not-found' };
  if (hits.length > 1) return { ok: false, reason: 'project-ambiguous' };
  return { ok: true, ...hits[0] };
}

function replaceProject(
  departments: unknown[],
  di: number,
  pi: number,
  update: (project: StoredProject) => StoredProject,
): unknown[] {
  return departments.map((dept, i) => {
    if (i !== di) return dept;
    return {
      ...(dept as StoredDepartment),
      projects: projectsOf(dept).map((project, j) => (j === pi ? update(project as StoredProject) : project)),
    };
  });
}

export function applyKrActualToDepartments(
  departments: unknown[],
  input: { projectId: string; krId: string; actual: KrActual },
): ApplyResult {
  const loc = locateProject(departments, input.projectId);
  if (!loc.ok) return loc;
  const project = projectsOf(departments[loc.di])[loc.pi] as StoredProject;
  const recorded = recordKrActual(project.okrsV2, input.krId, input.actual);
  if (!recorded.ok) return { ok: false, reason: recorded.reason };
  return {
    ok: true,
    departments: replaceProject(departments, loc.di, loc.pi, (p) => ({ ...p, okrsV2: recorded.next })),
  };
}

export function applyWorkProgressToDepartments(
  departments: unknown[],
  input: { projectId: string; pct: number | undefined },
): ApplyResult {
  if (input.pct !== undefined && (!Number.isFinite(input.pct) || input.pct < 0 || input.pct > 100)) {
    return { ok: false, reason: 'invalid-value' };
  }
  const loc = locateProject(departments, input.projectId);
  if (!loc.ok) return loc;
  return {
    ok: true,
    departments: replaceProject(departments, loc.di, loc.pi, (p) => {
      const next: StoredProject = { ...p };
      if (input.pct === undefined) delete next.workProgressPct;
      else next.workProgressPct = input.pct;
      return next;
    }),
  };
}

export async function patchStrategyDepartments(
  io: StrategyIo,
  input: {
    companyId: string;
    actorId: string;
    apply: (departments: unknown[]) => ApplyResult;
    maxAttempts?: number;
  },
): Promise<PatchOutcome> {
  const maxAttempts = input.maxAttempts ?? 3;
  if (!input.companyId || !input.actorId) return { ok: false, reason: 'missing_scope' };

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const read = await io.read(input.companyId);
    if (read.error) return { ok: false, reason: 'read_failed' };
    if (!read.row) return { ok: false, reason: 'row_not_found' };

    const applied = input.apply(read.row.departments);
    if (!applied.ok) return { ok: false, reason: applied.reason };

    const written = await io.write({
      companyId: input.companyId,
      rowId: read.row.id,
      expectedRevision: read.row.revision,
      departments: applied.departments,
      actorId: input.actorId,
    });
    if (written.error) return { ok: false, reason: 'write_failed' };
    if (written.row) return { ok: true, revision: written.row.revision, departments: written.row.departments };
  }
  return { ok: false, reason: 'revision_conflict' };
}
