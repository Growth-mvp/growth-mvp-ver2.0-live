import { NextRequest, NextResponse } from 'next/server';
import OpenAI from 'openai';

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

export async function POST(req: NextRequest) {
  try {
    const { departmentName, mission, story } = await req.json();

    if (!departmentName || !mission || !story) {
      return NextResponse.json({ error: '必要な情報が不足しています（部門名、ミッション、ストーリー）' }, { status: 400 });
    }

    const prompt = `
以下は企業の経営戦略ストーリーです：

---
${story}
---

この戦略と以下の部門ミッションに基づき、「${departmentName}」部門で注力すべきプロジェクト案を3つ提案してください。

【部門ミッション】
${mission}

フォーマット：
プロジェクト:
- ...
- ...
- ...
`;

    const chatCompletion = await openai.chat.completions.create({
      model: 'gpt-4o',
      messages: [
        { role: 'system', content: 'あなたは有能な経営コンサルタントです。' },
        { role: 'user', content: prompt },
      ],
    });

    const text = chatCompletion.choices[0].message.content || '';

    // プロジェクトのみを抽出
    const projectsMatch = text.match(/プロジェクト[:：]\s*((?:- .+\n?)+)/);

    const projects = projectsMatch
      ? projectsMatch[1].split('\n').map((line) => line.replace(/^- /, '').trim()).filter(Boolean)
      : [];

    return NextResponse.json({ projects });
  } catch (err) {
    console.error('❌ プロジェクト再生成エラー:', err);
    return NextResponse.json({ error: 'サーバーエラーが発生しました' }, { status: 500 });
  }
}
