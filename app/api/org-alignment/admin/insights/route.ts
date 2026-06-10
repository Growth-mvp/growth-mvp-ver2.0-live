// /app/api/org-alignment/admin/insights/route.ts
import 'server-only';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

import { NextResponse, NextRequest } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabaseAdmin';
import { getAuthUserIdFromBearer, requireMembership } from '@/lib/server/rbacGuard';
import {
  getLatestOrgAlignmentInsight,
  generateInsightKey,
  getInsightVisibilityCounts,
  getInsightSourceCases,
} from '@/utils/supabase/org-alignment-server';
import { findOrCreateSharedTopic } from '@/utils/supabase/org-alignment-shared-topics-server';

const ROUTE_TAG = 'app/api/org-alignment/admin/insights';

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
 * GET /api/org-alignment/admin/insights
 *
 * 最新の集計結果を取得
 * 権限: admin のみ
 */
export async function GET(req: NextRequest) {
  console.log(`[HIT] ${ROUTE_TAG} GET`);

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
    const latestInsight = await getLatestOrgAlignmentInsight(admin, companyId);

    if (!latestInsight) {
      return json({ insight: null, message: 'No insights found yet.' }, 200);
    }

    // ===== 各論点にvisibilityCounts、sourceCases、sharedTopicId を追加 =====
    const insightWithDetails = { ...latestInsight };

    if (Array.isArray(insightWithDetails.insights)) {
      for (let i = 0; i < insightWithDetails.insights.length; i++) {
        try {
          const insight = insightWithDetails.insights[i];
          const insightKey = generateInsightKey(insight, i);

          // visibilityCounts を取得
          const visibilityCounts = await getInsightVisibilityCounts(
            admin,
            latestInsight.id,
            insightKey
          );
          insightWithDetails.insights[i].visibilityCounts = visibilityCounts;

          // sourceCases を取得
          const sourceCases = await getInsightSourceCases(
            admin,
            latestInsight.id,
            insightKey
          );
          insightWithDetails.insights[i].sourceCases = sourceCases;
          insightWithDetails.insights[i].insightKey = insightKey;

          // sharedTopicId を取得（存在しなければ作成）
          try {
            const sharedTopic = await findOrCreateSharedTopic(
              admin,
              companyId,
              latestInsight.id,
              insightKey,
              insight
            );
            insightWithDetails.insights[i].sharedTopicId = sharedTopic.id;
          } catch (sharedTopicErr: any) {
            console.warn(
              `[${ROUTE_TAG}] Failed to find/create shared topic for insight ${i}:`,
              sharedTopicErr.message
            );
            // Continue without sharedTopicId if it fails
          }
        } catch (err: any) {
          console.warn(
            `[${ROUTE_TAG}] Failed to fetch details for insight ${i}:`,
            err.message
          );
          // Continue even if individual insight details fail to load
        }
      }
    }

    return json({ insight: insightWithDetails }, 200);
  } catch (err: any) {
    console.error(`[ERROR] ${ROUTE_TAG} GET:`, err);
    const message = err?.message || String(err);

    return json({ error: message }, 500);
  }
}
