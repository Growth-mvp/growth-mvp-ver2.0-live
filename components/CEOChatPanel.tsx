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
import CEOChatStage5Reflect from '@/components/CEOChatStage5Reflect';
import CEOChatStage2Reflect from '@/components/CEOChatStage2Reflect';
import { parseReviewTargets } from '@/lib/ceoChat/reviewTargets';
import { supabase } from '@/utils/supabase/client';
import { usePathname, useRouter } from 'next/navigation';
import { screenIdForPathname } from '@/lib/screens/screenContext';
import CEOChatCompanionCard from '@/components/CEOChatCompanionCard';
import CEOChatVoiceControls, { type InputMode } from '@/components/CEOChatVoiceControls';
import { resolveVoiceNavigation, type VoiceDepartment } from '@/lib/voice/navigationIntent';
import { contextDepartments, resolveOperationInstruction, type OperationProposal } from '@/lib/aiOperations/instruction';
import { useStage3CommandStore } from '@/lib/aiOperations/stage3Command';
import { parseStage4Intent } from '@/lib/aiOperations/stage4';
import { requestStage4, stage4ExcludedTitles, stage4ProjectRefs } from '@/lib/aiOperations/stage4Client';
import { useOperationProposalStore } from '@/lib/aiOperations/proposalStore';
import CEOChatProposalCard from '@/components/CEOChatProposalCard';
import {
  DEFAULT_SPEECH_RATE_KEY,
  isVoiceDisabledFor,
  readAutoRead,
  readReplyMode,
  readSpeechRate,
  speechRateOf,
  writeAutoRead,
  writeReplyMode,
  writeSpeechRate,
  type ReplyMode,
  type SpeechRateKey,
} from '@/lib/voice/voiceSettings';
import { speakChunks, stopSpeaking } from '@/lib/voice/browserSpeech';
import { toSpeakableChunks } from '@/lib/voice/speechText';
import { useVoiceConversation } from '@/hooks/useVoiceConversation';
import { keepsVoiceOnPathChange } from '@/lib/voice/conversationScope';
import { isAutofillRequest, publicProfileQuery } from '@/lib/autofill/intent';
import { useAutofillStore } from '@/lib/autofill/autofillStore';
import { runAutofillPipeline } from '@/lib/autofill/client';
import { runDocumentFinance, runPublicProfile } from '@/lib/autofill/publicClient';
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

/** 公開資料からの入力の依頼：候補を作り、STAGE1の承認欄へ渡す（反映はしない。AIは呼ばない）。進行状況を同じ発言に示す */
async function requestAutofillFromChat(args: {
  ticket: Parameters<typeof updateCeoChatMessages>[0];
  text: string;
  companyId: string;
  strategyId: string;
  isStale: () => boolean;
}): Promise<void> {
  const setLast = (content: string) => {
    if (args.isStale()) return;
    updateCeoChatMessages(args.ticket, (msgs) => [...msgs.slice(0, -1), { role: 'assistant', content }]);
  };
  updateCeoChatMessages(args.ticket, (msgs) => [...msgs, { role: 'assistant', content: '公開資料から取得しています…' }]);
  try {
    const { data } = await supabase.auth.getSession();
    const token = data?.session?.access_token;
    if (!token) return setLast('ログインが必要です。');
    const result = await runAutofillPipeline({
      text: args.text,
      companyId: args.companyId,
      strategyId: args.strategyId,
      token,
      onProgress: (p) => setLast(`取得中：${p.label}（${p.step}/${p.total}）`),
    });
    if (args.isStale()) return;
    if (result.status === 'FOUND') {
      const c = result.candidate;
      useAutofillStore.getState().setPending({ companyId: args.companyId, strategyId: args.strategyId, fetchedAt: result.fetchedAt, candidate: c });
      const notes = [
        result.missingPeriods.length > 0 ? `取得できなかった決算期：${result.missingPeriods.join('、')}` : '',
        '取得できなかった項目・確認できなかった項目は未入力のままです（推測で補っていません）。',
      ].filter(Boolean);
      return setLast(
        [
          `「${c.filer.name}」（証券コード ${c.filer.secCode ?? '未確認'}）の有価証券報告書から候補を作りました。`,
          `対象：直近${c.finance.length}期の財務、企業情報${c.segments ? '、事業セグメント' : ''}（最新の書類 ${c.docId}）`,
          'STAGE1の「①企業情報・事業内容」にある候補欄で、取得対象の企業名と内容を確認し、承認すると反映して保存されます。承認するまで入力欄は変わりません。',
          ...notes,
        ].join('\n'),
      );
    }
    if (result.status === 'AMBIGUOUS') {
      const names = result.candidates.map((c) => `${c.name}（証券コード ${c.secCode ?? '未確認'}）`).join('\n');
      return setLast(`同じ名前の会社が複数あります。証券コード（4桁）を付けて、もう一度依頼してください。\n${names}`);
    }
    return setLast(result.message);
  } catch {
    setLast('公開資料からの取得に失敗しました。時間をおいて再度お試しください。');
  }
}

