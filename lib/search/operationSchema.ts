import { z } from 'zod';

/**
 * Operation Guide Search Schema
 *
 * Defines the structure of searchable operations from OPERATION_GUIDE_FINAL.md
 */

export const OperationSchema = z.object({
  operationId: z.string().describe('Unique identifier for the operation (e.g., "home-navigate-stage1")'),
  screen: z.string().describe('Screen/page name (e.g., "Home", "STAGE2")'),
  screenPath: z.string().describe('URL path (e.g., "/", "/stage2")'),
  operationName: z.string().describe('Operation name/title'),
  description: z.string().describe('Brief description of the operation'),
  steps: z.array(z.string()).describe('Step-by-step instructions'),
  permissions: z.array(z.enum(['Admin', 'Manager', 'Member', 'Viewer'])).describe('Roles that can perform this operation'),
  viewerCanAccess: z.boolean().describe('Can Viewer role access this operation'),
  inputRequired: z.string().nullable().describe('Type of input required (e.g., "text", "number", "select")'),
  savingMethod: z.enum(['auto', 'manual', 'none']).describe('How data is saved'),
  debounceTime: z.number().optional().describe('Debounce time in milliseconds if auto-save'),
  relatedStages: z.array(z.string()).optional().describe('Related STAGE numbers'),
  keywords: z.array(z.string()).describe('Search keywords in Japanese and English'),
  category: z.enum([
    'navigation',
    'input',
    'generation',
    'save',
    'error',
    'permission',
    'display',
    'export',
    'other'
  ]).describe('Operation category'),
  docReference: z.object({
    file: z.string().describe('Source file (e.g., "OPERATION_GUIDE_FINAL.md")'),
    startLine: z.number().describe('Starting line number'),
    endLine: z.number().describe('Ending line number'),
  }).describe('Document reference'),
  codeReferences: z.array(z.object({
    file: z.string().describe('Code file path'),
    lines: z.array(z.number()).describe('Relevant line numbers'),
    context: z.string().describe('Context description'),
  })).optional().describe('Relevant code implementation references'),
});

export type Operation = z.infer<typeof OperationSchema>;

/**
 * Search query schema
 */
export const SearchQuerySchema = z.object({
  query: z.string().min(1).max(500).describe('Search query in natural language'),
  limit: z.number().int().min(1).max(20).default(5).describe('Max number of results'),
  filters: z.object({
    screen: z.string().optional().describe('Filter by screen name'),
    permission: z.enum(['Admin', 'Manager', 'Member', 'Viewer']).optional().describe('Filter by permission level'),
    savingMethod: z.enum(['auto', 'manual', 'none']).optional().describe('Filter by saving method'),
    category: z.string().optional().describe('Filter by operation category'),
  }).optional().describe('Optional filters'),
  semanticSearch: z.boolean().default(false).optional().describe('Enable semantic search'),
});

export type SearchQuery = z.infer<typeof SearchQuerySchema>;

/**
 * Search result with relevance score
 */
export const SearchResultSchema = z.object({
  operationId: z.string(),
  screen: z.string(),
  operationName: z.string(),
  description: z.string(),
  matchScore: z.number().min(0).max(1).describe('Relevance score (0-1)'),
  matchReasons: z.array(z.string()).describe('Reasons for matching'),
  snippet: z.string().describe('Preview snippet of the operation'),
  permissions: z.array(z.string()),
  savingMethod: z.string(),
  docReference: z.object({
    file: z.string(),
    startLine: z.number(),
    endLine: z.number(),
  }),
  codeReferences: z.array(z.object({
    file: z.string(),
    lines: z.array(z.number()),
    context: z.string(),
  })).optional().nullable().describe('Code references - excluded from search results for security'),
});

export type SearchResult = z.infer<typeof SearchResultSchema>;

/**
 * Search response
 */
export const SearchResponseSchema = z.object({
  query: z.string(),
  totalMatches: z.number(),
  results: z.array(SearchResultSchema),
  filters: z.object({
    applied: z.array(z.string()).optional(),
    availableFilters: z.array(z.string()).optional(),
  }).optional(),
  executionTime: z.number().describe('Query execution time in milliseconds'),
  error: z.string().optional().describe('Error message if search failed'),
});

export type SearchResponse = z.infer<typeof SearchResponseSchema>;
