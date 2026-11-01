/** 機会の4つの探索グループ（内部分類）。画面の主分類にはせず、事業展開の方向の参考として使う。 */
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

/**
 * 発見の視点（画面の主分類）。機会・脅威の両方に付く。
 * 記録が無い過去の候補は分類未設定として扱い、別の視点へ推測で振り分けない。
 */
export const DISCOVERY_VIEWPOINTS = ['world_change', 'customer_need', 'industry_competition'] as const;
export type DiscoveryViewpoint = (typeof DISCOVERY_VIEWPOINTS)[number];

export const VIEWPOINT_LABEL_JA: Record<DiscoveryViewpoint, string> = {
  world_change: '① 世の中の変化',
  customer_need: '② お客様の困りごと・願い',
  industry_competition: '③ 業界や競争の変化',
};

export const VIEWPOINT_DEFINITION_JA: Record<DiscoveryViewpoint, string> = {
  world_change:
    '① 世の中の変化（world_change）：社会・経済・人口・技術・制度などの変化による機会と脅威',
  customer_need:
    '② お客様の困りごと・願い（customer_need）：顧客や利用者が抱える悩み、まだ満たされていないニーズ、本当に実現したい成果、購買行動の変化による機会と脅威',
  industry_competition:
    '③ 業界や競争の変化（industry_competition）：競合企業、代替サービス、新規参入、業界の収益構造、取引条件などの変化による機会と脅威',
};

export function isDiscoveryViewpoint(value: unknown): value is DiscoveryViewpoint {
  return typeof value === 'string' && (DISCOVERY_VIEWPOINTS as readonly string[]).includes(value);
}
