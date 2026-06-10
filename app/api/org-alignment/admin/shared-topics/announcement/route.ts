// /app/api/org-alignment/admin/shared-topics/announcement/route.ts
import 'server-only';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

import { NextResponse, NextRequest } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabaseAdmin';
import { getAuthUserIdFromBearer, requireMembership } from '@/lib/server/rbacGuard';
import {
  getLatestOrgAlignmentInsight,
  generateInsightKey,
} from '@/utils/supabase/org-alignment-server';
import {
  createSharedTopicDraft,
  checkExistingDraft,
} from '@/utils/supabase/org-alignment-shared-topics-server';

const ROUTE_TAG = 'app/api/org-alignment/admin/shared-topics/announcement';

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
 * PATCH /api/org-alignment/admin/shared-topics/announcement
 *
 * insightId と insightIndex から shared topic を検索・作成し、告知文を設定
 * 権限: admin のみ
 */
export async function PATCH(req: NextRequest) {
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

    // リクエストボディを取得
    let body: any;
    try {
      body = await req.json();
    } catch {
      return json({ error: 'Invalid JSON body' }, 400);
    }

    const { insightId, insightIndex, announcementText } = body;

    // バリデーション
    if (typeof insightId !== 'string' || !insightId) {
      return json({ error: 'insightId must be a non-empty string' }, 400);
    }

    if (typeof insightIndex !== 'number' || insightIndex < 0) {
      return json({ error: 'insightIndex must be a non-negative number' }, 400);
    }

    if (typeof announcementText !== 'string') {
      return json({ error: 'announcementText must be a string' }, 400);
    }

    // ===== 最新の集計結果を取得してバリデーション =====
    const insight = await getLatestOrgAlignmentInsight(admin, companyId);
    if (!insight) {
      return json({ error: 'No insights found' }, 404);
    }

    if (!insight.insights || insight.insights.length <= insightIndex) {
      return json({ error: 'Invalid insight index' }, 404);
    }

    if (insight.id !== insightId) {
      return json({ error: 'Insight ID mismatch' }, 400);
    }

    const targetInsight = insight.insights[insightIndex];
    const sourceInsightId = `${insightId}-${insightIndex}`;

    // ===== 既に shared topic が存在するか確認 =====
    let existingTopic = await checkExistingDraft(admin, companyId, sourceInsightId);

    let topicId: string;

    if (existingTopic) {
      topicId = existingTopic.id;
    } else {
      // shared topic が存在しない場合は作成
      existingTopic = await createSharedTopicDraft(
        admin,
        companyId,
        targetInsight,
        sourceInsightId
      );
      topicId = existingTopic.id;
    }

    // ===== anonymous / manager_only の投稿者情報が含まれていないかチェック =====
    if (announcementText.trim()) {
      try {
        // insightKey を生成
        const insightKey = generateInsightKey(targetInsight, insightIndex);

        // org_alignment_insight_sources から related cases を取得
        const { data: sourceCases, error: sourceCasesError } = await admin
          .from('org_alignment_insight_sources')
          .select('case_id, org_alignment_cases!inner(created_by, visibility_mode)')
          .eq('insight_id', insightId)
          .eq('insight_key', insightKey);

        if (!sourceCasesError && sourceCases) {
          // anonymous と manager_only の cases から投稿者情報を取得
          const restrictedCaseIds = sourceCases
            .filter((row: any) => {
              const visibilityMode = row.org_alignment_cases?.visibility_mode;
              return visibilityMode === 'anonymous' || visibilityMode === 'manager_only';
            })
            .map((row: any) => row.org_alignment_cases?.created_by)
            .filter(Boolean);

          // 投稿者情報を取得
          if (restrictedCaseIds.length > 0) {
            const { data: userProfiles, error: userError } = await admin
              .from('profiles')
              .select('id, full_name, email')
              .in('id', restrictedCaseIds);

            if (!userError && userProfiles) {
              const restrictedInfo: string[] = [];

              for (const profile of userProfiles) {
                if (profile.full_name) restrictedInfo.push(profile.full_name);
                if (profile.email) restrictedInfo.push(profile.email);
              }

              // announcementText に含まれているかチェック
              const textLower = announcementText.toLowerCase();
              for (const info of restrictedInfo) {
                if (textLower.includes(info.toLowerCase())) {
                  return json(
                    {
                      error:
                        'anonymous / manager_only の投稿者名またはメールアドレスが告知文に含まれています。削除してから公開してください。',
                    },
                    400
                  );
                }
              }
            }
          }
        }
      } catch (checkErr: any) {
        console.warn(`[${ROUTE_TAG}] Failed to validate user info in announcement:`, checkErr.message);
        // チェック失敗時は続行
      }
    }

    // 告知を更新
    const { error: updateError } = await admin
      .from('org_alignment_shared_topics')
      .update({
        announcement_text: announcementText,
        announcement_updated_at: new Date().toISOString(),
        announcement_updated_by: userId,
        updated_at: new Date().toISOString(),
      })
      .eq('id', topicId);

    if (updateError) {
      throw updateError;
    }

    console.log(`[${ROUTE_TAG}] Successfully updated announcement for shared topic ${topicId}`);

    return json({ success: true, topicId }, 200);
  } catch (err: any) {
    console.error(`[ERROR] ${ROUTE_TAG} PATCH:`, err);
    const message = err?.message || String(err);

    return json({ error: message }, 500);
  }
}
