import { Operation, SearchResult } from './operationSchema';

/**
 * Text search and scoring engine
 *
 * Implements BM25-inspired scoring with keyword weighting and contextual boosting
 */

/**
 * Tokenize Japanese and English text
 */
function tokenize(text: string): string[] {
  // Split on whitespace, punctuation, and keep hiragana/katakana/kanji clusters
  const tokens = text
    .toLowerCase()
    // Split by spaces and punctuation
    .split(/[\s、。，！？\-_().,:;!?]+/)
    // Filter empty strings
    .filter(t => t.length > 0);

  return tokens;
}

/**
 * Calculate TF-IDF style score
 */
function calculateTermFrequency(tokens: string[], term: string): number {
  const matches = tokens.filter(t => t.includes(term) || term.includes(t)).length;
  return matches > 0 ? Math.log(1 + matches) : 0;
}

/**
 * Boost score based on match type
 */
function getMatchBoost(matchType: 'exact' | 'partial' | 'stemmed'): number {
  switch (matchType) {
    case 'exact':
      return 3;
    case 'partial':
      return 1.5;
    case 'stemmed':
      return 1;
    default:
      return 0.5;
  }
}

/**
 * Score a single operation against a query
 */
export function scoreOperation(
  operation: Operation,
  queryTokens: string[],
  fullQuery: string
): { score: number; reasons: string[] } {
  const reasons: string[] = [];
  let score = 0;

  // 1. Score operation name (highest priority)
  const operationNameTokens = tokenize(operation.operationName);
  for (const queryToken of queryTokens) {
    for (const nameToken of operationNameTokens) {
      if (nameToken === queryToken) {
        const boost = getMatchBoost('exact');
        score += 10 * boost; // Name matches are very valuable
        reasons.push(`操作名に完全一致: "${queryToken}"`);
      } else if (nameToken.includes(queryToken) || queryToken.includes(nameToken)) {
        const boost = getMatchBoost('partial');
        score += 5 * boost;
        reasons.push(`操作名に部分一致: "${queryToken}"`);
      }
    }
  }

  // 2. Score description
  const descriptionTokens = tokenize(operation.description);
  for (const queryToken of queryTokens) {
    const tf = calculateTermFrequency(descriptionTokens, queryToken);
    if (tf > 0) {
      score += 3 * tf;
      reasons.push(`説明文に一致: "${queryToken}"`);
    }
  }

  // 3. Score keywords (predefined and relevant)
  for (const keyword of operation.keywords) {
    for (const queryToken of queryTokens) {
      if (keyword.toLowerCase().includes(queryToken) || queryToken.includes(keyword.toLowerCase())) {
        score += 4;
        reasons.push(`キーワード一致: "${keyword}"`);
        break; // Avoid double counting for same keyword
      }
    }
  }

  // 4. Screen name matching
  const screenTokens = tokenize(operation.screen);
  for (const queryToken of queryTokens) {
    if (screenTokens.some(st => st.includes(queryToken) || queryToken.includes(st))) {
      score += 2;
      reasons.push(`画面名一致: "${operation.screen}"`);
      break;
    }
  }

  // 5. Category/function matching
  // If query contains action words, boost related operation categories
  const actionWords = ['追加', '削除', '編集', '変更', '保存', '出力', '生成', '確認', '表示'];
  for (const action of actionWords) {
    if (fullQuery.includes(action) && operation.category) {
      if (
        (action.includes('追加') && operation.category === 'input') ||
        (action.includes('保存') && operation.category === 'save') ||
        (action.includes('生成') && operation.category === 'generation') ||
        (action.includes('出力') && operation.category === 'export') ||
        (action.includes('確認') && operation.category === 'display')
      ) {
        score += 3;
        reasons.push(`カテゴリ一致: ${operation.category}`);
      }
    }
  }

  // 6. Normalize score to 0-1 range
  const normalizedScore = Math.min(score / 100, 1);

  // Remove duplicate reasons but keep track of matches
  const uniqueReasons = [...new Set(reasons)];

  return {
    score: normalizedScore,
    reasons: uniqueReasons.slice(0, 3), // Keep top 3 reasons
  };
}

