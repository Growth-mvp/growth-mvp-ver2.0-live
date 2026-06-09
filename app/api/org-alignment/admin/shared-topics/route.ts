// /app/api/org-alignment/admin/shared-topics/route.ts
import 'server-only';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

import { NextResponse, NextRequest } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabaseAdmin';
import { getAuthUserIdFromBearer, requireMembership } from '@/lib/server/rbacGuard';
import {
  getOrgAlignmentCasesForInsight,
  getLatestOrgAlignmentInsight,
} from '@/utils/supabase/org-alignment-server';
import {
  createSharedTopicDraft,
  checkExistingDraft,
} from '@/utils/supabase/org-alignment-shared-topics-server';

const ROUTE_TAG = 'app/api/org-alignment/admin/shared-topics';

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
 * POST /api/org-alignment/admin/shared-topics
 *
 * 管理者がAI論点から共有用下書きを作成する
 * 権限: admin のみ
 */
export async function POST(req: NextRequest) {
  console.log(`[HIT] ${ROUTE_TAG} POST`);

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
    const body = await req.json();
    const { insightIndex } = body;

    if (typeof insightIndex !== 'number' || insightIndex < 0) {
      return json({ error: 'Invalid insightIndex' }, 400);
    }

    // ===== 最新の集計結果を取得 =====
    const insight = await getLatestOrgAlignmentInsight(admin, companyId);
    if (!insight) {
      return json({ error: 'No insights found' }, 400);
    }

    if (!insight.insights || insight.insights.length <= insightIndex) {
      return json({ error: 'Invalid insight index' }, 400);
    }

    const targetInsight = insight.insights[insightIndex];
    const sourceInsightId = `${insight.id}-${insightIndex}`;

    // ===== 既に下書きが存在するか確認 =====
    const existingDraft = await checkExistingDraft(admin, companyId, sourceInsightId);
    if (existingDraft) {
      return json(
        {
          message: 'Draft already exists',
          topic: existingDraft,
        },
        200
      );
    }

    // ===== 下書きを作成 =====
    const sharedTopic = await createSharedTopicDraft(admin, companyId, targetInsight, sourceInsightId);

    console.log(`[${ROUTE_TAG}] Successfully created shared topic draft for company ${companyId}`);

    return json({ topic: sharedTopic }, 201);
  } catch (err: any) {
    console.error(`[ERROR] ${ROUTE_TAG}:`, err);
    const message = err?.message || String(err);

    return json({ error: message }, err?.status || 500);
  }
}
