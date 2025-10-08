export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

import { NextResponse } from 'next/server';
import { openai } from '@/lib/openai';
import { sanitizeText, toTextStory } from '@/app/api/_shared/utils';
import { getIndustryLabel } from '@/utils/industryTemplates'; // ★ 追加
import { z } from 'zod';

/* ========= 型定義 ========= */
type AnswerStep = { stepNumber: number; question: string; reason: string; answer: string };
type ReqBody = {
  departmentName: string;
  story?: Array<{ title: string; body: string }> | string;
  answers: AnswerStep[];
  industry?: string; // ★ 追加
};
type OKR = { objective: string; keyResults: string[]; owner?: string };
type Out = { mission: string; projects: string[]; okrs: OKR[] };

/* ========= バリデーション ========= */
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
  industry: z.string().optional(),
});

/* ========= ユーティリティ ========= */
function ensureThreeAnswered(answers: AnswerStep[]): { ok: boolean; reason?: string } {
  const byStep = new Map<number, AnswerStep>();
  for (const a of answers) {
    const n = Number(a?.stepNumber);
    if (n >= 1 && n <= 3 && !byStep.has(n)) byStep.set(n, a);
  }
  if (![1, 2, 3].every((n) => byStep.has(n)))
    return { ok: false, reason: '3問（1,2,3）の回答が必要です' };
  for (const n of [1, 2, 3]) {
    const ans = (byStep.get(n)?.answer || '').trim();
    if (!ans) return { ok: false, reason: `Q${n} の回答が空です` };
  }
  return { ok: true };
}

function normalizeProjects(list: any[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of Array.isArray(list) ? list : []) {
    const s = String(raw ?? '').trim();
    if (!s) continue;
    const key = s.toLowerCase().replace(/[！!。．.、,・・\s]+$/g, '').normalize('NFKC');
    if (!seen.has(key)) {
      seen.add(key);
      out.push(s);
    }
  }
  return out.slice(0, 5);
}

function normalizeOkrs(list: any[]): OKR[] {
  const out: OKR[] = [];
  for (const o of Array.isArray(list) ? list : []) {
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
      const isRetryable = [429, 500, 502, 503, 504].includes(status);
      if (!isRetryable || i === tries - 1) break;
      const retryAfter = Number(e?.response?.headers?.get?.('retry-after')) || 0;
      const backoff = retryAfter > 0 ? retryAfter * 1000 : [300, 700, 1300][Math.min(i, 2)];
      await new Promise((r) => setTimeout(r, backoff));
    }
  }
  throw lastErr;
}

/* ========= メインハンドラ ========= */
export async function POST(req: Request) {
  try {
    const raw = await req.json().catch(() => ({}));
    const parsed = ReqSchema.safeParse(raw);
    if (!parsed.success)
      return NextResponse.json({ error: '入力形式が不正です' }, { status: 400 });

    const body = parsed.data as ReqBody;
    const dept = body.departmentName.trim();
    if (!dept)
      return NextResponse.json({ error: 'departmentName が必要です' }, { status: 400 });

    // ★ 業種行
    const industry = body.industry || '';
    const industryLabel = industry ? getIndustryLabel(industry, { full: true }) : '';
    const industryLine = industryLabel
      ? `業種: ${industryLabel}${industry ? `（${industry}）` : ''}`
      : '業種: （未指定）';

    const storyText = typeof body.story === 'string' ? body.story : toTextStory(body.story);

    const steps = [...(body.answers || [])].sort((a, b) => a.stepNumber - b.stepNumber);
    const okCheck = ensureThreeAnswered(steps);
    if (!okCheck.ok)
      return NextResponse.json({ error: okCheck.reason || '3問の回答が必要です' }, { status: 400 });

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
${industryLine}
部門: ${dept}
【経営ストーリー】\n${sanitizeText(storyText || '', 1600) || '(未入力)'}
【部長の回答】\n${stepsText}
`.trim();

    const system = `
あなたは経営戦略ファシリテーターです。
業種の背景を踏まえつつ、部長の3つの回答を材料に、以下を日本語で実行可能な形に整形して JSON のみ返してください。
- mission: 80〜140字。存在意義と最終成果を1文で。
- projects: 3〜5件。実行主体とアウトプットが想像できる粒度で。
- okrs: 1〜2セット。objectiveは短文、keyResultsは測定可能（数値or頻度）に。
制約:
- 出力は {"mission":"...", "projects":["..."], "okrs":[{"objective":"...","keyResults":["..."],"owner":""}]} の JSON のみ。
- ストーリーや回答と矛盾する創作は禁止。業界特性を反映しつつ整合性を保つ。
- 「やらないこと」はKRに含めない。
`.trim();

    const user = `次の文脈を要約し、Mission/Projects/OKRを出力してください。\n${context}`;

    // === OpenAI呼び出し ===
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

    // === JSON抽出 ===
    const rawContent = ai?.choices?.[0]?.message?.content ?? '';
    const parsedOut = extractJsonObject<Out>(rawContent);
    if (!parsedOut?.mission || !Array.isArray(parsedOut.projects) || !Array.isArray(parsedOut.okrs))
      return NextResponse.json({ error: 'LLM JSON parse error', raw: rawContent }, { status: 502 });

    const mission = parsedOut.mission.trim().slice(0, 240);
    const projects = normalizeProjects(parsedOut.projects);
    const okrs = normalizeOkrs(parsedOut.okrs);

    return NextResponse.json({ mission, projects, okrs }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (e: any) {
    console.error('dept-summary error:', e?.message || e);
    return NextResponse.json(
      { error: 'Server error', detail: e?.message || String(e) },
      { status: 500 }
    );
  }
}
