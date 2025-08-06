'use client';

import { useEffect, useState } from 'react';
import { useAgentStore } from '@/store/useAgentStore';
import { useStrategyStore } from '@/store/strategyStore';
import { useUserStore } from '@/store/userStore';
import { insertAgentLog } from '@/lib/supabase/agentLogs';

export default function ChatPage() {
  const {
    vision,
    industry,
    revenue,
    employees,
    strength,
    weakness,
    opportunity,
    threat,
    strategyId,
  } = useStrategyStore();

  const { user } = useUserStore();
  const userId = user?.id;

  const {
    step,
    chatLog,
    addMessage,
    incrementStep,
    resetConversation,
  } = useAgentStore();

  const [chatInput, setChatInput] = useState('');
  const [chatLoading, setChatLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');

  // 初期化：最初の質問を AI から
  useEffect(() => {
    if (step === 0 && chatLog.length === 0) {
      handleSendMessage('');
    }
  }, [step, chatLog]);

  const handleSendMessage = async (userInput: string) => {
    if (chatLoading || !userId || !strategyId) return;

    setChatLoading(true);
    setErrorMessage('');

    const context = `
【経営戦略の想い】${vision}
【業種】${industry}
【売上】${revenue}
【社員数】${employees}
【SWOT】
- 強み: ${strength}
- 弱み: ${weakness}
- 機会: ${opportunity}
- 脅威: ${threat}`;

    try {
      const res = await fetch('/api/ask-ceo-agent', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userInput, step, context }),
      });

      const data = await res.json();

      if (res.ok && data.reply) {
        if (userInput.trim()) {
          addMessage({ role: 'user', content: userInput });
          await insertAgentLog({
            userId,
            strategyId,
            step,
            role: 'user',
            content: userInput,
          });
        }

        addMessage({ role: 'assistant', content: data.reply });
        await insertAgentLog({
          userId,
          strategyId,
          step,
          role: 'assistant',
          content: data.reply,
        });

        incrementStep();
        setChatInput('');
      } else {
        setErrorMessage('⚠ 回答を取得できませんでした。');
      }
    } catch (err) {
      console.error('APIエラー:', err);
      setErrorMessage('⚠ 通信エラーが発生しました。');
    } finally {
      setChatLoading(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      if (chatInput.trim()) {
        handleSendMessage(chatInput);
      }
    }
  };

  return (
    <div className="flex max-w-7xl mx-auto">
      <main className="w-2/3 pr-6">
        <h2 className="text-2xl font-bold">経営者AIエージェント</h2>
        <p className="text-sm text-gray-600 mb-4">
          経営者のように問いかけ、あなたの思考を引き出しながら、戦略を共につくっていきます。
        </p>

        <div className="space-y-2 text-sm">
          {chatLog.map((msg, i) => (
            <div
              key={i}
              className={`p-2 rounded ${
                msg.role === 'user' ? 'bg-white border' : 'bg-gray-100'
              }`}
            >
              <strong>{msg.role === 'user' ? 'あなた' : '経営者AI'}：</strong>{' '}
              {msg.content}
            </div>
          ))}
        </div>

        {!chatLoading && (
          <div className="mt-4">
            <textarea
              rows={3}
              className="w-full p-2 border rounded"
              placeholder="返信を入力してください（Enterで送信）"
              value={chatInput}
              onChange={(e) => setChatInput(e.target.value)}
              onKeyDown={handleKeyDown}
            />
          </div>
        )}

        {chatLoading && <p className="text-sm mt-4 text-gray-500">AIが考え中です...</p>}
        {errorMessage && <p className="text-sm mt-4 text-red-500">{errorMessage}</p>}

        <button
          onClick={resetConversation}
          className="mt-6 text-xs text-gray-500 underline"
        >
          会話をリセット
        </button>
      </main>

      <aside className="w-1/3 bg-gray-450 p-4 border-l">
        <h3 className="font-semibold mb-2">経営者AIエージェント</h3>
        <p className="text-sm text-gray-600">
          あなたの状況に応じて、戦略的な問いを立て、思考の整理と方向づけを支援します。
        </p>
        <p className="text-xs text-gray-400 mt-4">
          ※個人情報や評価制度などには回答できません。
        </p>
      </aside>
    </div>
  );
}
