import type OpenAI from 'openai';
import type { StrategyData } from '@/types/strategy';
import { classifySearchNeed, type SearchCategory } from './classify';
import { buildPublicSearchQuery } from './query';
import { countSources, runPublicSearch } from './search';
import { buildExternalInfoBlock, type ExternalInfoStatus } from './block';

export type WebSearchOutcome = {
  category: SearchCategory | null;
  status: ExternalInfoStatus | null;
  block: string;
  sourceCount: number;
  categoryCount: number;
  elapsedMs: number;
  skipReason?: 'no_public_scope';
};

const NOT_APPLICABLE: WebSearchOutcome = {
  category: null,
  status: null,
  block: '',
  sourceCount: 0,
  categoryCount: 0,
  elapsedMs: 0,
};

export function isCeoWebSearchEnabled(value: string | undefined): boolean {
  return value === 'true';
}

export async function resolveCeoWebSearch(args: {
  enabled: boolean;
  question: string;
  strategy: Pick<StrategyData, 'industry' | 'businessContent' | 'businessSegments'>;
  client: Pick<OpenAI, 'responses'>;
}): Promise<WebSearchOutcome> {
  if (!args.enabled) return NOT_APPLICABLE;

  const need = classifySearchNeed(args.question);
  if (!need.searchNeeded) return NOT_APPLICABLE;

  const query = buildPublicSearchQuery(args.strategy);
  if (!query.ok) {
    return {
      ...NOT_APPLICABLE,
      category: need.category,
      status: 'skipped_no_scope',
      block: buildExternalInfoBlock({ status: 'skipped_no_scope' }),
      skipReason: query.reason,
    };
  }

  const result = await runPublicSearch(args.client, query.query.input);
  const categoryLabels = query.query.categoryLabels;
  return {
    category: need.category,
    status: result.status,
    block: buildExternalInfoBlock({
      status: result.status,
      facts: result.facts,
      confirmedOn: result.confirmedOn,
      categoryLabels,
    }),
    sourceCount: countSources(result.facts),
    categoryCount: categoryLabels.length,
    elapsedMs: result.elapsedMs,
  };
}
