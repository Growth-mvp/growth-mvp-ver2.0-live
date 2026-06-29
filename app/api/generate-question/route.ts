// /app/api/generate-question/route.ts
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

import { NextResponse, type NextRequest } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabaseAdmin';
import { getAuthUserIdFromBearer, requireMembership, assertMinRole } from '@/lib/server/rbacGuard';
import { clampStepDyn, maxStepsForChapter, TEMPLATE12 } from './helpers';

/** 空や壊れたJSONも {} を返して許容する安全パーサ */
async function readJsonSafe(req: Request): Promise<any> {
  try {
    const ct = (req.headers.get('content-type') || '').toLowerCase();
    if (!ct.includes('application/json')) return {};
    const txt = await req.text().catch(() => '');
    if (!txt || !txt.trim()) return {};
    try {
      return JSON.parse(txt);
    } catch {
      return {};
    }
  } catch {
    return {};
  }
}

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

    // Role check: only manager+ can use this API
    try {
      assertMinRole(membership, 'manager');
    } catch (e: any) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    // リクエスト解析
    const { chapterIndex = 0, stepNumber = 1 } = await readJsonSafe(req);

    const ch = Number(chapterIndex) | 0;
    const max = maxStepsForChapter(ch);
    const step = clampStepDyn(ch, Number(stepNumber) || 1, 1);

    const tpl = (TEMPLATE12[ch] ?? [])[step - 1];
    if (!tpl) {
      return NextResponse.json({ error: 'No template for chapter/step' }, { status: 400 });
    }

    return NextResponse.json({
      step: {
        stepNumber: step,
        depth: 'exec',
        question: tpl.question,
        reason: tpl.reason,
        answer: '',
      },
      meta: {
        chapterIndex: ch,
        maxSteps: max,
        mode: 'pure12',
      },
    });
  } catch (e: any) {
    return NextResponse.json({ error: 'Server error', detail: e?.message }, { status: 500 });
  }
}
