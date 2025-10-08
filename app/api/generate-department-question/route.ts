// /app/api/generate-department-question/route.ts
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

import { NextResponse } from 'next/server';
import { openai } from '@/lib/openai';
import { sanitizeText } from '@/app/api/_shared/utils';
import { getIndustryLabel } from '@/utils/industryTemplates'; // ★ 追加

/** 1|2|3 の固定ステップ */
type StepNumber = 1 | 2 | 3;

type AnswerStep = {
  stepNumber: StepNumber;
  question: string;
  reason: string;
  answer: string;
  createdAt: string; // ISO8601
};

type ReqBody = {
  departmentName: string;
  mission?: string;
  projects?: string[];
  okrs?: Array<{ objective?: string; keyResults?: string[]; owner?: string }>;
  industry?: string; // ★ 追加（会社業種）
  answersSoFar?: Array<{ stepNumber: number; answer: string }>;
  afterStepIndex?: number;
};

const GUIDE = [
  {
    label: '役割と成果',
    goal: '部門の存在意義と成果ゴールを明確化する',
    seed:
      '経営戦略実現に向けた自分の役割と、最終的にどんな成果を実現すべきかを言語化してください。',
  },
  {
    label: '内外への価値',
    goal: '提供価値を内外で整理し、経営戦略に接続する',
    seed:
      'その役割と成果は、社内と顧客・市場に対してどんな価値として提供されますか？',
  },
  {
    label: '集中と選択',
    goal: '「選択と集中」を具体化する',
    seed:
      'その役割と価値ある成果を生み出すために、何に注力し、何をやらないか（短期課題・中長期課題・あえてやらないこと）を整理してください。',
  },
] as const;

/* =========================
 * 小ユーティリティ
 * ======================= */
function clampStep(n: unknown, fallback: StepNumber): StepNumber {
  const x = typeof n === 'number' ? n : Number(n);
  const v = Number.isFinite(x) ? (x as number) : fallback;
  return Math.max(1, Math.min(3, v)) as StepNumber;
}
function pickStepNumber(body: ReqBody): StepNumber {
  if (typeof body.afterStepIndex === 'number') {
    return clampStep(body.afterStepIndex + 2, 1);
  }
  const answered = (body.answersSoFar ?? [])
    .map((a) => Number(a?.stepNumber))
    .filter((n) => Number.isFinite(n) && n >= 1 && n <= 3) as number[];
  if (answered.length) return clampStep(Math.max(...answered) + 1, 1);
  return 1;
}

function safeJsonFromText<T = any>(raw: string): T | null {
  if (!raw || typeof raw !== 'string') return null;
  try {
    return JSON.parse(raw) as T;
  } catch {}
  const m = raw.match(/\{[\s\S]*\}/m);
  if (m) {
    try {
      return JSON.parse(m[0]) as T;
    } catch {}
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

async function callOpenAIWithRetry(
  messages: { role: 'system' | 'user'; content: string }[],
  tries = 3
) {
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
      const isRetryable = [429, 500, 502, 503, 504].includes(status);
      if (!isRetryable || i === tries - 1) break;
      const retryAfter = Number(e?.response?.headers?.get?.('retry-after')) || 0;
      const backoff =
        retryAfter > 0 ? retryAfter * 1000 : [300, 700, 1300][Math.min(i, 2)];
      await new Promise((res) => setTimeout(res, backoff));
    }
  }
  throw lastErr;
}

/* =========================
 * ハンドラ
 * ======================= */
export async function POST(req: Request) {
  try {
    const body = (await req.json()) as ReqBody;
    const dept = (body?.departmentName || '').trim();
    if (!dept) {
      return NextResponse.json({ error: 'departmentName が必要です' }, { status: 400 });
    }

    const stepNumber = pickStepNumber(body);
    const guide = GUIDE[stepNumber - 1] ?? GUIDE[2];

    // ★ 業種情報の取得と整形
    const industry = body.industry || '';
    const industryLabel = industry ? getIndustryLabel(industry, { full: true }) : '';
    const industryLine = industryLabel
      ? `${industryLabel}${industry ? `（${industry}）` : ''}`
      : '(業種未指定)';

    const contextLines: string[] = [];
    contextLines.push(`- 業種: ${industryLine}`); // ★ 新規追加：AIへの文脈に追加

    if (body.mission)
      contextLines.push(`- 部門ミッション（案）: ${sanitizeText(body.mission, 500)}`);

    if (Array.isArray(body.projects) && body.projects.length) {
      contextLines.push(
        `- プロジェクト案:\n${body.projects
          .slice(0, 6)
          .map((p) => `  - ${sanitizeText(p, 120)}`)
          .join('\n')}`
      );
    }

    if (Array.isArray(body.okrs) && body.okrs.length) {
      const o = body.okrs[0] || {};
      contextLines.push(
        `- OKR例: O="${sanitizeText(o.objective || '', 120)}" KR=${(o.keyResults || [])
          .slice(0, 3)
          .map((k) => `"${sanitizeText(k, 100)}"`)
          .join(', ')}`
      );
    }

    const prevA =
      body.answersSoFar?.length
        ? `直前の回答: ${sanitizeText(
            body.answersSoFar.sort((a, b) => a.stepNumber - b.stepNumber).slice(-1)[0]
              .answer || '',
            400
          )}`
        : '';

    const userContent = `
部門: ${dept}
文脈:
${contextLines.join('\n') || '(なし)'}
${prevA ? prevA + '\n' : ''}
今回ステップ: ${stepNumber}
ゴール: ${guide.goal}
seed: ${guide.seed}
→ seedの意味を保持しつつ、業種や部門文脈に即した自然な言い回しの問いへ1つだけリライトしてください。
`.trim();

    // OpenAI 呼び出し（リトライ付き）
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
      return NextResponse.json({ error: message }, { status: status === 429 ? 429 : 502 });
    }

    const raw = ai?.choices?.[0]?.message?.content ?? '';
    const parsed = safeJsonFromText<any>(raw);
    const q = (parsed?.question ?? '').trim();
    const r = (parsed?.reason ?? '').trim();

    if (!q || !r) {
      return NextResponse.json({ error: 'Invalid JSON from model', raw }, { status: 502 });
    }

    const step: AnswerStep = {
      stepNumber,
      question: q,
      reason: r,
      answer: '',
      createdAt: new Date().toISOString(),
    };

    return NextResponse.json({ step }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (e: any) {
    console.error('dept-question error:', e?.message || e);
    return NextResponse.json(
      { error: 'Server error', detail: e?.message || String(e) },
      { status: 500 }
    );
  }
}
