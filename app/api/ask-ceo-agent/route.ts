/* eslint-disable @typescript-eslint/no-explicit-any */
export const runtime = 'nodejs';

import { NextResponse } from 'next/server';
import { openai } from '@/lib/openai';
import { supabase } from '@/utils/supabase/client';
import { getFullStrategyDataByCompany } from '@/utils/supabase/strategy';
import { normalizeStrategyData } from '@/utils/supabase/normalize';
import agentPrompt from '@/lib/agentPrompt';
import { insertAgentLog } from '@/lib/supabase/agentLogs';
import {
  classifyHeuristic,
  classifyLLM,
  chooseBetter,
  includesAny,
  type IntentResult,
} from '@/lib/intentRouter';
import { buildFacilitatorBlock } from '@/lib/facilitatorProtocol';
import { buildJSONOutputInstruction, safeParseFacilitatorJSON } from '@/lib/facilitatorSchema';
import { buildStage1Insight } from '@/utils/insights/stage1Insight';
import { detectAutoMode } from '@/lib/autoModeRouter';
import { buildHelpSystemPrompt } from '@/lib/helpPrompt';
import { pickRelevantKnowledge } from '@/lib/growthKnowledge';
// ★ Sprint 6A: Light RAG 統合
import { getGrowthRagIndex, clearRagCache } from '@/lib/rag/indexer';
import { retrieveGrowthKnowledge } from '@/lib/rag/retriever';
import { buildRagContextBlock, buildRagDebugFooter } from '@/lib/rag/prompt';
import type { StrategyData } from '@/types/strategy';

// --- Service Role（統一管理） ---
import { getSupabaseAdmin } from '@/lib/supabaseAdmin';
import {
  getAuthUserIdFromBearer,
  requireMembership,
  assertCompanyScopeByStrategyId,
} from '@/lib/server/rbacGuard';

/* ========= 型 ========= */
type Role = 'system' | 'user' | 'assistant';
type Message = { role: Role; content: string };
type RequestBody = {
  messages: Message[];
  userId: string;
  strategyId: string;
  meta?: {
    stage?: 'strategy' | 'manual' | 'generic' | 'hybrid'; // 既存
    mode?: 'text' | 'facilitator' | 'help';               // Sprint 1-4: text/facilitator/help
    output?: 'text' | 'json';                              // Sprint 1: 出力形式
    insights?: 'none' | 'stage1';                          // Sprint 2: STAGE1インサイト注入
  };
};

/* ========= 禁則 ========= */
const TABOO =
  '【回答禁止】個人情報・人事評価や人事異動の断定、株主・取締役の機微情報、具体的な法的助言、確証のない断定的表現には答えません。必要な場合は専門家相談を案内します。';

/* ========= ユーティリティ ========= */
const cap = (s: any, n: number) => {
  const t = String(s ?? '');
  return t.length > n ? `${t.slice(0, n)}…` : t;
};
const safeArray = <T,>(v: any): T[] => (Array.isArray(v) ? (v as T[]) : []);
function normalizeMessages(msgs: Message[]) {
  const okRole = new Set<Role>(['system', 'user', 'assistant']);
  return (Array.isArray(msgs) ? msgs : [])
    .map((m) => ({
      role: okRole.has(m?.role as Role) ? (m.role as Role) : ('user' as Role),
      content: String(m?.content ?? ''),
    }))
    .filter((m) => m.content.trim().length > 0)
  // モデルのコンテキスト圧迫を避けるため直近のみ
    .slice(-12);
}

