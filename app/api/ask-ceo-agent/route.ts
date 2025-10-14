// /app/api/ask-ceo-agent/route.ts
export const runtime = 'nodejs';

import { NextResponse } from 'next/server';
import { openai } from '@/lib/openai';
import { supabase, getFullStrategyData } from '@/utils/supabase';
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
import type { StrategyData } from '@/types/strategy';

// Service Role（所属検証・最小文脈fallback）
import { createClient as createAdminClient, type SupabaseClient } from '@supabase/supabase-js';
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SERVICE_ROLE = process.env.SUPABASE_SERVICE_ROLE_KEY!;
type AdminClient = SupabaseClient<any, 'public', any>;
function admin(): AdminClient {
  return createAdminClient(SUPABASE_URL, SERVICE_ROLE, { auth: { persistSession: false } }) as AdminClient;
}
function getBearer(req: Request) {
  const h = req.headers.get('authorization') || req.headers.get('Authorization') || '';
  const m = h.match(/^\s*Bearer\s+(.+)\s*$/i);
  return m?.[1] ?? null;
}

/* ========= 型 ========= */
type Role = 'system' | 'user' | 'assistant';
type Message = { role: Role; content: string };
type RequestBody = {
  messages: Message[];
  userId: string;
  strategyId: string;
  meta?: { stage?: 'strategy' | 'manual' | 'generic' | 'hybrid' };
};

/* ========= 禁則 ========= */
const TABOO =
  '【回答禁止】給与・評価・異動・役員情報・株主・個人情報・人事制度・社内トラブルなどには絶対に答えないでください。';

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
    .slice(-12);
}

