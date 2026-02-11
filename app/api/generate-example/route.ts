// /app/api/generate-example/route.ts
import 'server-only';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

import { NextResponse, NextRequest } from 'next/server';
import { openai } from '@/lib/openai';
import { safeParseJson } from '@/app/api/generate-question/helpers';
import { getSupabaseAdmin } from '@/lib/supabaseAdmin';
import { getAuthUserIdFromBearer, requireMembership } from '@/lib/server/rbacGuard';

type Body = { question?: string; allowNamedExamples?: boolean };

export async function POST(req: NextRequest) {
  const ctype = req.headers.get('content-type') || '';
  if (!ctype.includes('application/json')) {
    return NextResponse.json(
      { error: 'Unsupported Media Type. Use application/json.' },
      { status: 415 }
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

  let body: Body = {};
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const question = (body.question || '').trim();
  // ✅ デフォルトを true に変更（常に著名企業名OK）
  const allowNamed = body.allowNamedExamples ?? true;

  if (!question) {
    return NextResponse.json({ error: 'question is required' }, { status: 400 });
  }

  const policy = allowNamed
    ? `- 固有名詞は「一般に広く知られた著名企業」かつ「公開情報として一般認知のある事例」に限定。
- 推測・内部情報・誇張は禁止。
- 著名企業とは、上場企業・公開取材事例・書籍や公的レポートに掲載された事例を指す。
- 迷う場合は固有名詞を使わず、業界・取り組みタイプで表現する。`
    : `- 固有名詞は禁止。守秘に配慮し、業界・規模などの抽象化のみを用いる。`;

  const prompt = `
あなたは企業事例アナリストです。
以下の質問に関連する「示唆が得られる実在事例」を日本語で2つ示してください。
${policy}
- 1事例あたり1〜2文。学びが伝わる要点を端的に。
- 行動→結果→学びの順に述べる。
- テンプレ的な説明やスローガンは避ける。
- JSONのみで返す: {"examples":["...","..."], "disclaimer":"..."}

質問: ${question}
  `.trim();

  const res = await openai.chat.completions.create({
    model: process.env.OPENAI_MODEL ?? 'gpt-4o-mini',
    response_format: { type: 'json_object' },
    temperature: 0.4,
    messages: [
      { role: 'system', content: 'GROWTH 事例アシスタント' },
      { role: 'user', content: prompt },
    ],
  });

  const data = safeParseJson<{ examples?: string[]; disclaimer?: string }>(
    res.choices[0]?.message?.content || ''
  );

  return NextResponse.json({
    examples: Array.isArray(data?.examples) ? data!.examples : [],
    disclaimer:
      data?.disclaimer ||
      '※ 本事例に登場する固有名詞は、一般に公開・認知された著名企業の事例に基づいています（守秘・内部情報は含みません）。',
  });
}
