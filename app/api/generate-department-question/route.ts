// /app/api/generate-department-question/route.ts
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

import { NextResponse } from 'next/server';
import { openai } from '@/lib/openai';
import { sanitizeText } from '@/app/api/_shared/utils';
import { getIndustryLabel } from '@/utils/industryTemplates';

/** 1..6 の固定ステップ（Ver4） */
type StepNumber = 1 | 2 | 3 | 4 | 5 | 6;

type AnswerStep = {
  stepNumber: StepNumber;
  label: string;
  question: string;
  reason: string;
  answer: string;
  createdAt: string; // ISO8601
  hint?: string;
};

type ReqBody = {
  departmentName: string;

  // 参考：事前たたき台（任意・あれば文脈に使う）
  mission?: string;
  projects?: string[];
  okrs?: Array<{ objective?: string; keyResults?: string[]; owner?: string }>;

  // Ver4 summary（任意・あれば強く参照）
  direction?: string;
  expectations?: string[];
  focusThemes?: string[];

  industry?: string; // 会社業種（任意）
  answersSoFar?: Array<{ stepNumber: number; answer: string }>;
  afterStepIndex?: number; // 0-based「この直後」
};

/* =========================
 * ガイド（6問・Ver4）
 * ======================= */
const GUIDE = [
  {
    step: 1,
    label: '役まわり',
    goal: '経営ストーリーにおける自部門の役割を一言で定義する',
    seed: 'ストーリーの中で活躍するための部門の役まわりは何か？',
    hint: '例：「新市場開拓の先鋒」「価値体験の設計者」「現場品質の牽引」など、場面と動作が連想できる表現で。',
  },
  {
    step: 2,
    label: '既存の貢献',
    goal: '既存の強み・業務の延長で即実行可能な貢献を特定する',
    seed: '具体的に既存の延長でやるべきことは何か？',
    hint: '例：既存顧客の深耕、品質改善、既存データ活用の標準化、既存導線の見直しなど。',
  },
  {
    step: 3,
    label: '未来への挑戦',
    goal: '未来に向けた新しい価値創出を小さく早く始める',
    seed: '既存だけでなく未来に向けて今からやるべきことは何か？',
    hint: '例：新規事業の種まき、新セグメント開拓、付加価値型サービスの試作、小規模な実証実験など。',
  },
  {
    step: 4,
    label: '犠牲と覚悟',
    goal: '変革のために伴う痛み（資源の再配分・削減）を明確化する',
    seed: '戦略ストーリー実現のために部門として犠牲にすべきことは何か？',
    hint: '例：自部門だけの最適化・非効率な慣習・指標の見せかけ改善など、やめる/減らす対象を具体化。',
  },
  {
    step: 5,
    label: '協力と連携',
    goal: '他部門との協働で相乗効果を生む領域と合意ゴールを定義する',
    seed: '戦略ストーリーを実現するために他部門と協力しなければならないことは何か？',
    hint: '例：営業×マーケで付加価値強化、生産×営業で深耕、CS×開発で体験向上。誰と何をいつまでに、を決める。',
  },
  {
    step: 6,
    label: '撤退と決断',
    goal: '選択と集中の観点から手放す領域を決める',
    seed: '戦略ストーリーを実現するために、やめるべき・諦めるべきことは何か？',
    hint: '例：採算の合わない事業、過去の成功体験への執着、惰性的な会議・報告、効果の薄い販促など。',
  },
] as const;

/* =========================
 * ユーティリティ
 * ======================= */
