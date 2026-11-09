/* IDのない既存プロジェクトに、利用者が計画を保存する時だけ安定IDを一度付ける。
 * 書き込むのは project.id の1項目だけ。戦略・KPIなど他の項目は変えない。
 * 画面で見ていた名称と一致するものにだけ付ける（並び替えの後に別のプロジェクトへ付けないため）。 */
import { stableIdOf } from './projectResolver';

export type AssignIdResult =
  | { ok: true; departments: unknown[]; projectId: string }
  | { ok: false; reason: 'NOT_FOUND' | 'TITLE_CHANGED' | 'ALREADY_HAS_ID' | 'ID_IN_USE'; projectId?: string };

export function assignProjectId(args: {
  departments: unknown;
  departmentIndex: number;
  projectIndex: number;
  expectedTitle: string;
  newId: string;
}): AssignIdResult {
  const list = Array.isArray(args.departments) ? (args.departments as Array<Record<string, unknown>>) : [];
  const dept = list[args.departmentIndex];
  const projects = Array.isArray(dept?.projects) ? (dept.projects as Array<Record<string, unknown>>) : [];
  const project = projects[args.projectIndex];
  if (!project) return { ok: false, reason: 'NOT_FOUND' };

  const existing = stableIdOf(project);
  if (existing) return { ok: false, reason: 'ALREADY_HAS_ID', projectId: existing };

  const allIds = list.flatMap((d) =>
    (Array.isArray(d?.projects) ? (d.projects as Array<Record<string, unknown>>) : []).map((p) => stableIdOf(p))
  );
  if (allIds.includes(args.newId)) return { ok: false, reason: 'ID_IN_USE' };

  if (typeof project.title !== 'string' || project.title.trim() !== args.expectedTitle.trim()) {
    return { ok: false, reason: 'TITLE_CHANGED' };
  }

  const nextProjects = projects.map((p, i) => (i === args.projectIndex ? { ...p, id: args.newId } : p));
  const nextDepartments = list.map((d, i) => (i === args.departmentIndex ? { ...d, projects: nextProjects } : d));
  return { ok: true, departments: nextDepartments, projectId: args.newId };
}
