/* eslint-disable @typescript-eslint/no-explicit-any */
export const runtime = 'nodejs';

import { NextResponse } from 'next/server';

/* ========= requestId 生成 ========= */
function makeRequestId() {
  return globalThis.crypto?.randomUUID?.() ?? `req_${Date.now()}`;
}
import OpenAI from 'openai';
import { sanitizeAskMessages } from '@/lib/ceoChat/askPolicy';
import { buildConsultingReasoningBlock, consultingEffort, selectConsultingPlan, type ConsultingPlan } from '@/lib/ceoChat/consultingReasoning';
import { consultationQueryOf } from '@/lib/ceoChat/followUpContext';
import { buildAnswerStyleBlock, decideAnswerStyle, isManualAdvisorChat } from '@/lib/ceoChat/answerStyle';
import { CONSULTANT_PERSONA, HELP_TONE } from '@/lib/ceoChat/consultantPersona';
import { composeExtraBlock, isExecutionQuestion, type ExtraParts } from '@/lib/ceoChat/extraContext';
import { stage6PlanDepartments } from '@/lib/cascade/projectLifecycle';
import { attributableOkrs } from '@/lib/cascade/okrAttribution';
import { resolveScreenContext } from '@/lib/screens/screenContext';
import { consultBlockFor } from '@/lib/consult/consultFocus';
import { loadExecutionScope, parseExecutionInput } from '@/lib/ceoChat/executionScope';
import { buildOperationGuidance } from '@/lib/operationKnowledge/guidance';
import { getFullStrategyDataByStrategyId } from '@/utils/supabase/strategy';
import { normalizeStrategyData } from '@/utils/supabase/normalize';
import { logInputGuard, checkSuspiciousKeywords } from '@/lib/inputGuardLogger';
import agentPrompt from '@/lib/agentPrompt';
import { insertAgentLog } from '@/lib/supabase/agentLogs';
import type { SupabaseClient } from '@supabase/supabase-js';
import {
  classifyHeuristic,
  classifyLLM,
  chooseBetter,
  type IntentResult,
} from '@/lib/intentRouter';
import { buildFacilitatorBlock } from '@/lib/facilitatorProtocol';
import { buildJSONOutputInstruction, safeParseFacilitatorJSON } from '@/lib/facilitatorSchema';
import { buildStage1Insight } from '@/utils/insights/stage1Insight';
import { detectAutoMode } from '@/lib/autoModeRouter';
import { buildHelpSystemPrompt } from '@/lib/helpPrompt';
import { pickRelevantKnowledge } from '@/lib/growthKnowledge';
import { searchExternalFinancialData } from '@/lib/externalFinancialSearch';
import { CONSULT_BEHAVIOR, CONSULT_ROLE, buildExternalFinancialBlock } from '@/lib/agentPrompt';
import { withConsultTone } from '@/lib/ceoChat/consultInstruction';
import { computeStage1ValueAnalysis } from '@/utils/valueAnalysis';
import { selectCanonicalStory } from '@/lib/ceoChat/strategyRationale';
import {
  selectContextSources,
  selectStage56Sources,
  selectSupplementSources,
  buildSelectedContextBlock,
  hasCompanyReference,
  isGeneralKnowledgeQuestion,
  selectOrganizationSource,
  isStage5RegistrationQuestion,
  isStage3QuestionStatusQuestion,
  isStage3WorkspaceQuestion,
  isStage4StatusQuestion,
} from '@/lib/ceoChat/contextSelection';
import { buildStage5RegistrationBlock } from '@/lib/ceoChat/stage5Registration';
import { buildStage3QuestionStatusBlock } from '@/lib/ceoChat/stage3QuestionStatus';
import { buildStage1IssuesBlock } from '@/lib/ceoChat/stage1Issues';
import { buildFinanceRegistrationStatus, financeSummaryForPrompt } from '@/lib/ceoChat/stage1Blocks';
import { buildStage2StoryStateBlock } from '@/lib/ceoChat/stage2StoryState';
import { buildStage3WorkingStateBlock } from '@/lib/ceoChat/stage3WorkingState';
import { loadWorkspace } from '@/lib/server/stage3StrategyBook';
import { buildExecutionSummaryBlock, isDepartmentsAbsent } from '@/lib/ceoChat/stage4Projection';
import { buildStage4PlanBlock, loadStage4PlanRows } from '@/lib/ceoChat/stage4PlanBlock';
import {
  buildStage5ProgressBlock,
  formatOwnProgressLines,
  CHECKIN_LOOKBACK_DAYS,
} from '@/lib/ceoChat/stage5Progress';
import {
  buildStage6PlanBlock,
  buildCashPositionBlock,
  isStage6FinanceAbsent,
  latestActual,
  hasStage6TargetOf,
} from '@/lib/ceoChat/stage6Plan';
import {
  buildStage2TargetBlock,
  isStage2TargetQuestion,
  isStage2TargetsAbsent,
  normalizeStage2Targets,
} from '@/lib/ceoChat/stage2Targets';
import { buildStage3BridgeBlock, isStage3BridgeAbsent } from '@/lib/ceoChat/stage3Context';
import {
  buildReferenceStatusBlock,
  buildReferenceStatusLines,
  classifyStage6Text,
  TRUNCATION_MARK,
  type ReferenceFacts,
} from '@/lib/ceoChat/referenceStatus';
import { buildFocusAnswersBlock } from '@/lib/ceoChat/supplementBlocks';
import {
  buildStatClaimNotice,
  buildWebSearchStatusBlock,
  checkStatisticClaims,
  countUnmatchedNumbers,
  countUrls,
  isCeoWebSearchEnabled,
  isExplicitWebSearchRequest,
  resolveCeoWebSearch,
  verifyAnswerUrls,
  type CeoFact,
  type WebSearchDiagnostics,
  type WebSearchTurnState,
} from '@/lib/ceoChat/webSearch';
import {
  buildReviewPromptBlock,
  isReviewQuestion,
  buildStage4ReviewCandidates,
  classifyReviewRun,
  extractReviewMarkers,
  type ReviewCandidate,
  type ReviewMarkerDiagnostics,
  type ReviewTarget,
} from '@/lib/ceoChat/reviewTargets';
// ★ Sprint 6A: Light RAG 統合
import { getGrowthRagIndex } from '@/lib/rag/indexer';
import { buildMilestoneGuard, isMilestone } from '@/lib/companion/companionAdvice';
import { retrieveGrowthKnowledge } from '@/lib/rag/retriever';
import { buildRagContextBlock, buildRagDebugFooter } from '@/lib/rag/prompt';
import type { StrategyData } from '@/types/strategy';

// --- Service Role（統一管理） ---
import { getSupabaseAdmin } from '@/lib/supabaseAdmin';
import {
  getAuthUserIdFromBearer,
  requireMembership,
  resolveCompanyIdFromStrategyId,
} from '@/lib/server/rbacGuard';

/* ========= 型 ========= */
type Role = 'system' | 'user' | 'assistant';
type Message = { role: Role; content: string };
type FetchRefFacts = {
  stage1MetricsFailed: boolean;
  companyTargetsAbsent: boolean;
  progressLogsFailed: boolean;
  progressLogCount: number;
  execution: { departmentsTotal: number; shownDepartments: number; complete: boolean; absenceConfirmed: boolean };
};
const PROGRESS_LOG_LIMIT = 200;
type RequestBody = {
  messages: Message[];
  userId: string;
  strategyId: string;
  companyId: string;
  screen?: unknown;
  execution?: unknown;
  consult?: unknown;
  meta?: {
    stage?: 'strategy' | 'manual' | 'generic' | 'hybrid'; // 既存
    mode?: 'text' | 'facilitator' | 'help';               // Sprint 1-4: text/facilitator/help
    output?: 'text' | 'json';                              // Sprint 1: 出力形式
    insights?: 'none' | 'stage1';                          // Sprint 2: STAGE1インサイト注入
    companion?: { milestone?: unknown };                   // 自律伴走の節目の助言（規則を追加する）
  };
};

