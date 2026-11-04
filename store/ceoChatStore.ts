import { create } from 'zustand';
import { useUserStore } from '@/store/userStore';
import {
  CEO_CHAT_GREETING,
  enforceChatLimits,
  type CeoChatMessage,
} from '@/lib/ceoChat/chatHistory';

// 会話履歴はメモリ上のみ保持する（DB・localStorage・sessionStorage には保存しない）。
// 所有者は userId と companyId の組。strategyId は一時的に変わり得るため含めない。

type CeoChatState = {
  ownerKey: string | null;
  generation: number;
  messages: CeoChatMessage[];
  pending: boolean;
};

export type CeoChatTicket = { ownerKey: string; generation: number } | null;

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
  useCeoChatStore.setState({
    ownerKey,
    generation: s.generation + 1,
    messages: CEO_CHAT_GREETING,
    pending: false,
  });
}

bindOwner(ceoChatOwnerKey(useUserStore.getState().user?.id, useUserStore.getState().companyId));
useUserStore.subscribe((s) => {
  bindOwner(ceoChatOwnerKey(s.user?.id, s.companyId));
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
