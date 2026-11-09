// /app/api/stage4/generate-execution-draft/route.ts
// STAGE4: 実行計画たたき台生成 API
// STAGE3から引き継がれたプロジェクト情報をもとに、実行計画のたたき台をAI生成

import 'server-only';
import type { ExecutionCompanyContext } from '@/lib/stage4/companyContext';
import { REASONING_OUTPUT_FIELDS, REASONING_RULES, companyContextSection, sanitizeDraftReasoning } from '@/lib/stage4/draftPromptSections';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

import { NextRequest, NextResponse } from 'next/server';
import OpenAI from 'openai';
import { getAuthUserIdFromBearer } from '@/lib/server/rbacGuard';
import { getSupabaseAdmin } from '@/lib/supabaseAdmin';
import { resolveProjectScope, type MembershipRow, type ResolveFailure, type StrategyRow } from '@/lib/stage4/plan/projectResolver';
import { readKpisOf } from '@/lib/stage4/plan/readModel';

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY! });

/* 画面に返す文言。内部の例外の文字列（DBの応答・APIの詳細・スタック）は返さない */
const PUBLIC_MESSAGE = {
  unauthorized: '認証に失敗しました。再ログインしてください。',
  forbidden: '対象の会社・戦略を利用する権限がありません。',
  notFound: '対象のプロジェクトが見つかりません。保存済みの戦略にあるプロジェクト名で指定してください。',
  ambiguous: '同じ名前のプロジェクトが複数あるため、対象を特定できません。',
  config: '生成の設定を確認できませんでした。管理者に連絡してください。',
  upstream: 'AIによる生成に失敗しました。時間をおいて再度お試しください。',
  parse: 'AIの出力を読み取れませんでした。時間をおいて再度お試しください。',
  internal: '生成に失敗しました。時間をおいて再度お試しください。',
} as const;

class RouteError extends Error {
  constructor(readonly status: number, readonly publicMessage: string) {
    super(publicMessage);
    this.name = 'RouteError';
  }
}

const RESOLVE_ERROR: Record<ResolveFailure, { status: number; message: string }> = {
  NO_ACCESS: { status: 403, message: PUBLIC_MESSAGE.forbidden },
  COMPANY_NOT_ACCESSIBLE: { status: 403, message: PUBLIC_MESSAGE.forbidden },
  STRATEGY_NOT_ACCESSIBLE: { status: 403, message: PUBLIC_MESSAGE.forbidden },
  PROJECT_NOT_FOUND: { status: 404, message: PUBLIC_MESSAGE.notFound },
  PROJECT_AMBIGUOUS: { status: 409, message: PUBLIC_MESSAGE.ambiguous },
};

const jsonError = (status: number, error: string) => NextResponse.json({ success: false, error }, { status });

/* 旧来の KPI の置き場（okrs[0].keyResults、kpis）。根拠の印は無いため、確定とは扱わず、AIには変えさせない */
const legacyKpiLabels = (project: Record<string, unknown>): string[] => {
  const okr0 = (Array.isArray(project.okrs) ? project.okrs[0] : undefined) as Record<string, unknown> | undefined;
  const keyResults = Array.isArray(okr0?.keyResults) ? (okr0.keyResults as unknown[]) : [];
  const kpis = Array.isArray(project.kpis) ? (project.kpis as unknown[]) : [];
  return [...keyResults, ...kpis].filter((x): x is string => typeof x === 'string' && x.trim() !== '').map((x) => x.trim());
};

const textOf = (v: unknown): string | undefined => {
  if (typeof v === 'string') return v.trim() || undefined;
  if (v && typeof v === 'object' && typeof (v as { statement?: unknown }).statement === 'string') {
    return ((v as { statement: string }).statement).trim() || undefined;
  }
  return undefined;
};

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
  sourceKpis?: string[];  // ★ 既存のKPI（利用者が確定、または確定の印が無い入力値）。AIが変更しない。サーバーがDBから設定する
  aiProvisionalKpis?: string[];  // AIが以前に仮に置いた目標（確定ではない）。サーバーがDBから設定する
  due?: string;
  ownerName?: string;
  companyStrategy?: string;
  companyTargets?: any[];
  companyContext?: ExecutionCompanyContext;
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
    throw new RouteError(500, PUBLIC_MESSAGE.config);
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

  // ★ 既存のKPI（利用者が確定したもの、または確定の印が無い入力値）をプロンプトに明記（AIが変更しない）
  const sourceKpisText = Array.isArray(projectInfo.sourceKpis) && projectInfo.sourceKpis.length > 0
    ? `【既存のKPI（変更不可）】\n${projectInfo.sourceKpis.map((kpi, idx) => `${idx + 1}. ${kpi}`).join('\n')}\n\n★重要★ 上記のKPI名は絶対に変更・追加・削除しないでください。`
    : '【既存のKPI】未設定のため、AIで補完してください。';
  const aiKpisText = Array.isArray(projectInfo.aiProvisionalKpis) && projectInfo.aiProvisionalKpis.length > 0
    ? `\n\n【以前にAIが仮に置いた目標（確定ではない。書き直してよい）】\n${projectInfo.aiProvisionalKpis.map((kpi, idx) => `${idx + 1}. ${kpi}`).join('\n')}`
    : '';

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

${sourceKpisText}${aiKpisText}

