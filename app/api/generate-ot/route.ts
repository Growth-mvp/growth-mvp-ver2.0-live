// app/api/generate-ot/route.ts
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

import { NextRequest, NextResponse } from 'next/server';
import { OpenAI } from 'openai';

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY!,
});

/* =========================
 * 型
 * ======================= */
type OT = {
  opportunity: string[]; // 5件
  threat: string[];      // 5件
};

type Req = {
  industry?: string;
  revenue?: string;
  employees?: string;
  businessContent?: string;
};

/* =========================
 * ユーティリティ
 * ======================= */
function sanitize(s?: string) {
  return (s ?? '')
    .toString()
    .replace(/\u0000/g, '')
    .trim()
    .slice(0, 2000); // 入力過多ガード
}

function toMarkdownList(arr: string[], titleJa: string, titleEn: string): string {
  const head = `■ ${titleEn}（${titleJa}）`;
  const body = (arr ?? []).map((v) => `- ${v}`).join('\n');
  return `${head}\n${body}\n`;
}

function buildUserPrompt({ industry, revenue, employees, businessContent }: Req) {
  return [
    'あなたはSWOT分析の専門家です。',
    '以下の企業情報をもとに、この企業が直面している「機会（Opportunity）」と「脅威（Threat）」をそれぞれ5つずつ分析してください。',
    '',
    `【業種】${industry || ''}`,
    `【売上規模】${revenue || ''}`,
    `【従業員数】${employees || ''}`,
    `【事業内容】${businessContent || ''}`,
    '',
    // 重要：JSON固定の明示（ただし SDKの json_schema を使うので説明は補助）
    '出力は JSON のみ。文章・表・前置き・注釈は一切不要。',
  ].join('\n');
}

// OpenAIの response_format: json_schema を用意
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

/* =========================
 * 失敗時フォールバック（最小限）
 * - どうしてもJSONで来なかった場合の保険
 * ======================= */
function naiveSplitFallback(text: string): OT {
  const t = (text || '').replace(/```(?:json|md|markdown)?/gi, '').trim();
  // 見出し・簡易表のよくある形式に対応
  const oppBlock =
    t.match(/(?:^|\n) *[■#\[]? *Opportunit(?:y|ies)|機会[^\n]*\n([\s\S]*?)(?=\n *[■#\[]? *(?:Threats?|脅威)|$)/i)?.[1] ||
    '';
  const thrBlock =
    t.match(/(?:^|\n) *[■#\[]? *(?:Threats?|脅威)[^\n]*\n([\s\S]*$)/i)?.[1] || '';

  const toList = (s: string) =>
    s
      .split('\n')
      .map((l) => l.replace(/^[-*・\s]+/, '').trim())
      .filter(Boolean)
      .slice(0, 5);

  let opp = toList(oppBlock);
  let thr = toList(thrBlock);

  // 双方空っぽの場合は行を半々に割る
  if (opp.length === 0 && thr.length === 0) {
    const lines = t
      .split('\n')
      .map((l) => l.replace(/^[-*・\s]+/, '').trim())
      .filter(Boolean);
    const mid = Math.ceil(lines.length / 2);
    opp = lines.slice(0, 5);
    thr = lines.slice(mid, mid + 5);
  }

  // 件数調整（足りなければ空文字で埋めない：足りない分は落とす）
  return {
    opportunity: opp.slice(0, 5),
    threat: thr.slice(0, 5),
  };
}

/* =========================
 * ハンドラ
 * ======================= */
export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as Req;
    const industry = sanitize(body.industry);
    const revenue = sanitize(body.revenue);
    const employees = sanitize(body.employees);
    const businessContent = sanitize(body.businessContent);

    // 1) JSONスキーマで厳密に取得
    let ot: OT | null = null;
    try {
      const completion = await openai.chat.completions.create({
        model: 'gpt-4o-mini', // 高速・低コスト。必要なら 'gpt-4o' へ
        temperature: 0.2,
        messages: [
          {
            role: 'system',
            content:
              'あなたはSWOT分析に精通した戦略コンサルタントです。出力は必ずJSON（指定スキーマ）で返します。',
          },
          { role: 'user', content: buildUserPrompt({ industry, revenue, employees, businessContent }) },
        ],
        response_format: {
          type: 'json_schema',
          json_schema: jsonSchema,
        },
      });

      const raw = completion.choices?.[0]?.message?.content ?? '';
      const parsed = JSON.parse(raw);
      if (
        parsed &&
        Array.isArray(parsed.opportunity) &&
        Array.isArray(parsed.threat)
      ) {
        ot = {
          opportunity: parsed.opportunity.map((s: any) => String(s).trim()).filter(Boolean).slice(0, 5),
          threat: parsed.threat.map((s: any) => String(s).trim()).filter(Boolean).slice(0, 5),
        };
      }
    } catch (e) {
      // JSONスキーマ出力失敗 → 下のフォールバックへ
      // （ログだけ残す。ユーザーには静かなフォールバック）
      console.warn('generate-ot: json_schema 出力失敗 → フォールバックに移行', e);
    }

    // 2) フォールバック：通常プロンプト→ナイーブ分割
    if (!ot) {
      const fallbackPrompt = [
        'あなたはSWOT分析の専門家です。',
        '以下の企業情報をもとに、この企業が直面している「機会（Opportunity）」と「脅威（Threat）」をそれぞれ5つずつ分析してください。',
        '',
        `【業種】${industry}`,
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

      const completion2 = await openai.chat.completions.create({
        model: 'gpt-4o',
        temperature: 0.3,
        messages: [
          { role: 'system', content: 'あなたはSWOT分析に精通した戦略コンサルタントです。' },
          { role: 'user', content: fallbackPrompt },
        ],
      });

      const text = completion2.choices?.[0]?.message?.content ?? '';
      const parsed = naiveSplitFallback(text);
      ot = parsed;
    }

    // 3) 最終正規化（null防止と件数調整）
    const opportunity = (ot?.opportunity ?? []).map((s) => s.trim()).filter(Boolean).slice(0, 5);
    const threat = (ot?.threat ?? []).map((s) => s.trim()).filter(Boolean).slice(0, 5);

    // 4) 既存UI互換のため、見出し＋箇条書きのテキストも同梱
    const resultMarkdown =
      toMarkdownList(opportunity, '機会', 'Opportunity') +
      '\n' +
      toMarkdownList(threat, '脅威', 'Threat');

    // 応答：構造化 + 互換テキスト
    return NextResponse.json({
      opportunity,
      threat,
      result: resultMarkdown, // 既存の parseOT(raw) がここを読む想定
    });
  } catch (err) {
    console.error('❌ O/T生成エラー:', err);
    return NextResponse.json({ error: 'O/T生成に失敗しました' }, { status: 500 });
  }
}
