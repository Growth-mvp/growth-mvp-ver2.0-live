export type CeoChatMessage = { role: 'user' | 'assistant'; content: string };

export const CEO_CHAT_GREETING: CeoChatMessage[] = [
  { role: 'assistant', content: 'こんにちは。AI経営コンサルタントです。' },
];

export const CEO_CHAT_MAX_MESSAGES = 100;
export const CEO_CHAT_MAX_MESSAGE_CHARS = 8_000;
export const CEO_CHAT_MAX_TOTAL_CHARS = 300_000;

// サーバー側（ask-ceo-agent の sanitizeAskMessages）は直近12件まで。今回の発言を含めて10件以内に収める
export const ASK_HISTORY_MAX_MESSAGES = 9;
export const ASK_HISTORY_MAX_CHARS = 8_000;

const TRUNCATED_SUFFIX = '…（文字数上限のため省略）';

export function enforceChatLimits(messages: CeoChatMessage[]): CeoChatMessage[] {
  const capped = messages.map((m) =>
    m.content.length > CEO_CHAT_MAX_MESSAGE_CHARS
      ? { ...m, content: m.content.slice(0, CEO_CHAT_MAX_MESSAGE_CHARS - TRUNCATED_SUFFIX.length) + TRUNCATED_SUFFIX }
      : m
  );
  let kept = capped.length > CEO_CHAT_MAX_MESSAGES ? capped.slice(-CEO_CHAT_MAX_MESSAGES) : capped;
  let total = kept.reduce((sum, m) => sum + m.content.length, 0);
  while (total > CEO_CHAT_MAX_TOTAL_CHARS && kept.length > 1) {
    total -= kept[0].content.length;
    kept = kept.slice(1);
  }
  return kept;
}

export function buildAskHistory(messages: CeoChatMessage[]): CeoChatMessage[] {
  const picked: CeoChatMessage[] = [];
  let chars = 0;
  for (let i = messages.length - 1; i >= 0 && picked.length < ASK_HISTORY_MAX_MESSAGES; i--) {
    const m = messages[i];
    if (chars + m.content.length > ASK_HISTORY_MAX_CHARS) break;
    picked.unshift(m);
    chars += m.content.length;
  }
  return picked;
}

export const CEO_CHAT_SNAPSHOT_KEY = 'growth-ceo-chat-history';
export const CEO_CHAT_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;

export type CeoChatSnapshot = {
  v: 1;
  ownerKey: string;
  savedAt: number;
  messages: CeoChatMessage[];
};

function isCeoChatMessage(m: unknown): m is CeoChatMessage {
  if (!m || typeof m !== 'object') return false;
  const { role, content } = m as { role?: unknown; content?: unknown };
  return (role === 'user' || role === 'assistant') && typeof content === 'string';
}

export function parseCeoChatSnapshot(raw: string | null, now: number): CeoChatSnapshot | null {
  if (!raw) return null;
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!data || typeof data !== 'object') return null;
  const d = data as { v?: unknown; ownerKey?: unknown; savedAt?: unknown; messages?: unknown };
  if (d.v !== 1 || typeof d.ownerKey !== 'string' || typeof d.savedAt !== 'number') return null;
  if (now - d.savedAt > CEO_CHAT_RETENTION_MS || d.savedAt > now) return null;
  if (!Array.isArray(d.messages)) return null;
  const messages = d.messages.filter(isCeoChatMessage);
  if (messages.length === 0) return null;
  return { v: 1, ownerKey: d.ownerKey, savedAt: d.savedAt, messages: enforceChatLimits(messages) };
}