/* ========= 操作マニュアル簡易応答 ========= */
const MANUAL_QA: Array<{ q: RegExp; a: string }> = [
  {
    q: /(okr).*(どこ|どれ|入力|書き方|やり方|方法)/i,
    a: [
      '【OKRの入力場所】',
      '1) 上部メニューの「カスケード（/cascade）」を開く',
      '2) 対象の部門カードを開く → プロジェクト → OKR を編集',
      '3) 右上「AI要約/生成」で下書きを反映可能',
      '',
      '【編集のコツ】',
      '- KRは数値/期日を入れてから再生成すると精度が上がります',
    ].join('\n'),
  },
  {
    q: /mvv.*(どこ|入力|やり方|方法)/i,
    a: '【MVV】「戦略 基本情報」画面で Mission / Vision / Value を入力・保存してください。',
  },
  {
    q: /swot.*(どこ|入力|書き方|やり方|方法)/i,
    a: '【SWOT】「戦略 SWOT」画面で強み/弱み/機会/脅威を3つ以上ずつ。必要なら「例を表示」で下書きを挿入できます。',
  },
  {
    q: /ストーリー.*(確定|最終|まとめ|やり方|方法)/i,
    a: '【ストーリー確定】各章の本文を整えて「最終化」。その後 /cascade で部門ミッション/プロジェクト→OKRへ展開します。',
  },
];
function answerManual(messages: Message[]) {
  const last = messages.slice().reverse().find((m) => m.role === 'user')?.content ?? '';
  const hit = MANUAL_QA.find((x) => x.q.test(last));
  if (hit) return `【操作ガイド】\n${hit.a}`;
  const list = [
    '・MVVの入力手順',
    '・SWOTの書き方',
    '・ストーリー確定から部門戦略へ',
    '・「OKRはどこに入力？」など、具体的に聞いてください',
  ].join('\n');
  return `【操作ガイド】よくある質問\n${list}`;
}

/* ========= OKR/進捗サマリ（プロンプトに埋め込む軽量要約） ========= */
function buildOKRSummary(departments: any[] = []) {
  const lines: string[] = [];
  departments.forEach((d, di) => {
    const dName = String(d?.name ?? `Department ${di + 1}`);
    const projects = safeArray<any>(d?.projects);
    if (!projects.length) return;
    lines.push(`■ 部門: ${dName}`);
    projects.forEach((p, pi) => {
      const pTitle = String(p?.title ?? p?.name ?? `Project ${pi + 1}`);
      const okrs = safeArray<any>(p?.okrs);
      if (!okrs.length) {
        lines.push(`  - プロジェクト ${pTitle}（OKRなし）`);
        return;
      }
      lines.push(`  - プロジェクト ${pTitle}`);
      okrs.forEach((o: any, oi: number) => {
        const kr = safeArray<string>(o?.keyResults);
        const owner = o?.owner ? ` / Owner: ${String(o.owner)}` : '';
        lines.push(`    • O${oi + 1}: ${cap(o?.objective ?? '', 200)} / KR: ${kr.length}件${owner}`);
        kr.forEach((k, ki) => lines.push(`       - KR${ki + 1}: ${cap(String(k || ''), 160)}`));
      });
    });
  });
  return lines.join('\n');
}
function buildProgressSummary(progressLogs: any[] = []) {
  if (!progressLogs.length) return '（進捗ログなし）';
  const sorted = [...progressLogs].sort(
    (a, b) => new Date(b.created_at || 0).getTime() - new Date(a.created_at || 0).getTime()
  );
  const recent = sorted.slice(0, 30);
  const lines: string[] = [];
  recent.forEach((r: any) => {
    const ts = String(r?.created_at ?? '').replace('T', ' ').replace('Z', '');
    const dept = r?.department ? ` [${String(r.department)}]` : '';
    const rating = Number.isFinite(r?.rating) ? ` ★${r.rating}` : '';
    const txt = cap(r?.progress_text ?? '', 200);
    const adv = r?.advice ? ` / Advice: ${cap(String(r.advice), 120)}` : '';
    lines.push(`- ${ts}${dept}${rating} : ${txt}${adv}`);
  });
  return lines.join('\n');
}

