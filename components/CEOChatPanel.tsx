// /components/CEOChatPanel.tsx
'use client';

import React, { useEffect, useRef, useState, useCallback } from 'react';
import { on } from '@/utils/actionBus';
import { useUserStore } from '@/store/userStore';
import { useStrategyStore, type StrategyState } from '@/store/strategyStore';
import {
  ceoChatOwnerKey,
  clearCeoChat,
  getCeoChatMessages,
  isCeoChatRequestCurrent,
  openCeoChatRequest,
  setCeoChatPending,
  updateCeoChatMessages,
  useCeoChatStore,
} from '@/store/ceoChatStore';
import AbstractCoachAvatar from '@/components/AbstractCoachAvatar';
import CEOChatMarkdown from '@/components/CEOChatMarkdown';
import CEOChatReviewTargets from '@/components/CEOChatReviewTargets';
import { parseReviewTargets } from '@/lib/ceoChat/reviewTargets';
import { supabase } from '@/utils/supabase/client';
import { usePathname } from 'next/navigation';
import { screenIdForPathname } from '@/lib/screens/screenContext';
import {
  AskFailureError,
  classifyAskError,
  describeAskFailure,
  evaluateAskCompanyGate,
} from '@/lib/ceoChat/askPolicy';
import {
  buildAskHistory,
  CEO_CHAT_GREETING,
  type CeoChatMessage,
} from '@/lib/ceoChat/chatHistory';

type Msg = CeoChatMessage;

type AskResp = {
  content?: string;
  reply?: { content?: string };
  stageUsed?: 'strategy' | 'manual' | 'generic' | 'hybrid';
  confidence?: number;
  error?: string;
  reviewTargets?: unknown;
};

type Props = { embedded?: boolean };

// ★ Sprint 3B': 自動チェックイン設定（控えめ）
const IDLE_MS = 180_000;               // 3分無操作で発火
const COOLDOWN_MS = 600_000;           // 発火後10分はクールダウン
const CHECK_TICK_MS = 15_000;          // 15秒ごとにポーリング
const MAX_NUDGES_PER_SESSION = 2;      // セッション中最大2回
const ASK_TIMEOUT_MS = 90_000;         // 応答待ちの上限（Web検索を含む処理時間を見込む）

