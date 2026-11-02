import 'server-only';
import { NextResponse } from 'next/server';
import { canAdoptCandidate } from '@/lib/cascade/stage3Candidates';

type AnyRecord = Record<string, unknown>;

export type WriteFailure = { ok: false; status: number; error: string };
export type WriteOutcome = { ok: true } | WriteFailure;
export type DepartmentApply = (
  target: AnyRecord,
  departments: AnyRecord[],
) => { ok: true; target: AnyRecord } | WriteFailure;

export function failResponse(status: number, error: string) {
  return NextResponse.json({ ok: false, error }, { status });
}

/**
 * 会社・戦略・権限・revision を確認し、対象部門1件だけを書き換える。
 * 書き込みは strategy_data.departments の1列だけ。保存済みの revision と一致した場合だけ書く。
 */
export async function writeDepartmentGuarded(args: {
  admin: any;
  userId: string;
  companyId: string;
  strategyId: string;
  expectedRevision: number;
  departmentName: string;
  apply: DepartmentApply;
}): Promise<WriteOutcome> {
  const { admin, userId, companyId, strategyId, expectedRevision, departmentName, apply } = args;

  const membership = await admin
    .from('company_members')
    .select('role')
    .eq('user_id', userId)
    .eq('company_id', companyId)
    .limit(1);
  if (membership.error) return { ok: false, status: 503, error: 'membership_check_unavailable' };
  if (!Array.isArray(membership.data) || membership.data.length === 0) {
    return { ok: false, status: 403, error: 'forbidden' };
  }
  if (!canAdoptCandidate(String(membership.data[0]?.role ?? ''))) {
    return { ok: false, status: 403, error: 'insufficient_role' };
  }

  const strategy = await admin
    .from('strategy_data')
    .select('id, company_id, revision, departments')
    .eq('id', strategyId)
    .maybeSingle();
  if (strategy.error) return { ok: false, status: 503, error: 'strategy_check_unavailable' };
  if (!strategy.data || strategy.data.company_id !== companyId) {
    return { ok: false, status: 403, error: 'strategy_mismatch' };
  }
  if (strategy.data.revision !== expectedRevision) return { ok: false, status: 409, error: 'revision_changed' };

  const departments: unknown = strategy.data.departments;
  if (!Array.isArray(departments)) return { ok: false, status: 409, error: 'unverifiable_departments' };
  const list = departments as AnyRecord[];
  const targetIndex = list.findIndex((d) => d && typeof d === 'object' && d.name === departmentName);
  if (targetIndex < 0) return { ok: false, status: 409, error: 'department_changed' };
  const target = list[targetIndex];
  if (target.projects !== undefined && target.projects !== null && !Array.isArray(target.projects)) {
    return { ok: false, status: 409, error: 'unverifiable_departments' };
  }

  const applied = apply(target, list);
  if (!applied.ok) return applied;

  const nextDepartments = list.map((d, i) => (i === targetIndex ? applied.target : d));
  const write = await admin
    .from('strategy_data')
    .update({ departments: nextDepartments })
    .eq('id', strategyId)
    .eq('company_id', companyId)
    .eq('revision', expectedRevision)
    .select('id');
  if (write.error) return { ok: false, status: 500, error: 'save_failed' };
  if (!Array.isArray(write.data) || write.data.length === 0) {
    return { ok: false, status: 409, error: 'revision_changed' };
  }
  return { ok: true };
}