/* ========= GROWTH SHIFT 基礎ガイド（概念編） ========= */
const GROWTH_SHIFT_FOUNDATION = `
## GROWTH SHIFT とは

GROWTH SHIFTは、戦略の策定・浸透・実行をつなぎ、組織の判断と行動を揃え、企業の成長につなげるためのAI企業変革プラットフォームです。合言葉は「戦略を行動へ。企業を成長へ。」です。

経営の意図を現場の判断に届け、日々の行動につなげることを目指します。認識、価値観、感情、関係性、暗黙の前提に生じるズレにも目を向けます。

## 製品名の表記

利用者の発言にある「グロースシフト」「クロスシフト」「GROWTH SHIFT」は、いずれも本製品（GROWTH SHIFT）のことです。表記の違いを確認したり訂正したりする言葉（「おそらく」「〜のことですね」など）は書かず、普通の名前として扱ってください。会社名・金額・年度・戦略の内容は、利用者の言葉のとおりに扱い、補正しないでください。

## 支援の姿勢

最終的な判断と対話の主体は人です。AIは論点の整理、問い、たたき台、確認を支援します。業績向上は目指す成果ですが、利用するだけで保証されるものではありません。戦略の浸透には、経営者と社員の対話と納得が欠かせません。

## 各STAGE で取り組むこと

（製品の概要を聞かれても、この一覧をそのまま並べない。質問に答える範囲で必要なものだけ触れる。）

- **STAGE1 会社の現状はどうか（企業価値分析）**：財務と事業の現状を捉え、企業価値と成長の論点を見いだす
- **STAGE2 会社は何を目指すのか（全社戦略）**：未来の成長に向けた全社の方向性と経営の意図を言語化する
- **STAGE3 各部門の役割は何か（事業・部門別戦略）**：全社の重点を事業・部門の役割、判断基準、共通行動へ展開する
- **STAGE4 現場は何をするのか（実行計画策定）**：重点課題を指標と実行計画に落とし込む
- **STAGE5 どうやって前に進めるか（実行支援）**：進捗を確認し、課題や次の行動を見直す
- **STAGE6 成果を確かめる（業績シミュレーション）**：実行の進み具合と期待される財務寄与を見て、見直しに使う
- **すり合わせルーム**：組織内の違和感と認識のズレを整理し、対話の論点を見つける

## STAGE2 について

STAGE2は全社戦略を考える場です。現状の危機や成長機会を起点に、顧客に提供する価値、選ばれる理由、重点とする方向、経営として社員に伝えたい意図を掘り下げます。用意された問いとAIの追加質問を使い、人が考えを深め、戦略を言葉にします。

## STAGE5 について

STAGE5は、立てた計画の実行状況を確認し、課題や次の行動を考える領域です。計画の進捗と課題を確認し、次の行動を考えます。目標やKPIの設定方法は対象のSTAGEに合わせて案内します。
`;

/* ========= 禁則 ========= */
const TABOO =
  '【回答禁止】個人情報・人事評価や人事異動の断定、株主・取締役の機微情報、具体的な法的助言、確証のない断定的表現には答えません。必要な場合は専門家相談を案内します。';

const FEATURE_CLAIM_RULE =
  '【機能の案内】GROWTH SHIFTの画面や機能として案内してよいのは、この説明と操作ガイドに書かれたものだけです。書かれていない記録・台帳・管理・通知の機能は、GROWTH SHIFTにあるとは言わないでください。業務上の記録が必要な場合は、「Excelや紙などで記録する」といった一般的な方法として提案してください。';

const INPUT_AND_IMAGE_RULE = [
  '【画面の入力・画像】',
  '- 画面のスクリーンショットや画像を送ってほしいと求めない。画像の添付や画像からの読み取りには、現在対応していない。資料の添付は、PDF・Excel・CSVだけに対応している。',
  '- 今いる画面と登録された操作の情報から、画面にある入力欄やボタンの名前を具体的に案内する。登録にない欄は推測しない。',
  '- AI入力代行で入力案を作れるのは、次の項目だけ。STAGE1の財務表の全社売上高（年度を指定）、STAGE2の「経営者の思い」への追加、STAGE3の6つの問いの回答と戦略書の再生成、STAGE4の実行計画書（作成・目標の追加・アクションの追加と期日の変更）、STAGE5の選んでいる案件の社内共有欄への反映。入力案は、利用者が承認するまで反映・保存しない。',
  '- 上の項目以外の入力欄を直接入力できるかを聞かれたら、「この項目の直接入力は現在対応していません」と答え、利用者が自分で入力する手順を案内する。',
  '- 「私は画面操作ができません」「画面に直接入力できません」といった一律の説明はしない。',
].join('\n');

/* ========= ユーティリティ ========= */
const safeArray = <T,>(v: any): T[] => (Array.isArray(v) ? (v as T[]) : []);

/* ========= 進捗サマリ（プロンプトに埋め込む軽量要約） ========= */
function buildProgressSummary(progressLogs: any[] = [], failed = false) {
  if (failed) return '（進捗ログは取得できませんでした。未登録とは判断しないでください）';
  if (!progressLogs.length) return '（進捗ログなし）';
  return formatOwnProgressLines(progressLogs).join('\n');
}

async function fetchStage5Company(admin: SupabaseClient, companyId: string, now: Date) {
  const since = new Date(now.getTime() - CHECKIN_LOOKBACK_DAYS * 24 * 60 * 60 * 1000).toISOString();
  const [okrRes, logRes] = await Promise.all([
    admin.from('okrs').select('id, department_id, project_id, objective, is_deleted').eq('company_id', companyId),
    admin
      .from('progress_logs')
      .select('okr_id, created_at, content, score, status')
      .eq('company_id', companyId)
      .gte('created_at', since)
      .limit(5000),
  ]);
  return {
    okrs: okrRes.error ? [] : safeArray<any>(okrRes.data),
    companyLogs: logRes.error ? [] : safeArray<any>(logRes.data),
    companyLogsFailed: !!okrRes.error || !!logRes.error,
  };
}

