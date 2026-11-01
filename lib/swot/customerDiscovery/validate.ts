import { z } from 'zod';
import { DISCOVERY_PER_BUYER_MAX, DISCOVERY_TEXT_MAX, DISCOVERY_TOTAL_MAX } from './prompt';
import { normalizeBuyerKey } from './buyers';

export type DiscoveryProblem = {
  buyerRef: number;
  subject: 'buyer' | 'stakeholder';
  text: string;
  whyUnsolved: string;
};

export type DiscoveryDropped = {
  malformed: number;
  blank: number;
  tooLong: number;
  badBuyerRef: number;
  duplicate: number;
  perBuyerCap: number;
  totalCap: number;
};

const ItemSchema = z.object({
  buyer_ref: z.number().int(),
  subject: z.enum(['buyer', 'stakeholder']),
  text: z.string(),
  why_unsolved: z.string(),
});

/**
 * 課題の出力を、形式だけで検査する（空欄・長さ・購入者番号・重複・件数）。
 * 課題の中身（機会の文かどうか、事業化可能性）では除外しない。
 */
export function validateDiscoveryProblems(
  raw: unknown,
  buyerCount: number
): { items: DiscoveryProblem[]; dropped: DiscoveryDropped } {
  const dropped: DiscoveryDropped = {
    malformed: 0,
    blank: 0,
    tooLong: 0,
    badBuyerRef: 0,
    duplicate: 0,
    perBuyerCap: 0,
    totalCap: 0,
  };
  const list = raw && typeof raw === 'object' && Array.isArray((raw as { problems?: unknown }).problems)
    ? ((raw as { problems: unknown[] }).problems)
    : [];
  const accepted: DiscoveryProblem[] = [];
  const seen = new Set<string>();

  for (const item of list) {
    const parsed = ItemSchema.safeParse(item);
    if (!parsed.success) {
      dropped.malformed++;
      continue;
    }
    const text = parsed.data.text.trim();
    if (!text) {
      dropped.blank++;
      continue;
    }
    if (text.length > DISCOVERY_TEXT_MAX) {
      dropped.tooLong++;
      continue;
    }
    if (parsed.data.buyer_ref < 1 || parsed.data.buyer_ref > buyerCount) {
      dropped.badBuyerRef++;
      continue;
    }
    const key = normalizeBuyerKey(text);
    if (seen.has(key)) {
      dropped.duplicate++;
      continue;
    }
    seen.add(key);
    accepted.push({
      buyerRef: parsed.data.buyer_ref,
      subject: parsed.data.subject,
      text,
      whyUnsolved: parsed.data.why_unsolved.trim(),
    });
  }

  const chosen = new Set<number>();
  const coveredBuyers = new Set<number>();
  accepted.forEach((p, i) => {
    if (chosen.size >= DISCOVERY_TOTAL_MAX || coveredBuyers.has(p.buyerRef)) return;
    coveredBuyers.add(p.buyerRef);
    chosen.add(i);
  });

  const perBuyer = new Map<number, number>();
  chosen.forEach((i) => perBuyer.set(accepted[i].buyerRef, (perBuyer.get(accepted[i].buyerRef) ?? 0) + 1));
  accepted.forEach((p, i) => {
    if (chosen.has(i)) return;
    const count = perBuyer.get(p.buyerRef) ?? 0;
    if (count >= DISCOVERY_PER_BUYER_MAX) {
      dropped.perBuyerCap++;
      return;
    }
    if (chosen.size >= DISCOVERY_TOTAL_MAX) {
      dropped.totalCap++;
      return;
    }
    chosen.add(i);
    perBuyer.set(p.buyerRef, count + 1);
  });

  const items = accepted.filter((_, i) => chosen.has(i));
  return { items, dropped };
}
