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

/* =========================
 * 型
 * ========================= */
type Role = 'system' | 'user' | 'assistant';
type Message = { role: Role; content: string };

type RequestBody = {
  messages: Message[];
  userId: string;
  strategyId: string;
  meta?: { stage?: 'strategy' | 'manual' | 'generic' | 'hybrid' };
};

/* =========================
 * 禁則テーマ（systemに常時付与）
 * ========================= */
const TABOO =
  '【回答禁止】給与・評価・異動・役員情報・株主・個人情報・人事制度・社内トラブルなどには絶対に答えないでください。';

/* =========================
 * ユーティリティ
 * ========================= */
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

/* =========================
 * 操作マニュアル（残す）
 * ========================= */
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

/* =========================
 * OKR/進捗サマリ
 * ========================= */
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

/* =========================
 * コンテキスト取得（normalize を必ず通す）
 * ========================= */
async function fetchStrategyContext(strategyId: string, userId: string) {
  const { data: sRow, error } = await getFullStrategyData(userId, strategyId);
  if (error) console.warn('getFullStrategyData error:', error?.message || error);

  // camelCase に統一（JSONは [] / {} を保証）。null の場合も空オブジェクトで受ける。
  const strategy: StrategyData = (normalizeStrategyData(sRow as any) ?? {}) as StrategyData;

  const answers2 = safeArray<any>(strategy.answers2);
  const finalStory = safeArray<any>(strategy.finalStory);
  const departments = safeArray<any>(strategy.departments ?? strategy.editableCascadeResult);

  const okrSummaryText = buildOKRSummary(departments);

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

  const progressSummaryText = buildProgressSummary(progressLogs);
  const extraBlock =
    `\n\n---\n# OKRサマリ\n${okrSummaryText || '（OKRなし）'}\n` +
    `\n# 直近進捗ログ\n${progressSummaryText}\n---\n`;

  return { strategy, answers2, finalStory, extraBlock };
}

/* =========================
 * route
 * ========================= */
export async function POST(req: Request) {
  try {
    const { messages, userId, strategyId, meta } = (await req.json()) as RequestBody;
    if (!userId || !strategyId || !Array.isArray(messages)) {
      return NextResponse.json({ content: 'invalid payload', error: 'invalid payload' }, { status: 400 });
    }

    const { strategy, answers2, finalStory, extraBlock } = await fetchStrategyContext(strategyId, userId);
    const lastUser = (messages || []).slice().reverse().find((m) => m.role === 'user')?.content || '';

    // 1) 自動判定（ヒューリスティック → 信頼不足ならLLM）
    let intent: IntentResult = classifyHeuristic(lastUser);
    if (intent.confidence < 0.7) {
      try {
        intent = chooseBetter(intent, await classifyLLM(openai, lastUser));
      } catch {}
    }
    if (meta?.stage) intent = { stage: meta.stage, confidence: 0.99, reasons: ['forced'] };

    // 2) systemPrompt 構築（禁則テーマを追加）
    const systemBase =
      (intent.stage === 'generic'
        ? 'あなたは博識なアシスタントです。日本語で簡潔・正確に答えます。推測は推測と明記。'
        : agentPrompt(strategy, answers2, finalStory) + '\n' + extraBlock) +
      '\n' +
      TABOO;

    // 先に短答
    const direct = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      temperature: 0.2,
      messages: [
        { role: 'system', content: 'ユーザーの質問に、まず1〜3行で端的・具体に答えよ。断定しない。' },
        { role: 'user', content: lastUser },
      ],
    });

    // 本文
    const detailed = await openai.chat.completions.create({
      model: 'gpt-4o',
      temperature: 0.2,
      messages: [{ role: 'system', content: systemBase }, ...normalizeMessages(messages)],
    });

    // 操作系ならガイドを短く添える（残す）
    let manualBlock = '';
    const isLikelyManual =
      /どこ|どうやって|手順|クリック|開く|入力|保存|画面|表示されない|エラー|UI|ボタン/i.test(lastUser) ||
      includesAny(lastUser, ['MVV', 'SWOT', 'OKR', '/cascade', '/story']);
    if (intent.stage === 'manual' || isLikelyManual) {
      manualBlock = '\n\n' + answerManual(messages);
    }

    const content = [
      (direct.choices[0]?.message?.content || '').trim(),
      '',
      (detailed.choices[0]?.message?.content || '').trim(),
      manualBlock,
    ]
      .join('\n')
      .trim();

    try {
      await insertAgentLog({ userId, strategyId, step: 0, role: 'assistant', content });
    } catch {}

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
