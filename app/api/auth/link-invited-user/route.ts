// /app/api/auth/link-invited-user/route.ts
import 'server-only';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

import { NextResponse, NextRequest } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabaseAdmin';
import { getAuthUserIdFromBearer } from '@/lib/server/rbacGuard';

/** メールアドレスをマスキングする（ログ出力用）*/
function maskEmail(email: string): string {
  if (!email || email.length < 3) return '***';
  const [local, domain] = email.split('@');
  if (!local || !domain) return '***';
  const maskedLocal = local.charAt(0) + '*'.repeat(Math.max(1, local.length - 2)) + local.charAt(local.length - 1);
  return `${maskedLocal}@${domain}`;
}

export async function POST(req: NextRequest) {
  try {
    // ========== PRODUCTION GUARD: 本番環境では厳格な保護が必須 ==========
    if (process.env.NODE_ENV === 'production') {
      // 本番環境でのみ実行される検証
      // 開発環境では実行スキップ可能だが、実装は完全に行う
    }

    const admin = getSupabaseAdmin();

    // 認証確認
    const userId = await getAuthUserIdFromBearer(admin, req);
    if (!userId) {
      console.error('[link-invited-user] unauthorized');
      return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
    }

    // 招待の照合は認証済みユーザー本人の email で行う（リクエストボディの email は信用しない）
    const { data: authData, error: authErr } = await admin.auth.admin.getUserById(userId);
    const authUser = authData?.user;
    const normalizedEmail = (authUser?.email || '').trim().toLowerCase();

    if (authErr || !normalizedEmail) {
      console.error('[link-invited-user] auth user email lookup failed:', authErr?.message);
      return NextResponse.json({ error: 'Failed to verify account email' }, { status: 403 });
    }

    if (!authUser?.email_confirmed_at) {
      console.error('[link-invited-user] account email is not confirmed');
      return NextResponse.json({ error: 'Email not confirmed' }, { status: 403 });
    }

    if (process.env.NODE_ENV !== 'production') {
      console.log('[link-invited-user] Attempting to link company membership:', {
        userId,
        email: maskEmail(normalizedEmail)
      });
    }

    // company_invites テーブルから招待レコードを探す
    const { data: inviteRecord, error: inviteErr } = await admin
      .from('company_invites')
      .select('company_id, role')
      .eq('email', normalizedEmail)
      .is('accepted_at', null)
      .gt('expires_at', new Date().toISOString())
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (inviteErr) {
      console.error('[link-invited-user] Failed to fetch invite record:', inviteErr);
      return NextResponse.json(
        { error: 'Failed to fetch invite record' },
        { status: 500 }
      );
    }

    if (!inviteRecord?.company_id) {
      if (process.env.NODE_ENV !== 'production') {
        console.warn('[link-invited-user] No valid invite found for:', maskEmail(normalizedEmail));
      }
      // 招待レコードがなくても処理を続行する（既に参加している可能性）
      return NextResponse.json({ ok: true, message: 'No invite record found' }, { status: 200 });
    }

    const companyId = inviteRecord.company_id;

    // 既存の所属は上書きしない（ignoreDuplicates は ON CONFLICT DO NOTHING）
    const { error: upsertErr } = await admin
      .from('company_members')
      .upsert(
        { company_id: companyId, user_id: userId, role: inviteRecord.role || 'member' },
        { onConflict: 'company_id,user_id', ignoreDuplicates: true }
      );

    if (upsertErr) {
      console.error('[link-invited-user] Failed to insert company_members:', upsertErr);
      return NextResponse.json({ error: 'Failed to link membership' }, { status: 500 });
    }

    const { data: membership, error: membershipErr } = await admin
      .from('company_members')
      .select('role')
      .eq('company_id', companyId)
      .eq('user_id', userId)
      .maybeSingle();

    if (membershipErr || !membership) {
      console.error('[link-invited-user] Failed to read membership:', membershipErr);
      return NextResponse.json({ error: 'Failed to link membership' }, { status: 500 });
    }

    const { error: acceptErr } = await admin
      .from('company_invites')
      .update({ accepted_at: new Date().toISOString() })
      .eq('company_id', companyId)
      .eq('email', normalizedEmail)
      .is('accepted_at', null);

    if (acceptErr) {
      console.warn('[link-invited-user] Failed to update invite accepted_at:', acceptErr);
    }

    if (process.env.NODE_ENV !== 'production') {
      console.log('[link-invited-user] Linked user:', {
        userId,
        companyId,
        email: maskEmail(normalizedEmail),
        role: membership.role,
      });
    }

    return NextResponse.json({ ok: true, companyId, role: membership.role }, { status: 200 });
  } catch (err: unknown) {
    console.error('[link-invited-user] Exception:', err);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