const PUBLIC_PROFILE_MESSAGE: Record<string, string> = {
  NOT_FOUND: '公開情報から該当する会社を見つけられませんでした。正式な会社名で依頼し直してください。',
  SEARCH_TIMEOUT: '公開情報の検索が時間内に終わりませんでした。時間をおいて再度依頼してください。',
  SEARCH_FAILED: '公開情報の検索に失敗しました。時間をおいて再度依頼してください。',
  QUERY_UNCLEAR: '会社名を含めて依頼してください。',
};

/** 非上場企業の公開情報（会社名で検索）から候補を作り、STAGE1の承認欄へ渡す（反映はしない。AIの会話は使わない） */
async function requestPublicProfileFromChat(args: {
  ticket: Parameters<typeof updateCeoChatMessages>[0];
  name: string;
  companyId: string;
  strategyId: string;
  isStale: () => boolean;
}): Promise<void> {
  const setLast = (content: string) => {
    if (args.isStale()) return;
    updateCeoChatMessages(args.ticket, (msgs) => [...msgs.slice(0, -1), { role: 'assistant', content }]);
  };
  updateCeoChatMessages(args.ticket, (msgs) => [...msgs, { role: 'assistant', content: `「${args.name}」のWebから会社情報を取得しています…` }]);
  try {
    const { data } = await supabase.auth.getSession();
    const token = data?.session?.access_token;
    if (!token) return setLast('ログインが必要です。');
    const result = await runPublicProfile({ name: args.name, companyId: args.companyId, strategyId: args.strategyId, token });
    if (args.isStale()) return;
    if (result.status === 'FOUND') {
      useAutofillStore.getState().setPending({ companyId: args.companyId, strategyId: args.strategyId, fetchedAt: result.fetchedAt, candidate: result.candidate });
      return setLast(
        [
          `「${result.candidate.filer.name}」の公開情報から候補を作りました（出典と確認日を付けています）。`,
          'STAGE1の「①企業情報・事業内容」にある候補欄で内容と出典を確認し、承認すると反映して保存されます。承認するまで入力欄は変わりません。',
          '取得できなかった項目は未入力のままです（推測で補っていません）。',
          '出典の原文はまだ確認していません（出典未照合）。承認画面で出典のURLを開いて内容を確認してから承認してください。',
        ].join('\n'),
      );
    }
    return setLast(result.message ?? PUBLIC_PROFILE_MESSAGE[result.status] ?? '公開情報から候補を作れませんでした。');
  } catch {
    setLast('公開情報からの取得に失敗しました。時間をおいて再度お試しください。');
  }
}

/** 添付された資料（PDF・Excel・CSV）から財務の候補を作り、STAGE1の承認欄へ渡す（反映はしない） */
async function requestDocumentFromChat(args: {
  ticket: Parameters<typeof updateCeoChatMessages>[0];
  files: File[];
  companyId: string;
  strategyId: string;
  isStale: () => boolean;
}): Promise<void> {
  const setLast = (content: string) => {
    if (args.isStale()) return;
    updateCeoChatMessages(args.ticket, (msgs) => [...msgs.slice(0, -1), { role: 'assistant', content }]);
  };
  updateCeoChatMessages(args.ticket, (msgs) => [...msgs, { role: 'assistant', content: '資料を読み込んでいます…' }]);
  try {
    const { data } = await supabase.auth.getSession();
    const token = data?.session?.access_token;
    if (!token) return setLast('ログインが必要です。');
    const result = await runDocumentFinance({ files: args.files, token });
    if (args.isStale()) return;
    if (result.status === 'FOUND') {
      useAutofillStore.getState().setPending({
        companyId: args.companyId,
        strategyId: args.strategyId,
        fetchedAt: new Date().toISOString(),
        candidate: result.candidate,
      });
      const years = result.candidate.finance.map((y) => `${y.year}年度`).join('・');
      return setLast(
        [
          `資料から財務の候補を作りました（${years}）。`,
          'STAGE1の「①企業情報・事業内容」にある候補欄で、資料が登録中の企業のものか確認し、承認すると反映して保存されます。承認するまで入力欄は変わりません。',
          ...result.candidate.issues,
        ].join('\n'),
      );
    }
    return setLast(result.message);
  } catch (e) {
    const code = e instanceof Error ? e.message : '';
    setLast(code === 'insufficient_role' || code === 'forbidden' ? '資料の読み込みは管理者または管理職のみ実行できます。' : '資料の読み込みに失敗しました。時間をおいて再度お試しください。');
  }
}

