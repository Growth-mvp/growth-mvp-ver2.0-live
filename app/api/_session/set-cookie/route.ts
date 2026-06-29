// /app/api/_session/set-cookie
import 'server-only';

export const runtime = 'nodejs';

import { NextResponse } from 'next/server';
import { isAuthenticated } from '@/lib/authUtils';

type Body = {
  name: string;
  value: string;
  options?: {
    path?: string;
    maxAge?: number;
    httpOnly?: boolean;
    sameSite?: 'lax' | 'strict' | 'none';
    secure?: boolean;
  };
};

export async function POST(req: Request) {
  try {
    // 認証チェック：このAPIは認証済みユーザーのみ使用可能
    if (!isAuthenticated(req)) {
      return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
    }

    const body = (await req.json().catch(() => null)) as Body | null;

    const name = (body?.name || '').toString();
    const value = (body?.value ?? '').toString();
    const options = body?.options || {};

    if (!name) {
      return NextResponse.json({ error: 'cookie_name_required' }, { status: 400 });
    }

    const res = NextResponse.json({ ok: true });

    res.cookies.set(name, value, {
      path: options.path ?? '/',
      maxAge: options.maxAge,
      httpOnly: options.httpOnly ?? true,
      sameSite: options.sameSite ?? 'lax',
      secure: options.secure ?? process.env.NODE_ENV === 'production',
    });

    return res;
  } catch (e: any) {
    console.error('[set-cookie] error:', e);
    return NextResponse.json({ error: 'cookie_set_failed' }, { status: 500 });
  }
}
