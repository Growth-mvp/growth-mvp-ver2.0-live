/* eslint-disable @typescript-eslint/no-explicit-any */
export const runtime = 'nodejs';

import { NextResponse } from 'next/server';

/* ========= requestId 生成 ========= */
function makeRequestId() {
  return globalThis.crypto?.randomUUID?.() ?? `req_${Date.now()}`;
}
import OpenAI from 'openai';
import { sanitizeAskMessages } from '@/lib/ceoChat/askPolicy';
import { resolveScreenContext } from '@/lib/screens/screenContext';
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
import { buildExternalFinancialBlock } from '@/lib/agentPrompt';
import { computeStage1ValueAnalysis } from '@/utils/valueAnalysis';
import { selectCanonicalStory } from '@/lib/ceoChat/strategyRationale';
import {
  selectContextSources,
  selectStage56Sources,
  selectSupplementSources,
  buildSelectedContextBlock,
  hasCompanyReference,
  isGeneralKnowledgeQuestion,
} from '@/lib/ceoChat/contextSelection';
import { buildExecutionSummaryBlock } from '@/lib/ceoChat/stage4Projection';
import {
  buildStage5ProgressBlock,
  formatOwnProgressLines,
  CHECKIN_LOOKBACK_DAYS,
} from '@/lib/ceoChat/stage5Progress';
import { buildStage6PlanBlock, buildCashPositionBlock } from '@/lib/ceoChat/stage6Plan';
import { buildFocusAnswersBlock } from '@/lib/ceoChat/supplementBlocks';
// ★ Sprint 6A: Light RAG 統合
import { getGrowthRagIndex } from '@/lib/rag/indexer';
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
type RequestBody = {
  messages: Message[];
  userId: string;
  strategyId: string;
  companyId: string;
  screen?: unknown;
  meta?: {
    stage?: 'strategy' | 'manual' | 'generic' | 'hybrid'; // 既存
    mode?: 'text' | 'facilitator' | 'help';               // Sprint 1-4: text/facilitator/help
    output?: 'text' | 'json';                              // Sprint 1: 出力形式
    insights?: 'none' | 'stage1';                          // Sprint 2: STAGE1インサイト注入
  };
};

