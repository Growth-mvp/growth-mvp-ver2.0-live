import { departmentKeyOf, projectIdOf } from '@/lib/cascade/stage3Adjustment';
import { currentItemValues, sameItemValues, validateProposalRequest } from '@/lib/cascade/stage3Candidates';

type AnyRecord = Record<string, unknown>;

export type ConfirmChange = {
  departmentKey: string;
  departmentName: string;
  item: string;
  proposed: Record<string, unknown>;
  base: Record<string, unknown>;
};

export type ConfirmPlan =
  | { ok: true; departments: AnyRecord[]; appliedCount: number; assignedProjectIds: number }
  | {
      ok: false;
      error: 'department_missing' | 'invalid_change' | 'duplicate_change' | 'current_value_changed';
      departmentName: string;
      item: string;
    };

const hasStableId = (p: AnyRecord) =>
  (typeof p.id === 'string' && p.id.trim() !== '') || (typeof p.id === 'number' && Number.isFinite(p.id));

/**
 * 確定する変更を、正式データの全体に対して先に検証し、すべて通った時だけ次の departments を返す。
 * 1件でも失敗すれば何も返さない（書き込みはしない）。入力は変えない。
 * 旧データで安定IDが無い計画には、ここで ID を付ける（名称を変えても対応が切れないようにする）。
 */
export function planConfirm(args: {
  departments: unknown[];
  changes: ConfirmChange[];
  mintId: () => string;
}): ConfirmPlan {
  const original = args.departments as AnyRecord[];
  const next: AnyRecord[] = JSON.parse(JSON.stringify(original));
  const seen = new Set<string>();

  for (const c of args.changes) {
    const fail = (error: 'department_missing' | 'invalid_change' | 'duplicate_change' | 'current_value_changed') => ({
      ok: false as const,
      error,
      departmentName: c.departmentName,
      item: c.item,
    });
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

  let assignedProjectIds = 0;
  for (const dept of next) {
    if (!Array.isArray(dept.projects)) continue;
    dept.projects = (dept.projects as AnyRecord[]).map((p) => {
      if (!p || typeof p !== 'object' || hasStableId(p)) return p;
      assignedProjectIds += 1;
      return { ...p, id: args.mintId() };
    });
  }

  return { ok: true, departments: next, appliedCount: args.changes.length, assignedProjectIds };
}

/** 付与後の安定ID（確認用）。 */
export function stableProjectKey(project: AnyRecord): string {
  return projectIdOf(project);
}
