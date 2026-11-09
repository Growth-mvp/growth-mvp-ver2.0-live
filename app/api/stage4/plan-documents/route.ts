import 'server-only';

import { NextRequest } from 'next/server';

import { stage4PlanApi } from '@/lib/stage4/plan/serverWiring';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/* 実行計画書の草案の読み込み（GET）と、利用者の修正の保存（PUT）。草案の作成は generate の経路だけが行う。 */
export async function GET(req: NextRequest) {
  return stage4PlanApi.plans(req);
}

export async function PUT(req: NextRequest) {
  return stage4PlanApi.plans(req);
}
