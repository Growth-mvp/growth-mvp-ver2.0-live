import 'server-only';

import { NextRequest } from 'next/server';

import { stage4PlanApi } from '@/lib/stage4/plan/serverWiring';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/* プロジェクトの番号（安定ID）。戦略の版番号と各プロジェクトの番号の読み取り、および番号の付与。 */
export async function GET(req: NextRequest) {
  return stage4PlanApi.identity(req);
}

export async function POST(req: NextRequest) {
  return stage4PlanApi.identity(req);
}
