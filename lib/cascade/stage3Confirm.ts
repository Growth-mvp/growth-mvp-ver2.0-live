import { departmentKeyOf, editableKpis, withKpis } from '@/lib/cascade/stage3Adjustment';
import { exclusionRefusal, isProjectActive } from '@/lib/cascade/projectLifecycle';
import type { ProjectTextFields } from '@/lib/cascade/stage3StrategyBook';
import {
  collectProjectIds,
  currentItemValues,
  krRecordsFromKpis,
  prepareAdoptedProject,
  sameItemValues,
  validateProposalRequest,
} from '@/lib/cascade/stage3Candidates';

type AnyRecord = Record<string, unknown>;

export type ConfirmChange = {
  departmentKey: string;
  departmentName: string;
  item: string;
  proposed: Record<string, unknown>;
  base: Record<string, unknown>;
};

export type ConfirmAdoption = {
  departmentKey: string;
  departmentName: string;
  candidateId: string;
  project: AnyRecord;
};

export type ConfirmProjectEdit = {
  departmentKey: string;
  departmentName: string;
  projectId: string;
  fields: ProjectTextFields;
  base: ProjectTextFields;
  kpis?: { base: string[]; next: string[] };
};

export type ConfirmProjectRemoval = {
  departmentKey: string;
  departmentName: string;
  projectId: string;
  base: { title: string };
};

type ConfirmError =
  | 'department_missing'
  | 'invalid_change'
  | 'duplicate_change'
  | 'current_value_changed'
  | 'adoption_department_missing'
  | 'invalid_project'
  | 'project_missing'
  | 'project_changed'
  | 'project_referenced'
  | 'project_approved';

export type ConfirmPlan =
  | {
      ok: true;
      departments: AnyRecord[];
      appliedCount: number;
      editedProjectCount: number;
      adoptedProjectIds: string[];
      excludedProjectIds: string[];
    }
  | { ok: false; error: ConfirmError; departmentName: string; item: string };

const sameStrings = (a: string[], b: string[]) => JSON.stringify(a) === JSON.stringify(b);

const textOrNull = (value: unknown): string | null => (typeof value === 'string' && value.trim() !== '' ? value : null);

export function projectTextOf(project: AnyRecord): ProjectTextFields {
  return {
    title: textOrNull(project.title) ?? '',
    reason: textOrNull(project.reason),
    hypothesis: textOrNull(project.hypothesis),
    description: textOrNull(project.description),
  };
}

const sameProjectText = (a: ProjectTextFields, b: ProjectTextFields) => JSON.stringify(a) === JSON.stringify(b);

/**
 * 確定する変更と採用するプロジェクトを、正式データの全体に対して先に検証し、すべて通った時だけ次の departments を返す。
 * 1件でも失敗すれば何も返さない（書き込みはしない）。入力は変えない。
 * 既存の計画には触れない（IDも内容も変えない）。採用する新規プロジェクトにだけ、既存と重ならない新しいIDを発行する。
 * 既存プロジェクトの編集は文章の項目だけを変え、KPI・OKR・IDは変えない。
 * 計画から外すのは物理削除ではなく無効化（lifecycle）。採用は候補IDで既存の施策と対応づけ、有効な施策は重複させず、除外中の施策は同じIDで復帰させる。
 */
