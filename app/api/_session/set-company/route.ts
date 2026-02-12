import 'server-only';
import { NextResponse } from 'next/server';

export async function POST(req: Request) {
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
