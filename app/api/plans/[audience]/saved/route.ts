import 'server-only';

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';

import { getAuthUserIdFromBearer, requireMembership } from '@/lib/server/rbacGuard';
import { getSupabaseAdmin } from '@/lib/supabaseAdmin';
import { assertStrategyInCompany, findSavedPlan } from '@/utils/supabase/generated-plans';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * /app/api/plans/[audience]/saved/route.ts
 *
 * 保存済み計画書の取得。全ロール（admin / manager / member）が閲覧可能。
 * 会社・戦略・audience を検証し、他社の計画書を返さない。
 */

const SavedRequestSchema = z.object({
  companyId: z.string().uuid(),
  strategyId: z.string().uuid(),
  audience: z.enum(['bank', 'shareholder', 'employee']),
});

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ audience: string }> }
) {
  try {
    const admin = getSupabaseAdmin();

    const userId = await getAuthUserIdFromBearer(admin, req);
    if (!userId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const parsed = SavedRequestSchema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) {
      return NextResponse.json({ error: 'Invalid input' }, { status: 400 });
    }
    const scope = parsed.data;

    const { audience: urlAudience } = await params;
    if (urlAudience !== scope.audience) {
      return NextResponse.json({ error: 'Audience mismatch' }, { status: 400 });
    }

    const membership = await requireMembership(admin, userId, scope.companyId);
    if (!membership) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const strategyInCompany = await assertStrategyInCompany(admin, scope.companyId, scope.strategyId);
    if (!strategyInCompany) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const plan = await findSavedPlan(admin, scope);
    if (!plan) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }

    return NextResponse.json({
      status: 'saved',
      audience: scope.audience,
      companyId: scope.companyId,
      strategyId: scope.strategyId,
      generatedText: plan.generatedText,
      sections: plan.sections,
      generatedAt: plan.generatedAt,
      version: plan.version,
      updatedAt: plan.updatedAt,
    });
  } catch (err) {
    console.error('[Plans Saved] Failed to load saved plan', {
      error: err instanceof Error ? err.message : String(err),
    });
    return NextResponse.json({ error: 'Failed to load plan' }, { status: 500 });
  }
}