function clampStep(n: unknown, fallback: StepNumber): StepNumber {
  const x = typeof n === 'number' ? n : Number(n);
  const v = Number.isFinite(x) ? (x as number) : fallback;
  return Math.max(1, Math.min(6, v)) as StepNumber;
}
function pickStepNumber(body: ReqBody): StepNumber {
  if (typeof body.afterStepIndex === 'number') {
    // afterStepIndex: 0ベースで「この直後」を指定 → 実ステップは+2
    return clampStep(body.afterStepIndex + 2, 1);
  }
  const answered = (body.answersSoFar ?? [])
    .map((a) => Number(a?.stepNumber))
    .filter((n) => Number.isFinite(n) && n >= 1 && n <= 6) as number[];
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
与えられた「goal」「seed」に忠実に、部門文脈に沿った自然な日本語の問いを1つだけ返してください。
- 出力は JSON のみ {"question":"...","reason":"...","hint":"..."}。
- question: 50〜120字、単一トピック、具体的（多重質問にしない）
- reason: 40〜100字、なぜ今その問いかを簡潔に
- hint: 60〜120字、考えを進める補助（例や観点）を一行で
- 用語は「Objective / Key Results」を使用（北極星KPIは使わない）
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
        max_tokens: opts?.max_tokens ?? 360,
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
function needsRewrite(question: string, reason: string, hint?: string) {
  const qLen = [...(question || '')].length;
  const rLen = [...(reason || '')].length;
  const tooManyQuestions = (question.match(/？/g) || []).length > 1;
  const tooManyConj = /(、.*、.*、)/.test(question); // 列挙過多っぽい
  const tooShortOrLong = qLen < 50 || qLen > 120 || rLen < 40 || rLen > 100;
  const hintTooLong = hint ? [...hint].length > 120 : false;
  return tooShortOrLong || tooManyQuestions || tooManyConj || hintTooLong;
}

/** リライト（要件に合わせて調整） */
async function rewriteForConstraints(payload: {
  question: string; reason: string; hint?: string;
  goal: string; stepNumber: StepNumber; departmentName: string;
}) {
  const prompt = `
次のQ/R/Hを、要件に合うよう1回で調整してください。JSONのみ {"question","reason","hint"}。
- goal: ${payload.goal}
- step: ${payload.stepNumber}
- 部門: ${payload.departmentName}
- 条件: questionは1トピック・50〜120字、reasonは40〜100字、hintは60〜120字。具体語と期限・KRを優先、言い換えすぎない
- 元Q: ${payload.question}
- 元R: ${payload.reason}
- 元H: ${payload.hint || '(なし)'}
`.trim();

  const fix = await callOpenAIWithRetry(
    [
      { role: 'system', content: '日本語で、必ずJSONのみを返答します。' },
      { role: 'user', content: prompt },
    ],
    2,
    { temperature: 0.25, max_tokens: 260 }
  );
  const raw = fix.choices?.[0]?.message?.content ?? '';
  const parsed = safeJsonFromText<any>(raw);
  const q = (parsed?.question ?? '').trim();
  const r = (parsed?.reason ?? '').trim();
  const h = (parsed?.hint ?? '').trim();
  return { q, r, h };
}

/* =========================
 * ハンドラ
 * ======================= */
export async function POST(req: Request) {
  const routeHeaders = {
    'Cache-Control': 'no-store',
    'X-GROWTH-Route': 'app/api/generate-department-question',
    'X-GROWTH-Question-Shape': 'v4-6step',
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
    const guide = GUIDE[(stepNumber - 1) as 0 | 1 | 2 | 3 | 4 | 5] ?? GUIDE[0];

    // 業種情報
    const industry = (body.industry || '').trim();
    const industryLabel = industry ? getIndustryLabel(industry, { full: true }) : '';
    const industryLine = industryLabel
      ? `${industryLabel}${industry ? `（${industry}）` : ''}`
      : '(業種未指定)';

    // Ver4 summary（方向性・期待・注力）を文脈に取り込む
    const summaryLines: string[] = [];
    if (body.direction) summaryLines.push(`- direction: ${sanitizeText(body.direction, 140)}`);
    if (Array.isArray(body.expectations) && body.expectations.length) {
      summaryLines.push(
        `- expectations:\n${body.expectations.slice(0, 4).map((x) => `  - ${sanitizeText(x, 120)}`).join('\n')}`
      );
    }
    if (Array.isArray(body.focusThemes) && body.focusThemes.length) {
      summaryLines.push(
        `- focusThemes:\n${body.focusThemes.slice(0, 4).map((x) => `  - ${sanitizeText(x, 120)}`).join('\n')}`
      );
    }

    // 事前たたき台（任意）
    const contextLines: string[] = [];
    contextLines.push(`- 業種: ${industryLine}`);
    contextLines.push(`- ステップ: ${stepNumber}（${guide.label}）`);

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
Ver4 summary:
${summaryLines.join('\n') || '(なし)'}
文脈:
${contextLines.join('\n') || '(なし)'}
${prevA ? prevA + '\n' : ''}
今回ステップ: ${stepNumber}（${guide.label}）
goal: ${guide.goal}
seed: ${guide.seed}
→ seedの意味を保持しつつ、summary・業種・部門文脈と一貫する「単一の問い」をJSONで返してください。
`.trim();

    // OpenAI 呼び出し
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
        { temperature: 0.25, max_tokens: 380 }
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
    let h = (parsed?.hint ?? '').trim();

    if (!q || !r) {
      return new NextResponse(JSON.stringify({ error: 'Invalid JSON from model', raw }), {
        status: 502,
        headers: routeHeaders,
      });
    }

    // 長さ・単一トピック・具体化の簡易チェック → 必要に応じリライト
    if (needsRewrite(q, r, h)) {
      const { q: q2, r: r2, h: h2 } = await rewriteForConstraints({
        question: q,
        reason: r,
        hint: h,
        goal: guide.goal,
        stepNumber,
        departmentName: dept,
      });
      if (q2 && r2 && !needsRewrite(q2, r2, h2)) {
        q = q2; r = r2; h = h2;
      }
    }

    const step: AnswerStep = {
      stepNumber,
      label: guide.label,
      question: q,
      reason: r,
      hint: h || GUIDE[stepNumber - 1]?.hint || '',
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
