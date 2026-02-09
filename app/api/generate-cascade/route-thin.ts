// /app/api/generate-cascade/route.ts (THINNED)
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { parseGenerateCascadeInput } from './_lib/input';
import { generateCascade } from './_lib/generateCascade';
import { toHttpResponse } from './_lib/errors';

/**
 * POST handler for cascade generation
 * Thinned version: 4270 lines → ~60 lines
 */
export async function POST(req: NextRequest) {
  try {
    // 1. 入力バリデーション
    const body = await req.json().catch(() => ({}));
    const input = parseGenerateCascadeInput(body);

    // 2. メイン処理
    const result = await generateCascade(input);

    // 3. 返却
    return NextResponse.json(result, {
      status: 200,
      headers: {
        'content-type': 'application/json; charset=utf-8',
        'Cache-Control': 'no-store',
      },
    });
  } catch (error: any) {
    // 4. エラー整形
    return toHttpResponse(error);
  }
}
