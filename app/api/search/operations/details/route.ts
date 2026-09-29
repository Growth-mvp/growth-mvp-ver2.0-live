import { NextRequest, NextResponse } from 'next/server';
import { getOperationById } from '@/lib/search/operationIndex';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * GET /api/search/operations/details?id=<operationId>
 *
 * Fetch detailed information for a specific operation by ID.
 *
 * Query parameters:
 * - id: Operation ID (required)
 *
 * Response:
 * {
 *   "operation": {
 *     "operationId": "stage4-status-update",
 *     "screen": "STAGE 4 - 実行計画策定",
 *     "operationName": "ステータス管理",
 *     ...
 *   }
 * }
 */
export async function GET(req: NextRequest) {
  try {
    // Get operation ID from query parameters
    const { searchParams } = new URL(req.url);
    const operationId = searchParams.get('id');

    // Validate operation ID
    if (!operationId || operationId.trim().length === 0) {
      return NextResponse.json(
        { error: 'Operation ID is required' },
        { status: 400 }
      );
    }

    // Fetch operation
    const operation = await getOperationById(operationId);

    if (!operation) {
      return NextResponse.json(
        { error: `Operation not found: ${operationId}` },
        { status: 404 }
      );
    }

    // Return operation details
    return NextResponse.json({
      operation,
    });
  } catch (error) {
    console.error('Operation detail API error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
