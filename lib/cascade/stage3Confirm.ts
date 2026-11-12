import { departmentKeyOf } from '@/lib/cascade/stage3Adjustment';
import {
  collectProjectIds,
  currentItemValues,
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
  project: AnyRecord;
};

type ConfirmError =
  | 'department_missing'
  | 'invalid_change'
  | 'duplicate_change'
  | 'current_value_changed'
  | 'adoption_department_missing'
  | 'invalid_project';

export type ConfirmPlan =
  | { ok: true; departments: AnyRecord[]; appliedCount: number; adoptedProjectIds: string[] }
  | { ok: false; error: ConfirmError; departmentName: string; item: string };

/**
 * 確定する変更と採用するプロジェクトを、正式データの全体に対して先に検証し、すべて通った時だけ次の departments を返す。
 * 1件でも失敗すれば何も返さない（書き込みはしない）。入力は変えない。
 * 既存の計画には触れない（IDも内容も変えない）。採用する新規プロジェクトにだけ、既存と重ならない新しいIDを発行する。
 */
export function planConfirm(args: {
  departments: unknown[];
  changes: ConfirmChange[];
  adoptions?: ConfirmAdoption[];
  mintId: () => string;
}): ConfirmPlan {
  const original = args.departments as AnyRecord[];
  const next: AnyRecord[] = JSON.parse(JSON.stringify(original));
  const seen = new Set<string>();

  for (const c of args.changes) {
    const fail = (error: ConfirmError) => ({ ok: false as const, error, departmentName: c.departmentName, item: c.item });
    const index = original.findIndex((d) => d && typeof d === 'object' && departmentKeyOf(d) === c.departmentKey);
    if (index < 0) return fail('department_missing');
    const request = validateProposalRequest(c.item, c.proposed, c.base);
    if (!request.ok) return fail('invalid_change');
    const key = `${c.departmentKey} ${request.item}`;
    if (seen.has(key)) return fail('duplicate_change');
    seen.add(key);
    if (!sameItemValues(c.base, currentItemValues(original[index], request.item))) return fail('current_value_changed');
    next[index] = { ...next[index], ...c.proposed };
  }

  const taken = collectProjectIds(original);
  const adoptedProjectIds: string[] = [];
  for (const a of args.adoptions ?? []) {
    const fail = (error: ConfirmError) => ({ ok: false as const, error, departmentName: a.departmentName, item: 'project' });
    const index = original.findIndex((d) => d && typeof d === 'object' && departmentKeyOf(d) === a.departmentKey);
    if (index < 0) return fail('adoption_department_missing');
    if (typeof a.project.title !== 'string' || a.project.title.trim() === '') return fail('invalid_project');
    const prepared = prepareAdoptedProject(a.project, args.mintId, taken);
    if (!prepared.ok) return fail('invalid_project');
    const id = String(prepared.project.id);
    taken.add(id);
    adoptedProjectIds.push(id);
    const list = Array.isArray(next[index].projects) ? (next[index].projects as AnyRecord[]) : [];
    next[index] = { ...next[index], projects: [...list, prepared.project] };
  }

  return { ok: true, departments: next, appliedCount: args.changes.length, adoptedProjectIds };
}
