// app/api/ask-ceo-agent/route.ts
import { NextResponse } from 'next/server';
import { openai } from '@/lib/openai';

// 型チェック用（OpenAI仕様に合わせて限定）
type Role = 'user' | 'assistant';
interface Message {
  role: Role;
  content: string;
}

export async function POST(req: Request) {
  try {
    const { messages, userId, strategyId } = await req.json();

    // ✅ バリデーション（最低限）
    if (!Array.isArray(messages) || !messages.every((m: any) => typeof m.role === 'string' && typeof m.content === 'string')) {
      return NextResponse.json({ error: '無効なメッセージ形式です。' }, { status: 400 });
    }

    const completion = await openai.chat.completions.create({
      model: 'gpt-4o',
      messages: messages as Message[],
      temperature: 0.7,
    });

    const content = completion.choices?.[0]?.message?.content;

    if (!content) {
      console.error('❌ コンテンツなし:', JSON.stringify(completion, null, 2));
      return NextResponse.json({ error: 'コンテンツが生成されませんでした。' }, { status: 500 });
    }

    return NextResponse.json({ content });
  } catch (e) {
    console.error('❌ OpenAI APIエラー:', JSON.stringify(e));
    return NextResponse.json(
      { error: 'OpenAI APIでエラーが発生しました。' },
      { status: 500 }
    );
  }
}
