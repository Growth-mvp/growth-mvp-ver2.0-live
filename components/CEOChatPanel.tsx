// /components/CEOChatPanel.tsx
'use client';

import React, { useEffect, useRef, useState, useCallback, useMemo } from 'react';
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
import CEOChatCompanionCard from '@/components/CEOChatCompanionCard';
import { judgeCompanion, type CompanionAction } from '@/lib/companion/companionEngine';
import { buildCompanionSnapshot } from '@/lib/companion/companionSnapshot';
import { detectMilestone, fingerprint, MILESTONE_LABEL } from '@/lib/companion/companionMilestones';
import { requestMilestoneAdvice } from '@/lib/companion/companionAdviceClient';
import { decodeRiskStored, encodeRiskStored, requestRiskReview, riskReviewBody } from '@/lib/companion/companionRiskClient';
import {
  isCompanionKilled,
  readCompanionPref,
  writeCompanionPref,
  shouldShowCompanion,
  recordCompanionShown,
  canRequestAdvice,
  recordAdviceRequested,
  canRequestRiskReview,
  recordRiskReviewRequested,
  readAdviceText,
  writeAdviceText,
  localDayKey,
  COMPANION_COOLDOWN_MS,
  type CompanionStores,
} from '@/lib/companion/companionPolicy';
import { consultPayloadFor } from '@/lib/consult/consultFocus';
import { useConsultFocusStore } from '@/store/consultFocusStore';
import { consultKeyOf, useSelectedProjectStore } from '@/lib/stage5/selectedProjectStore';
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
  const selection = useSelectedProjectStore((st) => st.selection);
  const consult = useSelectedProjectStore((st) => st.consult);
  useEffect(() => {
    if (consult) setInput(consult.text);
  }, [consult]);
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
    const selNow = useSelectedProjectStore.getState().selection;
    const execKey = selNow && selNow.companyId === activeCompanyIdRef.current ? consultKeyOf(selNow) : '';
    const userMsg: Msg = { role: 'user', content: trimmed, ...(execKey ? { execKey } : {}) };
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
      const consult = consultPayloadFor(useConsultFocusStore.getState().entries, pathname ?? '', latestStrategyId ?? null);

      const doAsk = async () => {
        // ★ Sprint 3A': meta を付与する場合と付与しない場合に対応
        const payload: any = {
          userId: user!.id,
          strategyId: latestStrategyId,
          companyId: requestCompanyId,
          ...(screenId ? { screen: { screenId } } : {}),
          ...(consult ? { consult } : {}),
          ...(execKey && selNow && selNow.strategyId === latestStrategyId
            ? { execution: { companyId: selNow.companyId, strategyId: selNow.strategyId, departmentId: selNow.departmentId, projectId: selNow.projectId } }
            : {}),
          messages: [...buildAskHistory(current.filter((m) => (m.execKey ?? '') === execKey)), userMsg],
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
        // AIへの送信を見送った時に、ユーザーの入力途中の下書きを消さない
        if (!keepDraft) {
          setInput((prev) => (prev.trim() === trimmed ? '' : prev));
        }
      }
      autoResize();
    }
    return true;
  }, [ownerKey, userOK, strategyOK, user?.id, shouldWaitForRestore, autoResize]);

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

  /** ====== 自律伴走（既定はOFF。操作・進行は決定的に判定し、節目の経営助言だけAIが作る） ====== */
  const companionAvailable = !isCompanionKilled(process.env.NEXT_PUBLIC_CEO_COMPANION_DISABLED);
  const [companionOn, setCompanionOn] = useState(false);
  const [companionCard, setCompanionCard] = useState<CompanionAction | null>(null);
  const [companionTick, setCompanionTick] = useState(0);
  const shownCompanionKeyRef = useRef<string | null>(null);
  const recordedCompanionKeyRef = useRef<string | null>(null);
  const adviceKeyRef = useRef<string | null>(null);
  const adviceInFlightRef = useRef<boolean>(false);
  const adviceCardActiveRef = useRef<boolean>(false);
  const riskKeyRef = useRef<string | null>(null);
  const companionRetryRef = useRef<number | null>(null);
  const companionStores = useMemo<CompanionStores | null>(
    () => (typeof window === 'undefined' ? null : { local: window.localStorage, session: window.sessionStorage }),
    [],
  );
  const cDirty = useStrategyStore((s: StrategyState) => s.dirty);
  const cLoaded = useStrategyStore((s: StrategyState) => s.loaded);
  const cLoadError = useStrategyStore((s: StrategyState) => (s as any).__lastServerError);
  const cCompanyName = useStrategyStore((s: StrategyState) => s.companyName);
  const cFinancePL = useStrategyStore((s: StrategyState) => s.financePL);
  const cIssues = useStrategyStore((s: StrategyState) => s.stage1Issues);
  const cAnswers = useStrategyStore((s: StrategyState) => s.answers12);
  const cFinalStory = useStrategyStore((s: StrategyState) => s.finalStory);
  const cFinalStoryDraft = useStrategyStore((s: StrategyState) => s.finalStoryDraft);
  const cFinalStoryEdited = useStrategyStore((s: StrategyState) => s.finalStoryEdited);
  const cFinalStoryFinal = useStrategyStore((s: StrategyState) => s.finalStoryFinal);
  const cBridge = useStrategyStore((s: StrategyState) => (s as any).stage3_strategy_bridge);
  const cDepartments = useStrategyStore((s: StrategyState) => s.departments);
  const userRole = useUserStore((s) => s.role);

  const companionSnapshot = useMemo(
    () =>
      buildCompanionSnapshot({
        restoreReady,
        loaded: Boolean(cLoaded),
        fetching: Boolean(isFetchingFromServer),
        hasLoadError: Boolean(cLoadError),
        storeCompanyId: storeCompanyId ?? null,
        strategyId: strategyId ?? null,
        dirty: Boolean(cDirty),
        currentPath: pathname ?? '',
        companyName: cCompanyName,
        financePL: cFinancePL,
        stage1Issues: cIssues,
        answers12: cAnswers,
        finalStory: cFinalStory,
        finalStoryDraft: cFinalStoryDraft,
        finalStoryEdited: cFinalStoryEdited,
        finalStoryFinal: cFinalStoryFinal,
        stage3Bridge: cBridge,
        departments: cDepartments,
        userId: user?.id ?? null,
        userCompanyId: companyId ?? null,
        role: userRole,
      }),
    [
      restoreReady, cLoaded, isFetchingFromServer, cLoadError, storeCompanyId, strategyId, cDirty, pathname,
      cCompanyName, cFinancePL, cIssues, cAnswers, cFinalStory, cFinalStoryDraft, cFinalStoryEdited,
      cFinalStoryFinal, cBridge, cDepartments, user?.id, companyId, userRole,
    ],
  );

  const companionProgress = useMemo<CompanionAction | null>(() => {
    if (!companionAvailable || !companionOn) return null;
    return judgeCompanion(companionSnapshot);
  }, [companionAvailable, companionOn, companionSnapshot]);
  const progressKey = companionProgress?.key ?? null;

  const companionMilestone = useMemo(() => {
    if (!companionAvailable || !companionOn) return null;
    return detectMilestone(companionSnapshot, {
      issues: fingerprint(cIssues),
      finalStory: fingerprint(cFinalStoryFinal ?? cFinalStory),
      bridge: fingerprint(cBridge),
    });
  }, [companionAvailable, companionOn, companionSnapshot, cIssues, cFinalStoryFinal, cFinalStory, cBridge]);
  const milestoneKey = companionMilestone?.key ?? null;

  // 設定の読み込み（利用者ごと。初期値はOFF）
  useEffect(() => {
    if (!companionAvailable || !user?.id || !companionStores) {
      setCompanionOn(false);
      return;
    }
    setCompanionOn(readCompanionPref(companionStores.local, user.id));
  }, [companionAvailable, user?.id, companionStores]);

  // 会社が切り替わったら、表示中の案内と助言の状態を消す（会社をまたいで残さない）
  useEffect(() => {
    shownCompanionKeyRef.current = null;
    recordedCompanionKeyRef.current = null;
    adviceKeyRef.current = null;
    adviceCardActiveRef.current = false;
    riskKeyRef.current = null;
    riskResultRef.current = null;
    riskShownKeyRef.current = null;
    setCompanionCard(null);
  }, [companyId]);

  // 進行・操作の案内（画面遷移・保存状態の変化でも判断し直す。表示中の案内は消さない）
  useEffect(() => {
    if (companionRetryRef.current !== null) {
      window.clearTimeout(companionRetryRef.current);
      companionRetryRef.current = null;
    }
    if (adviceCardActiveRef.current) return;
    if (!companionProgress || !companionStores || !user?.id || !companyId) {
      shownCompanionKeyRef.current = null;
      recordedCompanionKeyRef.current = null;
      setCompanionCard(null);
      return;
    }
    if (shownCompanionKeyRef.current === companionProgress.key) return;
    if (!shouldShowCompanion(companionStores, user.id, companyId, companionProgress, Date.now())) {
      shownCompanionKeyRef.current = null;
      setCompanionCard(null);
      // 間隔の制限で見送った案内は、間隔が過ぎた後に判断し直す（作業の直後の次の一歩を失わない）
      companionRetryRef.current = window.setTimeout(() => setCompanionTick((n) => n + 1), COMPANION_COOLDOWN_MS);
      return;
    }
    recordedCompanionKeyRef.current = null;
    shownCompanionKeyRef.current = companionProgress.key;
    setCompanionCard(companionProgress);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [progressKey, user?.id, companyId, pathname, companionTick]);

  // 同じ案内の中で文言が変わったら（論点数など）、表示中のカードも更新する
  useEffect(() => {
    if (!companionProgress) return;
    setCompanionCard((prev) => (prev && prev.kind === 'progress' && prev.key === companionProgress.key ? companionProgress : prev));
  }, [companionProgress]);

  // 節目の経営助言（保存済みの内容について、節目ごとに一度だけAIへ依頼する）
  useEffect(() => {
    if (!companionMilestone || !companionStores || !user?.id || !companyId || !strategyId) return;
    const key = companionMilestone.key;
    if (adviceKeyRef.current === key || adviceInFlightRef.current) return;
    const savedText = readAdviceText(companionStores.session, user.id, companyId, key);
    if (savedText) {
      adviceKeyRef.current = key;
      adviceCardActiveRef.current = true;
      shownCompanionKeyRef.current = null;
      setCompanionCard({
        kind: 'advice', key, title: MILESTONE_LABEL[companionMilestone.milestone] + '：AIの助言', message: '', href: '', linkLabel: '',
        canEdit: true, steps: [], body: savedText, status: 'ready',
      });
      return;
    }
    const now = Date.now();
    if (!canRequestAdvice(companionStores, user.id, companyId, key, now)) return;
    recordAdviceRequested(companionStores, user.id, companyId, key, now);

    const milestone = companionMilestone.milestone;
    const requestedCompany = companyId;
    const requestedStrategy = strategyId;
    const requestedUser = user.id;
    adviceKeyRef.current = key;
    adviceInFlightRef.current = true;
    adviceCardActiveRef.current = true;
    shownCompanionKeyRef.current = null;
    const base: CompanionAction = {
      kind: 'advice',
      key,
      title: MILESTONE_LABEL[milestone] + '：AIの助言',
      message: '',
      href: '',
      linkLabel: '',
      canEdit: true,
      steps: [],
      status: 'loading',
    };
    setCompanionCard(base);
    void requestMilestoneAdvice({
      milestone,
      userId: requestedUser,
      companyId: requestedCompany,
      strategyId: requestedStrategy,
      getAccessToken: async () => {
        const { data } = await supabase.auth.getSession();
        return data?.session?.access_token ?? null;
      },
    }).then((text) => {
      adviceInFlightRef.current = false;
      if (adviceKeyRef.current !== key) return;
      if (activeCompanyIdRef.current !== requestedCompany) {
        adviceKeyRef.current = null;
        adviceCardActiveRef.current = false;
        return;
      }
      if (!text) {
        adviceCardActiveRef.current = false;
        setCompanionCard(null);
        return;
      }
      if (companionStores) writeAdviceText(companionStores.session, requestedUser, requestedCompany, key, text);
      setCompanionCard({ ...base, body: text, status: 'ready' });
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [milestoneKey, companionStores, user?.id, companyId, strategyId]);

  // 経営点検：会社ごとに1日1回、保存済みの事実を点検する。重大なリスク（資金不足・目標未達）は進行の案内より優先し、
  // それ以外は進行の案内が無い時だけ出す。事実が無ければAIは呼ばない。
  const riskEligible =
    companionAvailable && companionOn && companionSnapshot.ready && !companionSnapshot.dirty && Boolean(user?.id && companyId && strategyId);
  const progressKeyRef = useRef<string | null>(null);
  progressKeyRef.current = progressKey;
  const riskResultRef = useRef<{ key: string; serious: boolean; body: string } | null>(null);
  const riskShownKeyRef = useRef<string | null>(null);

  const showRiskIfDue = () => {
    const r = riskResultRef.current;
    if (!r || riskShownKeyRef.current === r.key) return;
    if (!r.serious && progressKeyRef.current) return;
    riskShownKeyRef.current = r.key;
    adviceCardActiveRef.current = true;
    shownCompanionKeyRef.current = null;
    setCompanionCard({
      kind: 'advice',
      key: r.key,
      title: '経営点検（STAGE5・6）：AIの助言',
      message: '',
      href: '',
      linkLabel: '',
      canEdit: true,
      steps: [],
      body: r.body,
      status: 'ready',
    });
  };

  useEffect(() => {
    if (!riskEligible || !companionStores || !user?.id || !companyId || !strategyId) return;
    const requestedCompany = companyId;
    const requestedUser = user.id;
    const requestedStrategy = strategyId;
    const key = `RISK:${requestedCompany}:${requestedStrategy}:${localDayKey(Date.now())}`;
    if (riskKeyRef.current === key) return;
    riskKeyRef.current = key;

    const saved = decodeRiskStored(readAdviceText(companionStores.session, requestedUser, requestedCompany, key));
    if (saved) {
      riskResultRef.current = { key, ...saved };
      showRiskIfDue();
      return;
    }
    if (!canRequestRiskReview(companionStores, requestedUser, requestedCompany, Date.now())) return;
    recordRiskReviewRequested(companionStores, requestedUser, requestedCompany, Date.now());

    void requestRiskReview({
      companyId: requestedCompany,
      strategyId: requestedStrategy,
      getAccessToken: async () => {
        const { data } = await supabase.auth.getSession();
        return data?.session?.access_token ?? null;
      },
    }).then((result) => {
      if (riskKeyRef.current !== key || activeCompanyIdRef.current !== requestedCompany) {
        if (riskKeyRef.current === key) riskKeyRef.current = null;
        return;
      }
      if (!result || result.facts.length === 0) return;
      const stored = { serious: result.serious, body: riskReviewBody(result) };
      writeAdviceText(companionStores.session, requestedUser, requestedCompany, key, encodeRiskStored(stored));
      riskResultRef.current = { key, ...stored };
      showRiskIfDue();
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [riskEligible, companionStores, user?.id, companyId, strategyId]);

  // 進行の案内の有無が変わった時の調整：重大なリスクは進行の案内より前に出し、それ以外は進行の案内を優先する
  useEffect(() => {
    const r = riskResultRef.current;
    if (!r) return;
    if (progressKey && !r.serious && riskShownKeyRef.current === r.key) {
      riskShownKeyRef.current = null;
      adviceCardActiveRef.current = false;
      setCompanionCard(null);
      setCompanionTick((n) => n + 1);
      return;
    }
    showRiskIfDue();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [progressKey]);

  const recordCompanionVisible = () => {
    if (!companionCard || companionCard.kind !== 'progress' || !companionStores || !user?.id || !companyId) return;
    if (recordedCompanionKeyRef.current === companionCard.key) return;
    recordedCompanionKeyRef.current = companionCard.key;
    recordCompanionShown(companionStores, user.id, companyId, companionCard, Date.now());
  };
  const dismissCompanion = () => {
    shownCompanionKeyRef.current = null;
    adviceCardActiveRef.current = false;
    setCompanionCard(null);
    setCompanionTick((n) => n + 1);
  };
  const askCompanion = (question: string) => {
    dismissCompanion();
    void send(question);
  };
  const toggleCompanion = () => {
    if (!user?.id || !companionStores) return;
    const next = !companionOn;
    writeCompanionPref(companionStores.local, user.id, next);
    setCompanionOn(next);
    if (!next) dismissCompanion();
  };

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

      {companionAvailable && user?.id ? (
        <div className="shrink-0 space-y-2 px-5 pt-2">
          <div className="flex justify-end">
            <button
              type="button"
              onClick={toggleCompanion}
              aria-pressed={companionOn}
              className="text-[11px] text-zinc-500 hover:text-zinc-800"
            >
              自律伴走：{companionOn ? 'オン（オフにする）' : 'オフ（オンにする）'}
            </button>
          </div>
          {companionCard ? (
            <CEOChatCompanionCard
              action={companionCard}
              onDismiss={dismissCompanion}
              onAsk={askCompanion}
              askDisabled={sending}
              onVisible={recordCompanionVisible}
            />
          ) : null}
        </div>
      ) : null}
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
          {selection && (
            <p className="text-[12px] text-slate-600">
              相談中：<span className="font-semibold text-slate-800">{selection.projectTitle}</span>（{selection.departmentName}）
            </p>
          )}
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
