// /app/api/stage4/generate-execution-draft/route.ts
// STAGE4: 実行計画たたき台生成 API
// STAGE3から引き継がれたプロジェクト情報をもとに、実行計画のたたき台をAI生成

import 'server-only';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

import { NextRequest, NextResponse } from 'next/server';
import OpenAI from 'openai';
import { getAuthUserIdFromBearer, requireMembership } from '@/lib/server/rbacGuard';
import { getSupabaseAdmin } from '@/lib/supabaseAdmin';
import { z } from 'zod';

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY! });

interface ExecutionDraftRequest {
  departmentName?: string;
  projectTitle: string;
  hypothesis?: string;
  rationale?: string;
  reason?: string;
  kind?: string;
  mainLever?: string;
  horizon?: string;
  role?: string;
  existingOkrsV2?: any[];
  existingOkrs?: any[];
  existingKpis?: any[];
  sourceKpis?: string[];  // ★ STAGE3由来の固定KPI（AIが変更しない）
  due?: string;
  ownerName?: string;
  companyStrategy?: string;
  companyTargets?: any[];
}

interface ExecutionDraft {
  objective: string;
  role: 'REVENUE' | 'COST' | 'FUTURE';
  impact: {
    revenueMJPY: number | null;
    opIncomeMJPY: number | null;
    investmentMJPY: number | null;
    rationale: string;
    assumptions?: {
      targetCustomers?: number;
      conversionRatePct?: number;
      averageDealMJPY?: number;
      currentCostMJPY?: number;
      reductionRatePct?: number;
      peopleCount?: number;
      durationMonths?: number;
      monthlyCostPerPersonMJPY?: number;
      externalCostMJPY?: number;
    };
  };
  kpis: Array<{
    label: string;
    target: number;
    unit: string;
    due: string;
    owner: string;
    milestones: Array<{
      title: string;
      dueYm: string;
    }>;
  }>;
  steps: Array<{
    title: string;
    dueYm: string;
  }>;
}

