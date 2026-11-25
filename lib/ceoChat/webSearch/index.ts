import type OpenAI from 'openai';
import type { StrategyData } from '@/types/strategy';
import { COMPANY_REF, classifySearchNeed, isExplicitWebSearchRequest, type SearchCategory } from './classify';
import { buildPublicSearchQuery, publicIndustryLabel, type PublicSearchQueryResult } from './query';
import { selectMarketScope, type MarketScope } from './marketScope';
import { CEO_SEARCH_TIMEOUT_MS, countSources, runPublicSearch, type SearchPurpose } from './search';
import { buildExternalInfoBlock, type ExternalInfoStatus } from './block';
import { allowedSourceUrls } from './sourceCheck';
import { countFactEntities, type FactEntityCounts } from './entity';
import { statisticCounts, type StatisticCounts } from './statisticScope';
import { judgeSearchNeed, sanitizePublicQuery } from './judge';
import type { CeoFact } from './search';

export { countUrls, verifyAnswerUrls } from './sourceCheck';
export { buildWebSearchStatusBlock, type WebSearchTurnState } from './status';
export { isExplicitWebSearchRequest } from './classify';
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
    mode: MarketScope['mode'] | 'general';
    reason: MarketScope['reason'] | 'general_topic';
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

type ScopeInfo = { mode: WebSearchDiagnostics['marketScope']['mode']; reason: WebSearchDiagnostics['marketScope']['reason'] };

type SearchPlan = {
  input: string;
  purpose: SearchPurpose;
  categoryIds: string[];
  categoryLabels: string[];
  generalTopic?: string;
  scope: ScopeInfo;
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

async function searchWith(
  args: { client: Pick<OpenAI, 'responses'>; companyName?: string },
  category: SearchCategory,
  plan: SearchPlan
): Promise<WebSearchOutcome> {
  const result = await runPublicSearch(args.client, plan.input, CEO_SEARCH_TIMEOUT_MS, plan.purpose);
  const allowedUrls = allowedSourceUrls(result.facts);
  return {
    category,
    status: result.status,
    block: buildExternalInfoBlock({
      status: result.status,
      facts: result.facts,
      confirmedOn: result.confirmedOn,
      categoryLabels: plan.categoryLabels,
      companyName: args.companyName,
      generalTopic: plan.generalTopic,
    }),
    sourceCount: countSources(result.facts),
    categoryCount: plan.categoryLabels.length,
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
      entities: countFactEntities(result.facts.map((f) => f.text), args.companyName),
      allowedUrls: allowedUrls.length,
      marketScope: { ...plan.scope, count: plan.categoryIds.length, categoryIds: plan.categoryIds },
    },
  };
}

function skippedOutcome(category: SearchCategory): WebSearchOutcome {
  const scope: ScopeInfo = { mode: 'general', reason: 'general_topic' };
  return {
    ...NOT_APPLICABLE,
    category,
    status: 'skipped_no_scope',
    block: buildExternalInfoBlock({ status: 'skipped_no_scope' }),
    skipReason: 'no_public_scope',
    diagnostics: {
      marketScope: { ...scope, count: 0, categoryIds: [] },
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

/**
 * 質問の意味から外部の最新情報が必要かを判定し、検索する。
 * 会社の市場の話は登録済みの業種・事業から検索範囲を作り、一般の話（株価・為替など）は会社情報に関係なく検索する。
 * 判定に失敗したときは、キーワード判定に戻る。
 */
export async function resolveCeoWebSearch(args: {
  enabled: boolean;
  question: string;
  strategy: Pick<StrategyData, 'industry' | 'businessContent' | 'businessSegments' | 'companyName'>;
  client: Pick<OpenAI, 'responses' | 'chat'>;
}): Promise<WebSearchOutcome> {
  if (!args.enabled) return NOT_APPLICABLE;

  const judged = await judgeSearchNeed(args.client, args.question);
  const keyword = classifySearchNeed(args.question);
  const needed = isExplicitWebSearchRequest(args.question) || (judged ? judged.needsExternal : keyword.searchNeeded);
  if (!needed) return NOT_APPLICABLE;

  const category: SearchCategory = COMPANY_REF.test(args.question) ? 'C' : 'B';
  const companyName = args.strategy.companyName;

  if (!judged || judged.scope === 'company') {
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
    if (query.ok) {
      return searchWith({ client: args.client, companyName }, category, {
        input: query.query.input,
        purpose: 'market',
        categoryIds: query.query.categoryIds,
        categoryLabels: query.query.categoryLabels,
        scope: { mode: scope.mode, reason: scope.mode === 'all' ? scope.reason : 'explicit_market' },
      });
    }
  }

  const generalQuery = judged ? sanitizePublicQuery(judged.publicQuery, companyName ?? '') : null;
  if (generalQuery) {
    return searchWith({ client: args.client, companyName }, category, {
      input: generalQuery,
      purpose: 'general',
      categoryIds: [],
      categoryLabels: [],
      generalTopic: generalQuery,
      scope: { mode: 'general', reason: 'general_topic' },
    });
  }
  return skippedOutcome(category);
}