${projectInfo.companyStrategy ? `【全社戦略】\n${projectInfo.companyStrategy}` : ''}
${projectInfo.companyTargets && projectInfo.companyTargets.length > 0 ? `【全社目標】\n${projectInfo.companyTargets.map((t: any) => `- ${t.label}: ${t.base}→${t.high || t.base} (${t.unit})`).join('\n')}` : ''}
${companyContextSection(projectInfo.companyContext)}
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

${REASONING_RULES}

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
${REASONING_OUTPUT_FIELDS}  "kpis": [
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

  console.log('[STAGE4] OpenAI API call start', { model: 'gpt-6-luna', promptLength: prompt.length });

  let response;
  try {
    response = await openai.chat.completions.create({
      model: 'gpt-6-luna',
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
    console.error('[STAGE4 API] OpenAI call failed', e?.code ?? 'unknown');
    throw new RouteError(502, PUBLIC_MESSAGE.upstream);
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
    const reasoning = sanitizeDraftReasoning(parsed);
    Object.assign(parsed, { causalChain: reasoning.causalChain, assumptionBasis: reasoning.assumptionBasis, verificationItems: reasoning.verificationItems });

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
    console.error('[STAGE4 API] OpenAI response could not be read', e?.message ?? 'unknown');
    throw new RouteError(502, PUBLIC_MESSAGE.parse);
  }

  return { draft: parsed, debugInfo };
}

export async function POST(request: NextRequest) {
  try {
    const admin = getSupabaseAdmin();
    const userId = await getAuthUserIdFromBearer(admin, request);
    if (!userId) return jsonError(401, PUBLIC_MESSAGE.unauthorized);

    const body = await request.json().catch(() => null);
    if (!body || typeof body !== 'object') return jsonError(400, 'projectTitle is required');

    if (body.__ping === true || body.__ping === 'true') {
      return NextResponse.json({ __pong: true, timestamp: new Date().toISOString(), message: 'API is alive' }, { status: 200 });
    }
    if (typeof body.projectTitle !== 'string' || !body.projectTitle.trim()) {
      return jsonError(400, 'projectTitle is required');
    }

    const { data: memberships, error: membershipError } = await admin
      .from('company_members')
      .select('company_id, role')
      .eq('user_id', userId);
    if (membershipError) throw new Error(`membership lookup failed: ${membershipError.message}`);
    const memberRows = (memberships ?? []) as MembershipRow[];
    if (memberRows.length === 0) return jsonError(403, PUBLIC_MESSAGE.forbidden);

    const companyIds = Array.from(new Set(memberRows.map((m) => String(m.company_id))));
    const { data: strategies, error: strategyError } = await admin
      .from('strategy_data')
      .select('id, company_id, departments')
      .in('company_id', companyIds);
    if (strategyError) throw new Error(`strategy lookup failed: ${strategyError.message}`);

    const resolved = resolveProjectScope({
      memberships: memberRows,
      strategies: (strategies ?? []) as StrategyRow[],
      projectTitle: body.projectTitle,
      departmentName: typeof body.departmentName === 'string' ? body.departmentName : undefined,
      projectId: typeof body.projectId === 'string' ? body.projectId : undefined,
      requestedCompanyId: typeof body.companyId === 'string' ? body.companyId : undefined,
      requestedStrategyId: typeof body.strategyId === 'string' ? body.strategyId : undefined,
    });
    if (!resolved.ok) {
      const failure = RESOLVE_ERROR[resolved.reason];
      return jsonError(failure.status, failure.message);
    }

    const project = resolved.project.project;
    const kpis = readKpisOf(project);
    const okr0 = (Array.isArray(project.okrs) ? project.okrs[0] : undefined) as Record<string, unknown> | undefined;

    const projectInfo: ExecutionDraftRequest = {
      departmentName: resolved.project.departmentName,
      projectTitle: textOf(project.title) ?? body.projectTitle,
      hypothesis: textOf(project.hypothesis),
      rationale: textOf(project.rationale),
      reason: textOf(project.reason),
      kind: textOf(project.kind),
      mainLever: textOf(project.mainLever),
      horizon: textOf(project.horizon),
      role: textOf(project.role) ?? 'REVENUE',
      due: textOf(okr0?.due),
      ownerName: textOf(okr0?.owner),
      sourceKpis: Array.from(new Set([...legacyKpiLabels(project), ...kpis.filter((k) => k.basis !== 'AI_PROVISIONAL').map((k) => k.label)])),
      aiProvisionalKpis: kpis.filter((k) => k.basis === 'AI_PROVISIONAL').map((k) => k.label),
      // 会社の戦略・目標・財務は、画面から届いた値を参考に使う（DBとの照合は未実装。報告に記載）
      companyStrategy: typeof body.companyStrategy === 'string' ? body.companyStrategy : undefined,
      companyTargets: Array.isArray(body.companyTargets) ? body.companyTargets : undefined,
      companyContext: body.companyContext && typeof body.companyContext === 'object' ? (body.companyContext as ExecutionCompanyContext) : undefined,
    };

    const { draft, debugInfo } = await generateExecutionDraft(projectInfo);
    return NextResponse.json({ success: true, draft, debugInfo });
  } catch (error: unknown) {
    if (error instanceof RouteError) return jsonError(error.status, error.publicMessage);
    console.error('[STAGE4 API] generation failed', error instanceof Error ? error.message : 'unknown');
    return jsonError(500, PUBLIC_MESSAGE.internal);
  }
}