type RevenueRow = { year: number; revenue?: number | null };

function revenueYenByYear(rows: RevenueRow[] | undefined): Record<number, number | null> {
  const out: Record<number, number | null> = {};
  for (const r of rows ?? []) out[r.year] = typeof r.revenue === 'number' ? r.revenue : null;
  return out;
}

function proposalIntroText(p: OperationProposal): string {
  if (p.kind === 'stage4.plan') {
    return `「${p.projectTitle}」の実行計画書への変更の入力案を作りました（まだ保存していません）。内容を確かめ、「承認して保存」を押すと保存されます。`;
  }
  if (p.kind === 'stage3.question') {
    return `${p.departmentName}の6つの問い${p.stepNumber}番目の入力案を作りました（まだ保存していません）。内容を確かめ、「承認して保存」を押すと保存されます。`;
  }
  if (p.kind === 'stage2.ceoIntent') {
    return '「経営者の思い」への入力案を作りました（まだ保存していません）。内容を確かめ、「承認して保存」を押すと保存されます。';
  }
  return `${p.year}年度の全社売上高の入力案を作りました（まだ保存していません）。「承認して保存」を押すと、STAGE1の財務に反映して保存されます。`;
}

const STARTER_QUESTIONS = [
  '今、何から取り組めばいい？',
  '当社の経営戦略について相談したい',
  'この画面の使い方を教えて',
];

