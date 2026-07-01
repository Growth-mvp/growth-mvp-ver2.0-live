import 'server-only';
import { NextResponse } from 'next/server';
import { getAuthenticatedUserIdWithVerification } from '@/lib/authUtils';
import { getSupabaseAdmin } from '@/lib/supabaseAdmin';

export async function POST(req: Request) {
  // 認証チェック：署名検証済みの方法で user を取得
  const userId = await getAuthenticatedUserIdWithVerification(req);
  if (!userId) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  const body = await req.json().catch(() => null);
  const companyId = (body?.companyId || '').toString();

  if (!companyId) {
    return NextResponse.json({ error: 'companyId_required' }, { status: 400 });
  }

  // ユーザーが指定された companyId に実際に所属しているか確認
  const admin = getSupabaseAdmin();
  const { data } = await admin
    .from('company_members')
    .select('company_id')
    .eq('company_id', companyId)
    .eq('user_id', userId)
    .maybeSingle();

  if (!data?.company_id) {
    return NextResponse.json({ error: 'company_not_found' }, { status: 403 });
  }

  const res = NextResponse.json({ ok: true });

  res.cookies.set('company_id', companyId, {
    path: '/',
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    maxAge: 60 * 60 * 24 * 30,
  });

  return res;
}
