// /app/api/org-alignment/admin/insights/[id]/actions/route.ts
import 'server-only';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

import { NextResponse, NextRequest } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabaseAdmin';
import { getAuthUserIdFromBearer, requireMembership } from '@/lib/server/rbacGuard';
import { isValidUUID } from '@/lib/utils/isValidUUID';
import { requireAdminMfa } from '@/lib/server/mfaGuard';

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
    const mfa = await requireAdminMfa(admin, req);
    if (!mfa.ok) return NextResponse.json({ error: mfa.error }, { status: mfa.status });
    const userId = await getAuthUserIdFromBearer(admin, req);
    if (!userId) return json({ error: 'unauthorized' }, 401);

    const insightId = params.id;
    if (!isValidUUID(insightId)) return json({ error: 'invalid_id' }, 400);

    const { data: insight, error: fetchError } = await admin
      .from('org_alignment_insights')
      .select('id, company_id, insights')
      .eq('id', insightId)
      .maybeSingle();

    if (fetchError) throw fetchError;
    if (!insight) return json({ error: 'Insight not found' }, 404);

    const companyId = insight.company_id as string;
    const membership = await requireMembership(admin, userId, companyId);
    if (!membership || membership.role !== 'admin') {
      return json({ error: 'Access denied. Admin role required.' }, 403);
    }

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

    // DBに保存（権限確認済みの会社に限定して更新）
    const { data: updated, error: updateError } = await admin
      .from('org_alignment_insights')
      .update({
        insights: updatedInsights,
        updated_at: new Date().toISOString(),
      })
      .eq('id', insightId)
      .eq('company_id', companyId)
      .select('id');

    if (updateError) {
      throw updateError;
    }

    if (!updated || updated.length === 0) {
      return json({ error: 'Insight not found' }, 404);
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