/* ========= 操作マニュアル ========= */
const MANUAL_QA: Array<{ q: RegExp; a: string }> = [
  {
    q: /(okr).*(どこ|どれ|入力|書|やり方|方法)/i,
    a: [
      '【OKRの入力場所】',
      '1) 上部メニュー「/cascade」',
      '2) 対象の部門カードを開く',
      '3) 「質問を生成」に回答 → 右上「AI要約を生成」で OKR 下書きを反映',
      '',
      '【編集のコツ】',
      '- 数値/期限が弱い時は、回答に%や件数/期を入れてから再生成',
    ].join('\n'),
  },
  { q: /mvv.*(どこ|入力|やり方|方法)/i, a: '【MVV】「戦略 → 基本情報」で Mission/Vision/Value を入力→保存。' },
  { q: /swot.*(どこ|入力|書|やり方|方法)/i, a: '【SWOT】「戦略 → SWOT」で各欄に短文を3つ以上。迷ったら「例を表示」で下書きを挿入。' },
  { q: /ストーリー.*(確定|最終|どう|やり方|方法)/i, a: '【ストーリー確定】4章を編集→最終化→/cascade で部門ごとのミッション/プロジェクトを整備。' },
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

/* ========= OKR/進捗サマリ ========= */
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
        lines.push(`  - プロジェクト: ${pTitle}（OKRなし）`);
        return;
      }
      lines.push(`  - プロジェクト: ${pTitle}`);
      okrs.forEach((o: any, oi: number) => {
        const kr = safeArray<string>(o?.keyResults);
        const owner = o?.owner ? ` / Owner: ${String(o.owner)}` : '';
        lines.push(`    • O${oi + 1}: ${cap(o?.objective ?? '', 200)}（KR: ${kr.length}件${owner}）`);
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

/* ========= コンテキスト取得（フル→最小 fallback） ========= */
async function fetchStrategyContext(strategyId: string, userId: string) {
  let strategy: StrategyData | null = null;
  try {
    const { data: sRow, error } = await getFullStrategyData(userId, strategyId);
    if (error) console.warn('getFullStrategyData error:', error?.message || error);
    strategy = (normalizeStrategyData(sRow as any) ?? null) as StrategyData | null;
  } catch (e: any) {
    console.warn('getFullStrategyData exception:', e?.message || e);
    strategy = null;
  }

  let progressLogs: any[] = [];
  try {
    const { data: logs, error: plErr } = await supabase
      .from('progress_logs')
      .select(
        'id, created_at, progress_text, rating, rating_comment, advice, help_request, department, user_id, okr_id'
      )
      .eq('user_id', userId)
      .order('created_at', { ascending: false })
      .limit(200);
    if (plErr) console.warn('progress_logs select error:', plErr);
    progressLogs = safeArray<any>(logs);
  } catch (e: any) {
    console.warn('progress_logs select exception:', e?.message || e);
  }

  const departments = safeArray<any>(strategy?.departments ?? strategy?.editableCascadeResult);
  const okrSummaryText = buildOKRSummary(departments);
  const progressSummaryText = buildProgressSummary(progressLogs);
  const extraBlockFromFull =
    `\n\n---\n# OKRサマリ\n${okrSummaryText || '（OKRなし）'}\n` +
    `\n# 直近進捗ログ\n${progressSummaryText}\n---\n`;

  if (!strategy || Object.keys(strategy).length === 0) {
    const a = admin();
    const { data: srow } = await a.from('strategy_data').select('*').eq('id', strategyId).maybeSingle();
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

  const answers2 = safeArray<any>(strategy?.answers2);
  const finalStory = safeArray<any>(strategy?.finalStory);
  return { strategy, answers2, finalStory, extraBlock: extraBlockFromFull };
}

/* ========= route ========= */
export async function POST(req: Request) {
  try {
    // 認証
    const token = getBearer(req);
    if (!token) {
      return NextResponse.json({ content: '認証が必要です', error: 'no bearer' }, { status: 401 });
    }

    // 入力
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

    // 本人確認
    const a = admin();
    const { data: ures } = await a.auth.getUser(token);
    const authUserId = ures?.user?.id as string | undefined;
    if (!authUserId) return NextResponse.json({ content: 'トークンが無効です', error: 'invalid token' }, { status: 401 });
    if (authUserId !== userId) {
      return NextResponse.json({ content: '権限がありません（ユーザー不一致）', error: 'user mismatch' }, { status: 403 });
    }

    // strategy 所属検証
    const { data: srow } = await a
      .from('strategy_data')
      .select('id, company_id')
      .eq('id', strategyId)
      .maybeSingle();
    if (!srow?.company_id) {
      return NextResponse.json({ content: '戦略データが見つかりません', error: 'strategy not found' }, { status: 404 });
    }
    const { data: mem } = await a
      .from('company_members')
      .select('company_id')
      .eq('user_id', authUserId)
      .eq('company_id', srow.company_id)
      .maybeSingle();
    if (!mem?.company_id) {
      return NextResponse.json({ content: 'この戦略へのアクセス権がありません', error: 'no membership' }, { status: 403 });
    }

    // 文脈（フル→最小 fallback）
    const { strategy, answers2, finalStory, extraBlock } = await fetchStrategyContext(strategyId, userId);
    if (!strategy) {
      return NextResponse.json(
        { content: '戦略コンテキストを取得できませんでした。初期化や保存状況をご確認ください。', error: 'context missing' },
        { status: 400 }
      );
    }

    const lastUser = (messages || []).slice().reverse().find((m) => m.role === 'user')?.content || '';

    // 意図判定
    let intent: IntentResult = classifyHeuristic(lastUser);
    if (intent.confidence < 0.7) {
      try { intent = chooseBetter(intent, await classifyLLM(openai, lastUser)); } catch {}
    }
    if (meta?.stage) intent = { stage: meta.stage, confidence: 0.99, reasons: ['forced'] };

    // systemPrompt
    const systemBase =
      (intent.stage === 'generic'
        ? 'あなたは博識なアシスタントです。日本語で簡潔・正確に答えます。推測は推測と明記。'
        : agentPrompt(strategy, answers2, finalStory) + '\n' + extraBlock) +
      '\n' +
      TABOO;

    // === ここが変更点 ===
    // 短答（direct）は廃止。本文（detailed）のみ生成して返す。
    const detailed = await openai.chat.completions.create({
      model: 'gpt-4o',
      temperature: 0.2,
      messages: [{ role: 'system', content: systemBase }, ...normalizeMessages(messages)],
    });

    // 操作系ならガイドを短く添える（同一メッセージ内に追記するだけなので「二重回答」にはならない）
    let manualBlock = '';
    const isLikelyManual =
      /どこ|どうやって|手順|クリック|開く|入力|保存|画面|表示されない|エラー|UI|ボタン/i.test(lastUser) ||
      includesAny(lastUser, ['MVV', 'SWOT', 'OKR', '/cascade', '/story']);
    if (intent.stage === 'manual' || isLikelyManual) {
      manualBlock = '\n\n' + answerManual(messages);
    }

    const content =
      (detailed.choices[0]?.message?.content || '（応答の取得に失敗しました）').trim() + manualBlock;

    try { await insertAgentLog({ userId, strategyId, step: 0, role: 'assistant', content }); } catch {}

    return NextResponse.json({
      content,
      stageUsed: intent.stage,
      confidence: intent.confidence,
    });
  } catch (e: any) {
    console.error('ask-ceo-agent failed:', e?.message || e);
    return NextResponse.json({ content: 'サーバーエラーが発生しました。', error: 'ask-ceo-agent failed' }, { status: 500 });
  }
}
