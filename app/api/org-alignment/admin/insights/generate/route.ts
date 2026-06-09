// /app/api/org-alignment/admin/insights/generate/route.ts
import 'server-only';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

import { NextResponse, NextRequest } from 'next/server';
import OpenAI from 'openai';
import { getSupabaseAdmin } from '@/lib/supabaseAdmin';
import { getAuthUserIdFromBearer, requireMembership } from '@/lib/server/rbacGuard';
import {
  getOrgAlignmentCasesForInsight,
  saveOrgAlignmentInsight,
} from '@/utils/supabase/org-alignment-server';
import { createSharedTopicFromInsight } from '@/utils/supabase/org-alignment-shared-topics-server';
import { getFullStrategyDataByCompany } from '@/utils/supabase/strategy';
import type {
  OrgAlignmentInsightDashboard,
} from '@/types/org-alignment';

const ROUTE_TAG = 'app/api/org-alignment/admin/insights/generate';

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

function cleanApiKey(raw?: string | null): string {
  return (raw ?? '')
    .replace(/[\u200B-\u200D\uFEFF]/g, '')
    .replace(/\r?\n|\r/g, '')
    .trim();
}

function safeJsonParse(text: string): any | null {
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    const match = text.match(/\{[\s\S]*\}/);
    if (!match) return null;
    try {
      return JSON.parse(match[0]);
    } catch {
      return null;
    }
  }
}

