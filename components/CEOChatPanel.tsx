'use client';

import { useState, useRef, useEffect } from 'react';
import { useUserStore } from '@/store/userStore';
import { useStrategyStore } from '@/store/strategyStore';
import { askCeoAgent } from '@/utils/askCeoAgent';

type ChatMessage = {
  role: 'user' | 'assistant';
  content: string;
};

export default function CEOChatPanel() {
  const { user } = useUserStore();
  const { strategyId, mission, vision, value } = useStrategyStore();

  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const bottomRef = useRef<HTMLDivElement | null>(null);
  const idleTimer = useRef<NodeJS.Timeout | null>(null);

  // 📌 初期ログ
  useEffect(() => {
    console.log('🧩 CEOChatPanel Mounted');
    console.log('🧑‍💼 user:', user);
    console.log('📌 strategyId:', strategyId);
  }, [user, strategyId]);

  // 🎉 初回あいさつ
  useEffect(() => {
    if (!user?.id || !user?.name) return;

    const greetedKey = `agentGreeted-${user.id}`;
    const hasGreeted = localStorage.getItem(greetedKey);

    if (!hasGreeted) {
      const greetingContent = `こんにちは、${user.name}さん。GROWTHへようこそ。\n\n私は経営者AIエージェントです。経営のこと、組織のこと、戦略のこと、何でもお気軽にご相談ください。${
        !mission || !vision || !value
          ? '\n\n※「MVV（Mission・Vision・Value）」が未入力の場合は、左メニューの「戦略策定」から入力いただくと、より深いアドバイスが可能になります。'
          : ''
      }`;

      setMessages((prev) => [...prev, { role: 'assistant', content: greetingContent }]);
      localStorage.setItem(greetedKey, 'true');
      console.log('💬 初回あいさつを表示しました');
    }
  }, [user?.id, user?.name, mission, vision, value]);

  // 🕑 アイドル提案
  useEffect(() => {
    if (!user) return;

    const startIdleTimer = () => {
      if (idleTimer.current) clearTimeout(idleTimer.current);

      idleTimer.current = setTimeout(() => {
        setMessages((prev) => {
          if (prev.length > 3) return prev;
          return [
            ...prev,
            {
              role: 'assistant',
              content:
                'ご不明点やお困りごとはありませんか？戦略ストーリー、部門戦略、OKR設計などもお気軽にご相談ください。',
            },
          ];
        });
        console.log('⏱️ アイドルメッセージを表示しました');
      }, 2 * 60 * 1000);
    };

    startIdleTimer();

    return () => {
      if (idleTimer.current) clearTimeout(idleTimer.current);
    };
  }, [messages, user]);

  // ✉️ メッセージ送信処理
  const handleSend = async () => {
    if (!input.trim() || !user?.id) {
      console.warn('⚠️ 入力が空、または user.id が未定義');
      return;
    }

    if (!strategyId) {
      console.warn('⚠️ strategyId が未定義。戦略データ未読込の可能性あり');
      setMessages((prev) => [
        ...prev,
        {
          role: 'assistant',
          content:
            '⚠️ 戦略データがまだ読み込まれていないようです。\n\n左メニューの「戦略策定」から基本情報を入力・保存してください。',
        },
      ]);
      return;
    }

    const newMessages: ChatMessage[] = [...messages, { role: 'user', content: input }];
    setMessages(newMessages);
    setInput('');
    setLoading(true);

    try {
      const res = await askCeoAgent({
        messages: newMessages,
        userId: user.id,
        strategyId,
      });

      console.log('✅ API 応答:', res);

      const content =
        typeof res === 'string'
          ? res
          : typeof res === 'object' && res !== null && 'content' in res
          ? (res as { content?: string }).content ?? '回答の取得に失敗しました。'
          : '回答の取得に失敗しました。';

      setMessages((prev) => [...prev, { role: 'assistant', content }]);
    } catch (err) {
      console.error('❌ handleSend error:', err);
      setMessages((prev) => [
        ...prev,
        {
          role: 'assistant',
          content: '通信エラーが発生しました。時間をおいて再試行してください。',
        },
      ]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, loading]);

  // 💬 表示部
  return (
    <div className="flex flex-col h-[calc(100vh-48px)] p-4 bg-white">
      <div className="flex-1 overflow-y-auto space-y-4 pr-1">
        {messages.map((msg, index) => (
          <div
            key={index}
            className={`p-3 rounded-md text-sm ${
              msg.role === 'user'
                ? 'bg-blue-100 text-right ml-auto'
                : 'bg-gray-100 text-left mr-auto'
            } max-w-[80%] whitespace-pre-wrap`}
          >
            {msg.content}
          </div>
        ))}
        {loading && (
          <div className="p-3 rounded-md bg-gray-200 text-left mr-auto max-w-[80%] animate-pulse">
            生成中...
          </div>
        )}
        <div ref={bottomRef} />
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
