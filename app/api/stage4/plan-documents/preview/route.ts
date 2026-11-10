import 'server-only';

import { NextRequest } from 'next/server';

import { stage4PlanApi } from '@/lib/stage4/plan/serverWiring';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300;

/* 再生成のプレビュー（保存しない）。新しい案を返すだけで、保存された計画書は変えない。 */
export async function POST(req: NextRequest) {
  return stage4PlanApi.preview(req);
}
