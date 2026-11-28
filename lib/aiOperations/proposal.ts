/* AIが相談の中で示す操作の提案（全STAGE共通の基盤）。
 * 提案は、AIの回答と一緒に、提案時の内容のまま会話の中に保持する（同意の後にAIが作り直さない）。
 * 反映は利用者の同意の後に、既存の操作処理（直接反映・承認カード）で行う。純粋な判定だけを置き、保存はしない。 */
import type { Stage2Op } from '@/lib/stage2/stage2Input';
import { isNegatedOrDeferred, parseOperationCandidate, type ConsultOperationCandidate } from './consultOperation';

export type ProposedOp = ConsultOperationCandidate | Stage2Op;

export type ProposalStatus = 'open' | 'accepted' | 'declined' | 'closed';

export type ChatProposal = {
  status: ProposalStatus;
  op: ProposedOp;
  key: string;
  userId: string;
  companyId: string;
  strategyId: string;
  /** 提案時の対象の状態。同意の時点で同じかを照合する */
  signature: string;
  createdAt: number;
  expiresAt: number;
};

export const PROPOSAL_TTL_MS = 15 * 60_000;
const DECLINED_KEYS_MAX = 50;

function fnv1a(text: string, seed: number): string {
  let h = seed >>> 0;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, '0');
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value && typeof value === 'object') {
    const entries = Object.keys(value as Record<string, unknown>)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${canonicalJson((value as Record<string, unknown>)[k])}`);
    return `{${entries.join(',')}}`;
  }
  return JSON.stringify(value);
}

/** 提案の鍵：内容（操作の種類と値）から作る。同じ内容の提案は同じ鍵になる（再提案・否定の照合に使う） */
export function proposalKeyOf(op: ProposedOp): string {
  const text = canonicalJson(op);
  return fnv1a(text, 0x811c9dc5) + fnv1a(text, 0x9e3779b9);
}

/** 画面やサーバーから戻された提案の操作を、形だけ確かめる（内容の検証はサーバーの取り出し時に行う） */
export function parseProposedOp(raw: unknown): ProposedOp | null {
  if (!raw || typeof raw !== 'object') return null;
  const kind = (raw as { kind?: unknown }).kind;
  if (typeof kind !== 'string') return null;
  if (kind === 'stage1.issue') return parseOperationCandidate(raw);
  return raw as Stage2Op;
}

const NORMALIZE_STRIP = /[\s。、，,.!！?？]+/g;
const CONSENT_WORD =
  /^(?:はい|うん|ええ|そうですね|いいですね)?(?:お願いします|お願い|お願いいたします|お願いできますか|そうして(?:ください|ほしい)?|そうしましょう|それでお願いします|それで|ぜひ(?:お願いします)?|よろしく(?:お願いします)?|OK|ok|オッケー|了解(?:です)?|承知(?:しました)?|はい|うん|ええ)$/;
const CONSENT_MAX = 20;

/** 提案への同意か（「はい」「お願いします」「そうして」など、同意の語だけの発言に限る） */
export function isProposalConsent(text: string): boolean {
  const t = text.replace(NORMALIZE_STRIP, '');
  if (!t || t.length > CONSENT_MAX) return false;
  return CONSENT_WORD.test(t);
}

export type ProposalIdentity = { userId: string; companyId: string; strategyId: string };

export type ProposalReplyDecision =
  | { kind: 'accept' }
  | { kind: 'decline' }
  | { kind: 'close' }
  | { kind: 'discard'; reason: 'expired' | 'scope' | 'changed' };

/** 提案の直後の発言を、どう扱うかを決める。同意のときだけ反映の候補になり、それ以外は提案を閉じる */
export function decideProposalReply(input: {
  proposal: ChatProposal;
  text: string;
  now: number;
  identity: ProposalIdentity;
  signatureNow: string;
}): ProposalReplyDecision {
  const p = input.proposal;
  if (isProposalConsent(input.text)) {
    const sameScope =
      p.userId === input.identity.userId &&
      p.companyId === input.identity.companyId &&
      p.strategyId === input.identity.strategyId;
    if (!sameScope) return { kind: 'discard', reason: 'scope' };
    if (input.now > p.expiresAt) return { kind: 'discard', reason: 'expired' };
    if (p.signature !== input.signatureNow) return { kind: 'discard', reason: 'changed' };
    return { kind: 'accept' };
  }
  return isNegatedOrDeferred(input.text) ? { kind: 'decline' } : { kind: 'close' };
}

type ThreadMessage = { role: string; execKey?: string; consultKey?: string; operationProposal?: ChatProposal };

/** 利用者の発言は execKey、AIの回答は consultKey で、どの相談の中かを表す */
function threadKeyOf(m: ThreadMessage): string {
  return (m.role === 'user' ? m.execKey : m.consultKey) ?? '';
}

/** 同じ相談の中で、直前のAIの回答が示して、まだ開いている提案（ほかの発言が入った後は開いていない） */
export function openProposalMessageOf<T extends ThreadMessage>(messages: T[], execKey: string): T | null {
  const last = [...messages].reverse().find((m) => m.role === 'assistant' && threadKeyOf(m) === execKey);
  return last?.operationProposal?.status === 'open' ? last : null;
}

/** 同じ相談の中で否定された提案の鍵（同じ内容を繰り返し提案しないために、AIへ渡す） */
export function declinedProposalKeysOf(messages: ThreadMessage[], execKey: string): string[] {
  const keys = messages
    .filter((m) => threadKeyOf(m) === execKey && m.operationProposal?.status === 'declined')
    .map((m) => m.operationProposal!.key);
  return [...new Set(keys)].slice(-DECLINED_KEYS_MAX);
}
