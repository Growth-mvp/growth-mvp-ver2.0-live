// /app/api/generate/route.ts
import 'server-only';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

import { NextResponse, NextRequest } from 'next/server';
import OpenAI from 'openai';
import { getSupabaseAdmin } from '@/lib/supabaseAdmin';
import { getAuthUserIdFromBearer, requireMembership } from '@/lib/server/rbacGuard';
import { createHash } from 'crypto';

const ROUTE_TAG = 'app/api/generate';

/* ========== helpers ========== */
function json(res: any, status = 200, routeTag: string = ROUTE_TAG) {
  return new NextResponse(JSON.stringify(res), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
      'X-GROWTH-Route': routeTag, // ★ 名札（どのルートが応答したか判別）
    },
  });
}

function cleanApiKey(raw?: string | null): string {
  const v = (raw ?? '')
    .replace(/[\u200B-\u200D\uFEFF]/g, '') // zero-width
    .replace(/\r?\n|\r/g, '')              // newlines
    .trim();
  return v;
}

function extractStatus(e: any): number {
  const s = Number(e?.status || e?.code);
  if (s && s >= 400 && s < 600) return s;
  return 500;
}

function extractMessage(e: any): string {
  return (
    e?.message ??
    e?.response?.data?.error?.message ??
    e?.response?.data ??
    e?.error?.message ??
    String(e)
  );
}

function maskKey(k?: string | null) {
  if (!k) return null;
  const s = String(k).trim();
  if (s.length < 12) return `${s.slice(0, 3)}...<short>`;
  return `${s.slice(0, 7)}...${s.slice(-4)}`;
}
function hashKey(k?: string | null) {
  if (!k) return null;
  return createHash('sha256').update(String(k).trim()).digest('hex').slice(0, 10);
}

/* ========== POST ========== */
export async function POST(req: NextRequest) {
  console.log(`[HIT] ${ROUTE_TAG} POST`);

  // 一発特定用：環境変数で意図的に 418 を返す（UIがこのルートを叩いているか即判定）
  if ((process.env.DEBUG_TEA || '').trim() === '1') {
    return json({ result: 'teapot', note: 'DEBUG_TEA=1' }, 418);
  }

  try {
    // Bearer token authentication and membership validation
    const admin = getSupabaseAdmin();
    const userId = await getAuthUserIdFromBearer(admin, req);
    if (!userId) {
      return json({ error: 'unauthorized' }, 401);
    }
    const membership = await requireMembership(admin, userId);
    if (!membership) {
      return json({ error: 'forbidden' }, 403);
    }

    // 1) Body 検証
    let payload: any = null;
    try {
      payload = await req.json();
    } catch {
      return json({ result: 'invalid JSON body' }, 400);
    }
    const prompt = (payload?.prompt ?? '').toString().trim();
    if (!prompt) return json({ result: 'prompt が空です。' }, 400);
    if (prompt.length > 8000) {
      return json({ result: 'prompt が長すぎます（上限8,000文字目安）。' }, 400);
    }

    // 2) APIキー（掃除＋検証）
    const apiKey = cleanApiKey(process.env.OPENAI_API_KEY);
    if (!apiKey) return json({ result: 'OPENAI_API_KEY が未設定です。' }, 500);
    if (!apiKey.startsWith('sk-') || apiKey.length < 24) {
      return json(
        { result: 'OPENAI_API_KEY の形式が不正の可能性があります（再発行を推奨）。' },
        401
      );
    }

    // 3) OpenAI クライアント（Org/Project 未使用なら undefined でOK）
    const client = new OpenAI({
      apiKey,
      organization: cleanApiKey(process.env.OPENAI_ORG_ID) || undefined,
      project: cleanApiKey(process.env.OPENAI_PROJECT) || undefined,
    });

    // 4) モデル（env優先。未設定なら軽量安定版）
    const model = (process.env.OPENAI_MODEL || 'gpt-4o-mini').trim();

    // 5) 呼び出し
    const resp = await client.chat.completions.create({
      model,
      messages: [{ role: 'user', content: prompt }],
      temperature: 0.7,
      max_tokens: 800,
    });

    const text =
      resp?.choices?.[0]?.message?.content?.trim() ??
      'ストーリー生成に失敗しました。';

    return json({ result: text }, 200);
  } catch (e: any) {
    const status = extractStatus(e);
    const errMsg = extractMessage(e);
    console.error(`[ERROR] ${ROUTE_TAG}:`, errMsg);
    return json({ result: 'エラーが発生しました。', detail: errMsg }, status);
  }
}

/* ========== GET: ヘルスチェック & 同一キー判定（本番前に DEBUG_GENERATE を外せばOK） ========== */
export async function GET() {
  console.log(`[HIT] ${ROUTE_TAG} GET`);

  const debug = (process.env.DEBUG_GENERATE || '').trim() === '1';
  const rawKey = process.env.OPENAI_API_KEY ?? '';
  const apiKey = cleanApiKey(rawKey);
  const model = (process.env.OPENAI_MODEL || 'gpt-4o-mini').trim();
  const org = cleanApiKey(process.env.OPENAI_ORG_ID || '');
  const proj = cleanApiKey(process.env.OPENAI_PROJECT || '');

  const base: Record<string, any> = {
    ok: true,
    hasKey: !!apiKey,
    model,
    hasOrg: !!org,
    hasProject: !!proj,
  };

  if (debug) {
    base.keyPreview = maskKey(apiKey);
    base.keyHash = hashKey(apiKey);
    base.route = ROUTE_TAG;
  } else {
    base.note =
      'POST で { "prompt": "..." } を送ると生成します。詳細デバッグは DEBUG_GENERATE=1 を設定してください。';
  }

  return json(base, 200);
}
