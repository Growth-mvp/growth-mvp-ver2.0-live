import { create } from 'zustand';
import { useUserStore } from '@/store/userStore';
import {
  CEO_CHAT_GREETING,
  CEO_CHAT_SNAPSHOT_KEY,
  enforceChatLimits,
  parseCeoChatSnapshot,
  type CeoChatMessage,
  type CeoChatSnapshot,
} from '@/lib/ceoChat/chatHistory';

// 会話履歴はメモリ上に保持し、同じタブのリロードに備えて sessionStorage にも写す。
// 所有者は userId と companyId の組。strategyId は一時的に変わり得るため含めない。
// localStorage には保存しない。タブを閉じると消え、ログアウト・企業切替・所有者の変更で破棄する。

type CeoChatState = {
  ownerKey: string | null;
  generation: number;
  messages: CeoChatMessage[];
  pending: boolean;
};

export type CeoChatTicket = { ownerKey: string; generation: number } | null;

function sessionStore(): Storage | null {
  return typeof window === 'undefined' ? null : window.sessionStorage;
}

function readRestorableSnapshot(): CeoChatSnapshot | null {
  try {
    const store = sessionStore();
    if (!store) return null;
    const raw = store.getItem(CEO_CHAT_SNAPSHOT_KEY);
    if (raw === null) return null;
    const snapshot = parseCeoChatSnapshot(raw, Date.now());
    if (!snapshot) store.removeItem(CEO_CHAT_SNAPSHOT_KEY);
    return snapshot;
  } catch {
    return null;
  }
}

function removeSnapshot() {
  try {
    sessionStore()?.removeItem(CEO_CHAT_SNAPSHOT_KEY);
  } catch {
    // 保存先が使えない場合は何もしない（メモリ上の履歴は通常どおり動く）
  }
}

function writeSnapshot(ownerKey: string, messages: CeoChatMessage[]) {
  try {
    const store = sessionStore();
    if (!store) return;
    const isGreetingOnly =
      messages.length === 1 && messages[0].content === CEO_CHAT_GREETING[0].content;
    if (isGreetingOnly) {
      store.removeItem(CEO_CHAT_SNAPSHOT_KEY);
      return;
    }
    const snapshot: CeoChatSnapshot = { v: 1, ownerKey, savedAt: Date.now(), messages };
    store.setItem(CEO_CHAT_SNAPSHOT_KEY, JSON.stringify(snapshot));
  } catch {
    // 容量超過などで保存できない場合は、メモリ上の履歴だけで続ける
  }
}

// リロード直後はユーザーがまだ確定していないため、読んだ保存分は所有者が確定するまで保留する
let restorable: CeoChatSnapshot | null = readRestorableSnapshot();

export const useCeoChatStore = create<CeoChatState>()(() => ({
  ownerKey: null,
  generation: 0,
  messages: CEO_CHAT_GREETING,
  pending: false,
}));

export function ceoChatOwnerKey(
  userId: string | null | undefined,
  companyId: string | null | undefined
): string | null {
  return userId && companyId ? `${userId}|${companyId}` : null;
}

function bindOwner(ownerKey: string | null) {
  const s = useCeoChatStore.getState();
  if (s.ownerKey === ownerKey) return;

  let messages = CEO_CHAT_GREETING;
  if (ownerKey === null) {
    restorable = null;
    removeSnapshot();
  } else {
    if (restorable && restorable.ownerKey === ownerKey) {
      messages = restorable.messages;
    } else {
      removeSnapshot();
    }
    restorable = null;
  }

  useCeoChatStore.setState({
    ownerKey,
    generation: s.generation + 1,
    messages,
    pending: false,
  });
}

bindOwner(ceoChatOwnerKey(useUserStore.getState().user?.id, useUserStore.getState().companyId));
useUserStore.subscribe((s) => {
  bindOwner(ceoChatOwnerKey(s.user?.id, s.companyId));
});

let persistedMessages: CeoChatMessage[] | null = null;
useCeoChatStore.subscribe((s) => {
  if (s.ownerKey === null || s.messages === persistedMessages) return;
  persistedMessages = s.messages;
  writeSnapshot(s.ownerKey, s.messages);
});

export function openCeoChatRequest(ownerKey: string | null): CeoChatTicket {
  const s = useCeoChatStore.getState();
  if (!ownerKey || s.ownerKey !== ownerKey) return null;
  return { ownerKey, generation: s.generation };
}

export function isCeoChatRequestCurrent(ticket: CeoChatTicket): boolean {
  if (!ticket) return false;
  const s = useCeoChatStore.getState();
  return s.ownerKey === ticket.ownerKey && s.generation === ticket.generation;
}

export function getCeoChatMessages(ticket: CeoChatTicket): CeoChatMessage[] {
  return isCeoChatRequestCurrent(ticket) ? useCeoChatStore.getState().messages : [];
}

export function updateCeoChatMessages(
  ticket: CeoChatTicket,
  update: (messages: CeoChatMessage[]) => CeoChatMessage[]
) {
  if (!isCeoChatRequestCurrent(ticket)) return;
  useCeoChatStore.setState({ messages: enforceChatLimits(update(useCeoChatStore.getState().messages)) });
}

export function setCeoChatPending(ticket: CeoChatTicket, pending: boolean) {
  if (!isCeoChatRequestCurrent(ticket)) return;
  useCeoChatStore.setState({ pending });
}

export function clearCeoChat() {
  const s = useCeoChatStore.getState();
  useCeoChatStore.setState({
    generation: s.generation + 1,
    messages: CEO_CHAT_GREETING,
    pending: false,
  });
}