/* ========= コンテキスト取得（strategyId必須） ========= */
async function fetchStrategyContext(args: {
  companyId: string;
  strategyId: string;
  userId: string;
  question: string;
  supabaseAdmin?: SupabaseClient;
}) {
  const { companyId, strategyId, userId, question, supabaseAdmin } = args;

  // strategyId + companyId で直接取得（データ混在防止）
  let strategy: StrategyData | null = null;
  let stage1MetricsFailed = false;
  let companyTargetsAbsent = false;
  let departmentsAbsent = false;
  try {
    // ★ アプローチ1: server-side admin client を明示的に渡す
    const { data: sRow, error } = await getFullStrategyDataByStrategyId(strategyId, companyId, supabaseAdmin);
    if (error) console.warn('[ask-ceo-agent] getFullStrategyDataByStrategyId error:', error?.message || error);

    // ★ デバッグ: normalizeStrategyData 前後の比較
    if (sRow) {
      const beforeNormalize = {
        has_financeSummary: Array.isArray((sRow as any)?.financeSummary),
        financeSummary_count: Array.isArray((sRow as any)?.financeSummary) ? (sRow as any).financeSummary.length : 0,
        has_financePL: Array.isArray((sRow as any)?.financePL),
        financePL_count: Array.isArray((sRow as any)?.financePL) ? (sRow as any).financePL.length : 0,
      };

      companyTargetsAbsent = isStage2TargetsAbsent((sRow as any).companyTargets);
      departmentsAbsent = isDepartmentsAbsent((sRow as any).departments);
      strategy = normalizeStrategyData(sRow as Partial<StrategyData>) as StrategyData;
      const rawStage3Bridge = (sRow as any).stage3_strategy_bridge;
      if (rawStage3Bridge != null && (strategy as any).stage3_strategy_bridge == null) {
        (strategy as any).stage3_strategy_bridge = rawStage3Bridge;
      }

      try {
        const stage1 = computeStage1ValueAnalysis({
          financePL: strategy.financePL,
          financeBS: strategy.financeBS,
          financeSummary: strategy.financeSummary as any,
          segmentPL: strategy.segmentPL,
          segmentBS: strategy.segmentBS,
          pbrManual: strategy.pbrManual,
        });
        strategy.valueAnalysis = stage1.company;
      } catch (e: any) {
        stage1MetricsFailed = true;
        console.warn('[ask-ceo-agent] stage1 value analysis error:', e?.message || e);
      }

      strategy.financeSummary = financeSummaryForPrompt(strategy.financeSummary, strategy.financePL) as any;

      const afterNormalize = {
        has_financeSummary: Array.isArray((strategy as any)?.financeSummary),
        financeSummary_count: Array.isArray((strategy as any)?.financeSummary) ? (strategy as any).financeSummary.length : 0,
        has_financePL: Array.isArray((strategy as any)?.financePL),
        financePL_count: Array.isArray((strategy as any)?.financePL) ? (strategy as any).financePL.length : 0,
      };

      console.log('[fetchStrategyContext] normalize before/after', {
        before: beforeNormalize,
        after: afterNormalize,
      });
    } else {
      strategy = null;
    }
  } catch (e: any) {
    console.warn('[ask-ceo-agent] strategy load exception:', e?.message || e);
    strategy = null;
  }

  // 進捗ログ（本人の最近分） - Service Role Admin で取得（RLS回避）
  let progressLogs: any[] = [];
  let progressLogsFailed = false;
  try {
    const adminClient = supabaseAdmin ?? getSupabaseAdmin();
    const { data: logs, error: plErr } = await adminClient
      .from('progress_logs')
      .select('id, created_at, content, score, status, user_id, okr_id')
      .eq('user_id', userId)
      .eq('company_id', companyId)  // ★ company_id でフィルタ（RLS準拠）
      .order('created_at', { ascending: false })
      .limit(PROGRESS_LOG_LIMIT);
    if (plErr) {
      progressLogsFailed = true;
      console.warn('[ask-ceo-agent] progress_logs select error:', plErr?.message || plErr);
    }
    progressLogs = safeArray<any>(logs);
    console.log('[ask-ceo-agent] progress_logs fetched', {
      userId: userId.substring(0, 8),
      companyId: companyId.substring(0, 8),
      count: progressLogs.length,
    });
  } catch (e: any) {
    progressLogsFailed = true;
    console.error('[ask-ceo-agent] progress_logs select exception:', {
      errorMessage: e?.message || String(e),
      errorName: e?.name,
      userId: userId.substring(0, 8),
      companyId: companyId.substring(0, 8),
    });
  }

  const departments = safeArray<any>(strategy?.departments ?? (strategy as any)?.editableCascadeResult);
  const execSummary = buildExecutionSummaryBlock(departments, question, undefined, departmentsAbsent);
  const executionText = execSummary.text;
  const stage4PlanRows = supabaseAdmin ? await loadStage4PlanRows(supabaseAdmin, companyId, strategyId) : null;
  const stage4PlanText = buildStage4PlanBlock({ rows: stage4PlanRows, departments, question });
  const progressSummaryText = buildProgressSummary(progressLogs, progressLogsFailed);
  const extraParts: ExtraParts = { execution: executionText, stage4Plan: stage4PlanText, progress: progressSummaryText };

  // フルが取れない場合（strategyId が無効または削除されている場合）
  if (!strategy || Object.keys(strategy).length === 0) {
    return { strategy: null, answers2: [], finalStory: [], extraParts: null, refFacts: null };
  }

  const answers2 = safeArray<any>((strategy as any)?.answers2);
  const finalStory = safeArray<any>(selectCanonicalStory(strategy as any).chapters);
  const refFacts: FetchRefFacts = {
    stage1MetricsFailed,
    companyTargetsAbsent,
    progressLogsFailed,
    progressLogCount: progressLogs.length,
    execution: {
      departmentsTotal: execSummary.departments.total,
      shownDepartments: execSummary.departments.shown,
      complete: execSummary.complete,
      absenceConfirmed: departmentsAbsent,
    },
  };
  return { strategy, answers2, finalStory, extraParts, refFacts };
}