export default function CEOChatPanel({ embedded = true }: Props) {
  const { user } = useUserStore();
  // 会社切替の検知用。会話履歴と進行中の応答はこの会社に紐づける
  const companyId = useUserStore((s) => s.companyId);
  const pathname = usePathname();
  const ownerKey = ceoChatOwnerKey(user?.id, companyId);

  // === Strategy Store ===
  const strategyId = useStrategyStore((s: StrategyState) => s.strategyId);
  const setStrategyIdRef = useRef(useStrategyStore.getState().setStrategyId);
  useEffect(() => {
    setStrategyIdRef.current = useStrategyStore.getState().setStrategyId;
  }, []);

  // ★ Option 2: refetchFromServer 完了を待つための既存フラグ
  const restoreReady = useStrategyStore((s: StrategyState) => s.restoreReady);
  const isHydrated = useStrategyStore((s: StrategyState) => s.boot?.isHydrated);
  const isFetchingFromServer = useStrategyStore(
    (s: StrategyState) => s.__isFetchingFromServer
  );
  const shouldWaitForRestore =
    !isHydrated || !restoreReady || isFetchingFromServer;

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

  // 会話履歴はストアが保持する（パネルの開閉・aside/ドロワーの切替でも失われない）
  const messages = useCeoChatStore((s) => (s.ownerKey === ownerKey ? s.messages : CEO_CHAT_GREETING));
  const sending = useCeoChatStore((s) => s.pending && s.ownerKey === ownerKey);

  const [input, setInput] = useState('');
  const [notice, setNotice] = useState<string | null>(null);
  const [ctxUpdated, setCtxUpdated] = useState(false);
  const [refreshTick, setRefreshTick] = useState(0);
  const [booting, setBooting] = useState(false);
  const [mounted, setMounted] = useState(false);

  const listRef = useRef<HTMLDivElement | null>(null);
  const debounceRef = useRef<number | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const bootingLockRef = useRef(false);
  const unmountedRef = useRef(false);
  const autoEnsureOnceRef = useRef(false);
  const askAbortRef = useRef<AbortController | null>(null);

  // ★ Sprint 3B': 自動チェックイン用 refs
  const lastUserActionAtRef = useRef<number>(Date.now());
  const lastNudgeAtRef = useRef<number>(0);
  const nudgeCountRef = useRef<number>(0);
  const nudgeInFlightRef = useRef<boolean>(false);

  // 会社が切り替わったら、入力と進行中の応答を無効化する。会話履歴の破棄はストア側が行う。
  const activeCompanyIdRef = useRef<string | null>(companyId ?? null);
  useEffect(() => {
    const nextCompanyId = companyId ?? null;
    if (activeCompanyIdRef.current === nextCompanyId) return;
    activeCompanyIdRef.current = nextCompanyId;
    askAbortRef.current?.abort();
    askAbortRef.current = null;
    setNotice(null);
    setInput('');
  }, [companyId]);

  // 切替が確定（ストアの企業が画面の企業と一致）したら、切替中の通知を消す
  const storeCompanyId = useStrategyStore((s: StrategyState) => s.companyId);
  useEffect(() => {
    if (storeCompanyId === (companyId ?? null)) setNotice(null);
  }, [storeCompanyId, companyId]);

  useEffect(() => {
    setMounted(true);
    return () => {
      unmountedRef.current = true;
    };
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

  /** ====== strategyId を待機（provision は不要） ====== */
  useEffect(() => {
    if (!storeHydrated || !userOK) return;
    if (strategyOK) return;

    // ★ FIX: refetchFromServer が既に strategyId を復元するため、provision は不要
    // strategyId がない場合は単に待機
    if (shouldWaitForRestore) {
      console.log('[CEOChatPanel] waiting for strategyId restore', {
        restoreReady,
        isFetchingFromServer,
        strategyId,
      });
    }
  }, [storeHydrated, userOK, strategyOK, shouldWaitForRestore]);

  /** ====== スクロール追従（一覧の中だけをスクロールし、親要素の位置を動かさない） ====== */
  useEffect(() => {
    const el = listRef.current;
    if (el) el.scrollTop = el.scrollHeight;
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
  const send = useCallback(async (text: string, overrideMeta?: any): Promise<boolean> => {
    const trimmed = text.trim();
    if (!trimmed || useCeoChatStore.getState().pending) {
      return false;
    }
    setNotice(null);
    let keepDraft = false;

    const controller = new AbortController();
    askAbortRef.current = controller;
    const timeoutId = window.setTimeout(() => controller.abort(), ASK_TIMEOUT_MS);

    // 送信開始時の会話の所有者（userId + companyId）と世代。応答時点で変わっていれば結果を捨てる
    const ticket = openCeoChatRequest(ownerKey);
    const current = getCeoChatMessages(ticket);
    const userMsg: Msg = { role: 'user', content: trimmed };
    const requestCompanyId = activeCompanyIdRef.current;
    const isStale = () =>
      activeCompanyIdRef.current !== requestCompanyId ||
      (ticket !== null && !isCeoChatRequestCurrent(ticket));

    setCeoChatPending(ticket, true);
    updateCeoChatMessages(ticket, (msgs) => [...msgs, userMsg]);

    try {
      if (!userOK) throw new AskFailureError({ kind: 'http', status: 401 });

      // ★ Option 2: restore 完了を待つ中は送信不可
      if (shouldWaitForRestore) {
        updateCeoChatMessages(ticket, (msgs) => [
          ...msgs.slice(0, -1),
          { role: 'assistant', content: '戦略データを読み込み中です…少々お待ちください。' },
        ]);
        return true;
      }

      const { data: sdata } = await supabase.auth.getSession();
      // await 中に企業が切り替わった場合、切替前の企業のリクエストを組み立てない
      if (isStale()) return true;
      const accessToken = sdata?.session?.access_token;
      if (!accessToken) throw new AskFailureError({ kind: 'http', status: 401 });

      if (!strategyOK) {
        // ★ FIX: strategyOK でない場合は待機メッセージを表示（provision は呼ばない）
        updateCeoChatMessages(ticket, (msgs) => [
          ...msgs.slice(0, -1),
          { role: 'assistant', content: '戦略データを読み込み中です…少々お待ちください。' },
        ]);
        return true;
      }

      const companyGate = evaluateAskCompanyGate(
        activeCompanyIdRef.current,
        useStrategyStore.getState().companyId
      );
      if (!companyGate.ok) {
        if (isStale()) return true;
        keepDraft = true;
        updateCeoChatMessages(ticket, (msgs) => msgs.slice(0, -1));
        setNotice(companyGate.message);
        return false;
      }

      const latestStrategyId = useStrategyStore.getState().strategyId;

      const screenId = screenIdForPathname(pathname ?? '');

      const doAsk = async () => {
        // ★ Sprint 3A': meta を付与する場合と付与しない場合に対応
        const payload: any = {
          userId: user!.id,
          strategyId: latestStrategyId,
          companyId: requestCompanyId,
          ...(screenId ? { screen: { screenId } } : {}),
          messages: [...buildAskHistory(current), userMsg],
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
          signal: controller.signal,
        });
        const raw = await res.text();
        return { ok: res.ok, status: res.status, raw };
      };

      let r = await doAsk();

      if (!r.ok) {
        if (process.env.NODE_ENV !== 'production') {
          console.error('ask-ceo-agent failed:', r.status, r.raw);
        }
        throw new AskFailureError({ kind: 'http', status: r.status });
      }

      let data: AskResp | null = null;
      try { data = r.raw ? (JSON.parse(r.raw) as AskResp) : null; } catch { data = null; }

      const content =
        (data?.content && String(data.content)) ||
        (data?.reply?.content && String(data.reply?.content)) ||
        '（応答の取得に失敗しました）';

      // 会社が切り替わった後の応答は別会社の会話に混ぜない
      if (isStale()) return true;

      // ← 先に送信フラグを落としてからメッセージを追加（UI固着防止）
      setCeoChatPending(ticket, false);
      const reviewTargets = parseReviewTargets(data?.reviewTargets);
      updateCeoChatMessages(ticket, (msgs) => [
        ...msgs,
        { role: 'assistant', content, ...(reviewTargets.length > 0 ? { reviewTargets } : {}) },
      ]);
      return true;
    } catch (e) {
      // 会社切替による abort は通信エラーとして表示しない
      if (isStale()) return true;
      const failure = classifyAskError(e);
      console.error('[CEOChatPanel] SEND_ERROR', { failure_kind: failure.kind });
      if (process.env.NODE_ENV !== 'production') console.error(e);
      updateCeoChatMessages(ticket, (msgs) => [
        ...msgs,
        { role: 'assistant', content: describeAskFailure(failure) },
      ]);
    } finally {
      window.clearTimeout(timeoutId);
      if (askAbortRef.current === controller) askAbortRef.current = null;
      // 切替後の別リクエストが使っている送信状態・入力欄には触らない
      if (!isStale()) {
        setCeoChatPending(ticket, false);
        // 自動チェックイン送信時や送信を見送った時に、ユーザーの入力途中の下書きを消さない
        if (!keepDraft) {
          setInput((prev) => (prev.trim() === trimmed ? '' : prev));
        }
      }
      autoResize();
    }
    return true;
  }, [ownerKey, userOK, strategyOK, user?.id, shouldWaitForRestore, autoResize]);

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
      const started = await send(nudgeMsg, nudgeMeta);
      if (!started) return;

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
          <div className="flex min-w-0 items-center gap-3">
            <AbstractCoachAvatar size={60} status={
              !userOK ? ('loading' as any) : sending ? ('thinking' as any) : ctxUpdated ? ('responding' as any) : ('idle' as any)
            } />
            <div className="leading-tight min-w-0 break-words">
              <div className="text-[16px] font-semibold tracking-[-0.01em]">AI経営コンサルタント</div>
              <div className="mt-0.5 text-[12px] font-normal text-zinc-500">あなたの挑戦と成長を支える戦略パートナー</div>
            </div>
          </div>
          {ctxUpdated && (
            <span className="rounded-full bg-emerald-100 px-2 py-[2px] text-[10px] font-semibold text-emerald-700 mt-1">
              コンテキスト更新
            </span>
          )}
        </div>
      </header>

      <div ref={listRef} className="flex-1 min-h-0 overflow-y-auto overscroll-contain px-5 py-4 space-y-3" aria-live="polite">
        {messages.map((m, i) => (
          <div key={i}
            className={[
              'mb-1 max-w-[90%] text-[14px] leading-6 rounded-lg px-3 py-2',
              m.role === 'user'
                ? 'ml-auto whitespace-pre-wrap bg-zinc-100 text-zinc-900'
                : 'mr-auto bg-white border border-zinc-200 text-zinc-900'
            ].join(' ')}
          >
            {m.role === 'user' ? m.content : <CEOChatMarkdown content={m.content} />}
            {m.role === 'assistant' && m.reviewTargets && (
              <CEOChatReviewTargets targets={m.reviewTargets} currentStrategyId={strategyId} />
            )}
          </div>
        ))}
        {sending && (
          <div className="mr-auto inline-flex items-center gap-2 rounded-lg bg-white border border-zinc-200 px-2 py-1 text-[12px] text-zinc-500">
            <span className="h-2 w-2 animate-pulse rounded-full" />
            思考中…
          </div>
        )}
      </div>

      <div className="shrink-0 border-t px-5 py-3">
        <div className="space-y-2">
          {notice && (
            <p role="status" className="text-[12px] text-amber-700">
              {notice}
            </p>
          )}
          <textarea
            ref={textareaRef}
            className="w-full min-h-[88px] resize-none overflow-hidden rounded-lg border border-zinc-200 bg-white p-3 text-[14px] leading-6 outline-none focus:ring-2 focus:ring-zinc-300"
            placeholder={
              shouldWaitForRestore
                ? '戦略データを読み込み中…'
                : readyAll
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
            disabled={sending || !userOK || shouldWaitForRestore}
          />
          <div className="flex items-center justify-between">
            <span className="text-[11px] text-gray-400">
              Enterで送信
            </span>
            <div className="flex items-center gap-2">
              <button
                onClick={() => { clearCeoChat(); }}
                className="rounded-md px-3 py-2 text-[12px] hover:bg-gray-100 min-h-[2.5rem] sm:min-h-auto"
                type="button"
              >
                クリア
              </button>
              <button
                onClick={() => { if (input.trim()) void send(input); }}
                disabled={!inputOK || sending || !userOK || shouldWaitForRestore}
                className={`rounded-md px-4 py-2 text-[12px] font-semibold min-h-[2.5rem] sm:min-h-auto transition ${
                  (!inputOK || sending || !userOK || shouldWaitForRestore) ? 'bg-gray-200 text-gray-500' : 'bg-black text-white hover:opacity-90'
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
