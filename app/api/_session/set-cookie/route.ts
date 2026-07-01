// /app/api/_session/set-cookie
import 'server-only';

export const runtime = 'nodejs';

import { NextResponse } from 'next/server';
import { getAuthenticatedUserIdWithVerification } from '@/lib/authUtils';

type Body = {
  name: string;
  value: string;
  options?: {
    path?: string;
    maxAge?: number;
  };
};

const ALLOWED_COOKIE_NAMES = new Set([
  'company_id',
  'user_preferences',
  'session_token',
  'theme',
  'language',
]);

export async function POST(req: Request) {
  try {
    // 認証チェック：署名検証済みの方法で user を取得
    const userId = await getAuthenticatedUserIdWithVerification(req);
    if (!userId) {
      return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
    }

    const body = (await req.json().catch(() => null)) as Body | null;

    const name = (body?.name || '').toString();
    const value = (body?.value ?? '').toString();
    const options = body?.options || {};

    if (!name) {
      return NextResponse.json({ error: 'cookie_name_required' }, { status: 400 });
    }

    // cookie 名がホワイトリストに含まれているか確認
    if (!ALLOWED_COOKIE_NAMES.has(name)) {
      return NextResponse.json({ error: 'cookie_name_not_allowed' }, { status: 403 });
    }

    const res = NextResponse.json({ ok: true });

    // httpOnly, secure, sameSite はサーバー側で強制
    res.cookies.set(name, value, {
      path: options.path ?? '/',
      maxAge: options.maxAge,
      httpOnly: true,
      sameSite: 'lax',
      secure: process.env.NODE_ENV === 'production',
    });

    return res;
  } catch (e: any) {
    console.error('[set-cookie] error:', e);
    return NextResponse.json({ error: 'cookie_set_failed' }, { status: 500 });
  }
}
