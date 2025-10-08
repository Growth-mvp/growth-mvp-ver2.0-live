// /app/api/generate-department-draft/route.ts
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

import { NextResponse } from 'next/server';
import { openai } from '@/lib/openai';
import { sanitizeText, toTextStory } from '@/app/api/_shared/utils';
import { z } from 'zod';

/* ========= 型（既存I/Fを維持） ========= */
type AnswerStep = { stepNumber: number; question: string; reason: string; answer: string };
type ReqBody = {
  departmentName: string;
  story?: Array<{ title: string; body: string }> | string;
  answers: AnswerStep[];
};
type OKR = { objective: string; keyResults: string[]; owner?: string };
type Out = { mission: string; projects: string[]; okrs: OKR[] };

/* ========= Zod で軽量バリデーション ========= */
const ReqSchema = z.object({
  departmentName: z.string().min(1),
  story: z.any().optional(),
  answers: z
    .array(
      z.object({
        stepNumber: z.number().int(),
        question: z.string().optional(),
        reason: z.string().optional(),
        answer: z.string().optional(),
      })
    )
    .min(1),
});

/* ========= ユーティリティ ========= */
function ensureThreeAnswered(answers: AnswerStep[]): { ok: boolean; reason?: string } {
  const byStep = new Map<number, AnswerStep>();
  for (const a of answers) {
    const n = Number(a?.stepNumber);
    if (n >= 1 && n <= 3 && !byStep.has(n)) byStep.set(n, a);
  }
  if (![1, 2, 3].every((n) => byStep.has(n))) return { ok: false, reason: '3問（1,2,3）の回答が必要です' };
  for (const n of [1, 2, 3]) {
    const ans = (byStep.get(n)?.answer || '').trim();
    if (!ans) return { ok: false, reason: `Q${n} の回答（answer）が空です` };
  }
  return { ok: true };
}

function normalizeProjects(list: unknown[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of Array.isArray(list) ? list : []) {
    const s = String(raw ?? '').trim();
    if (!s) continue;
    const key = s.toLowerCase().replace(/[！!。．.、,・\s]+$/g, '').normalize('NFKC');
    if (key && !seen.has(key)) {
      seen.add(key);
      out.push(s);
    }
  }
  return out.slice(0, 5);
}

function normalizeOkrs(list: unknown[]): OKR[] {
  const out: OKR[] = [];
  for (const o of Array.isArray(list) ? (list as any[]) : []) {
    const objective = String(o?.objective ?? '').trim();
    const keyResults = (Array.isArray(o?.keyResults) ? o.keyResults : [])
      .map((k: unknown) => String(k ?? '').trim())
      .filter(Boolean)
      .slice(0, 4);
    const owner = o?.owner ? String(o.owner).trim() : undefined;
    if (!objective && keyResults.length === 0) continue;
    out.push({ objective, keyResults, owner });
    if (out.length >= 2) break;
  }
  return out;
}

function extractJsonObject<T = any>(raw: string): T | null {
  if (!raw || typeof raw !== 'string') return null;
  try {
    return JSON.parse(raw) as T;
  } catch {
    const m = raw.match(/\{[\s\S]*\}/m);
    if (m) {
      try {
        return JSON.parse(m[0]) as T;
      } catch {}
    }
  }
  return null;
}

async function callOpenAIWithRetry(messages: { role: 'system' | 'user'; content: string }[], tries = 3) {
  let lastErr: any;
  for (let i = 0; i < tries; i++) {
    try {
      const ai = await openai.chat.completions.create({
        model: process.env.OPENAI_MODEL ?? 'gpt-4o',
        response_format: { type: 'json_object' },
        temperature: 0.2,
        max_tokens: 700,
        messages,
      });
      return ai;
    } catch (e: any) {
      lastErr = e;
      const status = Number(e?.status ?? e?.code ?? 0);
      const isRetryable = status === 429 || status === 500 || status === 502 || status === 503 || status === 504;
      if (!isRetryable || i === tries - 1) break;
      const retryAfter = Number(e?.response?.headers?.get?.('retry-after')) || 0;
      const backoff = retryAfter > 0 ? retryAfter * 1000 : [300, 700, 1300][Math.min(i, 2)];
      await new Promise((r) => setTimeout(r, backoff));
    }
  }
  throw lastErr;
}

