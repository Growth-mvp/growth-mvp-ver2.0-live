// app/api/generate-followup-questions/route.ts
import { NextResponse } from 'next/server';
import OpenAI from 'openai';

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

export const runtime = 'edge';

export async function POST(req: Request) {
  const { answers } = await req.json();

  if (!answers || !Array.isArray(answers)) {
    return NextResponse.json({ error: 'Invalid answers format' }, { status: 400 });
  }

  const prompt = `以下は経営者からの深掘り回答の一覧です。これらを踏まえて、より本質に迫る追加の質問を5つ生成してください。

回答一覧:
${answers.map((a, i) => `${i + 1}. ${a}`).join('\n')}

形式：
1. 質問A
2. 質問B
...

質問：`;

  const response = await openai.chat.completions.create({
    model: 'gpt-4o',
    messages: [
      {
        role: 'system',
        content: 'あなたは経営戦略の専門家です。人の思考を深める対話の設計を得意とします。',
      },
      {
        role: 'user',
        content: prompt,
      },
    ],
    temperature: 0.7,
  });

  const result = response.choices?.[0]?.message?.content ?? '出力が見つかりませんでした';
  return NextResponse.json({ result });
}
