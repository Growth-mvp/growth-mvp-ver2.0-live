import 'server-only';

import { NextRequest } from 'next/server';

import { stage4PlanApi } from '@/lib/stage4/plan/serverWiring';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/* 会社・戦略の計画書の一覧（読み取りのみ）。STAGE6の参考シナリオに使う。 */
export async function GET(req: NextRequest) {
  return stage4PlanApi.list(req);
}
