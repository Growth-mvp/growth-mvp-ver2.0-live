// /app/api/generate-department-question/route.ts
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

import { NextResponse } from 'next/server';
import { openai } from '@/lib/openai';
import { sanitizeText } from '@/app/api/_shared/utils';
import { getIndustryLabel } from '@/utils/industryTemplates'; // ★ 業種ラベル

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
  industry?: string; // ★ 会社業種
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
    // afterStepIndex: 0ベースで「この直後」を指定 → 実ステップは+2
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
  const fence = raw.match(/```json\s*([\s\S]*?)```/i);
  if (fence?.[1]) {
    try { return JSON.parse(fence[1]) as T; } catch {}
  }
  const m = raw.match(/\{[\s\S]*\}$/m) || raw.match(/\{[\s\S]*\}/m);
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
- ゴールの意味はぶらさない
- 「北極星KPI」ではなく「Objective/OKR/Key Results」を用語として使用
- 箇条書きやMarkdown、コードフェンス禁止
`.trim();

async function callOpenAIWithRetry(
  messages: { role: 'system' | 'user'; content: string }[],
  tries = 3,
  opts?: { temperature?: number; max_tokens?: number }
) {
  let lastErr: any;
  for (let i = 0; i < tries; i++) {
    try {
      const ai = await openai.chat.completions.create({
        model: process.env.OPENAI_MODEL ?? 'gpt-4o',
        response_format: { type: 'json_object' },
        temperature: opts?.temperature ?? 0.2,
        max_tokens: opts?.max_tokens ?? 320,
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
      await new Promise((res) => setTimeout(res, backoff));
    }
  }
  throw lastErr;
}

/** 長さ/単一トピックの簡易バリデーション */
function needsRewrite(question: string, reason: string) {
  const qLen = [...(question || '')].length;
  const rLen = [...(reason || '')].length;
  const tooManyQuestions = (question.match(/？/g) || []).length > 1;
  const tooManyConj = /(、.*、.*、)/.test(question); // 列挙過多っぽい
  const tooShortOrLong = qLen < 50 || qLen > 120 || rLen < 40 || rLen > 100;
  return tooShortOrLong || tooManyQuestions || tooManyConj;
}

/** リライト（要件に合わせて調整） */
async function rewriteForConstraints(payload: {
  question: string; reason: string; goal: string; stepNumber: StepNumber; departmentName: string;
}) {
  const prompt = `
次のQ/Rを、要件に合うよう1回で調整してください。JSONのみ {"question","reason"}。
- goal: ${payload.goal}
- step: ${payload.stepNumber}
- 部門: ${payload.departmentName}
- 条件: questionは1トピック・50〜120字、reasonは40〜100字、具体語と期限・KPIを優先、言い換えすぎない
- 元Q: ${payload.question}
- 元R: ${payload.reason}
`.trim();

  const fix = await callOpenAIWithRetry(
    [
      { role: 'system', content: '日本語で、必ずJSONのみを返答します。' },
      { role: 'user', content: prompt },
    ],
    2,
    { temperature: 0.25, max_tokens: 220 }
  );
  const raw = fix.choices?.[0]?.message?.content ?? '';
  const parsed = safeJsonFromText<any>(raw);
  const q = (parsed?.question ?? '').trim();
  const r = (parsed?.reason ?? '').trim();
  return { q, r };
}

/* =========================
 * ハンドラ
 * ======================= */
export async function POST(req: Request) {
  const routeHeaders = {
    'Cache-Control': 'no-store',
    'X-GROWTH-Route': 'app/api/generate-department-question',
    'Content-Type': 'application/json; charset=utf-8',
  } as const;

  try {
    const body = (await req.json()) as ReqBody;
    const dept = (body?.departmentName || '').trim();
    if (!dept) {
      return new NextResponse(JSON.stringify({ error: 'departmentName が必要です' }), {
        status: 400,
        headers: routeHeaders,
      });
    }

    const stepNumber = pickStepNumber(body);
    const guide = GUIDE[stepNumber - 1] ?? GUIDE[2];

    // ★ 業種情報の取得と整形
    const industry = (body.industry || '').trim();
    const industryLabel = industry ? getIndustryLabel(industry, { full: true }) : '';
    const industryLine = industryLabel
      ? `${industryLabel}${industry ? `（${industry}）` : ''}`
      : '(業種未指定)';

    const contextLines: string[] = [];
    contextLines.push(`- 業種: ${industryLine}`); // ★ 追加：AIへの文脈
    contextLines.push(`- ステップ: ${stepNumber}（${GUIDE[stepNumber - 1]?.label}）`);

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
→ seedの意味を保持しつつ、業種と部門文脈に即した自然な「単一の問い」を1つだけJSONで返してください。
`.trim();

    // OpenAI 呼び出し（リトライ＋タイムアウト）
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 55_000);

    let ai;
    try {
      ai = await callOpenAIWithRetry(
        [
          { role: 'system', content: SYSTEM },
          { role: 'user', content: userContent },
        ],
        3,
        { temperature: 0.25, max_tokens: 340 }
      );
    } catch (e: any) {
      clearTimeout(timer);
      const status = Number(e?.status ?? e?.code ?? 500);
      const message = e?.message || 'OpenAI error';
      return new NextResponse(JSON.stringify({ error: message }), {
        status: status === 429 ? 429 : 502,
        headers: routeHeaders,
      });
    } finally {
      clearTimeout(timer);
    }

    const raw = ai?.choices?.[0]?.message?.content ?? '';
    let parsed = safeJsonFromText<any>(raw);
    let q = (parsed?.question ?? '').trim();
    let r = (parsed?.reason ?? '').trim();

    if (!q || !r) {
      return new NextResponse(JSON.stringify({ error: 'Invalid JSON from model', raw }), {
        status: 502,
        headers: routeHeaders,
      });
    }

    // 長さ・単一トピック・具体化の簡易チェック → 必要に応じリライト
    if (needsRewrite(q, r)) {
      const { q: q2, r: r2 } = await rewriteForConstraints({
        question: q,
        reason: r,
        goal: guide.goal,
        stepNumber,
        departmentName: dept,
      });
      if (q2 && r2 && !needsRewrite(q2, r2)) {
        q = q2; r = r2;
      }
    }

    const step: AnswerStep = {
      stepNumber,
      question: q,
      reason: r,
      answer: '',
      createdAt: new Date().toISOString(),
    };

    return new NextResponse(JSON.stringify({ step }), {
      status: 200,
      headers: routeHeaders,
    });
  } catch (e: any) {
    console.error('dept-question error:', e?.message || e);
    return new NextResponse(JSON.stringify(
      { error: 'Server error', detail: e?.message || String(e) }),
      { status: 500, headers: { 'Cache-Control': 'no-store', 'Content-Type': 'application/json; charset=utf-8' } }
    );
  }
}
