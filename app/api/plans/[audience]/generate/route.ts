import 'server-only';

import { NextRequest, NextResponse } from 'next/server';
import OpenAI from 'openai';
import { z } from 'zod';

import type { AudienceType } from '@/utils/export/buildPlanData';
import { buildPlanData } from '@/utils/export/buildPlanData';
import { bankFinancialPlanForRow, withBankFinancialPlan } from '@/utils/stage6/bankFinancialPlan';
import { bankFinancialPromptText, finalizeBankPlanText, type BankFinanceCheck } from '@/lib/plans/bankFinancialText';
import { getAuthUserIdFromBearer, requireMembership } from '@/lib/server/rbacGuard';
import { logAuditEvent } from '@/lib/server/auditLog';
import { checkSuspiciousKeywords } from '@/lib/inputGuardLogger';
import { getSupabaseAdmin } from '@/lib/supabaseAdmin';
import { getOpenAIModelParamsForProcess } from '@/lib/modelConfig';
import { canGeneratePlan } from '@/lib/plans/planDocumentState';
import { savePlanWithRetry } from '@/utils/supabase/generated-plans';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const DEBUG = process.env.NEXT_PUBLIC_DEBUG_HYDRATE === '1';

/**
 * /app/api/plans/[audience]/generate/route.ts
 *
 * ステークホルダー別計画書の AI本文生成 API
 * audience: bank | shareholder | employee
 *
 * フロー:
 * 1. 認証 (Bearer token)
 * 2. 企業スコープ確認 (membership)
 * 3. StrategyData 取得 (RLS適用)
 * 4. PlanData 構築 (audience別フィルタリング)
 * 5. プロンプト構築 (audience別カスタマイズ)
 * 6. OpenAI 呼び出し
 * 7. 監査ログ記録
 * 8. JSON返却
 */

const InputSchema = z.object({
  companyId: z.string().uuid('Invalid company ID'),
  strategyId: z.string().uuid('Invalid strategy ID'),
});

