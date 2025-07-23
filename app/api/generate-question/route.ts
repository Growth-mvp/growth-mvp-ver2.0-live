// app/api/generate-question/route.ts
import { OpenAI } from 'openai';
import { NextResponse } from 'next/server';

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY! });

export async function POST(req: Request) {
  const body = await req.json();

  const {
    role,
    industry,
    revenue,
    employees,
    thought,
    mission,
    vision,
    value,
    strength,
    weakness,
    opportunity,
    threat
  } = body;

  const prompt = `
あなたはドラッカーのような経営思想家です。${role}が本質的に考えるべき問いを生成してください。
文脈に基づいた深い思考を促す問いであることが重要です。

【会社情報】
- 役職: ${role}
- 業種: ${industry}
- 売上規模: ${revenue}
- 従業員数: ${employees}

【経営者の思い・MVV】
- 思い: ${thought}
- ミッション: ${mission}
- ビジョン: ${vision}
- バリュー: ${value}

【SWOT】
- 強み: ${strength}
- 弱み: ${weakness}
- 機会: ${opportunity}
- 脅威: ${threat}

【出力形式】
問い: （30〜100字程度の問い）
理由: なぜこの問いが重要なのか（背景と意図）

1つだけ、深く考えさせる問いを出力してください。
`;

  const response = await openai.chat.completions.create({
    model: 'gpt-4o',
    messages: [
      {
        role: 'system',
        content: 'あなたは経営者の思考を深める問いのプロフェッショナルです。'
      },
      {
        role: 'user',
        content: prompt
      }
    ],
    temperature: 0.7
  });

  const result = response.choices?.[0]?.message?.content ?? '出力が見つかりませんでした';
  return NextResponse.json({ result });
}
