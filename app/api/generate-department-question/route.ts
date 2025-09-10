export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

import { NextResponse } from 'next/server';
import { openai } from '@/lib/openai';
import { sanitizeText } from '@/app/api/_shared/utils';

type AnswerStep = { stepNumber: number; question: string; reason: string; answer: string };

type ReqBody = {
  departmentName: string;
  mission?: string;
  projects?: string[];
  okrs?: Array<{ objective?: string; keyResults?: string[]; owner?: string }>;
  answersSoFar?: Array<{ stepNumber: number; answer: string }>;
  afterStepIndex?: number; // 0-based
};

const GUIDE = [
  {
    label: '役割と成果',
    goal: '部門の存在意義と成果ゴールを明確化する',
    seed: '経営戦略実現に向けた自分の役割と、最終的にどんな成果を実現すべきかを言語化してください。',
  },
  {
    label: '内外への価値',
    goal: '提供価値を内外で整理し、経営戦略に接続する',
    seed: 'その役割と成果は、社内と顧客・市場に対してどんな価値として提供されますか？',
  },
  {
    label: '集中と選択',
    goal: '「選択と集中」を具体化する',
    seed: 'その役割と価値ある成果を生み出すために、何に注力し、何をやらないか（短期課題・中長期課題・あえてやらないこと）を整理してください。',
  },
] as const;

function clampStep(n: unknown, fallback: number): number {
  const x = typeof n === 'number' ? n : Number(n);
  const v = Number.isFinite(x) ? (x as number) : fallback;
  return Math.max(1, Math.min(3, v));
}
function pickStepNumber(body: ReqBody) {
  if (typeof body.afterStepIndex === 'number') return clampStep(body.afterStepIndex + 2, 1);
  const answered = (body.answersSoFar ?? []).map(a => a.stepNumber).filter(Boolean);
  if (answered.length) return clampStep(Math.max(...answered) + 1, 1);
  return 1;
}

function safeJsonFromText<T = any>(raw: string): T | null {
  if (!raw || typeof raw !== 'string') return null;
  try { return JSON.parse(raw) as T; } catch {}
  const m = raw.match(/\{[\s\S]*\}/m);
  if (m) {
    try { return JSON.parse(m[0]) as T; } catch {}
  }
  return null;
}

const SYSTEM = `
あなたは経営戦略を部長層に浸透させるファシリテーターです。
以下の「ゴール」を固定し、対応するseedをもとに、部門文脈に沿った自然な日本語の問いを1つだけ返してください。
- 出力は JSON のみ {"question":"...","reason":"..."}。
- question: 50〜120字、単一トピック、具体的に（多重質問にしない）
- reason: 40〜100字、なぜ今その問いかを簡潔に
- ゴールの意味は変えない（ぶらさない）
`.trim();

async function callOpenAIWithRetry(messages: { role: 'system'|'user'; content: string }[], tries = 3) {
  let lastErr: any;
  for (let i = 0; i < tries; i++) {
    try {
      const ai = await openai.chat.completions.create({
        model: process.env.OPENAI_MODEL ?? 'gpt-4o',
        response_format: { type: 'json_object' },
        temperature: 0.2,
        max_tokens: 320,
        messages,
      });
      return ai;
    } catch (e: any) {
      lastErr = e;
      const status = Number(e?.status ?? e?.code ?? 0);
      const isRate = status === 429;
      const isRetryable = isRate || status === 500 || status === 502 || status === 503 || status === 504;
      if (!isRetryable || i === tries - 1) break;
      const retryAfter = Number(e?.response?.headers?.get?.('retry-after')) || 0;
      const backoff = retryAfter > 0 ? retryAfter * 1000 : [300, 700, 1300][Math.min(i, 2)];
      await new Promise(res => setTimeout(res, backoff));
    }
  }
  throw lastErr;
}

export async function POST(req: Request) {
  try {
    const body = (await req.json()) as ReqBody;
    const dept = (body.departmentName || '').trim();
    if (!dept) return NextResponse.json({ error: 'departmentName が必要です' }, { status: 400 });

    const stepNumber = pickStepNumber(body);
    const guide = GUIDE[stepNumber - 1] ?? GUIDE[2];

    const contextLines: string[] = [];
    if (body.mission) contextLines.push(`- 部門ミッション（案）: ${sanitizeText(body.mission, 500)}`);
    if (Array.isArray(body.projects) && body.projects.length) {
      contextLines.push(`- プロジェクト案:\n${body.projects.slice(0, 6).map(p => `  - ${sanitizeText(p, 120)}`).join('\n')}`);
    }
    if (Array.isArray(body.okrs) && body.okrs.length) {
      const o = body.okrs[0] || {};
      contextLines.push(`- OKR例: O="${sanitizeText(o.objective||'', 120)}" KR=${(o.keyResults||[]).slice(0,3).map(k=>`"${sanitizeText(k,100)}"`).join(', ')}`);
    }
    const prevA = body.answersSoFar?.length
      ? `直前の回答: ${sanitizeText(body.answersSoFar.sort((a,b)=>a.stepNumber-b.stepNumber).slice(-1)[0].answer || '', 400)}`
      : '';

    const userContent = `
部門: ${dept}
文脈:
${contextLines.join('\n') || '(なし)'}
${prevA ? prevA + '\n' : ''}
今回ステップ: ${stepNumber}
ゴール: ${guide.goal}
seed: ${guide.seed}
→ seedの意味を保持しつつ、部門名や文脈に寄せて自然な言い回しの問いへ1つだけリライトしてください。
`.trim();

    let ai;
    try {
      ai = await callOpenAIWithRetry(
        [
          { role: 'system', content: SYSTEM },
          { role: 'user', content: userContent },
        ],
        3
      );
    } catch (e: any) {
      const status = Number(e?.status ?? e?.code ?? 500);
      const message = e?.message || 'OpenAI error';
      // 429 はそのまま返す（フロントで再試行制御可能）
      return NextResponse.json({ error: message }, { status: status === 429 ? 429 : 502 });
    }

    const raw = ai?.choices?.[0]?.message?.content ?? '';
    const parsed = safeJsonFromText<any>(raw);
    const q = (parsed?.question ?? '').trim();
    const r = (parsed?.reason ?? '').trim();
    if (!q || !r) {
      // 生成失敗（JSON不備）は 502 扱い
      return NextResponse.json({ error: 'Invalid JSON from model', raw }, { status: 502 });
    }

    const step: AnswerStep = { stepNumber, question: q, reason: r, answer: '' };
    return NextResponse.json({ step }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (e: any) {
    console.error('dept-question error:', e?.message || e);
    return NextResponse.json({ error: 'Server error', detail: e?.message || String(e) }, { status: 500 });
  }
}