type GenerateRequest = z.infer<typeof InputSchema>;

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ audience: string }> }
) {
  // ★ catch ブロックからアクセスできるように外で初期化
  let userId: string | null = null;
  let body: GenerateRequest | null = null;

  try {
    // ===== Step 0: params await =====
    const { audience: audienceParam } = await params;
    const audience = audienceParam as AudienceType;

    // ===== Step 1: 認証 =====
    const admin = getSupabaseAdmin();
    userId = await getAuthUserIdFromBearer(admin, req);
    if (!userId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // ===== Step 2: 入力バリデーション =====
    body = InputSchema.parse(await req.json());

    if (!['bank', 'shareholder', 'employee'].includes(audience)) {
      return NextResponse.json(
        { error: 'Invalid audience type' },
        { status: 400 }
      );
    }

    // ===== Step 3: 企業スコープ確認 =====
    const membership = await requireMembership(admin, userId, body.companyId);
    if (!membership) {
      console.error('[Plan Gen] Membership check failed', {
        userId,
        companyId: body.companyId,
      });
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    if (!canGeneratePlan(membership.role)) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    // ===== Step 4: StrategyData 取得 (service_role で直接取得) =====
    // RLS 回避用に service_role を使用（認証ユーザーのメンバーシップは既に Step 3 で検証済み）
    const strategyRow = await admin
      .from('strategy_data')
      .select('*')
      .eq('company_id', body.companyId)
      .eq('id', body.strategyId)
      .maybeSingle();

    if (strategyRow.error) {
      console.error('[Plan Gen] Strategy data fetch error', {
        companyId: body.companyId,
        strategyId: body.strategyId,
        dbError: strategyRow.error.message,
      });
      return NextResponse.json(
        { error: 'Failed to fetch strategy data' },
        { status: 500 }
      );
    }

    if (!strategyRow.data) {
      console.warn('[Plan Gen] Strategy record not found', {
        companyId: body.companyId,
        strategyId: body.strategyId,
      });
      return NextResponse.json(
        { error: 'Strategy data not found' },
        { status: 404 }
      );
    }

    // company_name 検証（buildPlanData の前提）
    if (!strategyRow.data.company_name) {
      console.error('[Plan Gen] Strategy data incomplete (missing company_name)', {
        companyId: body.companyId,
        strategyId: body.strategyId,
        dataId: strategyRow.data.id,
      });
      return NextResponse.json(
        { error: 'Strategy data incomplete' },
        { status: 400 }
      );
    }

    // strategyId の一致確認（他社 strategyId の拒否、すでに query で確認したので念の為）
    if (strategyRow.data.id !== body.strategyId) {
      return NextResponse.json(
        { error: 'Strategy ID mismatch' },
        { status: 403 }
      );
    }

    // DB 行を StrategyData 型に変換
    let strategyState;
    try {
      strategyState = dbRowToStrategyData(strategyRow.data);    } catch (err) {
      console.error('[Plan Gen Step 4] dbRowToStrategyData failed', {
        error: err instanceof Error ? err.message : String(err),
      });
      throw err;
    }

    // ===== Step 5: PlanData 構築 =====
    let planData;
    try {
      planData = buildPlanData(strategyState, audience, {
        companyId: body.companyId,
        strategyId: body.strategyId,
      });    } catch (err) {
      console.error('[Plan Gen Step 5] buildPlanData failed', {
        error: err instanceof Error ? err.message : String(err),
      });
      throw err;
    }

    // ===== Step 5b: 銀行向け財務データの構造化ブロック（銀行向けのみ） =====
    let bankFinancialPlan;
    if (audience === 'bank') {
      bankFinancialPlan = bankFinancialPlanForRow({
        row: strategyRow.data,
        companyId: body.companyId,
        now: new Date(),
      });
    }
    planData = withBankFinancialPlan(planData, audience, bankFinancialPlan);

    // ===== Step 6: プロンプト構築 =====
    let prompt;
    try {
      prompt = buildAudiencePrompt(audience, planData);    } catch (err) {
      console.error('[Plan Gen Step 6] buildAudiencePrompt failed', {
        error: err instanceof Error ? err.message : String(err),
      });
      throw err;
    }

    // ===== Step 7: 入力ガード（疑わしいキーワード検査） =====
    const { autoMotive, exhaust, ceramic, oem } = checkSuspiciousKeywords(prompt);
    if (autoMotive || exhaust || ceramic || oem) {
      console.warn('[input-guard] Suspicious keywords detected in plan prompt', {
        companyId: body.companyId,
        flagged: { autoMotive, exhaust, ceramic, oem },
      });
    }

    // ===== Step 8a: OpenAI API 設定取得 =====
    let modelParams;
    try {
      modelParams = getOpenAIModelParamsForProcess('planGenerate');    } catch (err) {
      console.error('[Plan Gen Step 8a] getOpenAIModelParamsForProcess failed', {
        error: err instanceof Error ? err.message : String(err),
      });
      throw err;
    }

    // ===== Step 8b: OpenAI 呼び出し =====
    let response;
    try {
      const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

      // ★ gpt-5.6-luna は temperature パラメータをサポートしない
      // modelParams から指定されたパラメータをそのまま使用
      response = await openai.chat.completions.create({
        ...modelParams,
        messages: [
          {
            role: 'system',
            content: getSystemPrompt(audience),
          },
          {
            role: 'user',
            content: prompt,
          },
        ],
      });
      if (DEBUG) console.log('[Plan Gen Step 8b] OpenAI API call complete', {
        model: response.model,
        finishReason: response.choices[0]?.finish_reason,
        usageInputTokens: response.usage?.prompt_tokens,
        usageOutputTokens: response.usage?.completion_tokens,
      });
    } catch (err) {
      console.error('[Plan Gen Step 8b] OpenAI API call failed', {
        error: err instanceof Error ? err.message : String(err),
        errorCode: (err as any)?.status || (err as any)?.code,
      });
      throw err;
    }

    // ===== Step 8c: レスポンス解析と検証 =====
    let generatedText;
    try {
      // ★ reasoning モデルのレスポンス構造を確認
      const firstChoice = response.choices[0];
      generatedText = firstChoice?.message?.content;

      // ★ 本文が空の場合はエラーとして扱う（HTTP 200 ではなくエラーを返す）
      if (!generatedText || generatedText.trim() === '') {
        console.error('[Plan Gen Step 8c] Generation produced no content', {
          finishReason: firstChoice?.finish_reason,
          usageCompletionTokens: response.usage?.completion_tokens,
          reasoningTokens: (response as any)?.usage?.reasoning_tokens,
        });
        return NextResponse.json(
          {
            error: 'Generation incomplete',
            details: 'AI model did not produce output within token limits',
          },
          { status: 503 }
        );
      }
    } catch (err) {
      console.error('[Plan Gen Step 8c] Response parsing failed', {
        error: err instanceof Error ? err.message : String(err),
      });
      throw err;
    }

    // ===== Step 9: 監査ログ =====
    try {
      await logAuditEvent({
        actorUserId: userId,
        action: 'PLAN_GENERATE',
        companyId: body.companyId,
        targetType: 'plan',
        metadata: {
          audience,
          strategyId: body.strategyId,
          generatedTokens: response.usage?.completion_tokens,
        },
      });    } catch (err) {
      console.error('[Plan Gen Step 9] Audit log failed', {
        error: err instanceof Error ? err.message : String(err),
      });
      // Audit log failure は非致命的なので continue
    }

    // ===== Step 10: レスポンス返却 =====
    let bankFinanceCheck: BankFinanceCheck | undefined;
    try {
      // ★ 「Generation failed」などのエラー文字列が本文になっていないか検証
      if (
        generatedText === 'Generation failed' ||
        generatedText.toLowerCase().includes('generation failed') ||
        generatedText.length < 100
      ) {
        console.error('[Plan Gen Step 10] Invalid generated text detected', {
          generatedTextLength: generatedText.length,
        });
        return NextResponse.json(
          {
            error: 'Generation incomplete',
            details: 'Generated text is too short or invalid',
          },
          { status: 503 }
        );
      }

      if (audience === 'bank') {
        const finance = finalizeBankPlanText(generatedText, bankFinancialPlan);
        generatedText = finance.text;
        bankFinanceCheck = finance.check;
        if (finance.check.issues.length > 0) {
          console.warn('[Plan Gen] Bank financial text issues', {
            companyId: body.companyId,
            proseReplaced: finance.check.proseReplaced,
            issueCount: finance.check.issues.length,
          });
        }
      }

      const sections = parseSections(generatedText, audience);
      // ★ sections が空でないか検証
      if (!sections || sections.length === 0) {
        console.error('[Plan Gen Step 10] No sections generated', {
          sectionCount: sections?.length || 0,
        });
        return NextResponse.json(
          {
            error: 'Generation incomplete',
            details: 'Could not parse generated content into sections',
          },
          { status: 503 }
        );
      }

      const generatedAt = new Date().toISOString();

      const save = await savePlanWithRetry(admin, {
        companyId: body.companyId,
        strategyId: body.strategyId,
        audience,
        userId,
        generatedText,
        sections,
        generatedAt,
      });

      if (save.status === 'unsaved') {
        console.error('[Plan Gen] Save failed after generation', {
          companyId: body.companyId,
          strategyId: body.strategyId,
          audience,
          reason: save.reason,
        });
        try {
          await logAuditEvent({
            actorUserId: userId,
            action: 'PLAN_SAVE_FAILED',
            companyId: body.companyId,
            targetType: 'plan',
            metadata: { audience, strategyId: body.strategyId, reason: save.reason },
          });
        } catch {
          // 監査ログの失敗は応答を変えない
        }
      }

      return NextResponse.json({
        audience,
        companyId: body.companyId,
        strategyId: body.strategyId,
        generatedText,
        sections,
        generatedAt,
        status: save.status,
        version: save.status === 'saved' ? save.version : null,
        saveReason: save.status === 'unsaved' ? save.reason : null,
        ...(bankFinancialPlan ? { bankFinancialPlan } : {}),
        ...(bankFinanceCheck ? { bankFinanceCheck } : {}),
      });
    } catch (err) {
      console.error('[Plan Gen Step 10] Response preparation failed', {
        error: err instanceof Error ? err.message : String(err),
      });
      throw err;
    }
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : String(err);
    const errorCode = (err as any)?.status || (err as any)?.code;

    console.error('[Plan Gen] Catch block error', {
      errorType: err?.constructor?.name,
      errorMessage: errorMessage.substring(0, 200),
      errorCode,
      hasZodError: err instanceof z.ZodError,
    });

    // ★ 失敗時の監査ログ
    try {
      await logAuditEvent({
        actorUserId: userId,
        action: 'PLAN_GENERATE_FAILED',
        companyId: body?.companyId,
        targetType: 'plan',
        metadata: {
          error: errorMessage.substring(0, 200),
          errorCode,
        },
      });
    } catch (auditErr) {
      console.error('[Plan Gen] Failed to log audit event', {
        error: auditErr instanceof Error ? auditErr.message : String(auditErr),
      });
    }

    if (err instanceof z.ZodError) {
      return NextResponse.json(
        { error: 'Invalid input', details: err.errors },
        { status: 400 }
      );
    }

    if (err instanceof Error && err.message.includes('Unauthorized')) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    return NextResponse.json(
      { error: 'Failed to generate plan' },
      { status: 500 }
    );
  }
}

// ===== Helper Functions =====

/**
 * DB 行（snake_case）を StrategyData 型に変換
 * buildPlanData のために必要なフィールドを抽出
 *
 * ★ Phase 1 修正：
 * - STAGE1の過去財務実績（financePL, csvFinanceData）を追加
 * - STAGE2の正式目標（companyTargets, midtermStrategy）を追加
 * - STAGE5/6の将来予測（financeSummary）を追加
 */
function dbRowToStrategyData(row: any): Record<string, any> | null {
  if (!row) return null;

  return {
    // 識別情報
    id: row.id,
    strategyId: row.id,
    companyId: row.company_id,

    // 全社情報
    companyName: row.company_name,
    mission: row.mission,
    vision: row.vision,
    value: row.value,
    ceoIntent: row.ceo_intent,

    // STAGE1：現状分析
    industry: row.industry,
    employees: row.employees,
    revenue: row.revenue,
    businessContent: row.business_content,
    customerSegment: row.customer_segment,
    strength: row.strength,
    weakness: row.weakness,
    opportunity: row.opportunity,
    threat: row.threat,
    stage1Issues: Array.isArray(row.stage1_issues) ? row.stage1_issues : [],

    // ★ STAGE1：過去財務実績（Phase 1 追加）
    financePL: Array.isArray(row.finance_pl) ? row.finance_pl : undefined,
    csvFinanceData: (row.csv_finance_data && typeof row.csv_finance_data === 'object')
      ? row.csv_finance_data
      : undefined,
    businessSegments: Array.isArray(row.business_segments)
      ? row.business_segments
      : undefined,

    // STAGE2：全社戦略
    finalStory: Array.isArray(row.final_story) ? row.final_story : [],

    // ★ STAGE2：正式目標（Phase 1 追加）
    companyTargets: Array.isArray(row.company_targets)
      ? row.company_targets
      : undefined,

    // ★ STAGE2：中計設計（swot_suggestions 内から展開）
    midtermStrategy: row.swot_suggestions?.midtermStrategy
      ? row.swot_suggestions.midtermStrategy
      : undefined,

    // STAGE3：部門別戦略
    departments: Array.isArray(row.departments) ? row.departments : [],

    // STAGE4：実行計画
    // （buildPlanData で必要なフィールドのみ）

    // STAGE5/6：財務・シミュレーション
    simulationResult: row.simulation_results
      ? Array.isArray(row.simulation_results)
        ? row.simulation_results[0]
        : row.simulation_results
      : null,

    // ★ STAGE5/6：将来財務予測（Phase 1 追加）
    financeSummary: (() => {
      const fs = row.finance_summary;
      if (Array.isArray(fs)) return fs;
      if (fs && typeof fs === 'object' && Array.isArray((fs as any).rows)) {
        return (fs as any).rows;
      }
      return undefined;
    })(),
  };
}

function getSystemPrompt(audience: AudienceType): string {
  const basePrompt = `You are an expert business consultant specializing in creating comprehensive business plans.
Your task is to generate a persuasive, logically structured business plan document tailored for a specific stakeholder.

IMPORTANT RULES:
1. DO NOT create or modify financial numbers
2. DO NOT invent company names, department names, or metrics that are not in the input data
3. DO NOT add fictional strategies or initiatives
4. DO NOT make up numerical assumptions
5. Focus on connecting existing data with clear, logical narratives
6. Write in Japanese
7. Use the exact data provided - no extrapolation or creative numbers
8. CRITICAL: Do NOT double-count figures from STAGE4 and STAGE6
   - If both STAGE4 project impacts and STAGE6 projections exist, clarify which is the official target
   - Do NOT sum them together
   - If data contradicts, mark as "要確認" (pending confirmation)
9. Be explicit about data confidence levels and missing assumptions`;

  const audienceSpecific = {
    bank: `AUDIENCE: Banking/Financial Institutions
You are creating an "経営改善・事業計画書" (Business Improvement & Execution Plan).

KEY FOCUS AREAS:
- Management challenges and root causes
- Improvement strategies with clear rationale
- Concrete implementation steps with timelines
- Expected financial impact (revenue/profit/cost improvement)
- Cash flow and debt repayment capability
- Execution management structure and responsibilities
- Risk mitigation and contingency plans

STRUCTURE:
1. 経営課題の分析 (Analysis of Management Challenges)
2. 改善戦略 (Improvement Strategy)
3. 具体的施策と期待効果 (Concrete Measures & Expected Impact)
4. 財務計画と返済可能性 (Financial Plan & Repayment Capacity)
5. 実行管理体制 (Execution Management Framework)

CRITICAL INSTRUCTIONS FOR FINANCIAL DATA HANDLING:
★ 以下は厳守事項です。指示に従わない場合、銀行審査で信頼を失います。

1. 実績と計画の区別：
   - 「過去年度別財務実績」は**実績値**です。将来予測ではありません。
   - 実績値をそのまま記載し、数値を変更してはいけません。

2. 数値の正確性：
   - 提供された売上・利益・営業利益率などを勝手に計算し直さない。
   - 元データと異なる数値を書いてはいけません。
   - ゼロ値や負値も正しい値として記載する。

3. 経営課題との関係分析：
   - 過去実績の傾向（増減、利益率の変化）から、現在の経営課題の根拠を分析する。
   - 「売上が減少している理由は何か」という観点で、提供されたデータと経営課題を結びつける。

4. 根拠のない推測は禁止：
   - 数値から直接確認できない原因を断定しない。
   - 例：「利益率が低い理由はコスト構造」→ コスト内訳が無ければ推測でも良いが、「高い」「低い」の判断は提供データを基準に。

5. 目標値の扱い：
   - STAGE2で設定された「正式な全社目標」とSTAGE4の「施策効果合計」を混同しない。
   - 両者が異なる場合、その理由（施策だけでは不十分 / 施策が目標を超える など）を分析する。

TONE: Professional, conservative, fact-based. Emphasize realistic assessment and risk management.`,

    shareholder: `AUDIENCE: Shareholders/Investors
You are creating a "中期経営計画書" (Mid-term Business Plan).

KEY FOCUS AREAS:
- Growth strategy and competitive advantage
- Market positioning and business environment
- Strategic portfolio allocation
- Revenue and profit growth targets
- Capital efficiency and investment returns
- Enterprise value enhancement
- Strategic initiatives and expected returns

STRUCTURE:
1. 経営環境と戦略方向性 (Business Environment & Strategy Direction)
2. 成長戦略と競争優位性 (Growth Strategy & Competitive Advantage)
3. 事業別戦略と期待収益 (Business Unit Strategies & Expected Returns)
4. 財務目標と資本効率 (Financial Targets & Capital Efficiency)
5. 企業価値向上への取り組み (Value Creation Initiatives)

TONE: Investor-focused, growth-oriented, emphasizing strategic opportunities and financial returns.`,

    employee: `AUDIENCE: Employees/Internal Staff
You are creating a "経営方針・実行計画書" (Management Policy & Execution Plan).

KEY FOCUS AREAS:
- Management philosophy and corporate direction
- Why transformation/improvement is necessary
- Company-wide goals and targets
- Departmental roles and responsibilities
- Concrete actions and key performance indicators
- Implementation timeline and milestones
- How individual/department efforts connect to overall strategy

STRUCTURE:
1. 経営方針と改革の必要性 (Management Policy & Need for Transformation)
2. 全社目標と戦略方向 (Company Goals & Strategic Direction)
3. 部門別の役割と重点施策 (Departmental Roles & Key Initiatives)
4. 具体的な行動計画とKPI (Concrete Action Plans & KPIs)
5. 実行スケジュール (Implementation Schedule)

TONE: Inspiring yet practical, emphasizing clarity on roles, concrete actions, and individual contribution.`,
  };

  return basePrompt + '\n' + audienceSpecific[audience];
}

function buildAudiencePrompt(
  audience: AudienceType,
  planData: any
): string {
  // ★ Phase 1 追加：STAGE1の年度別財務実績を表形式で構築
  const historicalFinancesTable =
    planData.stage1.historicalFinances && planData.stage1.historicalFinances.length > 0
      ? `
【過去年度別財務実績】
| 年度 | 売上高 | 売上総利益 | 営業利益 | 当期純利益 | 単位 |
|------|--------|-----------|---------|-----------|------|
${planData.stage1.historicalFinances
  .map(
    (f: any) =>
      `| ${f.year} | ${f.revenue !== undefined ? f.revenue : '-'} | ${f.grossProfit !== undefined ? f.grossProfit : '-'} | ${f.operatingIncome !== undefined ? f.operatingIncome : '-'} | ${f.netIncome !== undefined ? f.netIncome : '-'} | ${f.unit || '未確認'} |`
  )
  .join('\n')}

※注意: 上記は過去実績です。将来予測ではありません。数値の単位が確認できない場合は「単位未確認」と表示されています。
※分析時は実績値の傾向分析に留め、数値を変更しないでください。
`
      : '【過去年度別財務実績】データなし\n';

  const bankFinanceActive = audience === 'bank' && !!planData.bankFinancialPlan;
  const baseData = `
会社名: ${planData.companyName}
業種: ${planData.stage1.industry}

【STAGE1: 現状分析】
${planData.stage1.keyIssues?.length > 0 ? `経営課題: ${planData.stage1.keyIssues.join('、')}` : '経営課題: 未入力'}

${historicalFinancesTable}

【STAGE2: 全社戦略】
ミッション: ${planData.companyMission || '未定義'}
ビジョン: ${planData.companyVision || '未定義'}
${planData.stage2.midtermConcept ? `中計コンセプト: ${planData.stage2.midtermConcept}` : ''}
${planData.stage2.priorityThemes?.length > 0 ? `重点テーマ: ${planData.stage2.priorityThemes.join('、')}` : ''}

${
  planData.stage2.companyTargets && planData.stage2.companyTargets.length > 0
    ? `【STAGE2: 正式な全社目標】
${planData.stage2.companyTargets.map((t: any) => `- ${t.label}: ${t.value}`).join('\n')}
`
    : ''
}

【STAGE3: 部門別戦略】
${planData.stage3.departments
  .slice(0, 5)
  .map(
    (d: any) =>
      `部門: ${d.name}
役割: ${d.strategicRole || '未定義'}
課題: ${d.keyIssues?.join('、') || '未定義'}
施策: ${d.projects?.join('、') || '未定義'}`
  )
  .join('\n')}

【STAGE4: 実行計画・期待効果】
${planData.stage4.projectImpacts
  ?.slice(0, 5)
  .map(
    (p: any) =>
      `施策: ${p.title}
売上寄与: ${p.impactRevenue || '未定'}
営業利益寄与: ${p.impactOpIncome || '未定'}
投資額: ${p.impactInvestment || '未定'}`
  )
  .join('\n')}

【STAGE5/6: 財務目標】
☆ STAGE2登録売上目標: ${planData.stage56.companyTargetRevenue || '未設定'}
参考：STAGE4施策別期待効果合計: ${planData.stage56.projectImpactSum || 'なし'}
推奨目標: ${planData.stage56.northStarRevenue || '未設定'}
${bankFinanceActive ? '' : `財務シミュレーション状況: ${planData.stage56.projectionStatus || '未実施'}`}
${planData.stage56.northStarMetrics?.length ? `重要指標: ${planData.stage56.northStarMetrics.map((m: any) => `${m.label}=${m.value}`).join(', ')}` : '重要指標: 未定義'}
${!bankFinanceActive && planData.stage56.projectionNote ? `備考: ${planData.stage56.projectionNote}` : ''}
`;

  const audienceSpecificPrompt = {
    bank: `
銀行向けの経営改善・事業計画書を作成してください。

以下の点に特に注意してください：
1. 経営課題から改善施策への論理的つながりを明示
2. 期待効果（売上増、コスト削減）の現実的な根拠
3. 実行体制と責任者の明確性
4. 返済可能性の根拠（CFやキャッシュの裏付け）
5. 銀行員目線でのリスク評価と対応策

数値計画がSTAGE6で確認できない場合は「要確認」と記載してください。
`,

    shareholder: `
株主向けの中期経営計画書を作成してください。

以下の点に特に注意してください：
1. 成長の根拠（市場機会、競争優位）を明確に
2. 各事業の期待リターンと投資額のバランス
3. 資本配分の論理（なぜこの事業に投資するのか）
4. 競合との差別化ポイント
5. 企業価値向上への具体的パス

配当政策やEPS目標がない場合は省略してください。
`,

    employee: `
社員向けの経営方針・実行計画書を作成してください。

以下の点に特に注意してください：
1. 会社全体が「どこに向かうのか」を明確に
2. 自分の部門・職務がどう貢献するのかを示す
3. 個人レベルでの行動ステップを具体化
4. 何をいつまでに達成するのかを明確化
5. KPIを通じた進捗の可視化

部門別OKRが未確定の場合は「マネージャーとの協議で確定」と記載してください。
`,
  };

  const bankFinancePrompt = audience === 'bank' ? bankFinancialPromptText(planData.bankFinancialPlan) : '';
  return baseData + '\n' + audienceSpecificPrompt[audience] + (bankFinancePrompt ? '\n' + bankFinancePrompt : '');
}

function parseSections(text: string, audience: AudienceType): string[] {
  // テキストを章に分割（簡易パーサー）
  const lines = text.split('\n');
  const sections: string[] = [];
  let currentSection = '';

  for (const line of lines) {
    // 「第X章」または「【」で始まる行を章の区切りとして判定
    if (line.match(/^(第|【)/)) {
      if (currentSection) {
        sections.push(currentSection.trim());
      }
      currentSection = line;
    } else {
      currentSection += '\n' + line;
    }
  }

  if (currentSection) {
    sections.push(currentSection.trim());
  }

  return sections.length > 0 ? sections : [text];
}
