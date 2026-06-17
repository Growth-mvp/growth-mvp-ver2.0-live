// /app/api/org-alignment/shared/topics/[id]/reflection-candidates/route.ts
import 'server-only';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

import { NextResponse, NextRequest } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabaseAdmin';
import { getAuthUserIdFromBearer, requireMembership } from '@/lib/server/rbacGuard';
import { getSharedTopicById, updateSharedTopicEditable } from '@/utils/supabase/org-alignment-shared-topics-server';
import { createReflectionCandidates } from '@/utils/supabase/org-alignment-stage-reflection-candidates-server';

const ROUTE_TAG = 'app/api/org-alignment/shared/topics/[id]/reflection-candidates';

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
 * POST /api/org-alignment/shared/topics/[id]/reflection-candidates
 *
 * 戦略展開の反映候補をテーブルに登録し、shared topic側も更新する
 * 権限: 同じ company のメンバーなら可能
 */
export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  console.log(`[HIT] ${ROUTE_TAG} POST`);

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
    const { target_stage } = body;

    if (!target_stage || !['stage3', 'stage4'].includes(target_stage)) {
      return json({ error: 'target_stage must be stage3 or stage4' }, 400);
    }

    if (!existingTopic.strategy_reflection) {
      return json({ error: 'No strategy reflection data found' }, 400);
    }

    // ===== 反映候補を作成 =====
    const candidates = await createReflectionCandidates(
      admin,
      companyId,
      topicId,
      target_stage as 'stage3' | 'stage4',
      existingTopic.strategy_reflection
    );

    if (candidates.length === 0) {
      return json({ error: 'No candidates to create' }, 400);
    }

    // ===== shared topic の状態を更新 =====
    const strategyReflection = { ...existingTopic.strategy_reflection };
    if (target_stage === 'stage3') {
      strategyReflection.stage3Status = '反映候補';
      strategyReflection.stage3Confirmed = false;
    } else if (target_stage === 'stage4') {
      strategyReflection.stage4Status = '実行計画への反映候補';
      strategyReflection.stage4Confirmed = false;
    }

    // stage3/4_reflected_at を更新
    const updates: any = {
      strategy_reflection: strategyReflection,
    };

    if (target_stage === 'stage3') {
      updates.stage3_reflected_at = new Date().toISOString();
    } else if (target_stage === 'stage4') {
      updates.stage4_reflected_at = new Date().toISOString();
    }

    const updatedTopic = await updateSharedTopicEditable(admin, companyId, topicId, updates);

    console.log(`[${ROUTE_TAG}] Successfully created ${candidates.length} reflection candidates for topic ${topicId}`);

    return json({ candidates, topic: updatedTopic }, 200);
  } catch (err: any) {
    console.error(`[ERROR] ${ROUTE_TAG}:`, err);
    const message = err?.message || String(err);

    return json({ error: message }, err?.status || 500);
  }
}
