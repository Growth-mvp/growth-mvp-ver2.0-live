// /app/api/generate-ot/route.ts
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

import { NextRequest, NextResponse } from 'next/server';
import { openai } from '@/lib/openai';
import { z } from 'zod';
import { getIndustryLabel } from '@/utils/industryTemplates';

/* =========================
 * 型
 * ======================= */
type OT = {
  opportunity: string[]; // 5件
  threat: string[];      // 5件
};

type Req = {
  industry?: string;         // 英語コード
  revenue?: string;
  employees?: string;
  businessContent?: string;
};

/* =========================
 * バリデーション
 * ======================= */
const ReqSchema = z.object({
  industry: z.string().max(2000).optional(),
  revenue: z.string().max(2000).optional(),
  employees: z.string().max(2000).optional(),
  businessContent: z.string().max(2000).optional(),
});

/* =========================
 * ユーティリティ
 * ======================= */
function sanitize(s?: string) {
  return (s ?? '')
    .toString()
    .replace(/\u0000/g, '')
    .trim()
    .slice(0, 2000);
}

function toMarkdownList(arr: string[], titleJa: string, titleEn: string): string {
  const head = `■ ${titleEn}（${titleJa}）`;
  const body = (arr ?? []).map((v) => `- ${v}`).join('\n');
  return `${head}\n${body}\n`;
}

function buildUserPrompt({
  industryCode,
  industryLabel,
  revenue,
  employees,
  businessContent,
}: {
  industryCode: string;
  industryLabel: string;
  revenue: string;
  employees: string;
  businessContent: string;
}) {
  // 業種行は「日本語ラベル（英語コード）」の順で明示（片方欠けても崩れない）
  const industryLine =
    industryLabel && industryCode
      ? `${industryLabel}（${industryCode}）`
      : (industryLabel || industryCode || '');

  return [
    'あなたはSWOT分析の専門家です。',
    '以下の企業情報をもとに、この企業が直面している「機会（Opportunity）」と「脅威（Threat）」をそれぞれ5つずつ分析してください。',
    '',
    `【業種】${industryLine}`,
    `【売上規模】${revenue || ''}`,
    `【従業員数】${employees || ''}`,
    `【事業内容】${businessContent || ''}`,
    '',
    '出力は JSON のみ。文章・表・前置き・注釈は一切不要。',
  ].join('\n');
}

function extractJsonObject<T = any>(raw: string): T | null {
  if (!raw || typeof raw !== 'string') return null;
  try {
    return JSON.parse(raw) as T;
  } catch {
    const m = raw.match(/\{[\s\S]*\}/m);
    if (m) {
      try { return JSON.parse(m[0]) as T; } catch {}
    }
  }
  return null;
}

/* =========================
 * フォールバック（最小限）
 * ======================= */
