// /app/api/org-alignment/admin/shared-topics/[id]/route.ts
import 'server-only';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

import { NextResponse, NextRequest } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabaseAdmin';
import { getAuthUserIdFromBearer, requireMembership } from '@/lib/server/rbacGuard';
import { getSharedTopicById, updateSharedTopic } from '@/utils/supabase/org-alignment-shared-topics-server';

const ROUTE_TAG = 'app/api/org-alignment/admin/shared-topics/[id]';

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
 * PATCH /api/org-alignment/admin/shared-topics/[id]
 *
 * 管理者がステータスや公開状態を更新する
 * 権限: admin のみ
 */
export async function PATCH(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  console.log(`[HIT] ${ROUTE_TAG} PATCH`);

  try {
    const admin = getSupabaseAdmin();
    const userId = await getAuthUserIdFromBearer(admin, req);
    if (!userId) return json({ error: 'unauthorized' }, 401);

    const membership = await requireMembership(admin, userId);
    if (!membership) return json({ error: 'forbidden' }, 403);

    // admin ロール必須
    if (membership.role !== 'admin') {
      return json({ error: 'Access denied. Admin role required.' }, 403);
    }

    const companyId = membership.companyId;
    const topicId = params.id;

    // ===== トピックの存在確認 =====
    const existingTopic = await getSharedTopicById(admin, companyId, topicId);
    if (!existingTopic) {
      return json({ error: 'Topic not found' }, 404);
    }

    const body = await req.json();
    const { status, visibility } = body;

    if (!status && !visibility) {
      return json({ error: 'At least one field (status or visibility) must be provided' }, 400);
    }

    // ===== 更新処理 =====
    const updates: any = {};

    if (status) {
      const validStatuses = ['draft', 'published', 'in_alignment', 'action_planned', 'reflected_to_strategy', 'closed'];
      if (!validStatuses.includes(status)) {
        return json({ error: `Invalid status: ${status}` }, 400);
      }
      updates.status = status;
    }

    if (visibility) {
      const validVisibilities = ['company', 'draft'];
      if (!validVisibilities.includes(visibility)) {
        return json({ error: `Invalid visibility: ${visibility}` }, 400);
      }
      updates.visibility = visibility;
    }

    // When publishing, set published_by and published_at
    if (status === 'published' || visibility === 'company') {
      if (!existingTopic.published_by) {
        updates.published_by = userId;
        updates.published_at = new Date().toISOString();
      }
    }

    const updatedTopic = await updateSharedTopic(admin, companyId, topicId, updates);

    console.log(`[${ROUTE_TAG}] Successfully updated shared topic ${topicId}`);

    return json({ topic: updatedTopic }, 200);
  } catch (err: any) {
    console.error(`[ERROR] ${ROUTE_TAG}:`, err);
    const message = err?.message || String(err);

    return json({ error: message }, err?.status || 500);
  }
}