async function generateExecutionDraft(
  projectInfo: ExecutionDraftRequest
): Promise<{ draft: ExecutionDraft; debugInfo: any }> {
  const debugInfo: any = {
    hasOpenaiKey: !!process.env.OPENAI_API_KEY,
    projectTitle: projectInfo.projectTitle,
  };

  if (!process.env.OPENAI_API_KEY) {
    throw new Error('OPENAI_API_KEY is not configured');
  }

  // 現在年月日を明示的に計算
  const now = new Date();
  const currentYear = now.getFullYear();
  const currentMonth = now.getMonth() + 1;
  const currentDay = now.getDate();
  const currentYearMonth = `${currentYear}-${String(currentMonth).padStart(2, '0')}`;
  const currentDateStr = `${currentYear}年${currentMonth}月${currentDay}日`;

  // 期限の目安を計算：現在月から3〜6ヶ月後の範囲
  const kpiDueMonthsFrom = 3;
  const kpiDueMonthsTo = 6;
  const stepDueMonthsFrom = 1;
  const stepDueMonthsTo = 3;

  const getMonthAfter = (months: number): string => {
    let m = currentMonth + months;
    let y = currentYear;
    while (m > 12) {
      m -= 12;
      y += 1;
    }
    return `${y}-${String(m).padStart(2, '0')}`;
  };

  const kpiDueLowerBound = getMonthAfter(kpiDueMonthsFrom);
  const kpiDueUpperBound = getMonthAfter(kpiDueMonthsTo);
  const stepDueLowerBound = getMonthAfter(stepDueMonthsFrom);
  const stepDueUpperBound = getMonthAfter(stepDueMonthsTo);

  debugInfo.currentDateStr = currentDateStr;
  debugInfo.currentYearMonth = currentYearMonth;
  debugInfo.kpiDueRange = `${kpiDueLowerBound} ～ ${kpiDueUpperBound}`;
  debugInfo.stepDueRange = `${stepDueLowerBound} ～ ${stepDueUpperBound}`;

  // ★ STAGE3由来の固定KPI をプロンプトに明記（AIが変更しない）
  const sourceKpisText = Array.isArray(projectInfo.sourceKpis) && projectInfo.sourceKpis.length > 0
    ? `【STAGE3で確定されたKPI（変更不可）】\n${projectInfo.sourceKpis.map((kpi, idx) => `${idx + 1}. ${kpi}`).join('\n')}\n\n★重要★ 上記のKPI名は絶対に変更・追加・削除しないでください。`
    : '【STAGE3 KPI】未設定のため、AIで補完してください。';

  // プロジェクト情報をプロンプトに組み込む
  const projectContext = `
【プロジェクト情報】
- プロジェクト名: ${projectInfo.projectTitle}
- 部門: ${projectInfo.departmentName || '—'}
- 仮説: ${projectInfo.hypothesis || '—'}
- 理由: ${projectInfo.rationale || projectInfo.reason || '—'}
- 改革のポイント: ${projectInfo.mainLever || '—'}
- 成長ポイント（kind）: ${projectInfo.kind || '—'}
- タイムホライズン: ${projectInfo.horizon || '—'}
- 期限: ${projectInfo.due || '—'}
- オーナー: ${projectInfo.ownerName || '—'}
- 役割（Revenue/Cost/Future）: ${projectInfo.role || 'REVENUE'}

${sourceKpisText}

${projectInfo.companyStrategy ? `【全社戦略】\n${projectInfo.companyStrategy}` : ''}
${projectInfo.companyTargets && projectInfo.companyTargets.length > 0 ? `【全社目標】\n${projectInfo.companyTargets.map((t: any) => `- ${t.label}: ${t.base}→${t.high || t.base} (${t.unit})`).join('\n')}` : ''}
  `.trim();

  const prompt = `【重要：現在日時】
現在日は ${currentDateStr} です。
本プロンプトで「現在月」「今月」と表記した場合、${currentMonth}月を指します。
本プロンプトで「現在年月」と表記した場合、${currentYearMonth} を指します。

---

以下のプロジェクト情報と全社戦略をもとに、実行計画のたたき台を生成してください。
現場社員が白紙から入力しなくてもよいように、具体的で実行可能なKPI・ステップを提案してください。

${projectContext}

---

## 出力形式

JSON形式で以下を返してください。

{
  "objective": "このプロジェクトで目指す達成状態（30～50文字）",
  "role": "REVENUE | COST | FUTURE",
  "impact": {
    "revenueMJPY": 数値またはnull,
    "opIncomeMJPY": 数値またはnull,
    "investmentMJPY": 数値またはnull,
    "rationale": "数値目安の根拠",
    "assumptions": {
      "targetCustomers": 数値（REVENUE時のみ）,
      "conversionRatePct": 数値（REVENUE時のみ）,
      "averageDealMJPY": 数値（REVENUE時のみ）,
      "currentCostMJPY": 数値（COST時のみ）,
      "reductionRatePct": 数値（COST時のみ）,
      "peopleCount": 数値（FUTURE時のみ）,
      "durationMonths": 数値（FUTURE時のみ）,
      "monthlyCostPerPersonMJPY": 数値（FUTURE時のみ）,
      "externalCostMJPY": 数値（FUTURE時のみ）
    }
  },
  "kpis": [
    {
      "label": "KPI名",
      "target": 数値,
      "unit": "% または件数など",
      "due": "YYYY-MM形式の期限",
      "owner": "担当者名（未定の場合は空文字列）",
      "milestones": [
        {
          "title": "途中の目安（例：ベータ版リリース）",
          "dueYm": "YYYY-MM形式"
        }
      ]
    }
  ],
  "steps": [
    {
      "title": "最初の実行ステップ",
      "dueYm": "YYYY-MM形式"
    }
  ]
}

---

## 生成ガイドライン

### objective
- プロジェクトの最終状態を1文で表現
- 例：「既存顧客へのアップセルにより、平均売上単価を30%向上させる」

### role
- REVENUE: 売上拡大を目指すプロジェクト
- COST: コスト削減・効率化を目指すプロジェクト
- FUTURE: 将来の競争力強化・基盤構築を目指すプロジェクト

### impact
- revenueMJPY: 売上増分（百万円単位）
- opIncomeMJPY: 営業利益増分（百万円単位）
- investmentMJPY: 必要投資額（百万円単位）
- rationale: 数値の根拠（文字列）
- assumptions: 計算前提（role に応じて設定）
  - REVENUE: targetCustomers（対象顧客数）, conversionRatePct（受注率%）, averageDealMJPY（平均単価）
  - COST: currentCostMJPY（現在コスト）, reductionRatePct（削減率%）
  - FUTURE: peopleCount（人数）, durationMonths（期間月数）, monthlyCostPerPersonMJPY（月単価）, externalCostMJPY（外部費用）
- 不明な項目はnullを指定

### kpis
- ★ STAGE3で確定されたKPIがある場合は、そのKPI名をそのまま使用すること
  - KPI名を変更・追加・削除するなど、勝手に編集しないこと
  - ★ 非常に重要 ★ STAGE3 KPI の個数に合わせて、「同じ個数」「同じ順番」で生成すること
    - STAGE3 KPI件数：N件
    - STAGE4 KPI件数：必ずN件
    - 1番目のSTAGE3 KPI → 1番目のSTAGE4 KPIに対応させること

- STAGE3 KPIがない場合のみ、新規にKPI名を生成する
  - KPI名は「テーマ名：指標名」のように冗長にせず、具体的で成長につながる指標にする
  - NG例: 「半導体企業向け製品強化：売上向上（%）」
  - OK例: 「重点顧客向け新製品売上比率」、「半導体領域の有効商談数」

- AIが生成してよいのは、各KPIに対する以下のみ：
  - target: 目標値
  - unit: 単位
  - due: 期限（${kpiDueLowerBound} ～ ${kpiDueUpperBound}）
  - owner: 担当者案
  - milestones: マイルストーン

- 期限は ${kpiDueLowerBound} ～ ${kpiDueUpperBound} の範囲で設定すること（過去日付は絶対に使用しない）
  - この範囲は現在（${currentYearMonth}）から3～6ヶ月後の期間
  - 必ず YYYY-MM 形式で、この範囲内の日付を指定すること

- ★ 絶対に守ること ★
  - STAGE3 KPIより多く返さない
  - STAGE3 KPIより少なく返さない
  - 返す順番を変えない

### steps
- 初期段階の実行ステップを3～5個列挙
- 各ステップは1～3ヶ月単位で実行可能な粒度
- ステップ名は「誰に対して」「何をするか」を含む具体的な行動に
  - NG例: 「顧客アンケート実施」「提案内容ブラッシュアップ」
  - OK例: 「重点顧客10社への課題ヒアリング」「営業・開発合同で顧客別提案方針を確認」
- 期限は ${stepDueLowerBound} ～ ${stepDueUpperBound} の範囲で設定すること（過去日付は絶対に使用しない）
  - この範囲は現在（${currentYearMonth}）から1～3ヶ月後の期間
  - 必ず YYYY-MM 形式で、この範囲内の日付を指定すること

---

厳密には JSON のみを出力してください。説明やコメントは不要です。`;

  console.log('[STAGE4] OpenAI API call start', { model: 'gpt-4o-mini', promptLength: prompt.length });

  let response;
  try {
    response = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      temperature: 0.7,
      messages: [
        {
          role: 'user',
          content: prompt,
        },
      ],
    });
    debugInfo.openaiResponseReceived = true;
    debugInfo.choicesLength = response.choices.length;
  } catch (e: any) {
    debugInfo.openaiError = {
      message: e?.message,
      code: e?.code,
    };
    throw new Error(`OpenAI API failed: ${e?.message || 'unknown error'}`);
  }

  const content = response.choices[0]?.message?.content ?? '';
  debugInfo.contentLength = content.length;

  console.log('[STAGE4] OpenAI response received', { contentLength: content.length });

  let parsed: ExecutionDraft;
  try {
    const jsonMatch = content.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      debugInfo.jsonExtractionFailed = true;
      throw new Error('JSON not found in response');
    }

    debugInfo.jsonFound = true;
    const jsonStr = jsonMatch[0];

    parsed = JSON.parse(jsonStr) as ExecutionDraft;

    // バリデーション
    if (!parsed.objective || typeof parsed.objective !== 'string') {
      throw new Error('Invalid objective');
    }
    if (!['REVENUE', 'COST', 'FUTURE'].includes(parsed.role)) {
      parsed.role = 'REVENUE';
    }
    if (!parsed.impact || typeof parsed.impact !== 'object') {
      parsed.impact = {
        revenueMJPY: null,
        opIncomeMJPY: null,
        investmentMJPY: null,
        rationale: '',
      };
    }
    if (!Array.isArray(parsed.kpis)) {
      parsed.kpis = [];
    }
    if (!Array.isArray(parsed.steps)) {
      parsed.steps = [];
    }

    debugInfo.parsedSuccessfully = true;
  } catch (e: any) {
    debugInfo.parseError = e?.message;
    throw new Error(`Failed to parse OpenAI response: ${e?.message || 'unknown error'}`);
  }

  return { draft: parsed, debugInfo };
}

