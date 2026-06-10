// /components/CEOChatPanel.tsx
'use client';

import React, { useEffect, useRef, useState, useCallback } from 'react';
import { on } from '@/utils/actionBus';
import { useUserStore } from '@/store/userStore';
import { useStrategyStore, type StrategyState } from '@/store/strategyStore';
import AbstractCoachAvatar from '@/components/AbstractCoachAvatar';
import { supabase } from '@/utils/supabase/client';
import { ensureStrategyId } from '@/utils/strategyBootstrap';

type Msg = { role: 'user' | 'assistant'; content: string };

type AskResp = {
  content?: string;
  reply?: { content?: string };
  stageUsed?: 'strategy' | 'manual' | 'generic' | 'hybrid';
  confidence?: number;
  error?: string;
};

type Props = { embedded?: boolean };

// ★ Sprint 3B': 自動チェックイン設定（控えめ）
const IDLE_MS = 180_000;               // 3分無操作で発火
const COOLDOWN_MS = 600_000;           // 発火後10分はクールダウン
const CHECK_TICK_MS = 15_000;          // 15秒ごとにポーリング
const MAX_NUDGES_PER_SESSION = 2;      // セッション中最大2回

export default function CEOChatPanel({ embedded = true }: Props) {
  const { user } = useUserStore();

  // === Strategy Store ===
  const strategyId = useStrategyStore((s: StrategyState) => s.strategyId);
  const setStrategyIdRef = useRef(useStrategyStore.getState().setStrategyId);
  useEffect(() => {
    setStrategyIdRef.current = useStrategyStore.getState().setStrategyId;
  }, []);

  // Hydration（Zustand persist）
  const [storeHydrated, setStoreHydrated] = useState(
    (useStrategyStore as any)?.persist?.hasHydrated?.() ?? false
  );
  useEffect(() => {
    const api: any = (useStrategyStore as any)?.persist;
    if (!api?.onFinishHydration) {
      const t = setTimeout(() => setStoreHydrated(true), 0);
      return () => clearTimeout(t);
    }
    const unsub = api.onFinishHydration(() => setStoreHydrated(true));
    if (api.hasHydrated()) setStoreHydrated(true);
    return () => unsub?.();
  }, []);

  // strategyId の変更ログ（開発時のみ）
  useEffect(() => {
    if (process.env.NODE_ENV === 'production') return;
    let prev = useStrategyStore.getState().strategyId;
    const unsub = useStrategyStore.subscribe((state) => {
      const id = state.strategyId;
      if (id !== prev) {
        // console.log('[panel] strategyId changed =>', id);
        prev = id;
      }
    });
    return () => unsub();
  }, []);

  const [messages, setMessages] = useState<Msg[]>([
    { role: 'assistant', content: 'こんにちは。AI経営コンサルタントです。' },
  ]);
  const messagesRef = useRef(messages);
  useEffect(() => { messagesRef.current = messages; }, [messages]);

  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const [ctxUpdated, setCtxUpdated] = useState(false);
  const [refreshTick, setRefreshTick] = useState(0);
  const [booting, setBooting] = useState(false);
  const [mounted, setMounted] = useState(false);

  const listRef = useRef<HTMLDivElement | null>(null);
  const endRef = useRef<HTMLDivElement | null>(null);
  const debounceRef = useRef<number | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const bootingLockRef = useRef(false);
  const unmountedRef = useRef(false);
  const autoEnsureOnceRef = useRef(false);
  const sendingWatchdogRef = useRef<number | null>(null);

  // ★ Sprint 3B': 自動チェックイン用 refs
  const lastUserActionAtRef = useRef<number>(Date.now());
  const lastNudgeAtRef = useRef<number>(0);
  const nudgeCountRef = useRef<number>(0);
  const nudgeInFlightRef = useRef<boolean>(false);

  useEffect(() => {
    setMounted(true);
    return () => { unmountedRef.current = true; };
  }, []);

  const userOK = mounted && Boolean(user?.id);
  const strategyOK = mounted && strategyId != null && String(strategyId).length > 0;
  const inputOK = Boolean(input.trim());
  const readyAll = userOK && strategyOK && !sending;

  const avatarStatus =
    !userOK ? ('loading' as const)
    : sending ? ('thinking' as const)
    : ctxUpdated ? ('responding' as const)
    : ('idle' as const);

  /** ====== 自動 ensure（一度だけ） ====== */
  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!storeHydrated || !userOK) return;
      if (strategyOK) return;
      if (booting || bootingLockRef.current || autoEnsureOnceRef.current) return;

      autoEnsureOnceRef.current = true;
      setBooting(true);
      bootingLockRef.current = true;

      try {
        const timeout = new Promise<null>((r) => setTimeout(() => r(null), 7000));
        const id = await Promise.race([
          ensureStrategyId(supabase, user!.id) as Promise<string | null | undefined>,
          timeout,
        ]);
        if (!cancelled && !unmountedRef.current && id) setStrategyIdRef.current(id);
      } catch {
      } finally {
        if (!cancelled && !unmountedRef.current) {
          setBooting(false);
          setTimeout(() => { bootingLockRef.current = false; }, 300);
        }
      }
    })();
    return () => { cancelled = true; };
  }, [storeHydrated, userOK, strategyOK, booting]);

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
        window.setTimeout(() => setCtxUpdated(false), 1800);
      }, 300);
    });
    return () => { off1(); if (debounceRef.current) window.clearTimeout(debounceRef.current); };
  }, []);

  /** ====== ユーザー操作検知（idle リセット用） ====== */
  useEffect(() => {
    const updateLastAction = () => {
      lastUserActionAtRef.current = Date.now();
    };

    // ★ Sprint 3B': 各種操作でタイムスタンプをリセット
    window.addEventListener('pointerdown', updateLastAction);
    window.addEventListener('keydown', updateLastAction);
    window.addEventListener('scroll', updateLastAction);
    window.addEventListener('focus', updateLastAction);

    return () => {
      window.removeEventListener('pointerdown', updateLastAction);
      window.removeEventListener('keydown', updateLastAction);
      window.removeEventListener('scroll', updateLastAction);
      window.removeEventListener('focus', updateLastAction);
    };
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
  // ★ Sprint 3A': meta オプション対応に拡張
  const send = useCallback(async (text: string, overrideMeta?: any) => {
    const trimmed = text.trim();
    if (!trimmed || sending) return;

    // ウォッチドッグ: 10秒で強制解除
    if (sendingWatchdogRef.current) window.clearTimeout(sendingWatchdogRef.current);
    sendingWatchdogRef.current = window.setTimeout(() => {
      setSending(false);
    }, 10_000);

    const current = messagesRef.current;
    const userMsg: Msg = { role: 'user', content: trimmed };

    setSending(true);
    setMessages([...current, userMsg]);

    try {
      if (!userOK) throw new Error('ログイン情報が未取得です');
      const { data: sdata } = await supabase.auth.getSession();
      const accessToken = sdata?.session?.access_token;
      if (!accessToken) throw new Error('ログイン情報が無効です（access token なし）');

      if (!strategyOK) {
        setBooting(true);
        try {
          const id = await ensureStrategyId(supabase, user!.id);
          if (id) setStrategyIdRef.current(id);
        } finally {
          setBooting(false);
        }
      }

      const latestStrategyId = useStrategyStore.getState().strategyId;

      const doAsk = async () => {
        // ★ Sprint 3A': meta を付与する場合と付与しない場合に対応
        const payload: any = {
          userId: user!.id,
          strategyId: latestStrategyId,
          messages: [...current.slice(-9), userMsg],
        };
        if (overrideMeta) {
          payload.meta = overrideMeta;  // AI診断時のみ meta を付与
        }

        const res = await fetch('/api/ask-ceo-agent', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${accessToken}`,
          },
          credentials: 'include',
          body: JSON.stringify(payload),
        });
        const raw = await res.text();
        return { ok: res.ok, status: res.status, raw };
      };

      let r = await doAsk();

      if (!r.ok && r.status === 400 && /context/i.test(r.raw)) {
        try {
          setBooting(true);
          await fetch('/api/companies/provision', {
            method: 'POST',
            headers: { Authorization: `Bearer ${accessToken}` },
            credentials: 'include',
          }).catch(() => {});
          await new Promise((res) => setTimeout(res, 250));
        } finally {
          setBooting(false);
        }
        r = await doAsk();
      }

      if (!r.ok) {
        if (process.env.NODE_ENV !== 'production') {
          console.error('ask-ceo-agent failed:', r.status, r.raw);
        }
        throw new Error('応答の取得に失敗しました');
      }

      let data: AskResp | null = null;
      try { data = r.raw ? (JSON.parse(r.raw) as AskResp) : null; } catch { data = null; }

      const content =
        (data?.content && String(data.content)) ||
        (data?.reply?.content && String(data.reply?.content)) ||
        '（応答の取得に失敗しました）';

      // ← 先に送信フラグを落としてからメッセージを追加（UI固着防止）
      setSending(false);
      if (sendingWatchdogRef.current) { window.clearTimeout(sendingWatchdogRef.current); sendingWatchdogRef.current = null; }

      setMessages((prev) => [...prev, { role: 'assistant', content }]);
      setInput('');
      if (textareaRef.current) textareaRef.current.style.height = 'auto';
      return;
    } catch (e) {
      if (process.env.NODE_ENV !== 'production') console.error(e);
      setMessages((prev) => [
        ...prev,
        { role: 'assistant', content: '通信エラー。ネットワーク/ログイン/権限をご確認ください。' },
      ]);
    } finally {
      // ★ ここでは unmountedRef を見ずに必ず落とす（二重で呼ばれても問題なし）
      setSending(false);
      if (sendingWatchdogRef.current) { window.clearTimeout(sendingWatchdogRef.current); sendingWatchdogRef.current = null; }
      setInput('');
      if (textareaRef.current) textareaRef.current.style.height = 'auto';
    }
  }, [sending, userOK, strategyOK, user?.id]);

  /** ====== 自動チェックイン（idle時のみ） ====== */
  // ★ Sprint 3B': nudgeIfNeeded - ガード条件を満たしたら1回だけ自動送信
  const nudgeIfNeeded = useCallback(async () => {
    const now = Date.now();

    // ガード条件（すべて満たしたら実行）
    if (document.visibilityState !== 'visible') return;
    if (nudgeInFlightRef.current) return;
    if (nudgeCountRef.current >= MAX_NUDGES_PER_SESSION) return;
    if (now - lastUserActionAtRef.current < IDLE_MS) return;
    if (now - lastNudgeAtRef.current < COOLDOWN_MS) return;

    nudgeInFlightRef.current = true;

    try {
      const nudgeMeta = {
        mode: 'facilitator',
        output: 'text',
        stage: 'strategy',
        insights: 'stage1'
      };
      const nudgeMsg =
        '（自動チェックイン）現在の入力状況を2〜5行で要約し、次にやるべき最小アクションを最大3つ提案してください。提案は"どこを触るか"が分かるように書いてください。';

      // Sprint 3A' で拡張した send を使用（meta付与）
      await send(nudgeMsg, nudgeMeta);

      // 成功時のみカウント＆タイムスタンプ更新
      lastNudgeAtRef.current = now;
      nudgeCountRef.current++;
      lastUserActionAtRef.current = now; // 連続 idle 発火を抑止

    } catch (e) {
      // エラーは黙って握りつぶす
      if (process.env.NODE_ENV !== 'production') {
        console.debug('[nudge] auto-checkin failed:', e);
      }
    } finally {
      nudgeInFlightRef.current = false;
    }
  }, [send]);

  const onSubmit = () => { if (input.trim()) void send(input); };

  // ★ Sprint 3A': Shift+Enter で AI診断送信
  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    // Mac/Windows の日本語IME入力中は送信しない
    if (e.nativeEvent.isComposing) return;
    if ((e.nativeEvent as any).keyCode === 229) return;

    if (e.key === 'Enter') {
      if (e.shiftKey) {
        // Shift+Enter: AI診断送信（facilitator + insights='stage1'）
        e.preventDefault();
        const diagnosticMeta = {
          mode: 'facilitator',
          output: 'text',
          stage: 'strategy',
          insights: 'stage1'
        };
        const diagnosticMsg =
          '（AI診断）現在の入力状況を要約し、企業価値に効いていない点があれば根拠付きで指摘し、次にやるべき最小アクションを最大3つ提案してください。提案は"どこを触るか"が分かるように書いてください。';
        void send(diagnosticMsg, diagnosticMeta);
      } else {
        // Enter: 従来通り送信（meta無し）
        e.preventDefault();
        onSubmit();
      }
    }
  };

  /** ====== 自動チェックインポーリング ====== */
  // 現状は自動発話を停止（手動送信のみ有効）
  useEffect(() => {
    return;
  }, []);

  // ====== 見た目 ======
  const rootCls = embedded
    ? ['w-full h-full','flex flex-col','bg-transparent','min-w-0 overflow-hidden','[&_*]:max-w-full'].join(' ')
    : ['hidden md:flex','w-[380px] h-full flex-col','border-l bg-white/70 backdrop-blur'].join(' ');

  return (
    <div className={rootCls} data-embedded={embedded ? 'true' : 'false'}>
      <header className="shrink-0 px-5 pt-5 pb-3 border-b">
        <div className="flex items-start justify-between">
          <div className="flex items-center gap-3">
            <AbstractCoachAvatar size={60} status={
              !userOK ? ('loading' as any) : sending ? ('thinking' as any) : ctxUpdated ? ('responding' as any) : ('idle' as any)
            } />
            <div className="leading-tight">
              <div className="text-[16px] font-semibold tracking-[-0.01em]">AI経営コンサルタント</div>
            </div>
          </div>
          {ctxUpdated && (
            <span className="rounded-full bg-emerald-100 px-2 py-[2px] text-[10px] font-semibold text-emerald-700 mt-1">
              コンテキスト更新
            </span>
          )}
        </div>
      </header>

      <div ref={listRef} className="flex-1 min-h-0 overflow-y-auto px-5 py-4 space-y-3" aria-live="polite">
        {messages.map((m, i) => (
          <div key={i}
            className={[
              'mb-1 max-w-[90%] whitespace-pre-wrap text-[14px] leading-6 rounded-lg px-3 py-2',
              m.role === 'user' ? 'ml-auto bg-zinc-100 text-zinc-900' : 'mr-auto bg-white border border-zinc-200 text-zinc-900'
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

      <div className="shrink-0 border-t px-5 py-3">
        <div className="space-y-2">
          <textarea
            ref={textareaRef}
            className="w-full min-h-[88px] resize-none overflow-hidden rounded-lg border border-zinc-200 bg-white p-3 text-[14px] leading-6 outline-none focus:ring-2 focus:ring-zinc-300"
            placeholder={
              readyAll
                ? '質問を入力してください'
                : !userOK
                ? 'ユーザーを読み込み中…'
                : '準備中…'
            }
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onInput={autoResize}
            onKeyDown={onKeyDown}
            rows={3}
            disabled={sending || !userOK}
          />
          <div className="flex items-center justify-between">
            <span className="text-[11px] text-gray-400">
              Enterで送信
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
                disabled={!inputOK || sending || !userOK}
                className={`rounded-md px-3 py-1.5 text-[12px] font-semibold ${
                  (!inputOK || sending || !userOK) ? 'bg-gray-200 text-gray-500' : 'bg-black text-white hover:opacity-90'
                }`}
                type="button"
              >
                送信
              </button>
            </div>
          </div>

        </div>
      </div>
    </div>
  );
}