export default function CEOChatPanel({ embedded = true }: Props) {
  const { user } = useUserStore();
  // 会社切替の検知用。会話履歴と進行中の応答はこの会社に紐づける
  const companyId = useUserStore((s) => s.companyId);
  const pathname = usePathname();
  const router = useRouter();
  const ownerKey = ceoChatOwnerKey(user?.id, companyId);
  const voiceOff = isVoiceDisabledFor(
    companyId,
    process.env.NEXT_PUBLIC_CEO_VOICE_DISABLED,
    process.env.NEXT_PUBLIC_CEO_VOICE_DISABLED_COMPANY_IDS,
  );

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

  // 音声：読み上げは初期状態でOFF。開いた時点の履歴は読み上げず、新しく届いた回答だけを読む
  const [autoRead, setAutoRead] = useState(false);
  const [speaking, setSpeaking] = useState(false);
  const [speechRate, setSpeechRate] = useState<SpeechRateKey>(DEFAULT_SPEECH_RATE_KEY);
  const [inputMode, setInputMode] = useState<InputMode>('voice');
  const spokenRef = useRef<{ owner: string | null; msg: Msg | null }>({ owner: null, msg: null });

  useEffect(() => {
    if (!user?.id) return;
    setAutoRead(readAutoRead(window.localStorage, user.id));
  }, [user?.id]);

  useEffect(() => {
    const last = messages[messages.length - 1] ?? null;
    const prev = spokenRef.current;
    spokenRef.current = { owner: ownerKey, msg: last };
    if (prev.owner !== ownerKey || prev.msg === last) return;
    if (!autoRead || voiceOff || conversationActiveRef.current || !last || last.role !== 'assistant' || !last.answered) return;
    speakChunks(toSpeakableChunks(last.content), {
      rate: speechRateOf(speechRate),
      onStart: () => setSpeaking(true),
      onEnd: () => setSpeaking(false),
    });
  }, [messages, ownerKey, autoRead, voiceOff, speechRate]);

  useEffect(() => () => stopSpeaking(), []);

  const changeAutoRead = (on: boolean) => {
    setAutoRead(on);
    if (user?.id) writeAutoRead(window.localStorage, user.id, on);
    if (!on) stopSpeaking();
  };

  // 承認待ちの入力案は、会社・画面が変わったら破棄する
  const pendingProposal = useOperationProposalStore((s) => s.pending);
  useEffect(() => {
    const p = useOperationProposalStore.getState().pending;
    if (p && p.pathname !== pathname) useOperationProposalStore.getState().clearPending();
  }, [pathname]);
  const postProposalResult = useCallback((message: string) => {
    const ticket = openCeoChatRequest(useCeoChatStore.getState().ownerKey);
    if (ticket) updateCeoChatMessages(ticket, (msgs) => [...msgs, { role: 'assistant', content: message }]);
  }, []);

  // 音声会話：利用者の発言は自動で送り、AIの回答は自動で読み上げる（「会話を終了する」まで続く）
  const sendRef = useRef<((text: string) => Promise<boolean>) | null>(null);
  const conversationActiveRef = useRef(false);
  const voiceStopRef = useRef<((message?: string) => void) | null>(null);
  const ownerKeyRef = useRef(ownerKey);
  ownerKeyRef.current = ownerKey;
  const answerOfTurn = (beforeCount: number): string | null => {
    const st = useCeoChatStore.getState();
    if (st.ownerKey !== ownerKeyRef.current || st.messages.length <= beforeCount) return null;
    const last = st.messages[st.messages.length - 1];
    return last && last.role === 'assistant' && last.answered ? last.content : null;
  };
  const voice = useVoiceConversation(async (text) => {
    const sendNow = sendRef.current;
    if (!sendNow) return null;
    const beforeCount = useCeoChatStore.getState().messages.length;
    const ok = await sendNow(text);
    return ok ? answerOfTurn(beforeCount) : null;
  });
  useEffect(() => {
    conversationActiveRef.current = voice.status !== 'off';
    voiceStopRef.current = voice.stop;
  }, [voice.status, voice.stop]);
  const stopReadingAll = () => {
    if (voice.status !== 'off') voice.stop();
    stopSpeaking();
    setSpeaking(false);
  };
  const { setSpeechRate: applySpeechRate, setReplyMode: applyReplyMode } = voice;
  useEffect(() => {
    if (!user?.id) return;
    const storage = window.localStorage;
    const rateKey = readSpeechRate(storage, user.id);
    setSpeechRate(rateKey);
    applySpeechRate(rateKey);
    applyReplyMode(readReplyMode(storage, user.id));
  }, [user?.id, applySpeechRate, applyReplyMode]);
  const changeSpeechRate = (key: SpeechRateKey) => {
    setSpeechRate(key);
    applySpeechRate(key);
    if (user?.id) writeSpeechRate(window.localStorage, user.id, key);
  };
  const changeReplyMode = (mode: ReplyMode) => {
    applyReplyMode(mode);
    if (user?.id) writeReplyMode(window.localStorage, user.id, mode);
  };
  // 同じ会社のSTAGE1〜4の間では会話を続ける。それ以外の画面へ移るとマイクと読み上げを止める
  const prevPathnameRef = useRef(pathname);
  useEffect(() => {
    const from = prevPathnameRef.current;
    prevPathnameRef.current = pathname;
    if (from === pathname || keepsVoiceOnPathChange(from, pathname)) return;
    voiceStopRef.current?.('画面が切り替わったため、会話を終了しました。');
    stopSpeaking();
    setSpeaking(false);
  }, [pathname]);
  useEffect(() => {
    voiceStopRef.current?.('ログイン中のアカウントが切り替わったため、会話を終了しました。');
    stopSpeaking();
    setSpeaking(false);
  }, [user?.id]);


  // 会社が切り替わったら、入力と進行中の応答を無効化する。会話履歴の破棄はストア側が行う。
  const activeCompanyIdRef = useRef<string | null>(companyId ?? null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    const nextCompanyId = companyId ?? null;
    if (activeCompanyIdRef.current === nextCompanyId) return;
    activeCompanyIdRef.current = nextCompanyId;
    askAbortRef.current?.abort();
    askAbortRef.current = null;
    setNotice(null);
    setInput('');
    useOperationProposalStore.getState().clearPending();
    voiceStopRef.current?.('会社が切り替わったため、会話を終了しました。');
    stopSpeaking();
    setSpeaking(false);
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
  const showVoice = !voiceOff && userOK && !!user?.id;
  const showTextInput = !showVoice || inputMode === 'text';

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
    stopSpeaking();
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

      // 画面を開くだけの指示は、AIを呼ばずに既存の画面へ移動する（データは変更しない）
      const navigation = resolveVoiceNavigation(trimmed, useStrategyStore.getState().departments as unknown as VoiceDepartment[], pathname ?? null);
      if (navigation) {
        if (navigation.kind === 'clarify') {
          updateCeoChatMessages(ticket, (msgs) => [...msgs, { role: 'assistant', content: navigation.message }]);
        } else {
          router.push(navigation.href);
          const target = [navigation.departmentName, navigation.projectTitle].filter(Boolean).join(' / ');
          const hint = navigation.departmentName && !navigation.projectTitle ? '該当の部門は画面で選択してください。' : '';
          updateCeoChatMessages(ticket, (msgs) => [
            ...msgs,
            { role: 'assistant', content: `「${navigation.screenLabel}」を開きました。${target ? `対象：${target}。` : ''}${hint}` },
          ]);
        }
        return true;
      }

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

      // 実行計画書（STAGE4）への指示：変更案を作る（保存はしない。承認は入力案のカードで行う）
      const stage4Intent = parseStage4Intent(trimmed);
      if (stage4Intent && requestCompanyId && latestStrategyId && user?.id) {
        const pendingNow = useOperationProposalStore.getState().pending;
        const result = await requestStage4({
          intent: stage4Intent,
          text: trimmed,
          companyId: requestCompanyId,
          strategyId: latestStrategyId,
          actor: { userId: user.id, memberships: [{ companyId: requestCompanyId, role: useUserStore.getState().role ?? 'member' }] },
          projects: stage4ProjectRefs(useStrategyStore.getState().departments),
          excludedTitles: stage4ExcludedTitles(useStrategyStore.getState().departments),
          selectedProjectId: useSelectedProjectStore.getState().selection?.projectId ?? null,
          contextTitle: new URLSearchParams(window.location.search).get('project'),
          now: new Date(),
          pathnameNow: window.location.pathname,
          hasPendingStage4: pendingNow?.kind === 'stage4.plan',
        });
        if (result.kind === 'proposal') {
          useOperationProposalStore.getState().setPending(result.proposal);
          if (window.location.pathname !== '/okr') {
            router.push(`/okr?dept=${encodeURIComponent(result.proposal.departmentName)}&project=${encodeURIComponent(result.proposal.projectTitle)}`);
          }
          updateCeoChatMessages(ticket, (msgs) => [
            ...msgs,
            { role: 'assistant', content: `「${result.proposal.projectTitle}」の実行計画書への変更の入力案を作りました（まだ保存していません）。内容を確かめ、「承認して保存」を押すと保存されます。` },
          ]);
        } else if (result.kind === 'navigate') {
          if (window.location.pathname !== '/okr') router.push(result.href);
          updateCeoChatMessages(ticket, (msgs) => [...msgs, { role: 'assistant', content: result.text }]);
        } else {
          updateCeoChatMessages(ticket, (msgs) => [...msgs, { role: 'assistant', content: result.text }]);
        }
        return true;
      }

      // 音声・文字の指示から入力案を作る（保存はしない。承認は入力案のカードで行う）
      if (latestStrategyId && requestCompanyId) {
        const st = useStrategyStore.getState();
        const instruction = resolveOperationInstruction(trimmed, {
          companyId: requestCompanyId,
          strategyId: latestStrategyId,
          ceoIntent: st.ceoIntent ?? '',
          revenueYenByYear: revenueYenByYear(st.financePL as RevenueRow[] | undefined),
          departments: contextDepartments(st.departments as unknown as Parameters<typeof contextDepartments>[0]),
        });
        if (instruction) {
          if (instruction.kind === 'clarify') {
            updateCeoChatMessages(ticket, (msgs) => [...msgs, { role: 'assistant', content: instruction.message }]);
          } else if (instruction.kind === 'command') {
            useStage3CommandStore.getState().setPendingDepartmentName(instruction.departmentName);
            if (window.location.pathname !== '/cascade') router.push('/cascade');
            updateCeoChatMessages(ticket, (msgs) => [
              ...msgs,
              { role: 'assistant', content: `「${instruction.departmentName}」の戦略書を、6つの問いの回答を反映して再生成します。完了すると、STAGE3の画面に新しい版が表示されます。` },
            ]);
          } else {
            useOperationProposalStore.getState().setPending(instruction.proposal);
            if (window.location.pathname !== instruction.proposal.pathname) router.push(instruction.proposal.pathname);
            updateCeoChatMessages(ticket, (msgs) => [...msgs, { role: 'assistant', content: proposalIntroText(instruction.proposal) }]);
          }
          return true;
        }
      }

      if (isAutofillRequest(trimmed)) {
        if (latestStrategyId && requestCompanyId) {
          await requestAutofillFromChat({ ticket, text: trimmed, companyId: requestCompanyId, strategyId: latestStrategyId, isStale });
        } else {
          updateCeoChatMessages(ticket, (msgs) => [...msgs, { role: 'assistant', content: '戦略データを読み込み中です…少々お待ちください。' }]);
        }
        return true;
      }

      const publicName = publicProfileQuery(trimmed);
      if (publicName) {
        if (latestStrategyId && requestCompanyId) {
          await requestPublicProfileFromChat({ ticket, name: publicName, companyId: requestCompanyId, strategyId: latestStrategyId, isStale });
        } else {
          updateCeoChatMessages(ticket, (msgs) => [...msgs, { role: 'assistant', content: '戦略データを読み込み中です…少々お待ちください。' }]);
        }
        return true;
      }

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
        { role: 'assistant', content, answered: true, ...(reviewTargets.length > 0 ? { reviewTargets } : {}), ...(execKey ? { consultKey: execKey } : {}) },
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
  }, [ownerKey, userOK, strategyOK, user?.id, shouldWaitForRestore, autoResize, router]);

  useEffect(() => {
    sendRef.current = send;
  }, [send]);

  const onSubmit = () => { if (input.trim()) void send(input); };

  // ★ Sprint 3A': Shift+Enter で AI診断送信
  const attachDocuments = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? []);
    e.target.value = '';
    if (files.length === 0 || useCeoChatStore.getState().pending) return;
    const strategyIdNow = useStrategyStore.getState().strategyId;
    const requestCompanyId = activeCompanyIdRef.current;
    if (!strategyIdNow || !requestCompanyId) {
      setNotice('戦略データを読み込み中です…少々お待ちください。');
      return;
    }
    const ticket = openCeoChatRequest(ownerKey);
    const isStale = () => activeCompanyIdRef.current !== requestCompanyId || (ticket !== null && !isCeoChatRequestCurrent(ticket));
    setCeoChatPending(ticket, true);
    updateCeoChatMessages(ticket, (msgs) => [...msgs, { role: 'user', content: `資料を添付：${files.map((f) => f.name).join('、')}` }]);
    try {
      await requestDocumentFromChat({ ticket, files, companyId: requestCompanyId, strategyId: strategyIdNow, isStale });
    } finally {
      if (!isStale()) setCeoChatPending(ticket, false);
    }
  };

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
            <AbstractCoachAvatar size={64} status={
              !userOK ? ('loading' as any) : sending ? ('thinking' as any) : ctxUpdated ? ('responding' as any) : ('idle' as any)
            } />
            <div className="leading-tight min-w-0 break-words">
              <div className="text-[16px] font-semibold tracking-[-0.01em]">AI経営コンサルタント</div>
              <div className="mt-0.5 text-[12px] font-normal text-zinc-500">あなたの挑戦と成長を支える戦略パートナー</div>
            </div>
          </div>
          {ctxUpdated && (
            <span className="rounded-full bg-success-soft px-2 py-[2px] text-[10px] font-semibold text-success mt-1">
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
              'flex max-w-[92%] flex-col gap-1',
              m.role === 'user' ? 'ml-auto items-end' : 'mr-auto items-start',
            ].join(' ')}
          >
            <span className="px-1 text-[11px] font-medium text-zinc-500">{m.role === 'user' ? 'あなた' : 'AI経営コンサルタント'}</span>
            <div
              className={[
                'rounded-2xl px-4 py-3 text-[15px] leading-7',
                m.role === 'user'
                  ? 'whitespace-pre-wrap bg-zinc-100 text-zinc-900'
                  : 'border border-zinc-200 bg-white text-zinc-900 shadow-sm [&_li]:my-1 [&_ol]:my-2 [&_p+p]:mt-3 [&_ul]:my-2',
              ].join(' ')}
            >
            {m.role === 'user' ? m.content : <CEOChatMarkdown content={m.content} />}
            {m.role === 'assistant' && m.reviewTargets && (
              <CEOChatReviewTargets targets={m.reviewTargets} currentStrategyId={strategyId} />
            )}
            {m.role === 'assistant' &&
            m.answered &&
            i > 0 &&
            messages[i - 1].role === 'user' &&
            (pathname ?? '') === '/stage2' &&
            userRole === 'admin' &&
            companyId &&
            strategyId ? (
              <CEOChatStage2Reflect
                question={messages[i - 1].content}
                answer={m.content}
                companyId={companyId}
                strategyId={strategyId}
              />
            ) : null}
            {m.role === 'assistant' &&
            m.consultKey &&
            companyId &&
            strategyId &&
            (!selection || consultKeyOf(selection) === m.consultKey) ? (
              <CEOChatStage5Reflect
                question={i > 0 && messages[i - 1].role === 'user' ? messages[i - 1].content : ''}
                answer={m.content}
                execKey={m.consultKey}
                companyId={companyId}
                strategyId={strategyId}
              />
            ) : null}
            </div>
          </div>
        ))}
        {!messages.some((m) => m.role === 'user') && (
          <div className="flex flex-col gap-2">
            {STARTER_QUESTIONS.map((q) => (
              <button
                key={q}
                type="button"
                onClick={() => void send(q)}
                disabled={sending || !userOK || shouldWaitForRestore}
                className="rounded-lg border border-zinc-200 bg-white px-3 py-2 text-left text-[13px] text-zinc-800 transition hover:border-accent/40 hover:bg-accent-soft disabled:text-zinc-400 disabled:hover:border-zinc-200 disabled:hover:bg-white"
              >
                {q}
              </button>
            ))}
          </div>
        )}
        {pendingProposal && companyId && pendingProposal.companyId === companyId && pendingProposal.pathname === (pathname ?? '') ? (
          <CEOChatProposalCard proposal={pendingProposal} pathname={pathname ?? ''} onResult={postProposalResult} />
        ) : null}
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
            <p role="status" className="text-[12px] text-bluegray-deep">
              {notice}
            </p>
          )}
          {showVoice ? (
            <CEOChatVoiceControls
              inputMode={inputMode}
              onInputModeChange={setInputMode}
              status={voice.status}
              notice={voice.notice}
              disabled={!!sending || !userOK || !!shouldWaitForRestore}
              onStart={voice.start}
              onStop={() => voice.stop()}
              onResume={voice.resume}
              replyMode={voice.replyMode}
              onReplyModeChange={changeReplyMode}
              speechRate={speechRate}
              onSpeechRateChange={changeSpeechRate}
              autoRead={autoRead}
              onAutoReadChange={changeAutoRead}
              speaking={speaking}
              onStopReading={stopReadingAll}
            />
          ) : null}
          {showTextInput ? (
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
          ) : null}
          <div className="flex items-center justify-between">
            <span className="text-[11px] text-gray-400">
              {showTextInput ? 'Enterで送信' : null}
            </span>
            <div className="flex items-center gap-2">
              <button
                onClick={() => fileInputRef.current?.click()}
                disabled={sending || !userOK || shouldWaitForRestore}
                className="rounded-md px-3 py-2 text-[12px] hover:bg-gray-100 min-h-[2.5rem] sm:min-h-auto disabled:text-gray-400"
                type="button"
              >
                資料を添付
              </button>
              <input
                ref={fileInputRef}
                type="file"
                accept=".pdf,.xlsx,.xls,.csv"
                multiple
                className="hidden"
                aria-label="資料を添付"
                onChange={attachDocuments}
              />
              <button
                onClick={() => { clearCeoChat(); }}
                className="rounded-md px-3 py-2 text-[12px] hover:bg-gray-100 min-h-[2.5rem] sm:min-h-auto"
                type="button"
              >
                クリア
              </button>
              {showTextInput ? (
                <button
                  onClick={() => { if (input.trim()) void send(input); }}
                  disabled={!inputOK || sending || !userOK || shouldWaitForRestore}
                  className={`rounded-md px-4 py-2 text-[12px] font-semibold min-h-[2.5rem] sm:min-h-auto transition ${
                    (!inputOK || sending || !userOK || shouldWaitForRestore) ? 'bg-zinc-200 text-zinc-500' : 'bg-accent-action text-white hover:bg-accent-hover'
                  }`}
                  type="button"
                >
                  送信
                </button>
              ) : null}
            </div>
          </div>

        </div>
      </div>
    </div>
  );
}
