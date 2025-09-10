// /components/CEOChatPanel.tsx
'use client';

import React, { useEffect, useMemo, useRef, useState, useCallback } from 'react';
import { on } from '@/utils/actionBus';
import { useUserStore } from '@/store/userStore';
import { useStrategyStore } from '@/store/strategyStore';
import AbstractCoachAvatar from '@/components/AbstractCoachAvatar';
import { supabase } from '@/lib/supabaseClient';
import { ensureStrategyId } from '@/utils/strategyBootstrap';

type Msg = { role: 'user' | 'assistant'; content: string };

type AskResp = {
  content?: string;
  reply?: { content?: string };
  // stageUsed/confidence は返ってきても **表示しない**
  stageUsed?: 'strategy' | 'manual' | 'generic' | 'hybrid';
  confidence?: number;
  error?: string;
};

type Props = { embedded?: boolean };

export default function CEOChatPanel({ embedded = true }: Props) {
  const { user } = useUserStore();
  const s = useStrategyStore() as any;

  const strategyId = s?.strategyId as string | undefined;
  const setStrategyId =
    typeof s?.setStrategyId === 'function'
      ? (s.setStrategyId as (id: string) => void)
      : (id: string) => useStrategyStore.setState({ strategyId: id });

  const [messages, setMessages] = useState<Msg[]>([
    {
      role: 'assistant',
      content:
        'こんにちは。経営者AIエージェントです。GROWTHを理解した上で、一般質問も戦略相談もまとめてお答えします。',
    },
  ]);
  const messagesRef = useRef(messages);
  useEffect(() => { messagesRef.current = messages; }, [messages]);

  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const [ctxUpdated, setCtxUpdated] = useState(false);
  const [refreshTick, setRefreshTick] = useState(0);
  const [booting, setBooting] = useState(false);
  const [mounted, setMounted] = useState(false);
  const [initError, setInitError] = useState<string | null>(null);

  const listRef = useRef<HTMLDivElement | null>(null);
  const endRef = useRef<HTMLDivElement | null>(null);
  const debounceRef = useRef<number | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const bootingLockRef = useRef(false);
  const unmountedRef = useRef(false);

  useEffect(() => {
    setMounted(true);
    return () => { unmountedRef.current = true; };
  }, []);

  const userOK = mounted && Boolean(user?.id);
  const strategyOK = mounted && Boolean(strategyId);
  const inputOK = Boolean(input.trim());
  const readyAll = userOK && strategyOK && !booting;

  const avatarStatus =
    !userOK ? ('loading' as const)
    : booting ? ('loading' as const)
    : sending ? ('thinking' as const)
    : ctxUpdated ? ('responding' as const)
    : ('idle' as const);

  /** ====== strategyId 自動復元 ====== */
  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!userOK || strategyOK || booting || bootingLockRef.current) return;
      try {
        setInitError(null);
        setBooting(true);
        bootingLockRef.current = true;
        const id = await ensureStrategyId(supabase, user!.id);
        if (!cancelled && !unmountedRef.current && id) setStrategyId(id);
      } catch (e: any) {
        if (!cancelled && !unmountedRef.current) {
          const msg = typeof e?.message === 'string' ? e.message : '戦略データ初期化に失敗しました。';
          setInitError(msg);
          setMessages((prev) => [...prev, { role: 'assistant', content: `初期化エラー: ${msg}` }]);
        }
      } finally {
        if (!cancelled && !unmountedRef.current) {
          setBooting(false);
          setTimeout(() => { bootingLockRef.current = false; }, 300);
        }
      }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userOK, strategyOK]);

  /** ====== スクロール追従 ====== */
  useEffect(() => {
    if (endRef.current) endRef.current.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [messages, sending]);

  /** ====== コンテキスト更新イベント ====== */
  useEffect(() => {
    const off1 = on('agent:prompt:refresh', () => {
      if (debounceRef.current) window.clearTimeout(debounceRef.current);
      debounceRef.current = window.setTimeout(() => {
        setCtxUpdated(true);
        setRefreshTick((t) => t + 1);
        window.setTimeout(() => setCtxUpdated(false), 2000);
      }, 400);
    });
    return () => { off1(); if (debounceRef.current) window.clearTimeout(debounceRef.current); };
  }, []);

  /** ====== textarea オートリサイズ ====== */
  const autoResize = useCallback(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = Math.min(el.scrollHeight, 20 * 6) + 'px';
  }, []);
  useEffect(() => { autoResize(); }, [input, autoResize]);

  /** ====== 送信 ====== */
  const send = useCallback(async (text: string) => {
    const trimmed = text.trim();
    if (!trimmed || sending) return;

    const current = messagesRef.current;

    if (!userOK || booting || !strategyOK) {
      setMessages([
        ...current,
        { role: 'user', content: trimmed },
        {
          role: 'assistant',
          content: !userOK
            ? '（ログイン情報が未取得です。再ログインまたは画面リロードをお試しください）'
            : booting
            ? '（戦略IDを初期化中です。数秒後に再送信するか、下の「ワンクリック初期化」を押してください）'
            : initError
            ? `（初期化でエラーが発生しています: ${initError}）`
            : '（戦略IDが未設定です。初期化を実行してください）',
        },
      ]);
      setInput('');
      if (textareaRef.current) textareaRef.current.style.height = 'auto';
      return;
    }

    const userMsg: Msg = { role: 'user', content: trimmed };
    setSending(true);
    setMessages([...current, userMsg]);

    try {
      const res = await fetch('/api/ask-ceo-agent', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userId: user!.id,
          strategyId,
          messages: [...current.slice(-9), userMsg],
        }),
      });
      const raw = await res.text();
      if (!res.ok) throw new Error(`API ${res.status}: ${raw || 'unknown error'}`);

      let data: AskResp | null = null;
      try { data = raw ? (JSON.parse(raw) as AskResp) : null; } catch { data = null; }

      const content =
        (data?.content && String(data.content)) ||
        (data?.reply?.content && String(data.reply.content)) ||
        '（応答の取得に失敗しました）';

      setMessages((prev) => [...prev, { role: 'assistant', content }]);
    } catch (e) {
      console.error(e);
      setMessages((prev) => [
        ...prev,
        { role: 'assistant', content: '通信エラー。ネットワーク/ログイン/戦略IDをご確認のうえ再試行してください。' },
      ]);
    } finally {
      if (!unmountedRef.current) {
        setSending(false);
        setInput('');
        if (textareaRef.current) textareaRef.current.style.height = 'auto';
      }
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sending, userOK, booting, strategyOK, initError, strategyId, user?.id]);

  const onSubmit = () => { if (input.trim()) void send(input); };
  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); onSubmit(); }
  };

  const showDev = mounted && process.env.NODE_ENV !== 'production';

  /** ====== 手動初期化 ====== */
  const manualInit = async () => {
    if (!userOK || booting || bootingLockRef.current) return;
    try {
      setInitError(null);
      setBooting(true);
      bootingLockRef.current = true;
      const id = await ensureStrategyId(supabase, user!.id);
      setStrategyId(id);
      setMessages((prev) => [...prev, { role: 'assistant', content: '戦略IDを初期化しました。送信できます。' }]);
    } catch (e: any) {
      const msg = typeof e?.message === 'string' ? e.message : '初期化に失敗しました';
      setInitError(msg);
      setMessages((prev) => [...prev, { role: 'assistant', content: `初期化エラー: ${msg}` }]);
    } finally {
      setBooting(false);
      setTimeout(() => { bootingLockRef.current = false; }, 300);
    }
  };

  // ====== Apple風に：見出し1行＋控えめサブ、余白・タイポ強化 ======
  const rootCls = embedded
    ? ['w-full h-full','flex flex-col','bg-transparent','min-w-0 overflow-hidden','[&_*]:max-w-full'].join(' ')
    : ['hidden md:flex','w-[380px] h-full flex-col','border-l bg-white/70 backdrop-blur'].join(' ');

  return (
    <div className={rootCls} data-embedded={embedded ? 'true' : 'false'}>
      {/* ヘッダー */}
      <header className="shrink-0 px-5 pt-5 pb-3 border-b">
        <div className="flex items-start justify-between">
          <div className="flex items-center gap-3">
            <AbstractCoachAvatar size={60} status={avatarStatus as any} />
            <div className="leading-tight">
              <div className="text-[20px] font-semibold tracking-[-0.01em]">経営者AIエージェント</div>
              <div className="text-[12px] text-zinc-500 mt-0.5">
                {!userOK ? 'ユーザー未読み込み'
                  : booting ? '戦略IDを初期化中…'
                  : strategyOK ? '準備完了'
                  : '戦略ID未設定'}
              </div>
            </div>
          </div>
          {ctxUpdated && (
            <span className="rounded-full bg-emerald-100 px-2 py-[2px] text-[10px] font-semibold text-emerald-700 mt-1">
              コンテキスト更新
            </span>
          )}
        </div>
      </header>

      {/* 会話ログ */}
      <div ref={listRef} className="flex-1 min-h-0 overflow-y-auto px-5 py-4 space-y-3" aria-live="polite">
        {/* 未初期化時のガイダンス */}
        {userOK && !strategyOK && (
          <div className="mr-auto max-w-[90%] rounded-lg bg-amber-50 p-3 text-[12px] text-amber-800 space-y-2">
            <div>戦略IDが未設定です。ボタン一発で初期化できます。</div>
            {initError && <div className="text-red-700">エラー: {initError}</div>}
            <button
              onClick={manualInit}
              disabled={booting}
              className={`rounded-md px-3 py-1.5 text-[12px] font-semibold ${
                booting ? 'bg-gray-300 text-gray-600' : 'bg-black text-white hover:opacity-90'
              }`}
            >
              {booting ? '初期化中…' : 'ワンクリック初期化'}
            </button>
          </div>
        )}

        {messages.map((m, i) => (
          <div
            key={i}
            className={[
              'mb-1 max-w-[90%] whitespace-pre-wrap text-[14px] leading-6 rounded-lg px-3 py-2',
              m.role === 'user'
                ? 'ml-auto bg-zinc-100 text-zinc-900'
                : 'mr-auto bg-white border border-zinc-200 text-zinc-900'
            ].join(' ')}
          >
            {m.content}
          </div>
        ))}
        {sending && (
          <div className="mr-auto inline-flex items-center gap-2 rounded-lg bg-white border border-zinc-200 px-2 py-1 text-[12px] text-zinc-500">
            <span className="h-2 w-2 animate-pulse rounded-full" />
            思考中…
          </div>
        )}
        <div ref={endRef} />
      </div>

      {/* 入力フォーム */}
      <div className="shrink-0 border-t px-5 py-3">
        <div className="space-y-2">
          <textarea
            ref={textareaRef}
            className="w-full resize-none overflow-hidden rounded-lg border p-2 text-[14px] leading-6 outline-none focus:ring"
            placeholder={
              readyAll
                ? '質問を入力（Shift+Enterで改行、Enterで送信）'
                : !userOK
                ? 'ユーザーを読み込み中…'
                : booting
                ? '戦略IDを初期化中…'
                : '初期化が必要です。質問を送るとガイダンスが返ります。'
            }
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onInput={autoResize}
            onKeyDown={onKeyDown}
            rows={1}
            disabled={sending || booting}
          />
          <div className="flex items-center justify-between">
            <span className="text-[11px] text-gray-500">
              {refreshTick > 0 ? `更新 ${refreshTick}` : readyAll ? '準備OK' : booting ? '初期化中' : '待機中'}
            </span>
            <div className="flex items-center gap-2">
              <button
                onClick={() => { setMessages([{ role: 'assistant', content: '履歴をリセットしました。' }]); }}
                className="rounded-md px-2 py-1 text-[12px] hover:bg-gray-100"
                type="button"
              >
                クリア
              </button>
              <button
                onClick={() => { if (input.trim()) void send(input); }}
                disabled={!inputOK || sending}
                className={`rounded-md px-3 py-1.5 text-[12px] font-semibold ${
                  (!inputOK || sending) ? 'bg-gray-200 text-gray-500' : 'bg-black text-white hover:opacity-90'
                }`}
                type="button"
              >
                送信
              </button>
            </div>
          </div>

          {showDev && (
            <div className="text-[10px] text-gray-500 mt-1 space-x-2">
              <span>user:{String(user?.id ? '✓' : '×')}</span>
              <span>strategyId:{String(strategyId ? '✓' : '×')}</span>
              <span>booting:{String(booting)}</span>
              {initError && <span className="text-red-600">initError:{initError}</span>}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
