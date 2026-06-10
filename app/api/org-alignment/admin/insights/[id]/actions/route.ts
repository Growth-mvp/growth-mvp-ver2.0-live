// /app/api/org-alignment/admin/insights/[id]/actions/route.ts
import 'server-only';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

import { NextResponse, NextRequest } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabaseAdmin';
import { getAuthUserIdFromBearer, requireMembership } from '@/lib/server/rbacGuard';

const ROUTE_TAG = 'app/api/org-alignment/admin/insights/[id]/actions';

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
 * PATCH /api/org-alignment/admin/insights/[id]/actions
 *
 * 論点の次アクション（nextActions）を更新
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

    const insightId = params.id;

    // リクエストボディを取得
    let body: any;
    try {
      body = await req.json();
    } catch {
      return json({ error: 'Invalid JSON body' }, 400);
    }

    const { insightIndex, nextActions } = body;

    // バリデーション
    if (typeof insightIndex !== 'number' || insightIndex < 0) {
      return json({ error: 'insightIndex must be a non-negative number' }, 400);
    }

    if (!Array.isArray(nextActions)) {
      return json({ error: 'nextActions must be an array' }, 400);
    }

    // org_alignment_insights から現在のinsightsを取得
    const { data: insight, error: fetchError } = await admin
      .from('org_alignment_insights')
      .select('insights')
      .eq('id', insightId)
      .single();

    if (fetchError || !insight) {
      return json({ error: 'Insight not found' }, 404);
    }

    const insights = Array.isArray(insight.insights) ? insight.insights : [];

    // insightIndex が範囲外か確認
    if (insightIndex >= insights.length) {
      return json(
        {
          error: `insightIndex ${insightIndex} is out of bounds (insights.length=${insights.length})`,
        },
        400
      );
    }

    // 対象のinsightを更新
    const updatedInsights = insights.map((ins: any, idx: number) =>
      idx === insightIndex
        ? {
            ...ins,
            nextActions: nextActions,
          }
        : ins
    );

    // DBに保存
    const { error: updateError } = await admin
      .from('org_alignment_insights')
      .update({
        insights: updatedInsights,
        updated_at: new Date().toISOString(),
      })
      .eq('id', insightId);

    if (updateError) {
      throw updateError;
    }

    console.log(
      `[${ROUTE_TAG}] Successfully updated nextActions for insight ${insightIndex}`
    );

    return json({ success: true }, 200);
  } catch (err: any) {
    console.error(`[ERROR] ${ROUTE_TAG} PATCH:`, err);
    const message = err?.message || String(err);

    return json({ error: message }, 500);
  }
}