/* ========= コンテキスト取得（会社IDを元にフル→最小フォールバック） ========= */
async function fetchStrategyContext(args: { companyId: string; strategyId: string; userId: string }) {
  const { companyId, strategyId, userId } = args;

  // 会社単位のフルデータを取得して正規化
  let strategy: StrategyData | null = null;
  try {
    const { data: sRow, error } = await getFullStrategyDataByCompany(companyId);
    if (error) console.warn('[ask-ceo-agent] getFullStrategyDataByCompany error:', error?.message || error);
    strategy = sRow ? (normalizeStrategyData(sRow as Partial<StrategyData>) as StrategyData) : null;
  } catch (e: any) {
    console.warn('[ask-ceo-agent] strategy load exception:', e?.message || e);
    strategy = null;
  }

  // 進捗ログ（本人の最近分）
  let progressLogs: any[] = [];
  try {
    const { data: logs, error: plErr } = await supabase
      .from('progress_logs')
      .select(
        'id, created_at, progress_text, rating, rating_comment, advice, help_request, department, user_id, okr_id'
      )
      .eq('user_id', userId)
      .eq('company_id', companyId)  // ★ company_id でフィルタ（RLS準拠）
      .order('created_at', { ascending: false })
      .limit(200);
    if (plErr) console.warn('[ask-ceo-agent] progress_logs select error:', plErr);
    progressLogs = safeArray<any>(logs);
  } catch (e: any) {
    console.warn('[ask-ceo-agent] progress_logs select exception:', e?.message || e);
  }

  const departments = safeArray<any>(strategy?.departments ?? (strategy as any)?.editableCascadeResult);
  const okrSummaryText = buildOKRSummary(departments);
  const progressSummaryText = buildProgressSummary(progressLogs);
  const extraBlockFromFull =
    `\n\n---\n# OKRサマリ\n${okrSummaryText || '（OKRなし）'}\n` +
    `\n# 直近進捗ログ\n${progressSummaryText}\n---\n`;

  // フルが取れない場合は最小限フォールバック（Service Role）
  if (!strategy || Object.keys(strategy).length === 0) {
    const admin = getSupabaseAdmin();
    const { data: srow } = await admin.from('strategy_data').select('*').eq('id', strategyId).maybeSingle();
    if (!srow) {
      return { strategy: null, answers2: [], finalStory: [], extraBlock: '' };
    }
    const minimal: StrategyData = {
      id: String(srow.id),
      companyId: String(srow.company_id),
      companyName: (srow.companyName as string) ?? undefined,
      mission: (srow.mission as string) ?? undefined,
      vision: (srow.vision as string) ?? undefined,
      values: (srow.values as string) ?? undefined,
      departments: Array.isArray((srow as any).departments) ? (srow as any).departments : [],
    } as any;

    const dept2 = safeArray<any>(minimal.departments);
    const okrText = buildOKRSummary(dept2);
    const extraBlockMinimal =
      `\n\n---\n# OKRサマリ（最小）\n${okrText || '（OKRなし）'}\n` +
      `\n# 直近進捗ログ\n${progressSummaryText}\n---\n`;

    return { strategy: minimal, answers2: [], finalStory: [], extraBlock: extraBlockMinimal };
  }

  const answers2 = safeArray<any>((strategy as any)?.answers2);
  const finalStory = safeArray<any>((strategy as any)?.finalStory);
  return { strategy, answers2, finalStory, extraBlock: extraBlockFromFull };
}

