// /app/api/stage3/strategy-book/confirm/route.ts
// STAGE3: 採用された変更案と新規プロジェクトを、正式データへ一括で反映して確定する。
// 検証はサーバーで行い、書き込みは stage3_confirm_strategy_book（DBの1トランザクション）で行う。
import 'server-only';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 30;

import { randomUUID } from 'node:crypto';
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { getSupabaseAdmin } from '@/lib/supabaseAdmin';
import { logAuditEvent } from '@/lib/server/auditLog';
import { failResponse } from '@/lib/server/stage3DepartmentWrite';
import { loadStrategyAccess } from '@/lib/server/stage3Adjustment';
import { confirmAtomically, loadWorkspace } from '@/lib/server/stage3StrategyBook';
import { verifyWorkspaceState, type NewProjectCandidate, type WorkspaceState } from '@/lib/cascade/stage3StrategyBook';
import { planConfirm, type ConfirmAdoption, type ConfirmProjectEdit, type ConfirmProjectRemoval } from '@/lib/cascade/stage3Confirm';
import { findProjectReferences } from '@/lib/server/stage3ProjectReferences';
import { departmentKeyOf } from '@/lib/cascade/stage3Adjustment';
import { settleLegacySelections } from '@/lib/cascade/stage3Settle';

type AnyRecord = Record<string, unknown>;

function departmentNameOf(departments: unknown, key: string): string {
  const list = Array.isArray(departments) ? departments : [];
  const hit = list.find((d) => d && typeof d === 'object' && departmentKeyOf(d as AnyRecord) === key) as AnyRecord | undefined;
  return typeof hit?.name === 'string' ? hit.name : key;
}

const BodySchema = z.object({
  companyId: z.string().uuid(),
  strategyId: z.string().uuid(),
  expectedRevision: z.number().int().min(0),
  expectedVersion: z.number().int().min(1),
});

const CONFIRM_ROLES = ['admin', 'manager'];

function findCandidate(state: WorkspaceState, candidateId: string): NewProjectCandidate | undefined {
  for (let i = state.drafts.length - 1; i >= 0; i -= 1) {
    const hit = state.drafts[i].newProjects.find((np) => np.candidateId === candidateId);
    if (hit) return hit;
  }
  return undefined;
}

export async function POST(req: Request) {
  try {
    const parsed = BodySchema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) return failResponse(400, 'invalid_request');
    const body = parsed.data;

    const admin = getSupabaseAdmin();
    const access = await loadStrategyAccess(admin, req, body);
    if (!access.ok) return failResponse(access.status, access.error);
    const { access: who } = access;
    if (!CONFIRM_ROLES.includes(who.role)) return failResponse(403, 'insufficient_role');
    if (who.revision !== body.expectedRevision) return failResponse(409, 'revision_changed');

    const loaded = await loadWorkspace(admin, body.strategyId);
    if (!loaded.ok) return failResponse(loaded.status, loaded.error);
    if (loaded.workspace.version !== body.expectedVersion) return failResponse(409, 'version_conflict');

    const verified = verifyWorkspaceState(loaded.workspace.state, who.departments);
    if (!verified.ok) return failResponse(409, verified.error);
    if (verified.state.status === 'confirmed') return failResponse(409, 'already_confirmed');
    const current = settleLegacySelections(verified.state, who.departments).state;

    const changes = current.selections
      .filter((s) => s.decision === 'applied')
      .map((s) => ({
        departmentKey: s.departmentKey,
        departmentName: s.departmentName,
        item: s.item,
        proposed: s.proposed,
        base: s.base,
      }));

    const adoptions: ConfirmAdoption[] = [];
    for (const ps of current.projectSelections.filter((p) => p.decision === 'applied')) {
      const candidate = findCandidate(current, ps.candidateId);
      if (!candidate) return failResponse(409, 'candidate_missing');
      adoptions.push({ departmentKey: ps.departmentKey, departmentName: ps.departmentName, project: candidate.project });
    }

    const projectEdits: ConfirmProjectEdit[] = current.projectEdits.map((e) => ({
      departmentKey: e.departmentKey,
      departmentName: departmentNameOf(who.departments, e.departmentKey),
      projectId: e.projectId,
      fields: e.fields,
      base: e.base,
    }));
    const projectRemovals: ConfirmProjectRemoval[] = current.projectRemovals.map((r) => ({
      departmentKey: r.departmentKey,
      departmentName: departmentNameOf(who.departments, r.departmentKey),
      projectId: r.projectId,
      base: r.base,
    }));
    const referencedProjectKeys = new Set<string>();
    if (projectRemovals.length > 0) {
      const refs = await findProjectReferences(admin, {
        companyId: body.companyId,
        strategyId: body.strategyId,
        projectIds: projectRemovals.map((r) => r.projectId),
      });
      if (!refs.ok) return failResponse(503, refs.error);
      for (const r of projectRemovals) {
        if ((refs.references[r.projectId] ?? []).length > 0) referencedProjectKeys.add(`${r.departmentKey} ${r.projectId}`);
      }
      if (referencedProjectKeys.size > 0) return failResponse(409, 'project_referenced');
    }

    const plan = planConfirm({
      departments: who.departments,
      changes,
      adoptions,
      projectEdits,
      projectRemovals,
      referencedProjectKeys,
      mintId: () => `p-${randomUUID()}`,
    });
    if (!plan.ok) {
      return NextResponse.json(
        { ok: false, error: plan.error, departmentName: plan.departmentName, item: plan.item },
        { status: 409 },
      );
    }

    const confirmedState: WorkspaceState = {
      ...current,
      status: 'confirmed',
      // 採用しなかった新規候補は保留として残し、後から再検討できるようにする
      projectSelections: current.projectSelections.map((p) => (p.decision === 'pending' ? { ...p, decision: 'deferred' } : p)),
      projectEdits: [],
      projectRemovals: [],
      confirmed: { confirmedAt: new Date().toISOString(), appliedCount: plan.appliedCount },
    };
    const finalCheck = verifyWorkspaceState(confirmedState, who.departments);
    if (!finalCheck.ok) return failResponse(409, finalCheck.error);

    const saved = await confirmAtomically(admin, {
      companyId: body.companyId,
      strategyId: body.strategyId,
      actorUserId: who.userId,
      expectedRevision: body.expectedRevision,
      expectedVersion: body.expectedVersion,
      departments: plan.departments,
      state: confirmedState,
    });
    if (!saved.ok) return failResponse(saved.status, saved.error);

    await logAuditEvent({
      companyId: body.companyId,
      actorUserId: who.userId,
      action: 'stage3_strategy_book_confirmed',
      targetType: 'strategy',
      targetId: body.strategyId,
      metadata: {
        appliedCount: plan.appliedCount,
        adoptedProjectIds: plan.adoptedProjectIds,
        revision: saved.revision,
      },
    });

    return NextResponse.json({
      ok: true,
      revision: saved.revision,
      version: saved.version,
      appliedCount: plan.appliedCount,
      adoptedProjectIds: plan.adoptedProjectIds,
    });
  } catch {
    return failResponse(500, 'internal_error');
  }
}