/**
 * POST /api/org-alignment/admin/insights/generate
 *
 * AI集計を実行し、結果を保存
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

    // ===== 1. org_alignment_cases を取得 =====
    const cases = await getOrgAlignmentCasesForInsight(admin, companyId);

    if (cases.length === 0) {
      return json(
        {
          error: 'No cases found for this company. Please submit at least one case before generating insights.',
        },
        400
      );
    }

    console.log(`[${ROUTE_TAG}] Found ${cases.length} cases for company ${companyId}`);

    // ===== 2. strategy_data から部門情報を取得 =====
    let departments: any[] = [];
    try {
      const { data: strategyData } = await getFullStrategyDataByCompany(companyId);
      if (strategyData?.departments && Array.isArray(strategyData.departments)) {
        departments = strategyData.departments;
      }
    } catch (err) {
      console.warn(`[${ROUTE_TAG}] Failed to fetch strategy_data:`, err);
    }

    // ===== 3. AI集計用のプロンプト構築 =====
    const apiKey = cleanApiKey(process.env.OPENAI_API_KEY);
    if (!apiKey) return json({ error: 'OPENAI_API_KEY is not configured' }, 500);

    const systemPrompt = buildSystemPrompt(cases.length);
    const userPrompt = buildUserPrompt(cases, departments);

    // ===== 4. OpenAI API 実行 =====
    const openai = new OpenAI({ apiKey });
    const completion = await openai.chat.completions.create({
      model: process.env.OPENAI_MODEL || 'gpt-4o',
      temperature: 0.3,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ],
    });

    const content = completion.choices?.[0]?.message?.content ?? '';
    const parsed = safeJsonParse(content);

    if (!parsed) {
      throw new Error('Failed to parse AI response as JSON');
    }

    // ===== 5. レスポンス整形 =====
    const dashboard: OrgAlignmentInsightDashboard = {
      companyId,
      summary: parsed.summary || '集計結果がありません。',
      insights: Array.isArray(parsed.insights) ? parsed.insights : [],
      categoryCounts: parsed.categoryCounts || {},
      priorityCounts: parsed.priorityCounts || { low: 0, medium: 0, high: 0 },
      departmentTrends: Array.isArray(parsed.departmentTrends) ? parsed.departmentTrends : [],
      sourceCaseCount: cases.length,
      generatedAt: new Date().toISOString(),
    };

    // ===== 6. DB に保存 =====
    const savedInsight = await saveOrgAlignmentInsight(admin, {
      companyId,
      generatedBy: userId,
      dashboard,
    });

    // ===== 7. 各論点を共有トピックとして自動作成 =====
    const createdTopics = [];
    for (let i = 0; i < dashboard.insights.length; i++) {
      try {
        const topic = await createSharedTopicFromInsight(
          admin,
          companyId,
          dashboard.insights[i],
          `${savedInsight.id}-${i}`,
          userId,
          dashboard.sourceCaseCount,
          dashboard.insights.length,
          i  // Pass insight index for proper fallback calculation
        );
        createdTopics.push(topic.id);
      } catch (topicErr: any) {
        console.warn(`[${ROUTE_TAG}] Failed to create shared topic for insight ${i}:`, topicErr.message);
        // Continue even if individual topic creation fails
      }
    }

    console.log(`[${ROUTE_TAG}] Successfully generated and saved insights for company ${companyId}`);
    console.log(`[${ROUTE_TAG}] Created ${createdTopics.length} shared topics`);

    return json({ dashboard, createdTopics }, 200);
  } catch (err: any) {
    console.error(`[ERROR] ${ROUTE_TAG}:`, err);
    const message = err?.message || String(err);

    return json({ error: message }, err?.status || 500);
  }
}

// ===== ヘルパー関数 =====

function buildSystemPrompt(caseCount: number): string {
  return `あなたは、GROWTH SHIFT の組織変革ルームで収集された「認識のズレ」を会社全体の視点で集計・論点化する AI です。

【目的】
- 個別の投稿を、経営・部門・現場の認識差という構造で整理する
- 個人の不満ではなく、組織として対処すべき論点にまとめる
- STAGE3（部門戦略・KPI）やSTAGE4（実行計画）にフィードバックできる具体的なアクションを提示する

【重要ルール】
1. 個人や部署を責めない。組織構造・仕組み・判断基準のズレとして整理する
2. 論点は3〜5個にまとめる（多すぎると焦点がぼやける）
3. 各論点には、以下を詳細に明記する：
   - 論点のタイトルと詳細説明
   - 関連する issueType
   - 影響を受ける部門
   - 優先度スコア（0-100）、重要度、緊急度
   - 影響範囲の説明
   - 現場の認識 vs 会社としての認識とズレの本質
   - 会社としての判断軸
   - 推奨するすり合わせ形式
   - 具体的な次アクション（複数、各々に責任者と期限）
   - STAGE3/4への還流候補（戦略データ、OKR化候補など）
   - この論点に関連する投稿件数（relatedCaseCount）
4. 優先度スコアは、重要度と緊急度から計算してください
   priorityScore = (importance の点数 × 0.5 + urgency の点数 × 0.5) × 20
   ※ 高=3点、中=2点、低=1点
5. relatedCaseCount（この論点に関連する投稿件数）を計算するルール：
   - 各ケースを1つの論点に割り当てる。1つのケースが複数論点にまたがる場合は、最も関連が深い論点に割り当てる
   - すべての論点の relatedCaseCount の合計は、ケース総数（${caseCount}件）と一致させてください
   - 3論点あり7件のケースの場合: [3, 2, 2] など、合計が7になるように配分する
   - relatedCaseCount は整数で、0 以上の値を入れてください
6. 部門別の傾向では、部門名・件数・上位の issueType・平均リスクレベルを整理する
7. 出力は必ず JSON 形式のみ。Markdown や説明文は不要

【issueType の分類ガイド】
以下のいずれかに必ず分類してください。「その他」は極力避けてください：
- 部門間連携のズレ: 部門間の依頼・協力・調整の問題
- 経営と現場の認識のズレ: 経営方針と現場実態・実行能力の乖離
- 戦略と実行計画のズレ: 全社戦略と部門の実行計画の整合性
- 実行計画と評価制度のズレ: 評価指標と実際の期待行動の不一致
- 役割責任のズレ: 誰が何を決める・実行するかが曖昧
- 優先順位のズレ: 全社・部門・現場で優先すべきことが揃っていない
- 意思決定基準のズレ: 判断基準・ルール・権限の不明確
- 情報共有のズレ: 方針・背景・理由が共有されず、現場が動けない
- 挑戦と失敗許容のズレ: 挑戦を求める一方で失敗責任が厳しい
- ツール・施策への不信感: 入力しても改善に活かされるのが見えない

【出力JSONスキーマ】
{
  "summary": "全体サマリー（2-3文）",
  "insights": [
    {
      "title": "論点タイトル",
      "description": "論点の詳細説明",
      "relatedIssueTypes": ["issueType1", "issueType2"],
      "affectedDepartments": ["部門A", "部門B"],
      "recommendedActions": ["アクション1", "アクション2"],
      "stage3Stage4Relevance": "STAGE3/4への還流候補の説明",
      "relatedCaseCount": 5,
      "priorityScore": 70,
      "importance": "高",
      "urgency": "中",
      "impactScope": "論点が影響する範囲の説明",
      "recognitionGap": {
        "fieldView": "現場の認識・課題認識",
        "companyView": "会社としての認識",
        "gapEssence": "ズレの本質・生じている理由"
      },
      "companyAxis": "会社がこの論点をどの軸で考えるべきか",
      "sessionType": "推奨するすり合わせ形式（例：全社会議、部門別、分科会）",
      "nextActions": [
        {
          "title": "アクション1",
          "owner": "部門名",
          "dueDate": "YYYY-MM-DD",
          "status": "未着手"
        }
      ],
      "strategyReflection": {
        "stage3Status": "未反映",
        "stage4Status": "未反映",
        "relatedDepartments": ["部門A"],
        "generatedProjects": [],
        "generatedOkrs": []
      }
    }
  ],
  "categoryCounts": {
    "issueType1": 件数,
    "issueType2": 件数
  },
  "priorityCounts": {
    "low": 件数,
    "medium": 件数,
    "high": 件数
  },
  "departmentTrends": [
    {
      "departmentName": "部門名",
      "caseCount": 件数,
      "topIssueTypes": [
        { "issueType": "issueType1", "count": 件数 }
      ],
      "avgRiskLevel": "low | medium | high"
    }
  ]
}`;
}

function buildUserPrompt(cases: any[], departments: any[]): string {
  // ケースデータを匿名化して整形
  const caseSummaries = cases.map((c, idx) => {
    const aiResult = c.ai_result || {};
    return `
【ケース${idx + 1}】
- 分類: ${aiResult.issueType || '未分類'}
- リスクレベル: ${aiResult.riskLevel || 'unknown'}
- 関係する相手・部門: ${c.counterparty_type || '不明'}${c.counterparty_detail ? ` (${c.counterparty_detail})` : ''}
- 状況: ${c.situation_text || '記載なし'}
- 理想: ${c.ideal_text || '記載なし'}
- AI整理タイトル: ${aiResult.title || ''}
- AI整理サマリー: ${aiResult.inputSummary || ''}
`;
  }).join('\n');

  const departmentList = departments.length > 0
    ? departments.map((d) => `- ${d.name || d.departmentName || '名称不明'}`).join('\n')
    : '部門情報なし';

  return `【会社の部門一覧】
${departmentList}

【収集された認識のズレケース（${cases.length}件）】
${caseSummaries}

【集計・分類の指示】
1. すべてのケースを分析し、会社全体の論点を3〜5個にまとめてください
2. relatedIssueTypes は、複数のケースに関連する issueType をまとめてください
3. 「その他」という分類は極力避け、上記の正式カテゴリーのいずれかに分類してください
4. affectedDepartments には、実際に影響を受ける部門名を列挙してください
   - 全社的な論点の場合は [ "unknown" ] または複数部門を指定してください
5. categoryCounts には、分類された issueType ごとの件数を集計してください
6. affectedDepartments に 「unknown」が含まれている場合、UI 側で「全社横断」と表示されます

上記をもとに、会社全体の論点を整理してください。`;
}