export async function POST(request: NextRequest) {
  try {
    console.log('[STAGE4 API] POST called', { hasRequest: !!request });

    // 認証確認
    console.log('[STAGE4 API] Checking auth...');
    try {
      const admin = getSupabaseAdmin();
      console.log('[STAGE4 API] admin created:', { hasAdmin: !!admin });

      const userId = await getAuthUserIdFromBearer(admin, request);
      console.log('[STAGE4 API] userId from bearer:', { userId, hasUserId: !!userId });

      if (!userId) {
        console.warn('[STAGE4 API] Unauthorized: no userId');
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
      }

      // メンバーシップ確認
      console.log('[STAGE4 API] Checking membership for userId:', userId);
      const membership = await requireMembership(admin, userId);
      console.log('[STAGE4 API] membership:', { hasMembership: !!membership });

      if (!membership) {
        console.warn('[STAGE4 API] Forbidden: no membership');
        return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
      }
      console.log('[STAGE4 API] Auth and membership OK');
    } catch (authError: any) {
      console.error('[STAGE4 API] Auth check error:', authError?.message, { stack: authError?.stack?.substring(0, 300) });
      return NextResponse.json({ error: `Auth error: ${authError?.message}` }, { status: 401 });
    }

    console.log('[STAGE4 API] Parsing body...');
    const body = await request.json();
    const projectInfo: ExecutionDraftRequest = body;

    // テスト用：PING を返す
    if (body.__ping === true || body.__ping === 'true') {
      console.log('[STAGE4 API] PING MODE - returning pong');
      return NextResponse.json(
        { __pong: true, timestamp: new Date().toISOString(), message: 'API is alive' },
        { status: 200 }
      );
    }

    if (!projectInfo.projectTitle) {
      return NextResponse.json(
        { error: 'projectTitle is required' },
        { status: 400 }
      );
    }

    console.log('[STAGE4 API] Generating draft...', { projectTitle: projectInfo.projectTitle });
    const { draft, debugInfo } = await generateExecutionDraft(projectInfo);

    console.log('[STAGE4 API] Success, returning draft');
    return NextResponse.json({
      success: true,
      draft,
      debugInfo,
    });
  } catch (error: any) {
    console.error('[STAGE4 API] Uncaught error:', error?.message, { stack: error?.stack });
    return NextResponse.json(
      {
        success: false,
        error: error?.message || 'Unknown error',
        debugInfo: {
          timestamp: new Date().toISOString(),
          errorStack: error?.stack?.substring(0, 200),
        },
      },
      { status: 500 }
    );
  }
}
