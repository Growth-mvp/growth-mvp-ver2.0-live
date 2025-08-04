// /app/api/generate-advice/route.ts
import { NextResponse } from 'next/server';
import { openai } from '@/lib/openai';

export async function POST(req: Request) {
  const { objective, progress } = await req.json();

  const prompt = `
以下は業務目標（OKR）とその進捗状況です。
この内容を読んで、改善点や次の行動につながるアドバイスを日本語で3点、箇条書きで提案してください。

Objective: ${objective}
進捗内容: ${progress}

# アドバイス:
`;

  const response = await openai.chat.completions.create({
    model: 'gpt-4o',
    messages: [{ role: 'user', content: prompt }],
    temperature: 0.7,
  });

  const advice = response.choices?.[0]?.message?.content ?? 'アドバイス生成に失敗しました。';
  return NextResponse.json({ advice });
}