/**
 * Create a snippet from operation content
 */
export function createSnippet(operation: Operation, maxLength: number = 150): string {
  const content = operation.description || operation.operationName;
  if (content.length <= maxLength) {
    return content;
  }

  // Find a good break point
  const text = content.substring(0, maxLength);
  const lastBreak = Math.max(
    text.lastIndexOf('。'),
    text.lastIndexOf('。'),
    text.lastIndexOf(' ')
  );

  if (lastBreak > maxLength * 0.7) {
    return text.substring(0, lastBreak + 1) + '...';
  }

  return text + '...';
}

/**
 * Format match score as percentage
 */
export function formatScore(score: number): string {
  return `${Math.round(score * 100)}%`;
}

/**
 * Score and rank multiple operations
 */
export function scoreAndRankOperations(
  operations: Operation[],
  query: string,
  limit: number = 5
): SearchResult[] {
  const queryTokens = tokenize(query);

  // Score all operations
  const scored = operations.map(op => {
    const { score, reasons } = scoreOperation(op, queryTokens, query);
    return {
      operation: op,
      score,
      reasons,
    };
  });

  // Filter out low-scoring results (below 0.1)
  const filtered = scored.filter(s => s.score > 0.1);

  // Sort by score (highest first)
  const sorted = filtered.sort((a, b) => b.score - a.score);

  // Convert to search results
  const results: SearchResult[] = sorted.slice(0, limit).map(s => ({
    operationId: s.operation.operationId,
    screen: s.operation.screen,
    operationName: s.operation.operationName,
    description: s.operation.description,
    matchScore: s.score,
    matchReasons: s.reasons,
    snippet: createSnippet(s.operation),
    permissions: s.operation.permissions,
    savingMethod: s.operation.savingMethod,
    docReference: s.operation.docReference,
    // Note: codeReferences intentionally excluded from search results to avoid exposing implementation details
    // (model names, token limits, API implementation details, etc.)
  }));

  return results;
}

/**
 * Keyword expansion for better matching
 */
export function expandQueryKeywords(query: string): string[] {
  const keywords = tokenize(query);

  // Add common synonyms and related terms
  const expansions: Record<string, string[]> = {
    追加: ['追加', '新規', '作成', '追加する'],
    削除: ['削除', '消す', '除外', '削除する'],
    編集: ['編集', '変更', '修正', '更新'],
    保存: ['保存', '確定', '記録', '送信'],
    生成: ['生成', '作成', 'AI', '自動'],
    出力: ['出力', 'PDF', 'ダウンロード', 'エクスポート'],
    確認: ['確認', '表示', '見る', '確認する'],
    状態: ['状態', 'ステータス', 'ステータス'],
  };

  const expanded = new Set(keywords);

  for (const keyword of keywords) {
    if (expansions[keyword]) {
      expansions[keyword].forEach(syn => expanded.add(syn));
    }
  }

  return Array.from(expanded);
}

/**
 * Check if query matches filter criteria
 */
export function matchesFilters(
  operation: Operation,
  filters?: {
    screen?: string;
    permission?: string;
    savingMethod?: string;
    category?: string;
  }
): boolean {
  if (!filters) return true;

  if (filters.screen) {
    const screenMatch = operation.screen.toLowerCase().includes(filters.screen.toLowerCase());
    if (!screenMatch) return false;
  }

  if (filters.permission) {
    if (!operation.permissions.includes(filters.permission as any)) return false;
  }

  if (filters.savingMethod) {
    if (operation.savingMethod !== filters.savingMethod) return false;
  }

  if (filters.category) {
    if (operation.category !== filters.category) return false;
  }

  return true;
}
