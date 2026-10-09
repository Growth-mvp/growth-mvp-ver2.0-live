// /app/api/org-alignment/shared/topics/route.ts
import 'server-only';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

import { NextResponse, NextRequest } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabaseAdmin';
import { getAuthUserIdFromBearer, requireMembership } from '@/lib/server/rbacGuard';
import { getPublishedSharedTopics } from '@/utils/supabase/org-alignment-shared-topics-server';

const ROUTE_TAG = 'app/api/org-alignment/shared/topics';

function json(res: any, status = 200) {
  return new NextResponse(JSON.stringify(res), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'max-age=60',
      'X-GROWTH-Route': ROUTE_TAG,
    },
  });
}

/**
 * GET /api/org-alignment/shared/topics
 *
 * 全社すり合わせルームに表示する公開済み論点を取得する
 * 権限: 同じ company のメンバーなら可能
 */
export async function GET(req: NextRequest) {
  console.log(`[HIT] ${ROUTE_TAG} GET`);

  try {
    const admin = getSupabaseAdmin();
    const userId = await getAuthUserIdFromBearer(admin, req);
    if (!userId) return json({ error: 'unauthorized' }, 401);

    // Extract companyId from query parameter (required)
    const url = new URL(req.url);
    const queryCompanyId = url.searchParams.get('companyId');

    // companyId is required - reject if missing, empty, or invalid
    if (!queryCompanyId || queryCompanyId.trim() === '') {
      console.log(`[${ROUTE_TAG}] Missing or empty companyId`);
      return json({ error: 'companyId is required' }, 400);
    }

    const membership = await requireMembership(admin, userId, queryCompanyId);
    if (!membership) {
      console.log(`[${ROUTE_TAG}] User ${userId} does not belong to company ${queryCompanyId}`);
      return json({ error: 'forbidden' }, 403);
    }

    const companyId = membership.companyId;

    // ===== 公開済み論点を取得 =====
    const topics = await getPublishedSharedTopics(admin, companyId);

    console.log(`[${ROUTE_TAG}] Retrieved ${topics.length} published topics for company ${companyId}`);

    return json({ topics }, 200);
  } catch (err: any) {
    console.error(`[ERROR] ${ROUTE_TAG}:`, err);
    const message = err?.message || String(err);

    return json({ error: message }, err?.status || 500);
  }
}