/* ========= GROWTH SHIFT 基礎ガイド（概念編） ========= */
const GROWTH_SHIFT_FOUNDATION = `
## GROWTH SHIFT とは

GROWTH SHIFTは、戦略の策定・浸透・実行をつなぎ、組織の判断と行動を揃え、企業の成長につなげるためのAI企業変革プラットフォームです。合言葉は「戦略を行動へ。企業を成長へ。」です。

経営の意図を現場の判断に届け、日々の行動につなげることを目指します。認識、価値観、感情、関係性、暗黙の前提に生じるズレにも目を向けます。

## 支援の姿勢

最終的な判断と対話の主体は人です。AIは論点の整理、問い、たたき台、確認を支援します。業績向上は目指す成果ですが、利用するだけで保証されるものではありません。戦略の浸透には、経営者と社員の対話と納得が欠かせません。

## 各STAGE で取り組むこと

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

/* ========= ユーティリティ ========= */
const safeArray = <T,>(v: any): T[] => (Array.isArray(v) ? (v as T[]) : []);

/* ========= 進捗サマリ（プロンプトに埋め込む軽量要約） ========= */
function buildProgressSummary(progressLogs: any[] = []) {
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

      strategy = normalizeStrategyData(sRow as Partial<StrategyData>) as StrategyData;

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
        console.warn('[ask-ceo-agent] stage1 value analysis error:', e?.message || e);
      }

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
  try {
    const adminClient = supabaseAdmin ?? getSupabaseAdmin();
    const { data: logs, error: plErr } = await adminClient
      .from('progress_logs')
      .select('id, created_at, content, score, status, user_id, okr_id')
      .eq('user_id', userId)
      .eq('company_id', companyId)  // ★ company_id でフィルタ（RLS準拠）
      .order('created_at', { ascending: false })
      .limit(200);
    if (plErr) console.warn('[ask-ceo-agent] progress_logs select error:', plErr?.message || plErr);
    progressLogs = safeArray<any>(logs);
    console.log('[ask-ceo-agent] progress_logs fetched', {
      userId: userId.substring(0, 8),
      companyId: companyId.substring(0, 8),
      count: progressLogs.length,
    });
  } catch (e: any) {
    console.error('[ask-ceo-agent] progress_logs select exception:', {
      errorMessage: e?.message || String(e),
      errorName: e?.name,
      userId: userId.substring(0, 8),
      companyId: companyId.substring(0, 8),
    });
  }

  const departments = safeArray<any>(strategy?.departments ?? (strategy as any)?.editableCascadeResult);
  const executionText = buildExecutionSummaryBlock(departments, question).text;
  const progressSummaryText = buildProgressSummary(progressLogs);
  const extraBlockFromFull =
    `\n\n---\n${executionText}\n` +
    `\n# 直近進捗ログ\n${progressSummaryText}\n---\n`;

  // フルが取れない場合（strategyId が無効または削除されている場合）
  if (!strategy || Object.keys(strategy).length === 0) {
    return { strategy: null, answers2: [], finalStory: [], extraBlock: '' };
  }

  const answers2 = safeArray<any>((strategy as any)?.answers2);
  const finalStory = safeArray<any>(selectCanonicalStory(strategy as any).chapters);
  return { strategy, answers2, finalStory, extraBlock: extraBlockFromFull };
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

    // ★ アプローチ1: server-side admin client を fetchStrategyContext に渡す
    const { strategy, answers2, finalStory, extraBlock } = await fetchStrategyContext({
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
      extraBlock_len: extraBlock ? extraBlock.length : 0,
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
      resolvedMode = autoModeResult.mode === 'help' ? 'help' : 'advisor';
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
    let systemBase: string;
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
        TABOO;
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
          ? agentPrompt(strategy as any, answers2 as any, finalStory as any) +
            (externalFinancialBlock ? '\n\n' + externalFinancialBlock : '') +
            '\n' + extraBlock + '\n\n' + GROWTH_SHIFT_FOUNDATION
          : 'あなたは博識なアシスタントです。日本語で簡潔かつ正確に回答します。推測は推測と明記してください。\n\n' + GROWTH_SHIFT_FOUNDATION) +
        '\n' +
        TABOO;

      // facilitator モード時のみファシリテーション指示を追加
      if (resolvedMode === 'facilitator') {
        systemBase += '\n\n' + buildFacilitatorBlock({ stage: 'generic' });
      }

      const contextSelection = selectContextSources(lastUser);
      const selectedContextBlock = buildSelectedContextBlock({
        selection: contextSelection,
        strategy: strategy as any,
        companyDataIncluded: !!shouldUseAgentPrompt,
      });
      if (selectedContextBlock) systemBase += '\n\n' + selectedContextBlock;

      if (shouldUseAgentPrompt) {
        const stageSources = selectStage56Sources(lastUser);
        if (stageSources.progress) {
          const now = new Date();
          const company = await fetchStage5Company(admin, companyId, now);
          systemBase +=
            '\n\n' +
            buildStage5ProgressBlock({
              departments: (strategy as any)?.departments,
              okrs: company.okrs,
              companyLogs: company.companyLogs,
              companyLogsFailed: company.companyLogsFailed,
              now,
            });
        }
        if (stageSources.plan) {
          systemBase +=
            '\n\n' +
            buildStage6PlanBlock({
              csvFinanceData: (strategy as any)?.csvFinanceData,
              companyId,
              financePL: (strategy as any)?.financePL,
              financeBS: (strategy as any)?.financeBS,
              departments: (strategy as any)?.departments,
              fiscalYearEnd: (strategy as any)?.fiscalYearEnd,
              currentYear: new Date().getFullYear(),
              simulationResults: (strategy as any)?.simulationResults,
            });
        }
        const supplement = selectSupplementSources(lastUser);
        if (supplement.cash && !stageSources.plan) {
          systemBase +=
            '\n\n' +
            buildCashPositionBlock({
              csvFinanceData: (strategy as any)?.csvFinanceData,
              companyId,
              financePL: (strategy as any)?.financePL,
              financeBS: (strategy as any)?.financeBS,
            });
        }
        if (supplement.talent) {
          const focus = buildFocusAnswersBlock(strategy as any, lastUser);
          if (focus) systemBase += '\n\n' + focus;
        }
      }
      console.log('[ask-ceo-agent]', requestId, 'context_selection', {
        ...contextSelection,
        companyDataIncluded: shouldUseAgentPrompt,
        selected_block_len: selectedContextBlock.length,
      });
    }

    const screen = resolveScreenContext(body?.screen);
    if (body?.screen !== undefined && !screen) {
      console.warn('[ask-ceo-agent]', requestId, 'screen_context_rejected');
    }
    if (screen) {
      systemBase += `\n\n【現在の画面】${screen.label}（${screen.pathname}）\n操作案内はこの画面の範囲で行う。`;
    }

    const guidance = buildOperationGuidance({
      screenId: screen?.screenId ?? null,
      query: lastUserMessage,
      role: membership.role,
    });
    if (guidance.text) systemBase += '\n\n' + guidance.text;

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
          issueBlocks: (strategy as any)?.issueBlocks,
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

    // --- OpenAI 呼び出し ---
    const openaiReq: any = {
      model: 'gpt-5.6-luna',
      reasoning_effort: 'low',
      max_completion_tokens: 6000,
      messages: [{ role: 'system', content: systemBase }, ...sanitizeAskMessages(messages)],
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
    const content = rawContent;

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
