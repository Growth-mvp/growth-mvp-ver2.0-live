import type OpenAI from 'openai';
import type { StrategyData } from '@/types/strategy';
import { classifySearchNeed, type SearchCategory } from './classify';
import { buildPublicSearchQuery, publicIndustryLabel, type PublicSearchQueryResult } from './query';
import { selectMarketScope, type MarketScope } from './marketScope';
import { countSources, runPublicSearch } from './search';
import { buildExternalInfoBlock, type ExternalInfoStatus } from './block';
import { allowedSourceUrls } from './sourceCheck';
import { countFactEntities, type FactEntityCounts } from './entity';
import { statisticCounts, type StatisticCounts } from './statisticScope';
import type { CeoFact } from './search';

export { countUrls, verifyAnswerUrls } from './sourceCheck';
export {
  buildStatClaimNotice,
  checkStatisticClaims,
  countUnmatchedNumbers,
  type StatClaimCheck,
} from './statisticScope';
export type { CeoFact } from './search';

/** 開発環境の診断用。件数と状態だけを含む（企業名・本文・URL・検索クエリは含めない） */
export type WebSearchDiagnostics = {
  status: ExternalInfoStatus;
  elapsedMs: number;
  sourceCount: number;
  outputTypes: Record<string, number>;
  urlCitations: number;
  attributedFacts: number;
  droppedLines: number;
  periodKnown: number;
  publishedKnown: number;
  entities: FactEntityCounts;
  allowedUrls: number;
  statistics: StatisticCounts;
  marketScope: {
    mode: MarketScope['mode'];
    reason: MarketScope['reason'];
    count: number;
    categoryIds: string[];
  };
};

export type WebSearchOutcome = {
  category: SearchCategory | null;
  status: ExternalInfoStatus | null;
  block: string;
  sourceCount: number;
  categoryCount: number;
  elapsedMs: number;
  allowedUrls: string[];
  facts: CeoFact[];
  skipReason?: 'no_public_scope';
  diagnostics: WebSearchDiagnostics | null;
};

const NOT_APPLICABLE: WebSearchOutcome = {
  category: null,
  status: null,
  block: '',
  sourceCount: 0,
  categoryCount: 0,
  elapsedMs: 0,
  allowedUrls: [],
  facts: [],
  diagnostics: null,
};

function emptyEntities(): FactEntityCounts {
  return { self: 0, competitor: 0, market: 0, unclassified: 0 };
}

function emptyStatistics(): StatisticCounts {
  return { annual: 0, partial: 0, monthly: 0, unknownPeriod: 0, productScopeKnown: 0 };
}

export function isCeoWebSearchEnabled(value: string | undefined): boolean {
  return value === 'true';
}

export async function resolveCeoWebSearch(args: {
  enabled: boolean;
  question: string;
  strategy: Pick<StrategyData, 'industry' | 'businessContent' | 'businessSegments' | 'companyName'>;
  client: Pick<OpenAI, 'responses'>;
}): Promise<WebSearchOutcome> {
  if (!args.enabled) return NOT_APPLICABLE;

  const need = classifySearchNeed(args.question);
  if (!need.searchNeeded) return NOT_APPLICABLE;

  const scope = selectMarketScope({ question: args.question, strategy: args.strategy });
  const query: PublicSearchQueryResult =
    scope.mode === 'focused'
      ? {
          ok: true,
          query: {
            input: scope.input,
            industryLabel: publicIndustryLabel(args.strategy.industry),
            categoryIds: scope.categoryIds,
            categoryLabels: scope.categoryLabels,
          },
        }
      : buildPublicSearchQuery(args.strategy);
  if (!query.ok) {
    return {
      ...NOT_APPLICABLE,
      category: need.category,
      status: 'skipped_no_scope',
      block: buildExternalInfoBlock({ status: 'skipped_no_scope' }),
      skipReason: query.reason,
      diagnostics: {
        marketScope: { mode: scope.mode, reason: scope.mode === 'all' ? scope.reason : 'explicit_market', count: 0, categoryIds: [] },
        status: 'skipped_no_scope',
        elapsedMs: 0,
        sourceCount: 0,
        outputTypes: {},
        urlCitations: 0,
        attributedFacts: 0,
        droppedLines: 0,
        periodKnown: 0,
        publishedKnown: 0,
        entities: emptyEntities(),
        allowedUrls: 0,
        statistics: emptyStatistics(),
      },
    };
  }

  const result = await runPublicSearch(args.client, query.query.input);
  const categoryLabels = query.query.categoryLabels;
  const allowedUrls = allowedSourceUrls(result.facts);
  return {
    category: need.category,
    status: result.status,
    block: buildExternalInfoBlock({
      status: result.status,
      facts: result.facts,
      confirmedOn: result.confirmedOn,
      categoryLabels,
      companyName: args.strategy.companyName,
    }),
    sourceCount: countSources(result.facts),
    categoryCount: categoryLabels.length,
    elapsedMs: result.elapsedMs,
    allowedUrls,
    facts: result.facts,
    diagnostics: {
      statistics: statisticCounts(result.facts),
      status: result.status,
      elapsedMs: result.elapsedMs,
      sourceCount: countSources(result.facts),
      outputTypes: result.stats?.outputTypes ?? {},
      urlCitations: result.stats?.urlCitations ?? 0,
      attributedFacts: result.stats?.attributedFacts ?? 0,
      droppedLines: result.stats?.droppedLines ?? 0,
      periodKnown: result.facts.filter((f) => f.period !== null).length,
      publishedKnown: result.facts.filter((f) => f.publishedOn !== null).length,
      entities: countFactEntities(result.facts.map((f) => f.text), args.strategy.companyName),
      allowedUrls: allowedUrls.length,
      marketScope: {
        mode: scope.mode,
        reason: scope.reason,
        count: query.query.categoryIds.length,
        categoryIds: query.query.categoryIds,
      },
    },
  };
}
