import 'server-only';

import { NextRequest } from 'next/server';

import { stage4PlanApi } from '@/lib/stage4/plan/serverWiring';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/* 採用・規制の記録・実行開始・取り消し。版番号が一致した時だけ行い、条件はサーバーで確かめる。 */
export async function POST(req: NextRequest) {
  return stage4PlanApi.transition(req);
}