export function planConfirm(args: {
  departments: unknown[];
  changes: ConfirmChange[];
  adoptions?: ConfirmAdoption[];
  projectEdits?: ConfirmProjectEdit[];
  projectRemovals?: ConfirmProjectRemoval[];
  referencedProjectKeys?: Set<string>;
  mintId: () => string;
  /** 構造化KPI（okrsV2）のKRのIDを作る。省略時は mintId と同じ方法 */
  mintKrId?: () => string;
  nowIso: string;
  actorUserId: string | null;
}): ConfirmPlan {
  const original = args.departments as AnyRecord[];
  const next: AnyRecord[] = JSON.parse(JSON.stringify(original));
  const seen = new Set<string>();
  const findProject = (departmentKey: string, projectId: string, departmentName: string) => {
    const index = next.findIndex((d) => d && typeof d === 'object' && departmentKeyOf(d) === departmentKey);
    const list = index >= 0 && Array.isArray(next[index].projects) ? (next[index].projects as AnyRecord[]) : [];
    const at = list.findIndex((p) => p && typeof p === 'object' && String(p.id) === projectId);
    return { index, at, departmentName };
  };

  let appliedChanges = 0;
  for (const c of args.changes) {
    const fail = (error: ConfirmError) => ({ ok: false as const, error, departmentName: c.departmentName, item: c.item });
    const index = original.findIndex((d) => d && typeof d === 'object' && departmentKeyOf(d) === c.departmentKey);
    if (index < 0) return fail('department_missing');
    const request = validateProposalRequest(c.item, c.proposed, c.base);
    if (!request.ok) return fail('invalid_change');
    const key = `${c.departmentKey} ${request.item}`;
    if (seen.has(key)) return fail('duplicate_change');
    seen.add(key);
    const currentValues = currentItemValues(original[index], request.item);
    if (!sameItemValues(c.base, currentValues)) {
      // 以前の確定で既に正式データへ反映済みの変更（作業版に古い採用が残っている）は、競合ではなく反映済みとして扱う
      if (sameItemValues(c.proposed, currentValues)) continue;
      return fail('current_value_changed');
    }
    next[index] = { ...next[index], ...c.proposed };
    appliedChanges += 1;
  }

  let editedCount = 0;
  for (const e of args.projectEdits ?? []) {
    const fail = (error: ConfirmError) => ({ ok: false as const, error, departmentName: e.departmentName, item: 'project' });
    const { index, at } = findProject(e.departmentKey, e.projectId, e.departmentName);
    if (index < 0 || at < 0) return fail('project_missing');
    const list = next[index].projects as AnyRecord[];
    const project = list[at];
    if (!sameProjectText(e.base, projectTextOf(project))) return fail('project_changed');
    if (e.kpis) {
      const current = editableKpis(project);
      if (!current || !sameStrings(current, e.kpis.base) || e.kpis.next.length !== current.length) {
        return fail('project_changed');
      }
    }
    let updated: AnyRecord = { ...project, title: e.fields.title };
    for (const key of ['reason', 'hypothesis', 'description'] as const) {
      if (e.fields[key] === null) delete updated[key];
      else updated[key] = e.fields[key];
    }
    if (e.kpis) updated = withKpis(updated, e.kpis.next);
    list[at] = updated;
    editedCount += 1;
  }

  const excludedProjectIds: string[] = [];
  for (const r of args.projectRemovals ?? []) {
    const fail = (error: ConfirmError) => ({ ok: false as const, error, departmentName: r.departmentName, item: 'project' });
    if (args.referencedProjectKeys?.has(`${r.departmentKey} ${r.projectId}`)) return fail('project_referenced');
    const { index, at } = findProject(r.departmentKey, r.projectId, r.departmentName);
    if (index < 0 || at < 0) return fail('project_missing');
    const list = next[index].projects as AnyRecord[];
    const project = list[at];
    if (r.base.title !== (textOrNull(project.title) ?? '')) return fail('project_changed');
    if (exclusionRefusal(project, { executing: false }) === 'APPROVED') return fail('project_approved');
    if (!isProjectActive(project)) continue;
    list[at] = { ...project, lifecycle: { status: 'EXCLUDED', changedAt: args.nowIso, changedBy: args.actorUserId } };
    excludedProjectIds.push(r.projectId);
  }

  const taken = collectProjectIds(original);
  const adoptedProjectIds: string[] = [];
  for (const a of args.adoptions ?? []) {
    const fail = (error: ConfirmError) => ({ ok: false as const, error, departmentName: a.departmentName, item: 'project' });
    const index = original.findIndex((d) => d && typeof d === 'object' && departmentKeyOf(d) === a.departmentKey);
    if (index < 0) return fail('adoption_department_missing');
    const list = Array.isArray(next[index].projects) ? (next[index].projects as AnyRecord[]) : [];
    const linkedAt = list.findIndex((p) => p && typeof p === 'object' && (p as AnyRecord).sourceCandidateId === a.candidateId);
    if (linkedAt >= 0) {
      const linked = list[linkedAt];
      if (isProjectActive(linked)) continue;
      const restored: AnyRecord = { ...linked };
      delete restored.lifecycle;
      list[linkedAt] = restored;
      adoptedProjectIds.push(String(restored.id));
      continue;
    }
    if (typeof a.project.title !== 'string' || a.project.title.trim() === '') return fail('invalid_project');
    const prepared = prepareAdoptedProject(a.project, args.mintId, taken);
    if (!prepared.ok) return fail('invalid_project');
    const id = String(prepared.project.id);
    taken.add(id);
    adoptedProjectIds.push(id);
    const okrsV2 = krRecordsFromKpis(prepared.project, args.mintKrId ?? args.mintId);
    next[index] = { ...next[index], projects: [...list, { ...prepared.project, ...(okrsV2.length > 0 ? { okrsV2 } : {}), sourceCandidateId: a.candidateId }] };
  }

  return {
    ok: true,
    departments: next,
    appliedCount: appliedChanges,
    editedProjectCount: editedCount,
    adoptedProjectIds,
    excludedProjectIds,
  };
}
