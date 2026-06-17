// /app/api/org-alignment/shared/topics/[id]/route.ts
import 'server-only';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

import { NextResponse, NextRequest } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabaseAdmin';
import { getAuthUserIdFromBearer, requireMembership } from '@/lib/server/rbacGuard';
import { getSharedTopicById, updateSharedTopicEditable } from '@/utils/supabase/org-alignment-shared-topics-server';

const ROUTE_TAG = 'app/api/org-alignment/shared/topics/[id]';

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
 * PATCH /api/org-alignment/shared/topics/[id]
 *
 * ユーザーがすり合わせ結果、変えること・変えないこと、次の対応を編集・保存する
 * 権限: 同じ company のメンバーなら可能
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

    const companyId = membership.companyId;
    const topicId = params.id;

    // ===== トピックの存在確認 =====
    const existingTopic = await getSharedTopicById(admin, companyId, topicId);
    if (!existingTopic) {
      return json({ error: 'Topic not found' }, 404);
    }

    const body = await req.json();
    const {
      alignment_result,
      changed_things,
      unchanged_things,
      next_actions,
      strategy_reflection,
      status,
      stage3_reflected_at,
      stage4_reflected_at,
    } = body;

    // ===== バリデーション =====
    // changed_things / unchanged_things は配列であることを確認
    if (changed_things !== undefined && !Array.isArray(changed_things)) {
      return json({ error: 'changed_things must be an array' }, 400);
    }
    if (unchanged_things !== undefined && !Array.isArray(unchanged_things)) {
      return json({ error: 'unchanged_things must be an array' }, 400);
    }
    if (next_actions !== undefined && !Array.isArray(next_actions)) {
      return json({ error: 'next_actions must be an array' }, 400);
    }

    // next_actions の各要素が正しい構造を持つか確認
    if (next_actions !== undefined) {
      for (const action of next_actions) {
        if (!action.title || typeof action.title !== 'string') {
          return json({ error: 'next_actions items must have a title (string)' }, 400);
        }
        if (!action.owner || typeof action.owner !== 'string') {
          return json({ error: 'next_actions items must have an owner (string)' }, 400);
        }
        if (!action.dueDate || typeof action.dueDate !== 'string') {
          return json({ error: 'next_actions items must have a dueDate (string)' }, 400);
        }
        const validStatuses = ['未着手', '対応中', '完了'];
        if (!validStatuses.includes(action.status)) {
          return json({ error: `next_actions status must be one of: ${validStatuses.join(', ')}` }, 400);
        }
      }
    }

    // ===== 更新処理 =====
    const updates: any = {};

    if (alignment_result !== undefined) {
      updates.alignment_result = alignment_result;
    }
    if (changed_things !== undefined) {
      updates.changed_things = changed_things;
    }
    if (unchanged_things !== undefined) {
      updates.unchanged_things = unchanged_things;
    }
    if (next_actions !== undefined) {
      updates.next_actions = next_actions;
    }
    if (strategy_reflection !== undefined) {
      updates.strategy_reflection = strategy_reflection;
    }
    if (status !== undefined) {
      const validStatuses = ['published', 'in_alignment', 'action_planned', 'reflected', 'closed', 'on_hold', 'hidden'];
      if (!validStatuses.includes(status)) {
        return json({ error: `Invalid status: ${status}` }, 400);
      }
      updates.status = status;
    }
    if (stage3_reflected_at !== undefined) {
      updates.stage3_reflected_at = stage3_reflected_at;
    }
    if (stage4_reflected_at !== undefined) {
      updates.stage4_reflected_at = stage4_reflected_at;
    }

    const updatedTopic = await updateSharedTopicEditable(admin, companyId, topicId, updates);

    console.log(`[${ROUTE_TAG}] Successfully updated shared topic ${topicId}`);

    return json({ topic: updatedTopic }, 200);
  } catch (err: any) {
    console.error(`[ERROR] ${ROUTE_TAG}:`, err);
    const message = err?.message || String(err);

    return json({ error: message }, err?.status || 500);
  }
}
