// /app/api/stage3/strategy-book/confirm/route.ts
// STAGE3: 採用された変更案と新規プロジェクトを、正式データへ一括で反映して確定する。
// 検証はサーバーで行い、書き込みは stage3_confirm_strategy_book（DBの1トランザクション）で行う。
import 'server-only';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 30;

import { NextResponse } from 'next/server';
import { z } from 'zod';
import { getSupabaseAdmin } from '@/lib/supabaseAdmin';
import { logAuditEvent } from '@/lib/server/auditLog';
import { failResponse } from '@/lib/server/stage3DepartmentWrite';
import { loadStrategyAccess } from '@/lib/server/stage3Adjustment';
import { confirmAtomically, loadWorkspace } from '@/lib/server/stage3StrategyBook';
import { verifyWorkspaceState, type WorkspaceState } from '@/lib/cascade/stage3StrategyBook';
import { buildConfirmPlan } from '@/lib/server/stage3ConfirmPlan';
import { settleLegacySelections } from '@/lib/cascade/stage3Settle';

const BodySchema = z.object({
  companyId: z.string().uuid(),
  strategyId: z.string().uuid(),
  expectedRevision: z.number().int().min(0),
  expectedVersion: z.number().int().min(1),
});

const CONFIRM_ROLES = ['admin', 'manager'];

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

    const built = await buildConfirmPlan(admin, {
      companyId: body.companyId,
      strategyId: body.strategyId,
      state: current,
      departments: who.departments,
      actorUserId: who.userId,
    });
    if (built.kind === 'error') return failResponse(built.status, built.error);
    if (built.kind === 'failed') {
      return NextResponse.json(
        { ok: false, error: built.failure.error, departmentName: built.failure.departmentName, item: built.failure.item },
        { status: 409 },
      );
    }
    const plan = built.plan;

    const confirmedState: WorkspaceState = {
      ...current,
      status: 'confirmed',
      // 確定した採否は正式データに反映済みのため保留に戻す。採用しなかった候補も、後から再検討できるよう保留として残す
      projectSelections: current.projectSelections.map((p) =>
        p.decision === 'deferred' ? p : { ...p, decision: 'deferred' },
      ),
      projectEdits: [],
      projectRemovals: [],
      projectProposals: [],
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
        editedProjectCount: plan.editedProjectCount,
        adoptedProjectIds: plan.adoptedProjectIds,
        excludedProjectIds: plan.excludedProjectIds,
        revision: saved.revision,
      },
    });

    return NextResponse.json({
      ok: true,
      revision: saved.revision,
      version: saved.version,
      appliedCount: plan.appliedCount,
      adoptedProjectIds: plan.adoptedProjectIds,
      excludedProjectIds: plan.excludedProjectIds,
    });
  } catch {
    return failResponse(500, 'internal_error');
  }
}
