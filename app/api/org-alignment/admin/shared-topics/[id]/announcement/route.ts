// /app/api/org-alignment/admin/shared-topics/[id]/announcement/route.ts
import 'server-only';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

import { NextResponse, NextRequest } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabaseAdmin';
import { getAuthUserIdFromBearer, requireMembership } from '@/lib/server/rbacGuard';
import { isValidUUID } from '@/lib/utils/isValidUUID';
import { requireAdminMfa } from '@/lib/server/mfaGuard';

const ROUTE_TAG = 'app/api/org-alignment/admin/shared-topics/[id]/announcement';

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
 * PATCH /api/org-alignment/admin/shared-topics/[id]/announcement
 *
 * 共有トピックに告知文を追加・更新
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

    const topicId = params.id;
    if (!isValidUUID(topicId)) return json({ error: 'invalid_id' }, 400);

    const { data: topic, error: fetchError } = await admin
      .from('org_alignment_shared_topics')
      .select('id, company_id, source_alignment_insight_id')
      .eq('id', topicId)
      .maybeSingle();

    if (fetchError) throw fetchError;
    if (!topic) return json({ error: 'Topic not found' }, 404);

    const companyId = topic.company_id as string;
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

    const { announcementText } = body;

    // announcementText のバリデーション
    if (typeof announcementText !== 'string') {
      return json({ error: 'announcementText must be a string' }, 400);
    }

    // ===== anonymous / manager_only の投稿者情報が含まれていないかチェック =====
    if (topic.source_alignment_insight_id && announcementText.trim()) {
      try {
        const { data: sourceCases, error: sourceCasesError } = await admin
          .from('org_alignment_insight_sources')
          .select('case_id, org_alignment_cases!inner(created_by, visibility_mode)')
          .eq('insight_id', topic.source_alignment_insight_id);

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

    // 告知を更新し、shared topic を published にする
    // 告知文が設定されたら、そのトピックは公開対象です
    const { data: updated, error: updateError } = await admin
      .from('org_alignment_shared_topics')
      .update({
        announcement_text: announcementText,
        announcement_updated_at: new Date().toISOString(),
        announcement_updated_by: userId,
        status: 'published',  // 告知文が設定されたら published に昇格
        published_at: new Date().toISOString(),
        published_by: userId,
        updated_at: new Date().toISOString(),
      })
      .eq('id', topicId)
      .eq('company_id', companyId)
      .select('id');

    if (updateError) {
      throw updateError;
    }

    if (!updated || updated.length === 0) {
      return json({ error: 'Topic not found' }, 404);
    }

    console.log(`[${ROUTE_TAG}] Successfully updated announcement for topic ${topicId}`);

    return json({ success: true }, 200);
  } catch (err: any) {
    console.error(`[ERROR] ${ROUTE_TAG} PATCH:`, err);
    const message = err?.message || String(err);

    return json({ error: message }, 500);
  }
}
