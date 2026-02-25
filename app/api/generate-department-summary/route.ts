// /app/api/generate-department-summary/route.ts
// ★ DEPRECATED: This API has been consolidated into /api/generate-cascade
// Use /api/generate-cascade instead with the full department context.

import { NextRequest, NextResponse } from 'next/server';

/**
 * ★ 410 Gone Response
 * This endpoint was retired in favor of /api/generate-cascade, which provides
 * a unified generation pipeline for mission, projects, OKRs, and direction/expectations/focusThemes.
 */
export async function POST(req: NextRequest) {
  return NextResponse.json(
    {
      error: 'DEPRECATED',
      message: '/api/generate-department-summary は廃止されました。',
      info: '/api/generate-cascade を使用してください。',
    },
    { status: 410 }
  );
}

export async function GET(req: NextRequest) {
  return NextResponse.json(
    {
      error: 'DEPRECATED',
      message: '/api/generate-department-summary は廃止されました。',
      info: '/api/generate-cascade を使用してください。',
    },
    { status: 410 }
  );
}
