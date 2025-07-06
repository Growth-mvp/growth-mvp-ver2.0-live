// app/api/ask-ceo/route.ts
import { NextResponse } from 'next/server';
import { OpenAI } from 'openai';

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

export async function POST(req: Request) {
  const body = await req.json();
  const { message, context } = body;

  if (!message || typeof message !== 'string') {
    return NextResponse.json({ error: 'メッセージが無効です' }, { status: 400 });
  }

  const systemPrompt = `
あなたは経営者AIです。以下の経営情報に基づいて、質問にわかりやすく丁寧に答えてください。
ただし、以下のテーマには絶対に答えないでください：「給与」「評価」「異動」「役員情報」「株主」「個人情報」「人事制度」「社内トラブル」など。
それ以外の経営戦略・パーパス・方向性に関する内容について、社員に安心と納得を与えるように説明してください。

【会社情報（入力された経営情報）】:
${context}
`;

  const completion = await openai.chat.completions.create({
    model: 'gpt-4',
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: message },
    ],
    temperature: 0.7,
  });

  const reply = completion.choices[0]?.message?.content;
  return NextResponse.json({ reply });
}