/* ========= route ========= */
export async function POST(req: Request) {
  try {
    // --- 認証（rbacGuard で統一） ---
    const admin = getSupabaseAdmin();
    const authUserId = await getAuthUserIdFromBearer(admin, req);
    if (!authUserId) {
      return NextResponse.json({ content: '認証が必要です。', error: 'no bearer' }, { status: 401 });
    }

    // --- Membership 検証 ---
    const membership = await requireMembership(admin, authUserId);
    if (!membership) {
      return NextResponse.json({ content: 'この企業へのアクセス権がありません。', error: 'no membership' }, { status: 403 });
    }

    // --- 入力 ---
    let body: RequestBody | null = null;
    try {
      body = (await req.json()) as RequestBody;
    } catch {
      return NextResponse.json({ content: 'invalid payload', error: 'invalid payload' }, { status: 400 });
    }
    const { messages, userId, strategyId, meta } = body ?? ({} as RequestBody);
    if (!userId || !strategyId || !Array.isArray(messages)) {
      return NextResponse.json({ content: 'invalid payload', error: 'invalid payload' }, { status: 400 });
    }

    // --- 本人確認 ---
    if (authUserId !== userId) {
      return NextResponse.json({ content: '権限がありません（ユーザー不一致）。', error: 'user mismatch' }, { status: 403 });
    }

    // --- Strategy Company Scope 検証（strategyId が membership.companyId に属しているか） ---
    const companyId = await assertCompanyScopeByStrategyId(admin, membership, strategyId);
    if (!companyId) {
      return NextResponse.json({ content: '戦略データが見つかりません。', error: 'strategy not found' }, { status: 404 });
    }

    // --- コンテキスト取得（会社IDに紐づくフル → 最小フォールバック） ---
    const { strategy, answers2, finalStory, extraBlock } = await fetchStrategyContext({
      companyId,
      strategyId,
      userId,
    });
    if (!strategy) {
      return NextResponse.json(
        { content: '戦略コンテキストを取得できませんでした。初期化・保存状況をご確認ください。', error: 'context missing' },
        { status: 400 }
      );
    }

    const lastUser = (messages || []).slice().reverse().find((m) => m.role === 'user')?.content || '';

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

    // ★ Sprint 6A.1: system プロンプト構築（help/facilitator/advisor で分岐）
    // help モード時の注入順（UI創作防止）：
    // 1) buildHelpSystemPrompt（新規約：UI創作禁止、RAG優先）
    // 2) pickRelevantKnowledge（growthKnowledge から関連ナレッジ抽出）
    // 3) RAG 検索結果（buildRagContextBlock）
    // → 規約を最上位に配置し、RAG根拠を優先させる
    let systemBase: string;
    let knowledgeIdsUsed: string[] = [];
    let ragResultDebug = '';

    if (resolvedMode === 'help') {
      // help モード: 関連ナレッジを取得（growthKnowledge）
      const relevantKnowledge = pickRelevantKnowledge(lastUser, 3);
      knowledgeIdsUsed = relevantKnowledge.map((k) => k.id);

      // RAG 検索を実行（help モードのみ）→ RAG根拠を優先
      let ragContextBlock = '';
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

      // 注入順: 規約 → growthKnowledge → RAG検索結果 → 禁則
      systemBase =
        buildHelpSystemPrompt({
          productName: 'GROWTH',
          relevantKnowledge,
        }) +
        ragContextBlock +
        '\n' +
        TABOO;
    } else {
      // advisor/facilitator モード: 既存ロジック（agent-based systemPrompt）
      systemBase =
        (intent.stage === 'generic'
          ? 'あなたは博識なアシスタントです。日本語で簡潔かつ正確に回答します。推測は推測と明記してください。'
          : agentPrompt(strategy as any, answers2 as any, finalStory as any) + '\n' + extraBlock) +
        '\n' +
        TABOO;

      // facilitator モード時のみファシリテーション指示を追加
      if (resolvedMode === 'facilitator') {
        systemBase += '\n\n' + buildFacilitatorBlock({ stage: 'generic' });
      }
    }

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
      model: 'gpt-4o',
      temperature: 0.2,
      messages: [{ role: 'system', content: systemBase }, ...normalizeMessages(messages)],
    };

    // ★ meta.output === 'json' のときだけ response_format を付与（JSON形式を要求）
    if (output === 'json') {
      openaiReq.response_format = { type: 'json_object' };
    }

    const detailed = await openai.chat.completions.create(openaiReq);

    // --- 操作系ならガイドを短く添える ---
    let manualBlock = '';
    const isLikelyManual =
      /どこ|どうやって|手順|クリック|開く|入力|保存|画面|表示されない|エラー|UI|ボタン/i.test(lastUser) ||
      includesAny(lastUser, ['MVV', 'SWOT', 'OKR', '/cascade', '/story']);
    if (intent.stage === 'manual' || isLikelyManual) {
      manualBlock = '\n\n' + answerManual(messages);
    }

    // ★ LLM応答を取得（JSON出力時も含む）
    const rawContent = (detailed.choices[0]?.message?.content || '応答の取得に失敗しました。').trim();
    const content = rawContent + manualBlock;

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
      await insertAgentLog({ userId, strategyId, step: 0, role: 'assistant', content });
    } catch {
      /* noop */
    }

    // ★ 後方互換 + optional 拡張フィールド
    const response: any = {
      content,
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

    // ★ Sprint 5.1: debug footer（NEXT_PUBLIC_DEBUG_AGENT=1 時のみ）
    // ★ Sprint 6A: RAG 情報を debug footer に追加
    if (process.env.NEXT_PUBLIC_DEBUG_AGENT === '1') {
      const debugFooter = `\n\n[debug] mode=${resolvedMode} knowledge=${knowledgeIdsUsed?.join(',') || '-'} reasons=${autoModeResult?.reasons?.join('|') || '-'}${ragResultDebug ? ' ' + ragResultDebug : ''}`;
      response.content += debugFooter;
    }

    return NextResponse.json(response);
  } catch (e: any) {
    console.error('[ask-ceo-agent] failed:', e?.message || e);
    return NextResponse.json({ content: 'サーバーエラーが発生しました。', error: 'ask-ceo-agent failed' }, { status: 500 });
  }
}
