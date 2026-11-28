/* 提案の作成と、画面の現在の状態に照らした判定（画面の状態を読むので、クライアントだけで使う） */
import { parseOperationCandidate } from './consultOperation';
import { PROPOSAL_TTL_MS, parseProposedOp, proposalKeyOf, type ChatProposal, type ProposedOp } from './proposal';
import { stage2SignatureOf } from '@/lib/stage2/stage2Apply';
import type { Stage2Op } from '@/lib/stage2/stage2Input';
import type { StrategyState } from '@/store/strategyStore';

export function proposalSignatureOf(op: ProposedOp, st: StrategyState): string {
  if (op.kind === 'stage1.issue') {
    return JSON.stringify(((st.stage1Issues ?? []) as Array<{ title?: string }>).map((i) => i.title ?? ''));
  }
  return stage2SignatureOf(op as Stage2Op, st);
}

const linesOf = (text: string | undefined) => (text ?? '').split('\n').map((l) => l.trim()).filter(Boolean);

/** 提案の内容が、すでに画面の内容と同じか（同じなら、提案しない） */
export function alreadyReflected(op: ProposedOp, st: StrategyState): boolean {
  if (op.kind === 'stage1.issue') {
    const title = parseOperationCandidate(op)?.title ?? '';
    return ((st.stage1Issues ?? []) as Array<{ title?: string }>).some((i) => (i.title ?? '').trim() === title);
  }
  const s = st as unknown as Record<string, string | undefined>;
  const targets = st.companyTargets ?? [];
  switch (op.kind) {
    case 'ceo.append':
      return (st.ceoIntent ?? '').includes(op.text);
    case 'ceo.set':
      return (st.ceoIntent ?? '').trim() === op.text.trim();
    case 'mvv.set':
      return (s[op.field] ?? '').trim() === op.value.trim();
    case 'swot.add':
      return linesOf(s[op.field]).includes(op.text);
    case 'swot.replace':
      return !linesOf(s[op.field]).includes(op.from) && linesOf(s[op.field]).includes(op.to);
    case 'swot.remove':
      return !linesOf(s[op.field]).includes(op.text);
    case 'target.add':
      return targets.some(
        (t) => t.label === op.label && t.unit === op.unit && t.base === op.base && (t.dueYear ?? undefined) === (op.dueYear ?? undefined),
      );
    case 'target.setBase':
      return targets.some((t) => t.id === op.id && t.unit === op.unit && t.base === op.base);
    case 'target.update':
      return targets.some((t) => t.id === op.id && (t.dueYear ?? undefined) === (op.dueYear ?? undefined));
    case 'target.remove':
      return !targets.some((t) => t.id === op.id);
    case 'answer.set':
      return ((st.answers12 ?? []).find((a) => a.id === op.questionId)?.answer ?? '').trim() === op.text.trim();
  }
}

/** AIの回答が示した提案から、画面に保持する提案を作る。作れない（対象の権限がない・同じ内容がある）ときは undefined */
export function newChatProposal(
  raw: unknown,
  identity: { userId: string; companyId: string; strategyId: string },
  st: StrategyState,
  role: string | null,
  now: number,
): ChatProposal | undefined {
  const op = parseProposedOp(raw);
  if (!op) return undefined;
  const isStage2 = op.kind !== 'stage1.issue';
  const allowed = isStage2 ? role === 'admin' : role === 'admin' || role === 'manager';
  if (!allowed || alreadyReflected(op, st)) return undefined;
  return {
    status: 'open',
    op,
    key: proposalKeyOf(op),
    ...identity,
    signature: proposalSignatureOf(op, st),
    createdAt: now,
    expiresAt: now + PROPOSAL_TTL_MS,
  };
}
