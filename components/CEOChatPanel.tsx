'use client';

import { useState } from 'react';
import { useUserStore } from '@/store/userStore';
import { useStrategyStore } from '@/store/strategyStore';
import { askCeoAgent } from '@/utils/askCeoAgent';

export interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

export default function CEOChatPanel() {
  const { user } = useUserStore();
  const { strategyId } = useStrategyStore();

  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSend = async () => {
    if (!input.trim() || !user?.id) return;

    const newMessages: ChatMessage[] = [
      ...messages,
      { role: 'user', content: input },
    ];

    setMessages(newMessages);
    setInput('');
    setLoading(true);

    try {
      const response = await askCeoAgent({
        messages: newMessages,
        userId: user.id,
        strategyId,
      });

      if (response) {
        setMessages([...newMessages, { role: 'assistant', content: response }]);
      } else {
        setMessages([
          ...newMessages,
          { role: 'assistant', content: '回答の取得に失敗しました。' },
        ]);
      }
    } catch (err) {
      console.error('❌ handleSend エラー:', err);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex flex-col h-full p-4 bg-white">
      <div className="flex-1 overflow-y-auto space-y-4">
        {messages.map((msg, index) => (
          <div
            key={index}
            className={`p-3 rounded-md ${
              msg.role === 'user' ? 'bg-blue-100 text-right ml-auto' : 'bg-gray-100 text-left mr-auto'
            } max-w-[80%]`}
          >
            {msg.content}
          </div>
        ))}
        {loading && (
          <div className="p-3 rounded-md bg-gray-200 text-left mr-auto max-w-[80%] animate-pulse">
            生成中...
          </div>
        )}
      </div>

      <div className="mt-4 flex gap-2">
        <input
          type="text"
          className="flex-1 border rounded px-3 py-2"
          placeholder="経営者AIに質問..."
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') handleSend();
          }}
        />
        <button
          onClick={handleSend}
          disabled={loading}
          className="bg-blue-600 text-white px-4 py-2 rounded disabled:opacity-50"
        >
          送信
        </button>
      </div>
    </div>
  );
}
