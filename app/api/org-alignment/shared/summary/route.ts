// /app/api/org-alignment/shared/summary/route.ts
import 'server-only';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

import { NextResponse, NextRequest } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabaseAdmin';
import { getAuthUserIdFromBearer, requireMembership } from '@/lib/server/rbacGuard';

const ROUTE_TAG = 'app/api/org-alignment/shared/summary';

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
 * GET /api/org-alignment/shared/summary
 *
 * トップ画面用の軽量な集計サマリーを返す
 * 最新の org_alignment_insights に紐づく shared_topics の集計値
 * 権限: 同じ company のメンバーなら可能
 */
export async function GET(req: NextRequest) {
  console.log(`[HIT] ${ROUTE_TAG} GET`);

  try {
    const admin = getSupabaseAdmin();
    const userId = await getAuthUserIdFromBearer(admin, req);
    if (!userId) return json({ error: 'unauthorized' }, 401);

    const membership = await requireMembership(admin, userId);
    if (!membership) return json({ error: 'forbidden' }, 403);

    const companyId = membership.companyId;

    // ===== 1. 最新の org_alignment_insights を取得 =====
    const { data: latestInsight, error: insightError } = await admin
      .from('org_alignment_insights')
      .select('id, source_case_count, generated_at')
      .eq('company_id', companyId)
      .order('generated_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (insightError) {
      console.error(`[${ROUTE_TAG}] Failed to fetch latest insight:`, insightError);
      throw new Error(`Failed to fetch latest insight: ${insightError.message}`);
    }

    // インサイトが存在しない場合は0件を返す
    if (!latestInsight) {
      console.log(`[${ROUTE_TAG}] No insights found for company ${companyId}`);
      return json({
        sourceCaseCount: 0,
        topicCount: 0,
        counts: {
          published: 0,
          inAlignment: 0,
          actionPlanned: 0,
          reflected: 0,
          closed: 0,
          strategyReflectionCandidates: 0,
        },
        topTopics: [],
        latestGeneratedAt: null,
      });
    }

    // ===== 2. 最新のインサイトに紐づく shared_topics を全件取得 =====
    const { data: sharedTopics, error: topicsError } = await admin
      .from('org_alignment_shared_topics')
      .select('id, title, status, priority_score, strategy_reflection')
      .eq('company_id', companyId)
      .eq('source_alignment_insight_id', latestInsight.id)
      .in('status', ['published', 'in_alignment', 'action_planned', 'reflected', 'closed']);

    if (topicsError) {
      console.error(`[${ROUTE_TAG}] Failed to fetch shared topics:`, topicsError);
      throw new Error(`Failed to fetch shared topics: ${topicsError.message}`);
    }

    const topics = sharedTopics || [];

    // ===== 3. Status ごとに件数を集計 =====
    const counts = {
      published: 0,
      inAlignment: 0,
      actionPlanned: 0,
      reflected: 0,
      closed: 0,
      strategyReflectionCandidates: 0,
    };

    topics.forEach((topic: any) => {
      switch (topic.status) {
        case 'published':
          counts.published++;
          break;
        case 'in_alignment':
          counts.inAlignment++;
          break;
        case 'action_planned':
          counts.actionPlanned++;
          break;
        case 'reflected':
          counts.reflected++;
          break;
        case 'closed':
          counts.closed++;
          break;
      }

      // Strategy reflection 候補を判定
      if (topic.strategy_reflection) {
        const sr = topic.strategy_reflection;
        const isStage3Candidate =
          sr.stage3Status === '反映候補' || sr.stage3Status === '反映済み';
        const isStage4Candidate =
          sr.stage4Status === 'OKR化候補' || sr.stage4Status === 'OKR化済み';
        const hasProjects = Array.isArray(sr.generatedProjects) && sr.generatedProjects.length > 0;
        const hasOkrs = Array.isArray(sr.generatedOkrs) && sr.generatedOkrs.length > 0;

        if (isStage3Candidate || isStage4Candidate || hasProjects || hasOkrs) {
          counts.strategyReflectionCandidates++;
        }
      }
    });

    // ===== 4. Priority score が高い順に最大3件を取得 =====
    const topTopics = topics
      .filter((topic: any) => typeof topic.priority_score === 'number')
      .sort((a: any, b: any) => (b.priority_score || 0) - (a.priority_score || 0))
      .slice(0, 3)
      .map((topic: any) => ({
        id: topic.id,
        title: topic.title,
        priorityScore: topic.priority_score,
      }));

    console.log(`[${ROUTE_TAG}] Summary for company ${companyId}:`, {
      sourceCaseCount: latestInsight.source_case_count,
      topicCount: topics.length,
      counts,
      topTopicsCount: topTopics.length,
    });

    return json({
      sourceCaseCount: latestInsight.source_case_count,
      topicCount: topics.length,
      counts,
      topTopics,
      latestGeneratedAt: latestInsight.generated_at,
    });
  } catch (err: any) {
    console.error(`[ERROR] ${ROUTE_TAG}:`, err);
    const message = err?.message || String(err);
    return json({ error: message }, err?.status || 500);
  }
}