/* ========= ハンドラ ========= */
export async function POST(req: Request) {
  try {
    const raw = await req.json().catch(() => ({}));
    const parsed = ReqSchema.safeParse(raw);
    if (!parsed.success) {
      return NextResponse.json({ error: '入力形式が不正です' }, { status: 400 });
    }

    const body = parsed.data as ReqBody;
    const dept = (body.departmentName || '').trim();
    if (!dept) {
      return NextResponse.json({ error: 'departmentName が必要です' }, { status: 400 });
    }

    const storyText = typeof body.story === 'string' ? body.story : toTextStory(body.story);

    const steps = [...(body.answers || [])].sort((a, b) => a.stepNumber - b.stepNumber);
    const okCheck = ensureThreeAnswered(steps as AnswerStep[]);
    if (!okCheck.ok) {
      return NextResponse.json({ error: okCheck.reason || '3問の回答（answer）が必要です' }, { status: 400 });
    }

    const stepsText = steps
      .map(
        (s) =>
          `- Q${s.stepNumber}: ${sanitizeText(String(s.question || ''), 120)}\n  A: ${sanitizeText(
            String(s.answer || ''),
            400
          )}`
      )
      .join('\n');

    const context = `
部門: ${dept}
【経営ストーリー（要約入力）】
${sanitizeText(storyText || '', 1600) || '(未入力)'}
【部長の回答（1:役割/2:価値/3:集中と選択）】
${stepsText}
`.trim();

    const system = `
あなたは経営戦略ファシリテーターです。
部長の3つの回答を材料に、以下を日本語で「実行可能な形」に整形して JSON のみ返してください。
- mission: 80〜140字。存在意義と最終成果を1文で。
- projects: 3〜5件。重複や抽象語を避け、実行主体とアウトプットが想像できる粒度で。
- okrs: 1〜2セット。objectiveは短文、keyResultsは測定可能（数値or頻度）に。
制約:
- 出力は {"mission": "...", "projects": ["..."], "okrs":[{"objective":"...","keyResults":["..."],"owner":""}]} の JSON のみ。
- ストーリーに反する創作は禁止。回答の整合性を優先して簡潔に要約。
- 「やらないこと」はKRに含めない（別の意思決定とする）。
`.trim();

    const user = `次の文脈を要約し、Mission/Projects/OKRを出力してください。\n${context}`;

    // OpenAI（リトライ付き）
    let ai;
    try {
      ai = await callOpenAIWithRetry(
        [
          { role: 'system', content: system },
          { role: 'user', content: user },
        ],
        3
      );
    } catch (e: any) {
      const status = Number(e?.status ?? e?.code ?? 500);
      const message = e?.message || 'OpenAI error';
      return NextResponse.json({ error: message }, { status: status === 429 ? 429 : 502 });
    }

    // JSON抽出（response_format でも保険で抽出）
    const rawContent = ai?.choices?.[0]?.message?.content ?? '';
    const parsedOut = extractJsonObject<Out>(rawContent);

    if (!parsedOut?.mission || !Array.isArray(parsedOut?.projects) || !Array.isArray(parsedOut?.okrs)) {
      return NextResponse.json({ error: 'LLM JSON parse error', raw: rawContent }, { status: 502 });
    }

    // 正規化（空要素除外・重複排除・上限）
    const mission = String(parsedOut.mission || '').trim().slice(0, 240);
    const projects = normalizeProjects(parsedOut.projects as unknown[]);
    const okrs = normalizeOkrs(parsedOut.okrs as unknown[]);

    return NextResponse.json(
      { mission, projects, okrs },
      { headers: { 'Cache-Control': 'no-store' } }
    );
  } catch (e: any) {
    console.error('dept-draft error:', e?.message || e);
    return NextResponse.json({ error: 'Server error', detail: e?.message || String(e) }, { status: 500 });
  }
}
