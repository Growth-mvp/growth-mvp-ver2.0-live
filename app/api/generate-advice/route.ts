// /app/api/generate-advice/route.ts
import 'server-only';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

import { NextRequest, NextResponse } from 'next/server';
import OpenAI from 'openai';
import { getSupabaseAdmin } from '@/lib/supabaseAdmin';
import { getAuthUserIdFromBearer, requireMembership } from '@/lib/server/rbacGuard';

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY! });

function sanitize(text: unknown, max = 1000): string {
  const s =
    text == null ? '' : typeof text === 'string' ? text : String(text);
  return s.replace(/\u0000/g, '').trim().slice(0, max);
}

export async function POST(req: NextRequest) {
  try {
    if (!process.env.OPENAI_API_KEY) {
      return NextResponse.json(
        { error: 'OPENAI_API_KEY is missing' },
        { status: 500 }
      );
    }

    // Bearer token authentication and membership validation
    const admin = getSupabaseAdmin();
    const userId = await getAuthUserIdFromBearer(admin, req);
    if (!userId) {
      return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
    }
    const membership = await requireMembership(admin, userId);
    if (!membership) {
      return NextResponse.json({ error: 'forbidden' }, { status: 403 });
    }

    const body = await req.json().catch(() => ({}));
    const objective = sanitize((body as any).objective, 400);
    const progress = sanitize((body as any).progress, 800);

    if (!objective || !progress) {
      return NextResponse.json(
        { error: 'objective と progress は必須です' },
        { status: 400 }
      );
    }

    const prompt = `
以下は業務目標（OKR）とその進捗状況です。
これを読んで、改善点や次の行動につながる具体的なアドバイスを日本語で3点、箇条書きで提案してください。

Objective: ${objective}
進捗内容: ${progress}

# アドバイス:
`.trim();

    // タイムアウト制御
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 45000);

    let advice = '';
    try {
      const completion = await openai.chat.completions.create(
        {
          model: process.env.OPENAI_MODEL ?? 'gpt-4o',
          temperature: 0.7,
          max_tokens: 500,
          messages: [{ role: 'user', content: prompt }],
        },
        { signal: controller.signal }
      );
      advice =
        completion.choices?.[0]?.message?.content?.trim() ??
        'アドバイス生成に失敗しました。';
    } finally {
      clearTimeout(timer);
    }

    return NextResponse.json(
      { advice },
      { headers: { 'Cache-Control': 'no-store' } }
    );
  } catch (e: any) {
    const msg = e?.message || String(e);
    const status = e?.name === 'AbortError' ? 504 : 500;
    console.error('❌ generate-advice error:', e?.name, msg);
    return NextResponse.json(
      { error: 'サーバーエラーが発生しました', detail: msg },
      { status }
    );
  }
}
