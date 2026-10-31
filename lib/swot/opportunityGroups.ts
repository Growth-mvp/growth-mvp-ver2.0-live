/** 機会の4つの探索グループ。顧客の未充足ニーズは独立したグループではなく、A〜D すべてに共通する探索の視点。 */
export const OPPORTUNITY_GROUPS = ['existing_market', 'new_customer_use', 'new_region', 'new_business'] as const;
export type OpportunityGroup = (typeof OPPORTUNITY_GROUPS)[number];

export const GROUP_LABEL_JA: Record<OpportunityGroup, string> = {
  existing_market: 'A：既存事業・既存市場の新しい可能性',
  new_customer_use: 'B：新しい顧客・用途の可能性',
  new_region: 'C：新しい地域・市場の可能性',
  new_business: 'D：新しい事業領域の可能性',
};

export const GROUP_DEFINITION_JA: Record<OpportunityGroup, string> = {
  existing_market:
    'A（existing_market）：既存の顧客・市場における新たな需要、顧客価値、購買基準、競争条件の変化',
  new_customer_use:
    'B（new_customer_use）：現在とは異なる顧客層・利用者・用途・利用場面・未充足ニーズ',
  new_region:
    'C（new_region）：国内外を問わず、現在の商圏以外に存在する可能性のある需要や事業機会',
  new_business:
    'D（new_business）：自社の技術・経験・顧客基盤などを生かせる、隣接領域や新しい価値提供',
};

export function isOpportunityGroup(value: unknown): value is OpportunityGroup {
  return typeof value === 'string' && (OPPORTUNITY_GROUPS as readonly string[]).includes(value);
}
