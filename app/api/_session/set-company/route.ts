import 'server-only';
import { NextResponse } from 'next/server';
import { isAuthenticated } from '@/lib/authUtils';

export async function POST(req: Request) {
  // 認証チェック：このAPIは認証済みユーザーのみ使用可能
  if (!isAuthenticated(req)) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  const body = await req.json().catch(() => null);
  const companyId = (body?.companyId || '').toString();

  if (!companyId) {
    return NextResponse.json({ error: 'companyId_required' }, { status: 400 });
  }

  const res = NextResponse.json({ ok: true });

  // 必要に応じて cookie 属性は調整
  res.cookies.set('company_id', companyId, {
    path: '/',
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    maxAge: 60 * 60 * 24 * 30,
  });

  return res;
}
