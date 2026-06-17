// /app/api/org-alignment/shared/topics/reset-reflection/route.ts
import 'server-only';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

import { NextResponse, NextRequest } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabaseAdmin';
import { getAuthUserIdFromBearer, requireMembership } from '@/lib/server/rbacGuard';

const ROUTE_TAG = 'app/api/org-alignment/shared/topics/reset-reflection';

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
 * PATCH /api/org-alignment/shared/topics/reset-reflection
 *
 * shared_topic_id に紐づく反映候補のうち、status='accepted' のものを 'pending' に戻す
 * status='rejected' の候補は復活させない
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
    const { shared_topic_id } = body;

    if (!shared_topic_id) {
      console.warn(`[${ROUTE_TAG}] Missing shared_topic_id`);
      return json({ error: 'shared_topic_id is required' }, 400);
    }

    console.log(`[${ROUTE_TAG}] Resetting reflection for shared_topic_id=${shared_topic_id}, companyId=${companyId}`);

    const now = new Date().toISOString();

    // First, get candidates to check current state
    const { data: candidates, error: fetchError } = await admin
      .from('org_alignment_stage_reflection_candidates')
      .select('id, status')
      .eq('company_id', companyId)
      .eq('shared_topic_id', shared_topic_id);

    console.log(`[${ROUTE_TAG}] Found candidates:`, candidates);

    if (fetchError) {
      console.error(`[${ROUTE_TAG}] Fetch error:`, fetchError);
      return json({ error: `Failed to fetch candidates: ${fetchError.message}` }, 500);
    }

    // Update all candidates (accepted or pending) to pending. Do NOT restore rejected ones.
    const { data: updateResult, error } = await admin
      .from('org_alignment_stage_reflection_candidates')
      .update({
        status: 'pending',
        updated_at: now,
      })
      .eq('company_id', companyId)
      .eq('shared_topic_id', shared_topic_id)
      .in('status', ['pending', 'accepted'])
      .select('id, status');

    if (error) {
      console.error(`[${ROUTE_TAG}] Update error:`, error);
      return json({ error: `Failed to reset reflection: ${error.message}` }, 500);
    }

    console.log(`[${ROUTE_TAG}] Successfully reset reflection for ${shared_topic_id}. Updated ${updateResult?.length || 0} candidates.`);
    console.log(`[${ROUTE_TAG}] Updated candidates:`, updateResult);

    // Verify the update by fetching candidates again
    const { data: afterReset } = await admin
      .from('org_alignment_stage_reflection_candidates')
      .select('id, target_stage, status')
      .eq('company_id', companyId)
      .eq('shared_topic_id', shared_topic_id);

    console.log(`[${ROUTE_TAG}] Candidates after reset:`, afterReset);

    return json({ success: true }, 200);
  } catch (err: any) {
    console.error(`[ERROR] ${ROUTE_TAG}:`, err);
    const message = err?.message || String(err);

    return json({ error: message }, err?.status || 500);
  }
}
