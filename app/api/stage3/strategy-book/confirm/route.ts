// /app/api/stage3/strategy-book/confirm/route.ts
// STAGE3: 採用された変更案を、正式データへ一括で反映して確定する。
// 全件を検証してから、strategy_data.departments を1回の更新（revision 指定）で書く。作業状態の記録に失敗したら正式データを元に戻す。
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
import { loadWorkspace, saveWorkspace } from '@/lib/server/stage3StrategyBook';
import { verifyWorkspaceState } from '@/lib/cascade/stage3StrategyBook';
import { planConfirm } from '@/lib/cascade/stage3Confirm';

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

    const changes = verified.state.selections
      .filter((s) => s.decision === 'applied')
      .map((s) => ({
        departmentKey: s.departmentKey,
        departmentName: s.departmentName,
        item: s.item,
        proposed: s.proposed,
        base: s.base,
      }));

    const confirmedAt = new Date().toISOString();
    const confirmedState = {
      ...verified.state,
      status: 'confirmed' as const,
      confirmed: { confirmedAt, appliedCount: changes.length },
    };
    const finalCheck = verifyWorkspaceState(confirmedState, who.departments);
    if (!finalCheck.ok) return failResponse(409, finalCheck.error);

    const plan = planConfirm({
      departments: who.departments,
      changes,
      mintId: () => `p-${randomUUID()}`,
    });
    if (!plan.ok) {
      return NextResponse.json(
        { ok: false, error: plan.error, departmentName: plan.departmentName, item: plan.item },
        { status: 409 },
      );
    }

    const write = await admin
      .from('strategy_data')
      .update({ departments: plan.departments })
      .eq('id', body.strategyId)
      .eq('company_id', body.companyId)
      .eq('revision', body.expectedRevision)
      .select('id, revision');
    if (write.error) return failResponse(503, 'save_failed');
    if (!Array.isArray(write.data) || write.data.length === 0) return failResponse(409, 'revision_changed');
    const newRevision = Number(write.data[0].revision);

    const saved = await saveWorkspace(admin, {
      companyId: body.companyId,
      strategyId: body.strategyId,
      userId: who.userId,
      expectedVersion: body.expectedVersion,
      state: { ...confirmedState, confirmed: { confirmedAt, appliedCount: plan.appliedCount } },
    });
    if (!saved.ok) {
      const undo = await admin
        .from('strategy_data')
        .update({ departments: who.departments })
        .eq('id', body.strategyId)
        .eq('company_id', body.companyId)
        .eq('revision', newRevision)
        .select('id');
      if (undo.error || !Array.isArray(undo.data) || undo.data.length === 0) {
        return failResponse(500, 'confirm_rollback_failed');
      }
      return failResponse(503, 'confirm_rolled_back');
    }

    await logAuditEvent({
      companyId: body.companyId,
      actorUserId: who.userId,
      action: 'stage3_strategy_book_confirmed',
      targetType: 'strategy',
      targetId: body.strategyId,
      metadata: {
        appliedCount: plan.appliedCount,
        assignedProjectIds: plan.assignedProjectIds,
        revision: newRevision,
      },
    });

    return NextResponse.json({
      ok: true,
      revision: newRevision,
      version: saved.version,
      appliedCount: plan.appliedCount,
      assignedProjectIds: plan.assignedProjectIds,
    });
  } catch {
    return failResponse(500, 'internal_error');
  }
}
