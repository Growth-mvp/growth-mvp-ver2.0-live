// /app/api/stage3/strategy-book/route.ts
// STAGE3: 事業・部門戦略書の作業状態（未確定の草案・調整・対話・選択）の読み書き。正式データ（strategy_data）は変更しない。
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
import { loadWorkspace, saveWorkspace } from '@/lib/server/stage3StrategyBook';
import { verifyWorkspaceState, WorkspaceStateSchema } from '@/lib/cascade/stage3StrategyBook';
import { settleLegacySelections } from '@/lib/cascade/stage3Settle';

const IdsSchema = z.object({ companyId: z.string().uuid(), strategyId: z.string().uuid() });

const PutSchema = IdsSchema.extend({
  expectedVersion: z.number().int().min(0),
  state: z.unknown(),
});

const CONFIRM_ROLES = ['admin', 'manager'];

export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const parsed = IdsSchema.safeParse({
      companyId: url.searchParams.get('companyId'),
      strategyId: url.searchParams.get('strategyId'),
    });
    if (!parsed.success) return failResponse(400, 'invalid_request');

    const admin = getSupabaseAdmin();
    const access = await loadStrategyAccess(admin, req, parsed.data);
    if (!access.ok) return failResponse(access.status, access.error);

    const stage2Access = access.access.stage2;
    const stage2 = {
      stage2Status: stage2Access.status,
      companyStrategy: stage2Access.status === 'confirmed' ? stage2Access.companyStrategy : null,
      stage2PendingChanges: stage2Access.status === 'confirmed' ? stage2Access.pendingChanges : false,
    };
    const loaded = await loadWorkspace(admin, parsed.data.strategyId);
    if (!loaded.ok) {
      return NextResponse.json({ ok: false, error: loaded.error, ...stage2 }, { status: loaded.status });
    }
    const settled = settleLegacySelections(loaded.workspace.state, access.access.departments);
    return NextResponse.json({
      ok: true,
      version: loaded.workspace.version,
      state: settled.state,
      legacySettled: settled.counts,
      revision: access.access.revision,
      ...stage2,
    });
  } catch {
    return failResponse(500, 'internal_error');
  }
}

export async function PUT(req: Request) {
  try {
    const parsed = PutSchema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) return failResponse(400, 'invalid_request');
    const body = parsed.data;

    const admin = getSupabaseAdmin();
    const access = await loadStrategyAccess(admin, req, body);
    if (!access.ok) return failResponse(access.status, access.error);

    const shape = WorkspaceStateSchema.safeParse(body.state);
    if (!shape.success) return failResponse(400, 'invalid_state');
    if (shape.data.status === 'confirmed' && !CONFIRM_ROLES.includes(access.access.role)) {
      return failResponse(403, 'insufficient_role');
    }

    const verified = verifyWorkspaceState(body.state, access.access.departments);
    if (!verified.ok) return failResponse(400, verified.error);

    const saved = await saveWorkspace(admin, {
      companyId: body.companyId,
      strategyId: body.strategyId,
      userId: access.access.userId,
      expectedVersion: body.expectedVersion,
      state: verified.state,
    });
    if (!saved.ok) return failResponse(saved.status, saved.error);

    await logAuditEvent({
      companyId: body.companyId,
      actorUserId: access.access.userId,
      action: 'stage3_strategy_book_saved',
      targetType: 'strategy',
      targetId: body.strategyId,
      metadata: {
        version: saved.version,
        status: verified.state.status,
        draftCount: verified.state.drafts.length,
        selectionCount: verified.state.selections.length,
      },
    });

    return NextResponse.json({ ok: true, version: saved.version });
  } catch {
    return failResponse(500, 'internal_error');
  }
}