function naiveSplitFallback(text: string): OT {
  const t = (text || '').replace(/```(?:json|md|markdown)?/gi, '').trim();
  const oppBlock =
    t.match(/(?:^|\n) *[■#\[]? *Opportunit(?:y|ies)|機会[^\n]*\n([\s\S]*?)(?=\n *[■#\[]? *(?:Threats?|脅威)|$)/i)?.[1] ||
    '';
  // 修正：末尾まで確実に拾う
  const thrBlock = t.match(/(?:^|\n) *[■#\[]? *(?:Threats?|脅威)[^\n]*\n([\s\S]*$)/i)?.[1] || '';

  const toList = (s: string) =>
    s
      .split('\n')
      .map((l) => l.replace(/^[-*・\s]+/, '').trim())
      .filter(Boolean)
      .slice(0, 5);

  let opp = toList(oppBlock);
  let thr = toList(thrBlock);

  if (opp.length === 0 && thr.length === 0) {
    const lines = t
      .split('\n')
      .map((l) => l.replace(/^[-*・\s]+/, '').trim())
      .filter(Boolean);
    const mid = Math.ceil(lines.length / 2);
    opp = lines.slice(0, 5);
    thr = lines.slice(mid, mid + 5);
  }

  return {
    opportunity: opp.slice(0, 5),
    threat: thr.slice(0, 5),
  };
}

/* =========================
 * JSON Schema（可能なら使用）
 * ======================= */
const jsonSchema = {
  name: 'opportunity_threat_schema',
  schema: {
    type: 'object',
    properties: {
      opportunity: {
        type: 'array',
        items: { type: 'string' },
        minItems: 5,
        maxItems: 5,
        description: 'この企業にとっての機会（Opportunity）を簡潔に1文で。5件。',
      },
      threat: {
        type: 'array',
        items: { type: 'string' },
        minItems: 5,
        maxItems: 5,
        description: 'この企業にとっての脅威（Threat）を簡潔に1文で。5件。',
      },
    },
    required: ['opportunity', 'threat'],
    additionalProperties: false,
  },
  strict: true as const,
} as const;

const SUPPORTS_JSON_MODE = /^gpt-4o($|-)/;

/* =========================
 * OpenAI 呼び出し（リトライ）
 * ======================= */
async function callOpenAIWithRetry(
  args: {
    model: string;
    temperature: number;
    messages: { role: 'system' | 'user'; content: string }[];
    useSchema?: boolean;
    maxTokens?: number;
  },
  tries = 3
) {
  let lastErr: any;
  for (let i = 0; i < tries; i++) {
    try {
      const base: Record<string, unknown> = {
        model: args.model,
        temperature: args.temperature,
        max_tokens: args.maxTokens ?? 600,
        messages: args.messages,
      };

      if (args.useSchema && SUPPORTS_JSON_MODE.test(args.model)) {
        (base as any).response_format = {
          type: 'json_schema',
          json_schema: jsonSchema,
        };
      } else if (SUPPORTS_JSON_MODE.test(args.model)) {
        (base as any).response_format = { type: 'json_object' };
      }

      return await openai.chat.completions.create(base as any);
    } catch (e: any) {
      lastErr = e;
      const status = Number(e?.status ?? e?.code ?? 0);
      const retryable = status === 429 || status === 500 || status === 502 || status === 503 || status === 504;
      if (!retryable || i === tries - 1) break;
      const retryAfter = Number(e?.response?.headers?.get?.('retry-after')) || 0;
      const backoff = retryAfter > 0 ? retryAfter * 1000 : [300, 800, 1500][Math.min(i, 2)];
      await new Promise((r) => setTimeout(r, backoff));
    }
  }
  throw lastErr;
}

/* =========================
 * ハンドラ
 * ======================= */
export async function POST(req: NextRequest) {
  try {
    const raw = await req.json().catch(() => ({}));
    const parsed = ReqSchema.safeParse(raw);
    if (!parsed.success) {
      return NextResponse.json({ error: '入力形式が不正です' }, { status: 400 });
    }

    const body = parsed.data as Req;

    const industryCode = sanitize(body.industry);
    const revenue = sanitize(body.revenue);
    const employees = sanitize(body.employees);
    const businessContent = sanitize(body.businessContent);

    // ★ 英語コードから日本語ラベルをサーバ側で解決（UI改修なしでOK）
    const industryLabel = industryCode ? getIndustryLabel(industryCode, { full: true }) : '';

    // 1) JSONスキーマで厳密に取得（gpt-4o 系）
    let ot: OT | null = null;
    try {
      const ai = await callOpenAIWithRetry(
        {
          model: process.env.OPENAI_MODEL ?? 'gpt-4o-mini',
          temperature: 0.2,
          messages: [
            {
              role: 'system',
              content:
                'あなたはSWOT分析に精通した戦略コンサルタントです。出力は必ずJSON（指定スキーマ）で返します。',
            },
            {
              role: 'user',
              content: buildUserPrompt({
                industryCode,
                industryLabel,
                revenue,
                employees,
                businessContent,
              }),
            },
          ],
          useSchema: true,
          maxTokens: 600,
        },
        3
      );

      const rawContent = ai?.choices?.[0]?.message?.content ?? '';
      const parsedJson = extractJsonObject<any>(rawContent);
      if (
        parsedJson &&
        Array.isArray(parsedJson.opportunity) &&
        Array.isArray(parsedJson.threat)
      ) {
        ot = {
          opportunity: parsedJson.opportunity.map((s: unknown) => String(s ?? '').trim()).filter(Boolean).slice(0, 5),
          threat: parsedJson.threat.map((s: unknown) => String(s ?? '').trim()).filter(Boolean).slice(0, 5),
        };
      }
    } catch (e: any) {
      console.warn('generate-ot: json_schema 出力失敗 → フォールバックに移行', e?.message ?? String(e));
    }

    // 2) フォールバック：通常プロンプト→ナイーブ分割
    if (!ot) {
      const fallbackPrompt = [
        'あなたはSWOT分析の専門家です。',
        '以下の企業情報をもとに、この企業が直面している「機会（Opportunity）」と「脅威（Threat）」をそれぞれ5つずつ分析してください。',
        '',
        `【業種】${industryLabel ? `${industryLabel}${industryCode ? `（${industryCode}）` : ''}` : industryCode}`,
        `【売上規模】${revenue}`,
        `【従業員数】${employees}`,
        `【事業内容】${businessContent}`,
        '',
        '以下の見出しと箇条書きのみで出力してください。前後の説明・表・注釈は禁止：',
        '',
        '■ Opportunity（機会）',
        '- 〜',
        '- 〜',
        '- 〜',
        '- 〜',
        '- 〜',
        '',
        '■ Threat（脅威）',
        '- 〜',
        '- 〜',
        '- 〜',
        '- 〜',
        '- 〜',
      ].join('\n');

      let ai2;
      try {
        ai2 = await callOpenAIWithRetry(
          {
            model: 'gpt-4o',
            temperature: 0.3,
            messages: [
              { role: 'system', content: 'あなたはSWOT分析に精通した戦略コンサルタントです。' },
              { role: 'user', content: fallbackPrompt },
            ],
            useSchema: false,
            maxTokens: 700,
          },
          3
        );
      } catch (e: any) {
        const status = Number(e?.status ?? e?.code ?? 500);
        const message = e?.message || 'OpenAI error';
        return NextResponse.json({ error: message }, { status: status === 429 ? 429 : 502 });
      }

      const text = ai2?.choices?.[0]?.message?.content ?? '';
      ot = naiveSplitFallback(text);
    }

    // 3) 最終正規化（null防止と件数調整）
    const opportunity = (ot?.opportunity ?? [])
      .map((s: string) => s.trim())
      .filter(Boolean)
      .slice(0, 5);

    const threat = (ot?.threat ?? [])
      .map((s: string) => s.trim())
      .filter(Boolean)
      .slice(0, 5);

    // 4) 既存UI互換のため、見出し＋箇条書きのテキストも同梱
    const resultMarkdown =
      toMarkdownList(opportunity, '機会', 'Opportunity') +
      '\n' +
      toMarkdownList(threat, '脅威', 'Threat');

    return NextResponse.json(
      {
        opportunity,
        threat,
        result: resultMarkdown, // 既存の parseOT(raw) がここを読む想定
      },
      { headers: { 'Cache-Control': 'no-store' } }
    );
  } catch (err: any) {
    console.error('❌ O/T生成エラー:', err?.message || err);
    return NextResponse.json({ error: 'O/T生成に失敗しました' }, { status: 500 });
  }
}
