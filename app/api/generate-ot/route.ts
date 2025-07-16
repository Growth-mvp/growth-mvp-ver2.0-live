// app/api/generate-ot/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { OpenAI } from 'openai';

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY! });

export async function POST(req: NextRequest) {
  try {
    const { industry, revenue, employees, businessContent } = await req.json();

    const prompt = `
あなたはSWOT分析の専門家です。
以下の企業情報をもとに、この企業が直面している「機会（Opportunity）」と「脅威（Threat）」をそれぞれ5つずつ分析してください。

【業種】${industry}
【売上規模】${revenue} 億円
【従業員数】${employees} 人
【事業内容】${businessContent}

出力形式は以下に厳密に従ってください。前後に説明文は不要です：

■ Opportunity（機会）
- 
- 
- 
- 
- 

■ Threat（脅威）
- 
- 
- 
- 
- 
`;

    const completion = await openai.chat.completions.create({
      model: 'gpt-4o',
      messages: [
        {
          role: 'system',
          content: 'あなたはSWOT分析に精通した戦略コンサルタントです。',
        },
        {
          role: 'user',
          content: prompt,
        },
      ],
      temperature: 0.5,
    });

    const result = completion.choices[0].message?.content || '';
    return NextResponse.json({ result });
  } catch (err) {
    console.error('❌ O/T生成エラー:', err);
    return NextResponse.json({ error: 'O/T生成に失敗しました' }, { status: 500 });
  }
}
