'use client';

import { useState, useRef, useEffect } from 'react';
import { safeGetSession } from '@/utils/supabase/client';

type IntakeDraft = {
  situation_text?: string;
  my_recognition_text?: string;
  ideal_text?: string;
  expectation_text?: string;
  counterparty_type?: string;
  counterparty_detail?: string;
};

type ChatMessage = {
  role: 'user' | 'assistant';
  content: string;
};

type OrgAlignmentIntakeChatProps = {
  onComplete: (draft: IntakeDraft) => void;
  isLoading?: boolean;
};

export default function OrgAlignmentIntakeChat({ onComplete, isLoading: externalLoading }: OrgAlignmentIntakeChatProps) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [userInput, setUserInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');
  const [currentDraft, setCurrentDraft] = useState<IntakeDraft>({});
  const [conversationRound, setConversationRound] = useState(0);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  // 初回ロード時に初期メッセージを表示
  useEffect(() => {
    if (messages.length === 0) {
      setMessages([
        {
          role: 'assistant',
          content:
            'まず、今感じているもやもやや違和感を、そのまま書いてください。\nうまく整理できていなくても大丈夫です。\nあとからAIが一緒に整理します。',
        },
      ]);
    }
  }, []);

  // メッセージをスクロール
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const handleSendMessage = async () => {
    if (!userInput.trim() || isLoading || externalLoading) return;

    setErrorMessage('');
    const userMessage = userInput.trim();
    setUserInput('');

    // ユーザーメッセージを追加
    const newMessages: ChatMessage[] = [...messages, { role: 'user', content: userMessage }];
    setMessages(newMessages);

    setIsLoading(true);

    try {
      // Get Supabase auth session
      const { ok: sessionOk, data: sessionData, error: sessionError } = await safeGetSession();

      if (!sessionOk || !sessionData?.session?.access_token) {
        setErrorMessage('ログイン情報を確認できません。再ログインしてください。');
        setIsLoading(false);
        return;
      }

      // intake APIを呼び出し
      const response = await fetch('/api/org-alignment/intake', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${sessionData.session.access_token}`,
        },
        body: JSON.stringify({
          userMessage,
          conversationHistory: newMessages.slice(0, -1),
          currentDraft,
          conversationRound,
        }),
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.error || `API error: ${response.status} ${response.statusText}`);
      }

      const responseData = await response.json();

      // アシスタントのメッセージを追加
      if (responseData.assistantMessage) {
        setMessages((prev) => [
          ...prev,
          { role: 'assistant', content: responseData.assistantMessage },
        ]);
      }

      // draft を更新
      setCurrentDraft(responseData.draft);
      setConversationRound(responseData.conversationRound);

      // status が 'ready_for_review' なら完了
      if (responseData.status === 'ready_for_review') {
        onComplete(responseData.draft);
      }
    } catch (error) {
      console.error(error);
      setErrorMessage(
        error instanceof Error ? error.message : 'チャットの処理に失敗しました。時間をおいて再度お試しください。',
      );
      // エラー時はユーザーメッセージを削除して元の状態に戻す
      setMessages((prev) => prev.slice(0, -1));
    } finally {
      setIsLoading(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSendMessage();
    }
  };

  return (
    <div className="flex flex-col rounded-2xl border border-slate-200 bg-white shadow-sm">
      {/* チャットメッセージ領域 */}
      <div className="flex-1 space-y-4 border-b border-slate-200 p-6" style={{ maxHeight: '400px', overflowY: 'auto' }}>
        {messages.map((msg, index) => (
          <div
            key={index}
            className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}
          >
            <div
              className={`max-w-[80%] rounded-xl px-4 py-3 text-sm leading-7 ${
                msg.role === 'user'
                  ? 'bg-slate-900 text-white'
                  : 'border border-slate-200 bg-slate-50 text-slate-700'
              }`}
            >
              {msg.content}
            </div>
          </div>
        ))}
        <div ref={messagesEndRef} />
      </div>

      {/* 入力エリア */}
      <div className="space-y-3 p-6">
        {errorMessage && (
          <div className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-700">
            {errorMessage}
          </div>
        )}

        <div className="flex flex-col gap-3">
          <textarea
            value={userInput}
            onChange={(e) => setUserInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="あなたの考えや感じたことをここに入力してください..."
            disabled={isLoading || externalLoading}
            className="min-h-[100px] w-full resize-none rounded-xl border border-slate-300 px-4 py-3 text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-slate-400 disabled:bg-slate-100"
          />

          <button
            type="button"
            onClick={handleSendMessage}
            disabled={!userInput.trim() || isLoading || externalLoading}
            className={`w-full rounded-xl px-4 py-3 font-semibold transition-colors ${
              !userInput.trim() || isLoading || externalLoading
                ? 'cursor-not-allowed bg-slate-200 text-slate-400'
                : 'bg-slate-950 text-white hover:bg-slate-900'
            }`}
          >
            {isLoading || externalLoading ? '処理中...' : '送信 (Shift+Enter で改行)'}
          </button>
        </div>

        <p className="text-xs text-slate-500">
          ※ AIとの対話を通じて、もやもやを具体的に整理します。最大2回の追加質問をします。
        </p>
      </div>
    </div>
  );
}
