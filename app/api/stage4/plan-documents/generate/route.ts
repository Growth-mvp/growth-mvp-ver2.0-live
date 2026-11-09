import 'server-only';

import { NextRequest } from 'next/server';

import { stage4PlanApi } from '@/lib/stage4/plan/serverWiring';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/* 実行計画書の草案の生成（サーバーの経路）。同じプロジェクトは1つだけ。草案がある間は再生成しない。 */
export async function POST(req: NextRequest) {
  return stage4PlanApi.generate(req);
}
