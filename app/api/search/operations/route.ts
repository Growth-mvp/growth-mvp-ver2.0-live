import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { SearchQuerySchema, SearchResponseSchema } from '@/lib/search/operationSchema';
import { getAllOperations } from '@/lib/search/operationIndex';
import { scoreAndRankOperations, matchesFilters } from '@/lib/search/scoring';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * POST /api/search/operations
 *
 * Search for operations in the operation guide using natural language queries.
 *
 * Request body:
 * {
 *   "query": "STAGE4 の状態を更新するには？",
 *   "limit": 5,
 *   "filters": {
 *     "screen": "STAGE4",
 *     "permission": "admin",
 *     "savingMethod": "auto"
 *   }
 * }
 *
 * Response:
 * {
 *   "query": "STAGE4 の状態を更新するには？",
 *   "totalMatches": 3,
 *   "results": [...],
 *   "executionTime": 42
 * }
 */
export async function POST(req: NextRequest) {
  const startTime = performance.now();

  try {
    // Parse and validate request body
    let body: unknown;
    try {
      body = await req.json();
    } catch (error) {
      return NextResponse.json(
        { error: 'Invalid JSON in request body' },
        { status: 400 }
      );
    }

    // Validate against schema
    let query: z.infer<typeof SearchQuerySchema>;
    try {
      query = SearchQuerySchema.parse(body);
    } catch (validationError) {
      if (validationError instanceof z.ZodError) {
        return NextResponse.json(
          { error: 'Validation failed', details: validationError.errors },
          { status: 400 }
        );
      }
      return NextResponse.json(
        { error: 'Invalid request schema' },
        { status: 400 }
      );
    }

    // Validate query is not empty
    if (!query.query || query.query.trim().length === 0) {
      return NextResponse.json(
        { error: 'Query cannot be empty' },
        { status: 400 }
      );
    }

    // Validate minimum query length
    if (query.query.trim().length < 2) {
      return NextResponse.json(
        { error: 'Query must be at least 2 characters long' },
        { status: 400 }
      );
    }

    // Load all operations
    const allOperations = await getAllOperations();

    if (allOperations.length === 0) {
      return NextResponse.json(
        {
          query: query.query,
          totalMatches: 0,
          results: [],
          executionTime: performance.now() - startTime,
          error: 'Operation index not ready. Please try again in a few seconds.',
        },
        { status: 503 }
      );
    }

    // Filter by criteria if provided
    let filtered = allOperations;
    const appliedFilters: string[] = [];

    if (query.filters) {
      filtered = allOperations.filter(op =>
        matchesFilters(op, query.filters)
      );

      if (query.filters.screen) {
        appliedFilters.push(`screen: ${query.filters.screen}`);
      }
      if (query.filters.permission) {
        appliedFilters.push(`permission: ${query.filters.permission}`);
      }
      if (query.filters.savingMethod) {
        appliedFilters.push(`savingMethod: ${query.filters.savingMethod}`);
      }
      if (query.filters.category) {
        appliedFilters.push(`category: ${query.filters.category}`);
      }
    }

    // Perform search and ranking
    const results = scoreAndRankOperations(
      filtered,
      query.query,
      query.limit || 5
    );

    const executionTime = performance.now() - startTime;

    // Build response
    const response = SearchResponseSchema.parse({
      query: query.query,
      totalMatches: allOperations.length,
      results,
      filters: {
        applied: appliedFilters.length > 0 ? appliedFilters : undefined,
        availableFilters: ['screen', 'permission', 'savingMethod', 'category'],
      },
      executionTime: Math.round(executionTime),
    });

    return NextResponse.json(response);
  } catch (error) {
    console.error('Search API error:', error);

    // Don't expose internal error details
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: 'Response validation failed' },
        { status: 500 }
      );
    }

    return NextResponse.json(
      { error: 'Internal server error. Please try again.' },
      { status: 500 }
    );
  }
}

/**
 * GET /api/search/operations - health check
 */
export async function GET(req: NextRequest) {
  const startTime = performance.now();

  try {
    const operations = await getAllOperations();
    const executionTime = performance.now() - startTime;

    return NextResponse.json({
      status: 'ok',
      operationCount: operations.length,
      executionTime: Math.round(executionTime),
      message: 'Search API is operational',
    });
  } catch (error) {
    console.error('Health check error:', error);
    return NextResponse.json(
      { status: 'error', message: 'Failed to load operation index' },
      { status: 503 }
    );
  }
}