/* ========= route ========= */
export async function POST(req: Request) {
  const requestId = makeRequestId();

  try {
    // --- ENV チェック（最小必須） ---
    const missingEnv: string[] = [];
    if (!process.env.OPENAI_API_KEY) missingEnv.push('OPENAI_API_KEY');
    if (missingEnv.length > 0) {
      console.error('[ask-ceo-agent]', requestId, 'missing_env', missingEnv);
      return NextResponse.json(
        {
          error: 'missing_env',
          missing: missingEnv,
          requestId,
          content: 'サーバーエラーが発生しました。',
        },
        { status: 500 }
      );
    }
    const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

    // --- 認証（rbacGuard で統一） ---
    const admin = getSupabaseAdmin();
    const authUserId = await getAuthUserIdFromBearer(admin, req);
    if (!authUserId) {
      return NextResponse.json({ content: '認証が必要です。', error: 'no bearer' }, { status: 401 });
    }

    // --- 入力 ---
    let body: RequestBody | null = null;
    try {
      body = (await req.json()) as RequestBody;
    } catch {
      return NextResponse.json({ content: 'invalid payload', error: 'invalid payload' }, { status: 400 });
    }
    const { messages, userId, strategyId, companyId: requestCompanyId, meta } = body ?? ({} as RequestBody);
    if (
      !userId ||
      !strategyId ||
      typeof requestCompanyId !== 'string' ||
      requestCompanyId.length === 0 ||
      !Array.isArray(messages)
    ) {
      return NextResponse.json({ content: 'invalid payload', error: 'invalid payload' }, { status: 400 });
    }

    // --- 本人確認 ---
    if (authUserId !== userId) {
      return NextResponse.json({ content: '権限がありません（ユーザー不一致）。', error: 'user mismatch' }, { status: 403 });
    }

    // --- 会社スコープ: 送られた companyId と strategy の会社が一致し、かつ所属していること ---
    const strategyCompanyId = await resolveCompanyIdFromStrategyId(admin, strategyId);
    if (!strategyCompanyId || strategyCompanyId !== requestCompanyId) {
      return NextResponse.json(
        { content: '企業が一致しません。画面を再読み込みしてください。', error: 'company mismatch' },
        { status: 403 }
      );
    }
    const membership = await requireMembership(admin, authUserId, strategyCompanyId);
    if (!membership) {
      return NextResponse.json({ content: 'この企業へのアクセス権がありません。', error: 'no membership' }, { status: 403 });
    }
    const companyId = membership.companyId;

    // 実行支援の対象（選択中のプロジェクト）。会社・戦略・部門・プロジェクトの整合と、対象の範囲だけを参照する
    let executionPrompt = '';
    if (body?.execution !== undefined) {
      const parsed = parseExecutionInput(body.execution, { companyId, strategyId });
      if (!parsed.ok) {
        return NextResponse.json({ content: '相談の対象を確認できませんでした。画面を再読み込みしてください。', error: parsed.error }, { status: parsed.status });
      }
      const scope = await loadExecutionScope(admin, parsed.value);
      if (!scope.ok) {
        return NextResponse.json({ content: '相談の対象を確認できませんでした。画面を再読み込みしてください。', error: scope.error }, { status: scope.status });
      }
      executionPrompt = scope.promptBlock;
    }

    // ★ TASK 3: strategyId が undefined の場合ログ出力
    if (!strategyId) {
      console.warn('[ask-ceo-agent]', requestId, 'strategyId_undefined', {
        userId: userId.substring(0, 8),
        companyId: companyId ? companyId.substring(0, 8) : 'unresolved',
      });
    }

    if (!companyId) {
      console.error('[ask-ceo-agent]', requestId, 'companyId_not_found', {
        userId: userId.substring(0, 8),
        strategyId: strategyId ? strategyId.substring(0, 8) : 'undefined',
      });
      return NextResponse.json(
        { content: '戦略データが見つかりません。', error: 'strategy not found', requestId },
        { status: 404 }
      );
    }

    // --- コンテキスト取得（会社IDに紐づくフル → 最小フォールバック） ---
    // ★ TASK 3: デバッグ出力強化（companyId / strategyId / 取得結果）
    console.log('[ask-ceo-agent]', requestId, 'fetching_strategy_context', {
      companyId: companyId.substring(0, 8),
      strategyId: strategyId ? strategyId.substring(0, 8) : 'undefined',
      userId: userId.substring(0, 8),
    });

    const lastUser = (messages || []).slice().reverse().find((m) => m.role === 'user')?.content || '';
    const consultationQuery = consultationQueryOf(messages || []);

    // ★ アプローチ1: server-side admin client を fetchStrategyContext に渡す
    const { strategy, answers2, finalStory, extraParts, refFacts } = await fetchStrategyContext({
      companyId,
      strategyId,
      userId,
      question: lastUser,
      supabaseAdmin: admin,
    });

    // ★ TASK 3: 取得結果のログ + STAGE1 データ流路の追跡
    const hasFinanceSummary = Array.isArray((strategy as any)?.financeSummary);
    const financeSummaryCount = hasFinanceSummary ? (strategy as any).financeSummary.length : 0;
    const hasValueAnalysis = !!(strategy as any)?.valueAnalysis && typeof (strategy as any).valueAnalysis === 'object';

    console.log('[ask-ceo-agent]', requestId, 'strategy_context_result', {
      strategy_exists: !!strategy,
      strategy_keys: strategy ? Object.keys(strategy).slice(0, 10) : null,
      has_answers2: !!answers2 && Array.isArray(answers2) && answers2.length > 0,
      has_finalStory: !!finalStory && Array.isArray(finalStory) && finalStory.length > 0,
      extra_parts_len: extraParts ? extraParts.execution.length + extraParts.stage4Plan.length + extraParts.progress.length : 0,
    });

    // ① 検査: financeSummary の存在確認
    console.log('[ask-ceo-agent]', requestId, '①_STAGE1_data_check', {
      has_financeSummary: hasFinanceSummary,
      financeSummary_count: financeSummaryCount,
      has_valueAnalysis: hasValueAnalysis,
    });

    // ★ 外部決算情報検索（一旦停止）
    let externalFinancialBlock = '';
    // const isPerformanceQuestion = lastUser && /業績|決算|売上|利益|財務/.test(lastUser);
    // if (isPerformanceQuestion && strategy?.companyName) {
    //   try {
    //     const extData = await searchExternalFinancialData(strategy.companyName);
    //     if (extData) {
    //       externalFinancialBlock = buildExternalFinancialBlock(extData);
    //       console.log('[ask-ceo-agent]', requestId, 'external_financial_search_success', {
    //         companyName: strategy.companyName,
    //         fiscalYear: extData.fiscalYear,
    //         source: extData.source,
    //       });
    //     } else {
    //       console.log('[ask-ceo-agent]', requestId, 'external_financial_search_no_data', {
    //         companyName: strategy.companyName,
    //       });
    //     }
    //   } catch (error) {
    //     console.error('[ask-ceo-agent]', requestId, 'external_financial_search_error', {
    //       error: String(error),
    //       companyName: strategy.companyName,
    //     });
    //   }
    // }

    if (!strategy) {
      console.error('[ask-ceo-agent]', requestId, 'context_missing', {
        companyId: companyId.substring(0, 8),
        strategyId: strategyId ? strategyId.substring(0, 8) : 'undefined',
      });
      return NextResponse.json(
        {
          content: '戦略コンテキストを取得できませんでした。初期化・保存状況をご確認ください。',
          error: 'context missing',
          requestId,
        },
        { status: 400 }
      );
    }

    // ★ Sprint 4: mode 解決ロジック（優先順位：明示指定 > auto判定）
    let resolvedMode: 'facilitator' | 'help' | 'advisor' = 'advisor';
    let autoModeResult: any = undefined;

    if (meta?.mode === 'facilitator') {
      // A) meta.mode が明示的に 'facilitator' → 固定
      resolvedMode = 'facilitator';
    } else if (meta?.mode === 'help') {
      // B) meta.mode が明示的に 'help' → 固定
      resolvedMode = 'help';
    } else {
      // C) meta.mode が無い → auto 判定
      autoModeResult = detectAutoMode({ lastUserText: lastUser });
      resolvedMode =
        autoModeResult.mode === 'help' && !isExplicitWebSearchRequest(lastUser) ? 'help' : 'advisor';
    }

    // --- 意図判定（ヒューリスティック → LLM 併用） ---
    let intent: IntentResult = classifyHeuristic(lastUser);
    if (intent.confidence < 0.7) {
      try {
        intent = chooseBetter(intent, await classifyLLM(openai, lastUser));
      } catch {
        /* LLM分類失敗は無視 */
      }
    }
    if (meta?.stage) intent = { stage: meta.stage, confidence: 0.99, reasons: ['forced'] };

    const lastUserMessage = (messages || [])
      .slice()
      .reverse()
      .find((m) => m.role === 'user')?.content || '';

    // ★ Sprint 6A.1: system プロンプト構築（help/facilitator/advisor で分岐）
    // help モード時の注入順（UI創作防止）：
    // 1) buildHelpSystemPrompt（新規約：UI創作禁止、RAG優先）
    // 2) pickRelevantKnowledge（growthKnowledge から関連ナレッジ抽出）
    // 3) RAG 検索結果（buildRagContextBlock）
    // → 規約を最上位に配置し、RAG根拠を優先させる
    const screen = resolveScreenContext(body?.screen);
    if (body?.screen !== undefined && !screen) {
      console.warn('[ask-ceo-agent]', requestId, 'screen_context_rejected');
    }
    const guidance = buildOperationGuidance({
      screenId: screen?.screenId ?? null,
      query: lastUserMessage,
      role: membership.role,
    });
    const names = safeArray<any>((strategy as any)?.departments)
      .flatMap((d) => [d?.name, ...safeArray<any>(d?.projects).map((p) => p?.title ?? p?.name)])
      .filter((n): n is string => typeof n === 'string');
    const isManual = isManualAdvisorChat({
      resolvedMode,
      output: meta?.output ?? 'text',
      insights: meta?.insights ?? 'none',
      hasCompanion: !!meta?.companion,
      hasOperationGuidance: !!guidance.text,
    });
    const extraBlock = extraParts
      ? composeExtraBlock(
          extraParts,
          isManual
            ? { execution: isExecutionQuestion(lastUser, names), progress: selectStage56Sources(lastUser).progress }
            : { execution: true, progress: true }
        )
      : '';

    let systemBase: string;
    let companyContextUsed = false;
    let consultingPlan: ConsultingPlan | null = null;
    let externalSourceAllowlist: string[] | null = null;
    let webSearchDiagnostics: WebSearchDiagnostics | null = null;
    let webSearchFacts: CeoFact[] = [];
    let webSearchStatus: WebSearchTurnState['status'] = null;
    const webSearchEnabled = isCeoWebSearchEnabled(process.env.CEO_CHAT_WEB_SEARCH_ENABLED);
    let reviewCandidates = new Map<string, ReviewCandidate>();
    let reviewRun: {
      applicable: boolean;
      stage4Total: number;
      unlinkable: number;
      shownInPrompt: number;
      relevantOutsideShown: number;
    } = { applicable: false, stage4Total: 0, unlinkable: 0, shownInPrompt: 0, relevantOutsideShown: 0 };
    let knowledgeIdsUsed: string[] = [];
    let ragResultDebug = '';
    let ragContextBlock = '';

    if (resolvedMode === 'help') {
      // help モード: 関連ナレッジを取得（growthKnowledge）
      const relevantKnowledge = pickRelevantKnowledge(lastUser, 3);
      knowledgeIdsUsed = relevantKnowledge.map((k) => k.id);

      // RAG 検索を実行（help モードのみ）→ RAG根拠を優先
      try {
        const ragIndex = getGrowthRagIndex();
        const ragResult = retrieveGrowthKnowledge(lastUser, ragIndex, 4);
        if (ragResult.hits.length > 0) {
          ragContextBlock = '\n\n' + buildRagContextBlock(ragResult);
          if (process.env.NEXT_PUBLIC_DEBUG_AGENT === '1') {
            ragResultDebug = buildRagDebugFooter(ragResult);
          }
        }
      } catch (err) {
        // RAG エラーは黙ってスキップ（既存ナレッジで対応）
        console.error('[RAG] 検索エラー', err);
      }

      // 注入順: 規約 → GROWTH SHIFT基礎ガイド → growthKnowledge → RAG検索結果 → 操作ガイド検索結果 → 禁則
      systemBase =
        buildHelpSystemPrompt({
          productName: 'GROWTH SHIFT',
          relevantKnowledge,
        }) +
        '\n\n' + GROWTH_SHIFT_FOUNDATION +
        ragContextBlock +
        '\n' +
        TABOO +
        '\n' +
        FEATURE_CLAIM_RULE +
        '\n' +
        INPUT_AND_IMAGE_RULE + '\n\n' + HELP_TONE;
      console.log('[ask-ceo-agent]', requestId, 'persona_route', { resolved_mode: 'help', persona: 'help_tone' });
    } else {
      // advisor/facilitator モード: 既存ロジック（agent-based systemPrompt）
      // ③ 検査: どの経路が選ばれるか + 企業データ参照の判定
      // 企業名をノーマライズ（「株式会社」削除、スペース削除等）
      const normalizeCompanyName = (name: string): string => {
        return name
          .replace(/^[\(（]株[\)）]\s*/, '') // (株) / （株）削除
          .replace(/[\(（]株[\)）]\s*$/, '') // 末尾の(株)削除
          .replace(/^株式会社\s*/, '') // 前置の株式会社削除
          .replace(/\s*株式会社$/, '') // 末尾の株式会社削除
          .replace(/\s+/g, '') // スペース削除
          .toLowerCase();
      };

      const companyName = (strategy as any)?.companyName || '';
      const normalizedCompanyName = normalizeCompanyName(companyName);

      // 会社への言及（当社・わが社・社長など）があるか判定
      const hasPronouns = hasCompanyReference(lastUser);

      // 企業名を含むかを判定（企業名を正規化した上で、質問に含まれるか）
      const hasCompanyName = normalizedCompanyName && lastUser.includes(companyName);

      // 企業名が正規化後のパターンでマッチするか（例：「株式会社日本製罐」→「日本製罐」）
      const hasNormalizedCompanyName = normalizedCompanyName &&
        lastUser.replace(/\s+/g, '').toLowerCase().includes(normalizedCompanyName);

      // 選択中企業のデータを使用すべきか判定（企業名の表記ゆれに対応）
      const isAboutSelectedCompany = hasPronouns || hasCompanyName || hasNormalizedCompanyName;

      // 一般的な経営知識の質問だけ企業データを省く。経営相談は主語が省略されていても企業データを使う
      const isGeneralQuestion = !isAboutSelectedCompany && isGeneralKnowledgeQuestion(lastUser);

      // 他社名を明示した質問かを検出
      // 選択中企業に関する質問の場合は、他社明示と判定しない
      const hasExplicitOtherCompany = !isAboutSelectedCompany && /\w+の[^を]*?は|外部|競合|他社/.test(lastUser);

      // generic でも、選択中企業に関する質問ならば agentPrompt を使用
      const shouldUseAgentPrompt = !isGeneralQuestion;
      companyContextUsed = shouldUseAgentPrompt;

      console.log('[ask-ceo-agent]', requestId, '③_system_prompt_route', {
        intent_stage: intent.stage,
        using_agent_prompt: shouldUseAgentPrompt,
        using_generic_response: !shouldUseAgentPrompt,
        is_general_question: isGeneralQuestion,
        is_about_selected_company: isAboutSelectedCompany,
        has_pronouns: hasPronouns,
        has_company_name: hasCompanyName,
        has_explicit_other_company: hasExplicitOtherCompany,
      });

      // ④-2 検査: agentPrompt 呼び出し前に financeSummary を確認
      if (shouldUseAgentPrompt) {
        const fsArray = Array.isArray((strategy as any)?.financeSummary);
        const fsCount = fsArray ? (strategy as any).financeSummary.length : 0;
        const fsFirstKeys = fsCount > 0 ? Object.keys((strategy as any).financeSummary[0] || {}).slice(0, 5) : [];
        console.log('[ask-ceo-agent]', requestId, '④-2_before_agentPrompt', {
          finance_summary_is_array: fsArray,
          finance_summary_count: fsCount,
          finance_summary_first_keys: fsFirstKeys,
          will_call_agentPrompt: true,
        });
      }

      systemBase =
        (shouldUseAgentPrompt
          ? agentPrompt(strategy as any, answers2 as any, finalStory as any, isManual ? CONSULT_ROLE : undefined, isManual ? CONSULT_BEHAVIOR : undefined) +
            (externalFinancialBlock ? '\n\n' + externalFinancialBlock : '') +
            '\n' + extraBlock + '\n\n' + GROWTH_SHIFT_FOUNDATION
          : (isManual
              ? CONSULTANT_PERSONA + '\n\n一般的な経営知識の質問です。自社の登録情報は使わず、推測は推測と明記して、日本語で簡潔かつ正確に回答します。'
              : 'あなたは博識なアシスタントです。日本語で簡潔かつ正確に回答します。推測は推測と明記してください。') + '\n\n' + GROWTH_SHIFT_FOUNDATION) +
        '\n' +
        TABOO +
        '\n' +
        FEATURE_CLAIM_RULE +
        '\n' +
        INPUT_AND_IMAGE_RULE;

      // facilitator モード時のみファシリテーション指示を追加
      if (resolvedMode === 'facilitator') {
        systemBase += '\n\n' + buildFacilitatorBlock({ stage: 'generic' });
      }

      const webSearch = await resolveCeoWebSearch({
        enabled: webSearchEnabled,
        question: lastUser,
        strategy: strategy as StrategyData,
        client: openai,
      });
      webSearchStatus = webSearch.status;
      if (webSearch.block) systemBase += '\n\n' + webSearch.block;
      if (webSearch.category) {
        externalSourceAllowlist = webSearch.allowedUrls;
        webSearchDiagnostics = webSearch.diagnostics;
        webSearchFacts = webSearch.facts;
        console.log('[ask-ceo-agent]', requestId, 'ceo_web_search', {
          category: webSearch.category,
          status: webSearch.status,
          categoryCount: webSearch.categoryCount,
          sourceCount: webSearch.sourceCount,
          elapsedMs: webSearch.elapsedMs,
          skipReason: webSearch.skipReason ?? null,
        });
      }

      // 重要な個社の経営相談だけ、判断に必要な情報を追加する。
      consultingPlan = selectConsultingPlan(consultationQuery, isManual && shouldUseAgentPrompt && !!strategy);
      const baselineContext = selectContextSources(consultationQuery);
      const contextSelection = consultingPlan ? {
        ...baselineContext,
        finance: baselineContext.finance || consultingPlan.sources.finance,
        rationale: baselineContext.rationale || consultingPlan.sources.rationale,
        alignment: baselineContext.alignment || consultingPlan.sources.alignment,
        unclear: false,
      } : baselineContext;
      if (consultingPlan) systemBase += '\n\n' + buildConsultingReasoningBlock(consultingPlan);
      const selectedContextBlock = buildSelectedContextBlock({
        selection: contextSelection,
        strategy: strategy as any,
        companyDataIncluded: !!shouldUseAgentPrompt,
        organization: selectOrganizationSource(lastUser),
      });
      if (selectedContextBlock) systemBase += '\n\n' + selectedContextBlock;

      if (shouldUseAgentPrompt) {
        const baselineStages = selectStage56Sources(consultationQuery);
        const stageSources = consultingPlan ? {
          progress: baselineStages.progress || consultingPlan.sources.progress,
          plan: baselineStages.plan || consultingPlan.sources.plan,
        } : baselineStages;
        let stage5Facts: ReferenceFacts['stage5'] = null;
        let stage6Facts: ReferenceFacts['stage6'] = null;
        let stage2TargetFacts: ReferenceFacts['stage2Targets'] = null;
        let stage3Facts: ReferenceFacts['stage3Bridge'] = null;
        if (stageSources.progress) {
          const now = new Date();
          const company = await fetchStage5Company(admin, companyId, now);
          const stage5Text = buildStage5ProgressBlock({
            departments: (strategy as any)?.departments,
            okrs: attributableOkrs(company.okrs, (strategy as any)?.departments),
            companyLogs: company.companyLogs,
            companyLogsFailed: company.companyLogsFailed,
            now,
          });
          stage5Facts = {
            failed: company.companyLogsFailed,
            truncated: stage5Text.includes(TRUNCATION_MARK),
          };
          systemBase += '\n\n' + stage5Text;
        }
        const csvFinance = (strategy as any)?.csvFinanceData;
        const financeAbsent = isStage6FinanceAbsent((strategy as any)?.financePL);
        if (stageSources.plan) {
          const planText = buildStage6PlanBlock({
            csvFinanceData: csvFinance,
            companyId,
            financePL: (strategy as any)?.financePL,
            financeBS: (strategy as any)?.financeBS,
            departments: stage6PlanDepartments((strategy as any)?.departments),
            fiscalYearEnd: (strategy as any)?.fiscalYearEnd,
            currentYear: new Date().getFullYear(),
            companyTargets: (strategy as any)?.companyTargets,
            simulationResults: (strategy as any)?.simulationResults,
            // 重要な投資判断では質問文に明示されない資金余力も参照する。
            question: consultingPlan?.focus === 'investment' || consultingPlan?.focus === 'finance'
              ? lastUser + '\n資金・投資' : lastUser,
          });
          stage6Facts = { scope: 'plan', financeEmpty: financeAbsent, ...classifyStage6Text(planText) };
          systemBase += '\n\n' + planText;
        }
        const supplement = selectSupplementSources(consultationQuery);
        if (supplement.cash && !stageSources.plan) {
          const cashText = buildCashPositionBlock({
            csvFinanceData: csvFinance,
            companyId,
            financePL: (strategy as any)?.financePL,
            financeBS: (strategy as any)?.financeBS,
            departments: stage6PlanDepartments((strategy as any)?.departments),
            fiscalYearEnd: (strategy as any)?.fiscalYearEnd,
            currentYear: new Date().getFullYear(),
            companyTargets: (strategy as any)?.companyTargets,
            question: lastUser,
          });
          stage6Facts = { scope: 'cash', financeEmpty: financeAbsent, ...classifyStage6Text(cashText) };
          systemBase += '\n\n' + cashText;
        }
        if (supplement.talent) {
          const focus = buildFocusAnswersBlock(strategy as any, lastUser);
          if (focus) systemBase += '\n\n' + focus;
        }
        if (isStage2TargetQuestion(consultationQuery)) {
          const targets = normalizeStage2Targets((strategy as any)?.companyTargets);
          const absenceConfirmed = refFacts?.companyTargetsAbsent ?? false;
          stage2TargetFacts = { rows: targets.rows.length, total: targets.total, absenceConfirmed };
          systemBase += '\n\n' + buildStage2TargetBlock({
            companyTargets: (strategy as any)?.companyTargets,
            actual: latestActual((strategy as any)?.financePL, (strategy as any)?.financeBS),
            absenceConfirmed,
            stage6TargetRegistered: hasStage6TargetOf((strategy as any)?.csvFinanceData, companyId),
          });
        }
        if (contextSelection.alignment && !contextSelection.operation) {
          const bridge = buildStage3BridgeBlock(strategy as any);
          stage3Facts = {
            state: bridge.state,
            absenceConfirmed: isStage3BridgeAbsent(strategy as any),
            omitted: bridge.omitted,
          };
        }
        const reviewIndex = buildStage4ReviewCandidates((strategy as any)?.departments, strategyId);
        const reviewBlock: ReturnType<typeof buildReviewPromptBlock> = isReviewQuestion(reviewIndex, lastUser)
          ? buildReviewPromptBlock(reviewIndex, lastUser)
          : { text: '', shown: [], relevantOutsideShown: 0 };
        if (reviewBlock.text) systemBase += '\n\n' + reviewBlock.text;
        reviewCandidates = new Map(reviewBlock.shown.map((c) => [c.id, c]));
        reviewRun = {
          applicable: true,
          stage4Total: reviewIndex.candidates.length,
          unlinkable: reviewIndex.unlinkableProjects,
          shownInPrompt: reviewBlock.shown.length,
          relevantOutsideShown: reviewBlock.relevantOutsideShown,
        };
        if (refFacts) {
          const referenceFacts: ReferenceFacts = {
            stage1: { financeSummaryCount, metricsFailed: refFacts.stage1MetricsFailed },
            stage2Qa: {
              chapterSteps: safeArray<any>(answers2)
                .map((c) => (Array.isArray(c?.steps) ? c.steps.length : 0))
                .filter((n) => n > 0),
            },
            stage2Story: { chapterCount: finalStory.length },
            stage2Targets: stage2TargetFacts,
            stage3Bridge: stage3Facts,
            stage4: {
              departmentsTotal: refFacts.execution.departmentsTotal,
              shownDepartments: refFacts.execution.shownDepartments,
              complete: refFacts.execution.complete,
              absenceConfirmed: refFacts.execution.absenceConfirmed,
            },
            progressLog: {
              failed: refFacts.progressLogsFailed,
              count: refFacts.progressLogCount,
              limit: PROGRESS_LOG_LIMIT,
            },
            stage5: stage5Facts,
            stage6: stage6Facts,
          };
          systemBase += '\n\n' + buildReferenceStatusBlock(buildReferenceStatusLines(referenceFacts));
        }
      }
      console.log('[ask-ceo-agent]', requestId, 'context_selection', {
        ...contextSelection,
        companyDataIncluded: shouldUseAgentPrompt,
        selected_block_len: selectedContextBlock.length,
      });
    }

    if (screen) {
      systemBase += `\n\n【現在の画面】${screen.label}（${screen.pathname}）\n操作案内はこの画面の範囲で行う。`;
    }
    if (body?.consult !== undefined) {
      const deptRow = await admin.from('strategy_data').select('departments').eq('id', strategyId).maybeSingle();
      const departmentList: unknown[] = Array.isArray(deptRow.data?.departments) ? deptRow.data.departments : [];
      const departmentNames = new Set<string>();
      const projectIds = new Set<string>();
      for (const d of departmentList) {
        if (!d || typeof d !== 'object') continue;
        const dept = d as { name?: unknown; projects?: unknown };
        if (typeof dept.name === 'string' && dept.name) departmentNames.add(dept.name);
        for (const p of Array.isArray(dept.projects) ? dept.projects : []) {
          const id = p && typeof p === 'object' ? (p as { id?: unknown }).id : undefined;
          if (typeof id === 'string' || typeof id === 'number') projectIds.add(String(id));
        }
      }
      const consultBlock = consultBlockFor(body.consult, screen, { departmentNames, projectIds });
      if (consultBlock) systemBase += `\n\n${consultBlock}`;
    }
    if (executionPrompt) {
      systemBase += `\n\n${executionPrompt}`;
    }

    systemBase += '\n\n' + buildWebSearchStatusBlock({ enabled: webSearchEnabled, status: webSearchStatus });

    if (guidance.text) systemBase += '\n\n' + guidance.text;
    if (strategy) systemBase += '\n\n' + buildFinanceRegistrationStatus((strategy as any).financePL);

    // ★ meta.output === 'json' のときだけJSON出力指示を追加
    const output = meta?.output ?? 'text';
    if (output === 'json') {
      systemBase += '\n\n' + buildJSONOutputInstruction();
    }

    // ★ meta.insights === 'stage1' のときだけSTAGE1インサイトを注入
    const insightsMode = meta?.insights ?? 'none';
    if (insightsMode === 'stage1' && strategy) {
      try {
        const insight = buildStage1Insight({
          strategy,
          valueAnalysis: (strategy as any)?.valueAnalysis,
          financeSummary: (strategy as any)?.financeSummary,
          businessPortfolio: (strategy as any)?.businessPortfolio,
          issueBlocks: (strategy as any)?.stage1Issues,
        });
        if (Object.keys(insight).length > 0) {
          systemBase +=
            '\n\n【STAGE1 企業価値分析 INSIGHTS（JSON）】\n' +
            JSON.stringify(insight) +
            '\n' +
            'INSIGHTSの各項目（赤旗・推奨勝ち筋・必要データ）を根拠に、具体的な助言をしてください。推測や想定の部分は「推測ですが」と明記してください。';
        }
      } catch (e) {
        // insights 生成失敗は無視（systemBase は変更しない）
        console.warn('[ask-ceo-agent] buildStage1Insight error:', e);
      }
    }

    const companionMilestone = meta?.companion?.milestone;
    if (isMilestone(companionMilestone)) {
      systemBase += '\n\n' + buildMilestoneGuard(companionMilestone);
    }

    // 登録状況の質問は、相談の経路（モード）に関係なく、保存済みの値の集計を根拠に答える
    if (strategy && isStage5RegistrationQuestion(lastUser)) {
      const now = new Date();
      const company = await fetchStage5Company(admin, companyId, now);
      const registration = buildStage5RegistrationBlock({
        departments: (strategy as any)?.departments,
        planRows: await loadStage4PlanRows(admin, companyId, strategyId),
        okrs: attributableOkrs(company.okrs, (strategy as any)?.departments),
        companyLogs: company.companyLogs,
        companyLogsFailed: company.companyLogsFailed,
        now,
      });
      systemBase += '\n\n' + registration.text;
    }
    if (strategy && isStage3QuestionStatusQuestion(lastUser)) {
      systemBase += '\n\n' + buildStage3QuestionStatusBlock((strategy as any)?.departments).text;
    }
    if (strategy && companyContextUsed) {
      const issuesText = buildStage1IssuesBlock((strategy as any)?.stage1Issues);
      if (issuesText) systemBase += '\n\n' + issuesText;
      systemBase += '\n\n' + buildStage2StoryStateBlock(strategy as Record<string, unknown>);
    }
    if (strategy && isStage4StatusQuestion(lastUser)) {
      const departmentsNow = (strategy as any)?.departments;
      if (!systemBase.includes('# 部門・OKR・実行計画')) {
        systemBase += '\n\n' + buildExecutionSummaryBlock(departmentsNow, lastUser, undefined, false).text;
      }
      if (!systemBase.includes('# 実行計画（STAGE4・保存済みの計画書）')) {
        const planRows = await loadStage4PlanRows(admin, companyId, strategyId);
        systemBase += '\n\n' + buildStage4PlanBlock({ rows: planRows, departments: departmentsNow, question: lastUser });
      }
    }
    if (strategy && companyContextUsed && isStage3WorkspaceQuestion(lastUser)) {
      let workspace: Awaited<ReturnType<typeof loadWorkspace>>;
      try {
        workspace = await loadWorkspace(admin, strategyId);
      } catch {
        workspace = { ok: false, status: 503, error: 'workspace_unavailable' };
      }
      systemBase += '\n\n' + buildStage3WorkingStateBlock(
        workspace.ok ? { state: workspace.workspace.state, failed: false } : { state: null, failed: true },
      );
    }

    const askMessages = sanitizeAskMessages(messages);
    if (
      isManualAdvisorChat({
        resolvedMode,
        output,
        insights: insightsMode,
        hasCompanion: !!meta?.companion,
        hasOperationGuidance: !!guidance.text,
      })
    ) {
      const answerStyle = decideAnswerStyle({
        userText: lastUser,
        hasPriorAssistantTurn: askMessages.some((m) => m.role === 'assistant'),
        priorUserTexts: askMessages.slice(0, -1).filter((m) => m.role === 'user').map((m) => m.content),
      });
      systemBase += '\n\n' + buildAnswerStyleBlock(answerStyle);
      console.log('[ask-ceo-agent]', requestId, 'persona_route', { resolved_mode: resolvedMode, persona: 'consultant', answer_style: answerStyle });
    }

    // --- OpenAI 呼び出し ---
    const openaiReq: any = {
      model: 'gpt-5.6-luna',
      reasoning_effort: consultingEffort(consultingPlan, process.env.CEO_CHAT_CONSULTING_HIGHER_EFFORT === '1'),
      max_completion_tokens: 6000,
      messages: [
        { role: 'system', content: systemBase },
        ...(isManual && companyContextUsed ? withConsultTone(askMessages) : askMessages),
      ] as any,
    };

    // ★ meta.output === 'json' のときだけ response_format を付与（JSON形式を要求）
    if (output === 'json') {
      openaiReq.response_format = { type: 'json_object' };
    }

    // ★ 【検証ログ】financeSummary が systemBase に正しく含まれているか確認
    const fsArray = (strategy as any)?.financeSummary;
    const fsCount = Array.isArray(fsArray) ? fsArray.length : 0;
    const fsItems = Array.isArray(fsArray)
      ? fsArray.map((item: any) => ({
          year: typeof item?.year === 'number' ? item.year : null,
          has_revenue: typeof item?.revenue === 'number',
          has_operatingIncome: typeof item?.operatingIncome === 'number',
          has_netIncome: typeof item?.netIncome === 'number',
        }))
      : [];
    const hasFinanceSummaryBlock = systemBase.includes('【STAGE1 財務サマリ');
    console.log('[ask-ceo-agent]', requestId, '【FINAL_CHECK】financeSummary_in_systemBase', {
      fs_is_array: Array.isArray(fsArray),
      fs_count: fsCount,
      fs_items: fsItems,
      has_finance_block_in_prompt: hasFinanceSummaryBlock,
      systemBase_length: systemBase.length,
    });

    // 【入力充足度ログ】OpenAI呼び出し直前に観測ログを出力
    const hasCompanyInfo = !!(strategy?.mission || strategy?.vision);
    const hasStage1Context = !!(strategy?.mission || strategy?.vision || strategy?.ceoIntent);
    const hasStage2Answers = Array.isArray(answers2) && answers2.length > 0;
    const hasStage2Story = Array.isArray(finalStory) && finalStory.length > 0;
    const hasStage3Context = Array.isArray(strategy?.departments) && strategy.departments.length > 0;
    const hasStage4Context = Array.isArray(strategy?.stage4Plans) && strategy.stage4Plans.length > 0;

    const inputFlags = [hasCompanyInfo, hasStage1Context, hasStage2Answers, hasStage2Story, hasStage3Context, hasStage4Context];
    const meaningfulInputScore = Math.round((inputFlags.filter(Boolean).length / inputFlags.length) * 100);

    const systemBaseLen = (systemBase || '').length;
    const messagesStr = messages.map((m: any) => m.content || '').join(' ');
    const totalPromptLen = systemBaseLen + messagesStr.length;
    const suspiciousKeywords = checkSuspiciousKeywords(messagesStr);

    logInputGuard({
      requestId,
      apiName: 'ask-ceo-agent',
      companyId: companyId,
      strategyId: strategyId,
      meaningfulInputScore,
      hasCompanyInfo,
      hasStage1Context,
      hasStage2Answers,
      hasStage2Story,
      hasStage3Context,
      hasStage4Context,
      promptLength: totalPromptLen,
      suspiciousKeywordFlags: suspiciousKeywords,
    });

    // ★ 診断ログ: 質問分類、モード、モデル、検索、ガイド注入、回答成否のみ記録
    if (process.env.DEBUG_AGENT_PROMPT === '1') {
      console.log('[ask-ceo-agent]', requestId, 'DIAGNOSIS', {
        questionType: guidance.text ? 'operation' : 'concept_or_other',
        selectedMode: resolvedMode,
        model: openaiReq.model,
        guidanceOperationCount: guidance.operationCount,
        guidanceScreenIds: guidance.screenIds,
        guidesInjected: {
          growthShiftFoundation: !!(systemBase && systemBase.includes('GROWTH SHIFT')),
          operationGuides: guidance.operationCount > 0,
          ragKnowledge: !!ragContextBlock,
        },
      });
    }

    // ④ 検査: 最終プロンプトに財務サマリが含まれるか
    const hasFinanceSummaryInPrompt = systemBase.includes('【STAGE1 財務サマリ');
    const hasValueAnalysisInPrompt = systemBase.includes('【STAGE1 5指標分析');

    console.log('[ask-ceo-agent]', requestId, '④_final_prompt_check', {
      has_finance_summary_block: hasFinanceSummaryInPrompt,
      has_value_analysis_block: hasValueAnalysisInPrompt,
      system_prompt_length: systemBase.length,
    });

    // ★ 一時的な診断: OpenAI呼び出し前ログ
    console.log('[ask-ceo-agent]', requestId, 'BEFORE_OPENAI', {
      model: openaiReq.model,
      messageCount: openaiReq.messages?.length ?? 0,
      hasResponseFormat: !!openaiReq.response_format,
      hasTemperature: Object.prototype.hasOwnProperty.call(openaiReq, 'temperature'),
    });

    let detailed;
    try {
      detailed = await openai.chat.completions.create(openaiReq);
    } catch (e: any) {
      console.error('[ask-ceo-agent]', requestId, 'OPENAI_CALL_FAILED', {
        name: e?.name,
        status: e?.status,
        code: e?.code ?? e?.error?.code,
        type: e?.type ?? e?.error?.type,
        message: e?.message ?? e?.error?.message ?? String(e),
        requestId_openai:
          e?.request_id ??
          e?._request_id ??
          e?.headers?.get?.('x-request-id') ??
          e?.headers?.get?.('openai-request-id'),
      });
      throw e;
    }

    console.log('[ask-ceo-agent]', requestId, 'AFTER_OPENAI_SUCCESS');

    // ★ LLM応答を取得（JSON出力時も含む）
    const rawContent = (detailed.choices[0]?.message?.content || '応答の取得に失敗しました。').trim();
    let reviewTargets: ReviewTarget[] = [];
    let reviewMarker: ReviewMarkerDiagnostics | null = null;
    let content = rawContent;
    if (output !== 'json') {
      const review = extractReviewMarkers(content, reviewCandidates);
      content = review.content;
      reviewTargets = review.reviewTargets;
      reviewMarker = review.diagnostics;
    }
    if (reviewRun.applicable) {
      console.log('[ask-ceo-agent]', requestId, 'stage4_review', classifyReviewRun({
        asJson: output === 'json',
        ...reviewRun,
        marker: reviewMarker,
        finishReason: detailed.choices[0]?.finish_reason ?? null,
        contentChars: rawContent.length,
      }));
    }
    if (externalSourceAllowlist) {
      const check = verifyAnswerUrls(content, externalSourceAllowlist, [
        process.env.NEXT_PUBLIC_APP_URL ?? '',
        process.env.NEXT_PUBLIC_SITE_URL ?? '',
      ]);
      content = check.content;
      console.log('[ask-ceo-agent]', requestId, 'ceo_web_search_url_check', {
        allowed: externalSourceAllowlist.length,
        removed: check.removed,
      });
      const statCheck = checkStatisticClaims(content, webSearchFacts, [
        JSON.stringify(strategy ?? {}),
        ...messages.map((m: any) => String(m?.content ?? '')),
      ]);
      const statNotice = buildStatClaimNotice(statCheck.findings);
      if (statNotice && output !== 'json') content = `${content}\n\n${statNotice}`;
      if (process.env.NODE_ENV === 'development' && webSearchDiagnostics) {
        console.log('[ask-ceo-agent]', requestId, 'ceo_web_search_diag', {
          ...webSearchDiagnostics,
          urlsInAnswer: countUrls(content),
          urlsRemoved: check.removed,
          numbersNotInSearchFacts: countUnmatchedNumbers(
            content,
            webSearchFacts.flatMap((f) => [f.text, f.period ?? ''])
          ),
          statClaims: {
            checked: statCheck.checked,
            unverifiable: statCheck.unverifiable,
            findingKinds: statCheck.findings.reduce<Record<string, number>>(
              (acc, f) => ({ ...acc, [f.kind]: (acc[f.kind] ?? 0) + 1 }),
              {}
            ),
            noticeAppended: statNotice !== '' && output !== 'json',
          },
        });
      }
    }

    // ★ meta.output === 'json' のときだけJSON解析 & 検証
    let structured: boolean | undefined = undefined;
    let parsed: any = undefined;

    if (output === 'json') {
      const facilResp = safeParseFacilitatorJSON(rawContent);
      if (facilResp) {
        structured = true;
        parsed = facilResp;
      } else {
        structured = false;
        // JSON parse失敗でも content は必ず返す
      }
    }

    // --- ログ保存（失敗は無視） ---
    try {
      await insertAgentLog({
        userId,
        strategyId,
        step: 0,
        role: 'assistant',
        content: `requestId=${requestId} chars=${content.length}`,
      });
    } catch {
      /* noop */
    }

    // ★ 後方互換 + optional 拡張フィールド
    const response: any = {
      content,
      requestId,
      stageUsed: intent.stage,
      confidence: intent.confidence,
      resolvedMode,  // Sprint 4: モード解決結果を返す
    };

    response.reviewTargets = reviewTargets;

    // JSON出力時のみ optional フィールドを追加
    if (output === 'json') {
      response.structured = structured;
      if (parsed) response.parsed = parsed;
    }

    // meta.mode が無い場合のみ、auto 判定結果を返す
    if (!meta?.mode && autoModeResult) {
      response.autoMode = autoModeResult;
    }

    // ★ Sprint 5: help モード時のみ、使用したナレッジID を返す（debug/改善用）
    if (resolvedMode === 'help' && knowledgeIdsUsed.length > 0) {
      response.knowledgeIdsUsed = knowledgeIdsUsed;
    }

    if (guidance.text) {
      response.operationGuidance = { operationCount: guidance.operationCount, screenIds: guidance.screenIds };
    }

    // ★ Sprint 5.1: debug footer（NEXT_PUBLIC_DEBUG_AGENT=1 時のみ）
    // ★ Sprint 6A: RAG 情報を debug footer に追加
    if (process.env.NEXT_PUBLIC_DEBUG_AGENT === '1') {
      const guidanceInfo = guidance.operationCount > 0 ? ` guidance=${guidance.operationCount}` : '';
      const debugFooter = `\n\n[debug] mode=${resolvedMode} knowledge=${knowledgeIdsUsed?.join(',') || '-'} reasons=${autoModeResult?.reasons?.join('|') || '-'}${ragResultDebug ? ' ' + ragResultDebug : ''}${guidanceInfo}`;
      response.content += debugFooter;
    }

    return NextResponse.json(response);
  } catch (e: any) {
    // ★ 一時的な診断: route全体の失敗を ROUTE_FAILED として記録
    console.error('[ask-ceo-agent]', requestId, 'ROUTE_FAILED', {
      name: e?.name,
      status: e?.status ?? e?.response?.status,
      code: e?.code ?? e?.error?.code,
      type: e?.type ?? e?.error?.type,
      message: e?.message ?? e?.error?.message ?? String(e),
    });
    return NextResponse.json(
      {
        content: 'サーバーエラーが発生しました。',
        error: 'ask-ceo-agent failed',
        requestId,
      },
      { status: 500 }
    );
  }
}
