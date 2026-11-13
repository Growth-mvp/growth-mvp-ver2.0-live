import 'server-only';

import { NextRequest } from 'next/server';

import { stage4PlanApi } from '@/lib/stage4/plan/serverWiring';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/* 再生成の案を、現在の計画書として保存する。案はプレビューでサーバーが作って署名したものだけを受け付ける。 */
export async function POST(req: NextRequest) {
  return stage4PlanApi.useDraft(req);
}
