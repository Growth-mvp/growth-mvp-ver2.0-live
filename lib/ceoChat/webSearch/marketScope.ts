import {
  MARKET_TAXONOMY,
  THEME_LINE_LIMIT,
  buildPlanInput,
  keywordHit,
  type MarketCategory,
} from '@/lib/swot/marketTaxonomy';
import { companyMatchOf, publicIndustryLabel, type QuerySource } from './query';

/**
 * AI経営コンサルタント専用の市場選択。質問はサーバー内の選択にだけ使い、外部へは送らない。
 * 送るのは公開市場分類のラベルとテーマだけ。
 */
export type MarketScope =
  | { mode: 'all'; reason: 'company_wide' | 'cross_cutting' | 'unspecified' }
  | {
      mode: 'focused';
      reason: 'explicit_market';
      categoryIds: string[];
      categoryLabels: string[];
      input: string;
    };

const COMPANY_WIDE_CUE = /全社|全事業|すべての事業|全ての事業|当社全体|会社全体|事業全体|全体/;
const CROSS_CUTTING_CUE = /原材料|原料|物流|規制|環境|脱炭素|法改正|人手|人材|為替|金利|エネルギー|価格|カーボン|GX|技術革新/;

/** 市場名そのものが横断的なテーマになっている分類（物流・環境規制など）。単独で指定されたら全事業を対象にする */
const THEME_MARKET_IDS: ReadonlySet<string> = new Set(['p_logistics', 'k_environment']);

const themeLine = (c: MarketCategory) => `${c.label}: ${c.theme}`;

const uniqueById = (list: MarketCategory[]): MarketCategory[] =>
  [...new Map(list.map((c) => [c.id, c])).values()];

/** 質問に、市場の名前や語が明確に含まれる公開市場分類（条件付きの分類は条件も満たす必要がある） */
function explicitMarkets(question: string): MarketCategory[] {
  return MARKET_TAXONOMY.filter((c) => {
    if (!c.keywords.some((k) => keywordHit(question, k))) return false;
    return (c.requires ?? []).every((group) => group.some((k) => keywordHit(question, k)));
  });
}

export function selectMarketScope(args: { question: string; strategy: QuerySource }): MarketScope {
  const question = args.question ?? '';
  if (COMPANY_WIDE_CUE.test(question)) return { mode: 'all', reason: 'company_wide' };

  const crossCutting = CROSS_CUTTING_CUE.test(question);
  const explicit = explicitMarkets(question);
  const onlyThemeMarkets = explicit.length > 0 && explicit.every((c) => THEME_MARKET_IDS.has(c.id));
  if (explicit.length === 0 || (crossCutting && onlyThemeMarkets)) {
    return { mode: 'all', reason: crossCutting ? 'cross_cutting' : 'unspecified' };
  }

  const primary = explicit.filter((c) => c.kind === 'product' || c.kind === 'customer');
  let secondary = explicit.filter((c) => c.kind === 'substitute' || c.kind === 'criteria');
  if (crossCutting) {
    const match = companyMatchOf(args.strategy);
    secondary = uniqueById([...secondary, ...match.substitute, ...match.criteria]);
  }
  const selected = uniqueById([...primary, ...secondary]);

  const groups = [
    { title: '質問に関連する市場（公開分類）', categories: primary },
    { title: '関連する代替品・購買基準（公開分類）', categories: secondary },
  ].filter((g) => g.categories.length > 0);

  const input = buildPlanInput({
    industryLabel: publicIndustryLabel(args.strategy.industry),
    regions: [],
    groups,
    themeLines: selected.slice(0, THEME_LINE_LIMIT).map(themeLine),
    macro: crossCutting,
  });

  return {
    mode: 'focused',
    reason: 'explicit_market',
    categoryIds: selected.map((c) => c.id),
    categoryLabels: selected.map((c) => c.label),
    input,
  };
}
