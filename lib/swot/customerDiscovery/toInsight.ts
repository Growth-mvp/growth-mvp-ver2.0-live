import type { Buyer } from './buyers';
import type { DiscoveryProblem } from './validate';

/**
 * 課題を既存の機会②の形式（insights の項目）へ写す。候補の形式は変えず、既存の欄だけを使う。
 * 課題の文はそのまま本文にする（機会の文へ書き換えない）。根拠は持たない（常に仮説）。
 */
export function toDiscoveryInsight(problem: DiscoveryProblem, buyers: readonly Buyer[]) {
  const buyer = buyers.find((b) => b.ref === problem.buyerRef);
  if (!buyer) throw new Error('buyer_ref が購入者の一覧にありません');
  const whoLabel = problem.subject === 'buyer' ? buyer.label : `${buyer.label}の関係者`;
  return {
    text: problem.text,
    viewpoint: 'customer_need' as const,
    basis: 'hypothesis' as const,
    evidence: '',
    sourceIndex: null,
    need: {
      discoveryPath: 'customer_need' as const,
      segmentName: buyer.segments[0] ?? null,
      whoLabel,
      problem: problem.text,
      whyCurrentFails: problem.whyUnsolved && problem.whyUnsolved !== '不明' ? problem.whyUnsolved : null,
    },
  };
}

export type DiscoveryInsight = ReturnType<typeof toDiscoveryInsight>;
