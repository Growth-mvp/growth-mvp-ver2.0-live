// /app/api/generate-insight/route.ts
import { NextResponse } from 'next/server';
import { generateInsights } from '@/utils/insightModel';

export const runtime = 'edge'; // 速い & 依存少

export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => ({}));
    const { baseline, y3, prob, krs } = body ?? {};
    const insight = generateInsights({
      baseline: baseline ?? null,
      y3: y3 ?? null,
      prob: typeof prob === 'number' ? prob : 0,
      krs: Array.isArray(krs) ? krs : undefined,
    });
    return NextResponse.json({ insight });
  } catch (e: any) {
    return NextResponse.json({ error: String(e?.message || e) }, { status: 500 });
  }
}
