// /app/api/org-alignment/generate/route.ts
import 'server-only';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

import { NextResponse, NextRequest } from 'next/server';
import OpenAI from 'openai';
import { getSupabaseAdmin } from '@/lib/supabaseAdmin';
import { getAuthUserIdFromBearer, requireMembership } from '@/lib/server/rbacGuard';
import { getFullStrategyDataByCompany } from '@/utils/supabase/strategy';
import type { OrgAlignmentResult } from '@/utils/supabase';

const ROUTE_TAG = 'app/api/org-alignment/generate';

/* ========== helpers ========== */
function json(res: any, status = 200, routeTag: string = ROUTE_TAG) {
  return new NextResponse(JSON.stringify(res), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
      'X-GROWTH-Route': routeTag,
    },
  });
}

function cleanApiKey(raw?: string | null): string {
  const v = (raw ?? '')
    .replace(/[\u200B-\u200D\uFEFF]/g, '')
    .replace(/\r?\n|\r/g, '')
    .trim();
  return v;
}

function extractMessage(e: any): string {
  return (
    e?.message ??
    e?.response?.data?.error?.message ??
    e?.response?.data ??
    e?.error?.message ??
    String(e)
  );
}

/* ========== POST ========== */
export async function POST(req: NextRequest) {
  console.log(`[HIT] ${ROUTE_TAG} POST`);

  try {
    // 認証確認
    const admin = getSupabaseAdmin();
    const userId = await getAuthUserIdFromBearer(admin, req);
    if (!userId) {
      return json({ error: 'unauthorized' }, 401);
    }
    const membership = await requireMembership(admin, userId);
    if (!membership) {
      return json({ error: 'forbidden' }, 403);
    }

    // Body検証
    let payload: any = null;
    try {
      payload = await req.json();
    } catch {
      return json({ error: 'invalid JSON body' }, 400);
    }

    const {
      situationText,
      myRecognitionText,
      idealText,
      expectationText,
      counterpartyType,
      counterpartyDetail,
      visibilityMode,
      strategyContext,
    } = payload;

    // 必須フィールド検証
    if (!situationText || !myRecognitionText || !idealText || !expectationText) {
      return json({ error: '入力フィールドが不足しています。' }, 400);
    }

    // OpenAI APIキー取得
    const apiKey = cleanApiKey(process.env.OPENAI_API_KEY);
    if (!apiKey) return json({ error: 'OPENAI_API_KEY が未設定です。' }, 500);

    // strategyDataを取得
    let strategyData: any = null;
    let companyRecognitionMode: 'strategy_based' | 'needs_confirmation' = 'needs_confirmation';

    console.log(`[ORG-ALIGNMENT] membership.companyId: ${membership.companyId}`);
    console.log(`[ORG-ALIGNMENT] membership.userId: ${membership.userId}`);

    let strategyFetchMethod: 'company_id' | 'user_id' | 'not_found' = 'not_found';
    let strategyFetchError: any = null;

    if (membership.companyId) {
      const { data, error } = await getFullStrategyDataByCompany(membership.companyId);
      console.log(`[ORG-ALIGNMENT] getFullStrategyDataByCompany result:`, {
        hasData: !!data,
        hasError: !!error,
        errorMessage: error?.message,
        dataMission: data?.mission,
        dataVision: data?.vision,
        dataValue: data?.value,
        departmentsCount: Array.isArray(data?.departments) ? data.departments.length : 'not-array',
        winPatternsCount: Array.isArray(data?.winPatterns) ? data.winPatterns.length : 'not-array',
        dataKeys: data ? Object.keys(data).slice(0, 20) : 'no-data',
        data_id: data?.id,
        data_company_id: data?.companyId,
        data_user_id: data?.userId,
      });

      if (error) {
        strategyFetchError = error;
        console.log(`[ORG-ALIGNMENT] strategy fetch by company_id failed:`, error);
      } else if (data) {
        strategyFetchMethod = 'company_id';
        strategyData = data;
        console.log(`[ORG-ALIGNMENT] strategy data fetched by company_id successfully`);
      } else {
        console.log(`[ORG-ALIGNMENT] No strategy data found for company_id (expected for new companies)`);
      }
    }

    // Fallback: user_id で strategy_data を取得（company_id で見つからない場合）
    if (!strategyData && membership.userId) {
      console.log(`[ORG-ALIGNMENT] Trying fallback: fetch by user_id: ${membership.userId}`);
      try {
        // ★ NOTE: user_id でStrategyDataを直接取得する方法を探す
        // 現在、getFullStrategyDataByCompany の user_id バージョンがなければ、
        // ブラウザ側の strategyStore と同じロジックで取得する必要がある
        // 暫定的に、最新の strategy_data を user_id でクエリ
        const admin = getSupabaseAdmin();
        const userStrategyRes = await admin
          .from('strategy_data')
          .select('*')
          .eq('user_id', membership.userId)
          .order('updated_at', { ascending: false })
          .limit(1)
          .maybeSingle();

        if (userStrategyRes.error) {
          console.log(`[ORG-ALIGNMENT] user_id fetch error:`, userStrategyRes.error?.message);
          strategyFetchError = userStrategyRes.error;
        } else if (userStrategyRes.data) {
          strategyData = userStrategyRes.data;
          strategyFetchMethod = 'user_id';
          console.log(`[ORG-ALIGNMENT] strategy data fetched by user_id successfully`);
        } else {
          console.log(`[ORG-ALIGNMENT] No strategy data found for user_id either`);
        }
      } catch (fallbackErr: any) {
        console.log(`[ORG-ALIGNMENT] fallback fetch error:`, fallbackErr?.message);
        strategyFetchError = fallbackErr;
      }
    }

    // strategy_data が取得できている場合、companyRecognitionMode を判定
    if (strategyData) {
      // ★ 判定ロジック：strategy_based と needs_confirmation の区別
      // 方針：STAGE1〜4が完全に揃っていなくても、AIが会社方針に照らした整理を行える
      // だけの実用的な情報があれば strategy_based と判定する
      // 以下のいずれか1つ以上が存在すれば strategy_based：
      //  - mission / vision / value（MVV）
      //  - finalStory / story / storyDraft / ceoIntent（経営ストーリー）
      //  - departments >= 1件
      //  - departments[].projects >= 1件
      //  - departments[].projects[].okrs >= 1件
      //  - winPatterns >= 1件
      //  - financeSummary / businessPortfolio（財務・事業情報）
      //  - executionPlans（実行計画）
      //
      // strategy_data が存在しない、または中身がほぼ空の場合のみ needs_confirmation

      // strategyContextForPrompt に拾える情報を事前に構築（判定に使用）
      const hasMvv = !!(strategyData.mission || strategyData.vision || strategyData.value);
      const hasStory = !!(
        (Array.isArray(strategyData.finalStory) && strategyData.finalStory.length > 0) ||
        (Array.isArray(strategyData.story) && strategyData.story.length > 0) ||
        (Array.isArray(strategyData.storyDraft) && strategyData.storyDraft.length > 0) ||
        strategyData.ceoIntent
      );
      const hasDepartments = Array.isArray(strategyData.departments) && strategyData.departments.length > 0;
      const hasDepartmentProjects = hasDepartments && strategyData.departments.some((d: any) =>
        Array.isArray(d?.projects) && d.projects.length > 0
      );
      const hasDepartmentOkrs = hasDepartmentProjects && strategyData.departments.some((d: any) =>
        (d?.projects ?? []).some((p: any) => Array.isArray(p?.okrs) && p.okrs.length > 0)
      );
      const hasWinPatterns = Array.isArray(strategyData.winPatterns) && strategyData.winPatterns.length > 0;
      const hasFinanceSummary = !!(strategyData.financeSummary && typeof strategyData.financeSummary === 'object');
      const hasBusinessPortfolio = !!(strategyData.businessPortfolio && typeof strategyData.businessPortfolio === 'object');
      const hasExecutionPlans = Array.isArray(strategyData.executionPlans) && strategyData.executionPlans.length > 0;

      // AIが会社方針に照らした整理を行えるだけの情報があるか判定
      const hasUsableStrategyContext = !!(
        hasMvv ||
        hasStory ||
        hasDepartments ||
        hasDepartmentProjects ||
        hasDepartmentOkrs ||
        hasWinPatterns ||
        hasFinanceSummary ||
        hasBusinessPortfolio ||
        hasExecutionPlans
      );

      console.log(`[ORG-ALIGNMENT] hasUsableStrategyContext detailed:`, {
        hasMvv,
        hasStory,
        hasDepartments,
        hasDepartmentProjects,
        hasDepartmentOkrs,
        hasWinPatterns,
        hasFinanceSummary,
        hasBusinessPortfolio,
        hasExecutionPlans,
        result: hasUsableStrategyContext,
      });

      if (hasUsableStrategyContext) {
        companyRecognitionMode = 'strategy_based';
      }
    }

    // strategyContextを構築（存在する情報を広く拾う）
    const strategyContextForPrompt = strategyData
      ? {
          // MVV
          mission: strategyData.mission || null,
          vision: strategyData.vision || null,
          value: strategyData.value || null,
          // ストーリー系
          ceoIntent: strategyData.ceoIntent || null,
          story: Array.isArray(strategyData.story)
            ? strategyData.story.slice(0, 2).map((s: any) => {
                if (typeof s === 'string') return s;
                return s?.content || s?.text || null;
              }).filter(Boolean)
            : [],
          finalStory: Array.isArray(strategyData.finalStory)
            ? strategyData.finalStory.slice(0, 1)
            : [],
          // 部門・プロジェクト
          departments: Array.isArray(strategyData.departments)
            ? strategyData.departments.map((d: any) => ({
                name: d?.name,
                projectCount: Array.isArray(d?.projects) ? d.projects.length : 0,
                projectTitles: Array.isArray(d?.projects)
                  ? d.projects.slice(0, 3).map((p: any) => p?.title || p?.name).filter(Boolean)
                  : [],
              }))
            : [],
          // 重点戦略
          winPatterns: Array.isArray(strategyData.winPatterns)
            ? strategyData.winPatterns.slice(0, 3).map((wp: any) => ({
                name: wp?.name,
                description: wp?.description,
              }))
            : [],
          // 経営指標・財務
          hasFinanceSummary: !!(strategyData.financeSummary && typeof strategyData.financeSummary === 'object'),
          hasBusinessPortfolio: !!(strategyData.businessPortfolio && typeof strategyData.businessPortfolio === 'object'),
          // OKR・KPI
          companyTargets: Array.isArray(strategyData.companyTargets)
            ? strategyData.companyTargets.slice(0, 3).map((ct: any) => ({
                name: ct?.name,
                description: ct?.description,
              }))
            : [],
        }
      : null;

    // プロンプトを構築
    let systemPromptBase = `あなたは組織の認識のズレを、個人への批判ではなく、組織全体の方向性を確認するための論点として整理する専門家です。

入力された違和感・もやもやを、以下の視点から構造的に整理してください：

1. 関係当事者の認識仮説：入力者の視点から、相手方がどのような認識で動いている可能性があるかを推測
2. 会社としてあるべき認識：会社全体の方向性・価値判断に基づく、確認すべき判断基準
3. 擦り合わせるべきポイント：認識のズレを解消するために確認・調整すべき項目`;

    if (companyRecognitionMode === 'strategy_based') {
      systemPromptBase += `

【重要】ユーザーが提供する「会社の戦略情報」を活用してください。
- 「会社としての認識」では、ミッション、ビジョン、部門構成、プロジェクト、重点戦略など提供されたデータに基づいた具体的な判断基準を示してください
- 戦略情報に直接的または間接的に言及し、「会社がこのズレにどう向き合うべきか」を戦略的視点から説明してください`;
    }

    const systemPrompt = systemPromptBase + `

出力は必ず以下の JSON 形式で返してください。JSON のみを返し、他のテキストは含めないでください。

{
  "title": "短いタイトル",
  "inputSummary": "入力されたもやもやの要約",
  "issueType": "部門間連携のズレ | 経営と現場の認識のズレ | 戦略と実行計画のズレ | 実行計画と評価制度のズレ | 役割責任のズレ | 優先順位のズレ | 意思決定基準のズレ | 情報共有のズレ | 挑戦と失敗許容のズレ | ツール・施策への不信感 | その他",
  "participantRecognitionHypothesis": "関係当事者の認識仮説",
  "companyRecognitionMode": "strategy_based | needs_confirmation",
  "companyRecognitionTitle": "会社の方針に照らした、あるべき認識 | 会社として確認すべき認識",
  "companyRecognition": "会社としての認識",
  "alignmentPoints": ["確認すべきポイント1", "確認すべきポイント2", "確認すべきポイント3"],
  "recommendedNextAction": {
    "title": "次のアクション名",
    "detail": "次のアクションの説明"
  },
  "riskLevel": "low | medium | high",
  "riskReason": "放置した場合のリスク"
}`;

    // 取得できている戦略情報を文字列化
    const strategyInfoLines: string[] = [];
    if (strategyContextForPrompt) {
      if (strategyContextForPrompt.mission) {
        strategyInfoLines.push(`・ミッション：${strategyContextForPrompt.mission}`);
      }
      if (strategyContextForPrompt.vision) {
        strategyInfoLines.push(`・ビジョン：${strategyContextForPrompt.vision}`);
      }
      if (strategyContextForPrompt.value) {
        strategyInfoLines.push(`・バリュー：${strategyContextForPrompt.value}`);
      }
      if (strategyContextForPrompt.ceoIntent) {
        strategyInfoLines.push(`・経営方針：${strategyContextForPrompt.ceoIntent}`);
      }
      if (strategyContextForPrompt.story && strategyContextForPrompt.story.length > 0) {
        strategyInfoLines.push(`・経営ストーリー：${strategyContextForPrompt.story[0].substring(0, 100)}...`);
      }
      if (strategyContextForPrompt.finalStory && strategyContextForPrompt.finalStory.length > 0) {
        const story = strategyContextForPrompt.finalStory[0];
        const storyText = typeof story === 'string' ? story : story?.content || story?.text || '';
        if (storyText) {
          strategyInfoLines.push(`・戦略ストーリー：${storyText.substring(0, 100)}...`);
        }
      }
      if (strategyContextForPrompt.winPatterns && strategyContextForPrompt.winPatterns.length > 0) {
        strategyInfoLines.push(`・重点戦略：${strategyContextForPrompt.winPatterns.map((wp) => wp.name).join('、')}`);
      }
      if (strategyContextForPrompt.departments && strategyContextForPrompt.departments.length > 0) {
        const deptNames = strategyContextForPrompt.departments
          .filter((d) => d.name)
          .map((d) => `${d.name}${d.projectTitles.length > 0 ? `（${d.projectTitles.join('、')}）` : ''}`)
          .slice(0, 5);
        strategyInfoLines.push(`・部門構成：${deptNames.join('、')}`);
      }
      if (strategyContextForPrompt.companyTargets && strategyContextForPrompt.companyTargets.length > 0) {
        const targetNames = strategyContextForPrompt.companyTargets
          .filter((ct) => ct.name)
          .map((ct) => ct.name)
          .slice(0, 3);
        strategyInfoLines.push(`・経営指標：${targetNames.join('、')}`);
      }
      if (strategyContextForPrompt.hasFinanceSummary) {
        strategyInfoLines.push(`・財務数値：利用可能`);
      }
      if (strategyContextForPrompt.hasBusinessPortfolio) {
        strategyInfoLines.push(`・事業ポートフォリオ：利用可能`);
      }
    }

    const userPrompt = `【入力内容】

■ どんな場面でもやもやしましたか？
${situationText}

■ その時、自分はどう受け止めましたか？
${myRecognitionText}

■ 本来どうあるべきだと思いますか？
${idealText}

■ 相手に何を期待していましたか？
${expectationText}

■ 関係している相手・部門
${counterpartyType !== 'unknown' ? `相手方の種類：${counterpartyType}${counterpartyDetail ? `（${counterpartyDetail}）` : ''}` : '特定なし'}

${
  companyRecognitionMode === 'strategy_based' && strategyInfoLines.length > 0
    ? `
【会社の戦略情報（参考情報）】
${strategyInfoLines.join('\n')}
`
    : ''
}

以下のポイントに注意してください：
- 入力者を責めないこと
- 相手方も個別の事情・制約がある可能性があることを仮説として示すこと
${
  companyRecognitionMode === 'strategy_based'
    ? `- 【必須】上記の会社の戦略情報（ミッション、ビジョン、部門、プロジェクト、戦略など）に基づいて、「会社としての認識」を具体的に構成してください
- 戦略情報に直接的または間接的に言及し、提供されたデータを活用した判断基準を示してください
- 「確認すべきポイント」では、提供された戦略情報の範囲内で、確認すべき具体的な項目を提示してください`
    : `- 会社の方針が不明確な場合は、確認すべき判断基準として整理すること`
}
- すり合わせのための対話につながる問い形式で、確認ポイントを示すこと`;

    // OpenAI APIを呼び出し
    const openai = new OpenAI({ apiKey });

    const completion = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ],
      temperature: 0.7,
      max_tokens: 2000,
      response_format: { type: 'json_object' },
    });

    const responseText = completion.choices[0]?.message?.content || '';
    if (!responseText) {
      return json({ error: 'OpenAI API からレスポンスが得られません。' }, 500);
    }

    let result: OrgAlignmentResult;
    try {
      const parsed = JSON.parse(responseText);
      result = {
        title: parsed.title || '認識のズレ',
        inputSummary: parsed.inputSummary || situationText,
        issueType: parsed.issueType || 'その他',
        participantRecognitionHypothesis:
          parsed.participantRecognitionHypothesis || '相手方の認識を整理中...',
        companyRecognitionMode: companyRecognitionMode,
        companyRecognitionTitle:
          companyRecognitionMode === 'strategy_based'
            ? '会社の方針に照らした、あるべき認識'
            : '会社として確認すべき認識',
        companyRecognition: parsed.companyRecognition || '会社としての認識を確認中...',
        alignmentPoints: Array.isArray(parsed.alignmentPoints)
          ? parsed.alignmentPoints
          : ['確認ポイントを整理中...'],
        recommendedNextAction: {
          title: parsed.recommendedNextAction?.title || 'すり合わせの場を依頼',
          detail:
            parsed.recommendedNextAction?.detail ||
            '関係者と一緒に認識を確認し、次のステップを決めます。',
        },
        riskLevel: parsed.riskLevel || 'medium',
        riskReason:
          parsed.riskReason || '放置すると、認識のズレが拡大する可能性があります。',
      };
    } catch (parseError) {
      console.error('JSON parse error:', parseError);
      return json({ error: 'AI レスポンスのパース失敗' }, 500);
    }

    // ★ DEBUG 情報を追加（本番前に削除予定）
    const debugInfo = {
      companyId: membership.companyId,
      userId: membership.userId,
      strategyDataExists: !!strategyData,
      strategyFetchMethod,
      strategyFetchError: strategyFetchError ?
        (strategyFetchError instanceof Error ? strategyFetchError.message : String(strategyFetchError))
        : null,
      strategyDataRecordId: strategyData?.id || null,
      strategyDataCompanyId: strategyData?.companyId || null,
      strategyDataUserId: strategyData?.userId || null,
      strategyDataKeys: strategyData ? Object.keys(strategyData).sort() : [],
      hasUsableStrategyContext: strategyData ? !!(
        (strategyData.mission || strategyData.vision || strategyData.value) ||
        ((Array.isArray(strategyData.finalStory) && strategyData.finalStory.length > 0) ||
         (Array.isArray(strategyData.story) && strategyData.story.length > 0) ||
         (Array.isArray(strategyData.storyDraft) && strategyData.storyDraft.length > 0) ||
         strategyData.ceoIntent) ||
        (Array.isArray(strategyData.departments) && strategyData.departments.length > 0) ||
        (Array.isArray(strategyData.winPatterns) && strategyData.winPatterns.length > 0) ||
        (strategyData.financeSummary && typeof strategyData.financeSummary === 'object') ||
        (strategyData.businessPortfolio && typeof strategyData.businessPortfolio === 'object')
      ) : false,
      companyRecognitionMode,
      strategyContext: {
        mission: strategyData?.mission || null,
        vision: strategyData?.vision || null,
        value: strategyData?.value || null,
        ceoIntent: strategyData?.ceoIntent ? strategyData.ceoIntent.substring(0, 50) : null,
        storyCount: Array.isArray(strategyData?.story) ? strategyData.story.length : 0,
        finalStoryCount: Array.isArray(strategyData?.finalStory) ? strategyData.finalStory.length : 0,
        departmentsCount: Array.isArray(strategyData?.departments) ? strategyData.departments.length : 0,
        projectTitlesCount: strategyData?.departments
          ? strategyData.departments.reduce((sum: number, d: any) =>
              sum + (Array.isArray(d?.projects) ? d.projects.length : 0), 0)
          : 0,
        winPatternsCount: Array.isArray(strategyData?.winPatterns) ? strategyData.winPatterns.length : 0,
        hasFinanceSummary: !!strategyData?.financeSummary,
        hasBusinessPortfolio: !!strategyData?.businessPortfolio,
      },
    };

    return json({ result, caseId: null, debug: debugInfo });
  } catch (err: any) {
    console.error(`[ERROR] ${ROUTE_TAG}:`, err);
    const msg = extractMessage(err);
    const status = err?.status || 500;
    return json({ error: msg }, status);
  }
}
