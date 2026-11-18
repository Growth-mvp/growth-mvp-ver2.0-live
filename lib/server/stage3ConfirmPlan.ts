import 'server-only';
import { randomUUID } from 'node:crypto';
import type { SupabaseClient } from '@supabase/supabase-js';
import { departmentKeyOf } from '@/lib/cascade/stage3Adjustment';
import { isProjectActive } from '@/lib/cascade/projectLifecycle';
import type { NewProjectCandidate, WorkspaceState } from '@/lib/cascade/stage3StrategyBook';
import {
  planConfirm,
  type ConfirmAdoption,
  type ConfirmPlan,
  type ConfirmProjectEdit,
  type ConfirmProjectRemoval,
} from '@/lib/cascade/stage3Confirm';
import { findExecutingProjectIds } from '@/lib/server/stage3ProjectReferences';

type AnyRecord = Record<string, unknown>;
export type ConfirmPlanOk = Extract<ConfirmPlan, { ok: true }>;
export type ConfirmPlanFailure = Extract<ConfirmPlan, { ok: false }>;

function departmentNameOf(departments: unknown, key: string): string {
  const list = Array.isArray(departments) ? departments : [];
  const hit = list.find((d) => d && typeof d === 'object' && departmentKeyOf(d as AnyRecord) === key) as AnyRecord | undefined;
  return typeof hit?.name === 'string' ? hit.name : key;
}

function linkedProjectOf(departments: unknown, departmentKey: string, candidateId: string): AnyRecord | undefined {
  const dept = (Array.isArray(departments) ? departments : []).find(
    (d) => d && typeof d === 'object' && departmentKeyOf(d as AnyRecord) === departmentKey,
  ) as AnyRecord | undefined;
  const list = Array.isArray(dept?.projects) ? (dept.projects as AnyRecord[]) : [];
  return list.find((p) => p && typeof p === 'object' && p.sourceCandidateId === candidateId);
}

function findCandidate(state: WorkspaceState, candidateId: string): NewProjectCandidate | undefined {
  for (let i = state.drafts.length - 1; i >= 0; i -= 1) {
    const hit = state.drafts[i].newProjects.find((np) => np.candidateId === candidateId);
    if (hit) return hit;
  }
  return undefined;
}

const sameList = (a: string[], b: string[]) => JSON.stringify(a) === JSON.stringify(b);

/**
 * 作業版の内容を、保存済みの正式データに当てた確定計画にする（書き込みはしない）。
 * 確定と検証プレビューで同じ計画を使う。
 */
export async function buildConfirmPlan(
  admin: SupabaseClient,
  args: { companyId: string; strategyId: string; state: WorkspaceState; departments: unknown[]; actorUserId: string },
): Promise<
  | { kind: 'ok'; plan: ConfirmPlanOk }
  | { kind: 'failed'; failure: ConfirmPlanFailure }
  | { kind: 'error'; status: number; error: string }
> {
  const { state, departments } = args;

  const changes = state.selections
    .filter((s) => s.decision === 'applied')
    .map((s) => ({
      departmentKey: s.departmentKey,
      departmentName: s.departmentName,
      item: s.item,
      proposed: s.proposed,
      base: s.base,
    }));

  const adoptions: ConfirmAdoption[] = [];
  for (const ps of state.projectSelections.filter((p) => p.decision === 'applied')) {
    const candidate = findCandidate(state, ps.candidateId);
    if (!candidate) return { kind: 'error', status: 409, error: 'candidate_missing' };
    adoptions.push({
      departmentKey: ps.departmentKey,
      departmentName: ps.departmentName,
      candidateId: ps.candidateId,
      project: candidate.project,
    });
  }

  const manualEdits: ConfirmProjectEdit[] = state.projectEdits.map((e) => ({
    departmentKey: e.departmentKey,
    departmentName: departmentNameOf(departments, e.departmentKey),
    projectId: e.projectId,
    fields: e.fields,
    base: e.base,
  }));
  const proposalEdits: ConfirmProjectEdit[] = state.projectProposals
    .filter((p) => p.decision === 'adopted')
    .map((p) => ({
      departmentKey: p.departmentKey,
      departmentName: p.departmentName,
      projectId: p.projectId,
      fields: { title: p.proposed.title, reason: p.proposed.reason, hypothesis: p.proposed.hypothesis, description: p.proposed.description },
      base: { title: p.base.title, reason: p.base.reason, hypothesis: p.base.hypothesis, description: p.base.description },
      kpis: sameList(p.base.kpis, p.proposed.kpis) ? undefined : { base: p.base.kpis, next: p.proposed.kpis },
    }));
  const projectEdits = [...manualEdits, ...proposalEdits];

  const removalFromRecord = state.projectRemovals.map((r) => ({
    departmentKey: r.departmentKey,
    departmentName: departmentNameOf(departments, r.departmentKey),
    projectId: r.projectId,
    base: r.base,
  }));
  const discardedExclusions: ConfirmProjectRemoval[] = [];
  for (const ps of state.projectSelections.filter((p) => p.decision === 'discarded')) {
    const linked = linkedProjectOf(departments, ps.departmentKey, ps.candidateId);
    if (!linked || !isProjectActive(linked)) continue;
    discardedExclusions.push({
      departmentKey: ps.departmentKey,
      departmentName: ps.departmentName,
      projectId: String(linked.id),
      base: { title: String(linked.title ?? '') },
    });
  }
  const projectRemovals: ConfirmProjectRemoval[] = [...removalFromRecord, ...discardedExclusions];
  const referencedProjectKeys = new Set<string>();
  if (projectRemovals.length > 0) {
    const executing = await findExecutingProjectIds(admin, {
      companyId: args.companyId,
      strategyId: args.strategyId,
      projectIds: projectRemovals.map((r) => r.projectId),
    });
    if (!executing.ok) return { kind: 'error', status: 503, error: executing.error };
    for (const r of projectRemovals) {
      if (executing.ids.has(r.projectId)) referencedProjectKeys.add(`${r.departmentKey} ${r.projectId}`);
    }
    if (referencedProjectKeys.size > 0) return { kind: 'error', status: 409, error: 'project_referenced' };
  }

  const plan = planConfirm({
    departments,
    changes,
    adoptions,
    projectEdits,
    projectRemovals,
    referencedProjectKeys,
    mintId: () => `p-${randomUUID()}`,
    nowIso: new Date().toISOString(),
    actorUserId: args.actorUserId,
  });
  if (!plan.ok) return { kind: 'failed', failure: plan };
  return { kind: 'ok', plan };
}
