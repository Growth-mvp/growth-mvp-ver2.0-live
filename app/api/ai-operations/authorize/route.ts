import 'server-only';
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { assertCompanyScopeByStrategyId, assertMinRole, getAuthUserIdFromBearer, requireMembership } from '@/lib/server/rbacGuard';
import { getSupabaseAdmin } from '@/lib/supabaseAdmin';
import { logAuditEvent } from '@/lib/server/auditLog';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 30;

const ID_MAX = 100;

const bodySchema = z.object({
  companyId: z.string().trim().min(1).max(ID_MAX),
  strategyId: z.string().trim().min(1).max(ID_MAX),
  operation: z.enum(['stage2.ceoIntent', 'stage1.revenue']),
  year: z.number().int().min(1900).max(2100).optional(),
});

const REQUIRED_ROLE = { 'stage2.ceoIntent': 'admin', 'stage1.revenue': 'manager' } as const;

/** 利用者が承認した入力案を保存する前に、認証・会社所属・権限・戦略の所属を再検証する。保存はしない */
export async function POST(req: Request) {
  try {
    const admin = getSupabaseAdmin();
    const userId = await getAuthUserIdFromBearer(admin, req);
    if (!userId) {
      return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
    }

    const parsed = bodySchema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) {
      return NextResponse.json({ error: 'invalid_payload' }, { status: 400 });
    }
    const body = parsed.data;

    const membership = await requireMembership(admin, userId, body.companyId);
    if (!membership || membership.companyId !== body.companyId) {
      return NextResponse.json({ error: 'forbidden' }, { status: 403 });
    }
    try {
      await assertMinRole(membership, REQUIRED_ROLE[body.operation]);
      await assertCompanyScopeByStrategyId(admin, membership, body.strategyId);
    } catch {
      return NextResponse.json({ error: 'forbidden' }, { status: 403 });
    }

    await logAuditEvent({
      companyId: body.companyId,
      actorUserId: userId,
      action: 'AI_OPERATION_APPROVED',
      targetType: 'strategy',
      targetId: body.strategyId,
      metadata: { operation: body.operation, ...(body.year !== undefined ? { year: body.year } : {}) },
    });

    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ error: 'server_error' }, { status: 500 });
  }
}
