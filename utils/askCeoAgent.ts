// utils/askCeoAgent.ts

export interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

export async function askCeoAgent({
  messages,
  userId,
  strategyId,
}: {
  messages: ChatMessage[];
  userId: string;
  strategyId: string;
}): Promise<string | null> {
  try {
    // OpenAI形式への変換（必要に応じて内部変換）
    const openAIMessages = messages.map((msg) => ({
      role: msg.role,
      content: msg.content,
    }));

    const res = await fetch('/api/ask-ceo-agent', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        messages: openAIMessages,
        userId,
        strategyId,
      }),
    });

    if (!res.ok) {
      console.error('❌ APIエラー:', res.status, await res.text());
      return null;
    }

    const data = await res.json();

    // contentがstringであることを保証
    if (typeof data?.content === 'string') {
      return data.content;
    } else {
      console.error('❌ レスポンス形式が不正です:', data);
      return null;
    }
  } catch (err) {
    console.error('❌ askCeoAgent.ts エラー:', err);
    return null;
  }
}
