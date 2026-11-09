import 'server-only';

import { NextRequest } from 'next/server';

import { stage4PlanApi } from '@/lib/stage4/plan/serverWiring';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/* 実行計画書の草案（開発用の保存先からの切り替え先）。読み込み・新規作成・版番号つき更新。 */
export async function GET(req: NextRequest) {
  return stage4PlanApi.plans(req);
}

export async function POST(req: NextRequest) {
  return stage4PlanApi.plans(req);
}

export async function PUT(req: NextRequest) {
  return stage4PlanApi.plans(req);
}
