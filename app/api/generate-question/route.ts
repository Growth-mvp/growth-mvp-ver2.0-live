import { OpenAI } from 'openai';
import { NextResponse } from 'next/server';

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY!,
});

export async function POST(req: Request) {
  try {
    const { story } = await req.json();

    const prompt = `
あなたはドラッカーのような経営思想家です。
戦略ストーリーに込められた意味を解釈し、社員の理解と自律を深めるための「深い問い」を設計してください。

以下のストーリーには、第1章〜第4章が含まれています。
各章に対して以下を作成してください：
- 2〜3問の問い
- 各問いには「なぜこの問いが重要か」という理由を添えてください
- 表面的な質問ではなく、戦略や価値創造、組織変革、人間理解に関わる深い問いにしてください

【ストーリー本文】
${story}

【出力形式】
[
  {
    "chapter": "第1章",
    "question": "～～～？",
    "reason": "～～～だからこの問いが重要"
  },
  ...
]
`.trim();

    const response = await openai.chat.completions.create({
      model: 'gpt-4o',
      messages: [
        {
          role: 'system',
          content: 'あなたはドラッカーのような思考を持つ経営思想家であり、社員の問いを設計するプロフェッショナルです。',
        },
        {
          role: 'user',
          content: prompt,
        },
      ],
      temperature: 0.7,
    });

    const raw = response.choices?.[0]?.message?.content ?? '[]';

    let questions = [];
    try {
      questions = JSON.parse(raw);
    } catch (err) {
      console.warn('❗️JSONパース失敗。GPT出力:\n', raw);
      return NextResponse.json({ error: 'AI出力の形式が不正です' }, { status: 500 });
    }

    return NextResponse.json({ questions });
  } catch (error) {
    console.error('❌ 質問生成エラー:', error);
    return NextResponse.json({ error: '質問生成に失敗しました' }, { status: 500 });
  }
}
