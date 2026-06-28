// /app/api/generate-insight/route.ts
import { NextResponse, type NextRequest } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabaseAdmin';
import { getAuthUserIdFromBearer, requireMembership } from '@/lib/server/rbacGuard';
import { generateInsights } from '@/utils/insightModel';

export const runtime = 'nodejs';

export async function POST(req: NextRequest) {
  try {
    // Bearer 認証チェック
    const admin = getSupabaseAdmin();
    const userId = await getAuthUserIdFromBearer(admin, req);
    if (!userId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Membership 確認
    const membership = await requireMembership(admin, userId);
    if (!membership) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

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
