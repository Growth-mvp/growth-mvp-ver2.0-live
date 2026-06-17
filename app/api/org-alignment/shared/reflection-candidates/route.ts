// /app/api/org-alignment/shared/reflection-candidates/route.ts
import 'server-only';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

import { NextResponse, NextRequest } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabaseAdmin';
import { getAuthUserIdFromBearer, requireMembership } from '@/lib/server/rbacGuard';
import { getPendingReflectionCandidates, updateReflectionCandidateStatus } from '@/utils/supabase/org-alignment-stage-reflection-candidates-server';

const ROUTE_TAG = 'app/api/org-alignment/shared/reflection-candidates';

function json(res: any, status = 200) {
  return new NextResponse(JSON.stringify(res), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
      'X-GROWTH-Route': ROUTE_TAG,
    },
  });
}

/**
 * GET /api/org-alignment/shared/reflection-candidates?target_stage=stage3|stage4
 *
 * pending状態の反映候補を取得する
 * 権限: 同じ company のメンバーなら可能
 */
export async function GET(req: NextRequest) {
  console.log(`[HIT] ${ROUTE_TAG} GET`);

  try {
    const admin = getSupabaseAdmin();
    const userId = await getAuthUserIdFromBearer(admin, req);
    if (!userId) return json({ error: 'unauthorized' }, 401);

    const membership = await requireMembership(admin, userId);
    if (!membership) return json({ error: 'forbidden' }, 403);

    const companyId = membership.companyId;
    const targetStage = req.nextUrl.searchParams.get('target_stage') as 'stage3' | 'stage4' | null;

    if (!targetStage || !['stage3', 'stage4'].includes(targetStage)) {
      return json({ error: 'target_stage must be stage3 or stage4' }, 400);
    }

    const candidates = await getPendingReflectionCandidates(admin, companyId, targetStage);

    console.log(`[${ROUTE_TAG}] Retrieved ${candidates.length} candidates for ${targetStage}`);

    return json({ candidates }, 200);
  } catch (err: any) {
    console.error(`[ERROR] ${ROUTE_TAG}:`, err);
    const message = err?.message || String(err);

    return json({ error: message }, err?.status || 500);
  }
}

/**
 * PATCH /api/org-alignment/shared/reflection-candidates/[id]
 *
 * 反映候補のステータスを更新する
 * 権限: 同じ company のメンバーなら可能
 */
export async function PATCH(req: NextRequest) {
  console.log(`[HIT] ${ROUTE_TAG} PATCH`);

  try {
    const admin = getSupabaseAdmin();
    const userId = await getAuthUserIdFromBearer(admin, req);
    if (!userId) {
      console.warn(`[${ROUTE_TAG}] No userId found`);
      return json({ error: 'unauthorized' }, 401);
    }

    const membership = await requireMembership(admin, userId);
    if (!membership) {
      console.warn(`[${ROUTE_TAG}] No membership found for userId ${userId}`);
      return json({ error: 'forbidden' }, 403);
    }

    const companyId = membership.companyId;

    const body = await req.json();
    const { id: candidateId, status } = body;

    console.log(`[${ROUTE_TAG}] PATCH request: candidateId=${candidateId}, status=${status}, companyId=${companyId}`);

    if (!candidateId || !status) {
      console.warn(`[${ROUTE_TAG}] Missing candidateId or status`);
      return json({ error: 'id and status are required' }, 400);
    }

    if (!['pending', 'accepted', 'rejected'].includes(status)) {
      console.warn(`[${ROUTE_TAG}] Invalid status: ${status}`);
      return json({ error: 'Invalid status' }, 400);
    }

    const finalStatus = status === 'rejected' ? 'rejected' : status;

    console.log(`[${ROUTE_TAG}] Calling updateReflectionCandidateStatus...`);
    const updated = await updateReflectionCandidateStatus(admin, companyId, candidateId, finalStatus);

    console.log(`[${ROUTE_TAG}] Updated candidate ${candidateId} to ${finalStatus}:`, updated);

    return json({ candidate: updated }, 200);
  } catch (err: any) {
    console.error(`[ERROR] ${ROUTE_TAG}:`, err);
    const message = err?.message || String(err);
    console.error(`[ERROR] ${ROUTE_TAG} details:`, { message, stack: err?.stack });

    return json({ error: message }, err?.status || 500);
  }
}
