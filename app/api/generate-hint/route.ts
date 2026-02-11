// /app/api/generate-hint/route.ts
import 'server-only';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

import { NextResponse, NextRequest } from 'next/server';
import { openai } from '@/lib/openai';
import { safeParseJson } from '@/app/api/generate-question/helpers';
import { getSupabaseAdmin } from '@/lib/supabaseAdmin';
import { getAuthUserIdFromBearer, requireMembership } from '@/lib/server/rbacGuard';

type Body = { question?: string; answer?: string };

export async function POST(req: NextRequest) {
  const ctype = req.headers.get('content-type') || '';
  if (!ctype.includes('application/json')) {
    return NextResponse.json({ error: 'Unsupported Media Type. Use application/json.' }, { status: 415 });
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

  let body: Body = {};
  try { body = await req.json(); } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const question = (body.question || '').trim();
  const answer = (body.answer || '').trim();

  if (!question) {
    return NextResponse.json({ error: 'question is required' }, { status: 400 });
  }

  const prompt = `
あなたは企業変革の思考ファシリテーターです。
以下の質問に「答えるためのヒント」を3つ、日本語で出してください。
- 質問文を言い換えない。やさしい日本語。上から目線にしない。
- 各ヒントは30〜60字。助言調（〜してみましょう / 〜を見てみましょう）。
- 未来志向を強化するため、次を必ず1つずつ含める：
  1) バックキャスト：3年後の姿を置いてから今日の一歩に落とす
  2) 先行指標：顧客行動の小さな変化を測る具体例
  3) 小さな実験：2週間で検証できる仮説と観察点
出力はJSONのみ {"hints":["...","...","..."]}

【質問】${question}
【これまでの回答（任意）】${answer || '(まだなし)'}
  `.trim();

  const res = await openai.chat.completions.create({
    model: process.env.OPENAI_MODEL ?? 'gpt-4o-mini',
    response_format: { type: 'json_object' },
    temperature: 0.3,
    messages: [
      { role: 'system', content: 'GROWTH 思考支援AI' },
      { role: 'user', content: prompt },
    ],
  });

  const data = safeParseJson<{ hints?: string[] }>(res.choices[0]?.message?.content || '');

  return NextResponse.json({ hints: Array.isArray(data?.hints) ? data!.hints : [] });
}
