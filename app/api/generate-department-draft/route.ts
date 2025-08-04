import { NextRequest, NextResponse } from 'next/server';
import OpenAI from 'openai';

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

export async function POST(req: NextRequest) {
  try {
    const { departmentName, story } = await req.json();

    if (!departmentName || !story) {
      return NextResponse.json({ error: '部門名またはストーリーが不足しています' }, { status: 400 });
    }

    const prompt = `
以下は企業の経営戦略ストーリーです：

---
${story}
---

この戦略に基づき、「${departmentName}」部門のミッション案と、注力すべきプロジェクト案を3つ提案してください。

フォーマット：
ミッション: ...
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

    // 出力を整形（ミッションとプロジェクトを抽出）
    const missionMatch = text.match(/ミッション[:：]\s*(.+)/);
    const projectsMatch = text.match(/プロジェクト[:：]\s*((?:- .+\n?)+)/);

    const mission = missionMatch ? missionMatch[1].trim() : '';
    const projects = projectsMatch
      ? projectsMatch[1].split('\n').map((line) => line.replace(/^- /, '').trim()).filter(Boolean)
      : [];

    return NextResponse.json({ mission, projects });
  } catch (err) {
    console.error('❌ 部門ドラフト生成エラー:', err);
    return NextResponse.json({ error: 'サーバーエラーが発生しました' }, { status: 500 });
  }
}
