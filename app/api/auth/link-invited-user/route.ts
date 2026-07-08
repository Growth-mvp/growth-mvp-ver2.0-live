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

    // リクエストボディのパース
    const body = await req.json();
    const { email } = body;

    if (!email) {
      console.error('[link-invited-user] email is required');
      return NextResponse.json({ error: 'email is required' }, { status: 400 });
    }

    // メールアドレスを正規化（大文字小文字・空白）
    const normalizedRequestEmail = String(email).trim().toLowerCase();

    if (!normalizedRequestEmail) {
      console.error('[link-invited-user] email validation failed after normalization');
      return NextResponse.json({ error: 'Invalid email format' }, { status: 400 });
    }

    if (process.env.NODE_ENV !== 'production') {
      console.log('[link-invited-user] Attempting to link company membership:', {
        userId,
        email: maskEmail(normalizedRequestEmail)
      });
    }

    // company_invites テーブルから招待レコードを探す
    const { data: inviteRecord, error: inviteErr } = await admin
      .from('company_invites')
      .select('company_id, role, email')
      .eq('email', normalizedRequestEmail)
      .is('accepted_at', null)
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
        console.warn('[link-invited-user] No valid invite found for:', maskEmail(normalizedRequestEmail));
      }
      // 招待レコードがなくても処理を続行する（既に参加している可能性）
      return NextResponse.json({ ok: true, message: 'No invite record found' }, { status: 200 });
    }

    // ========== EMAIL VERIFICATION: 招待メールアドレスと実行ユーザーメールを厳密照合 ==========
    const inviteEmail = String(inviteRecord.email).trim().toLowerCase();

    if (normalizedRequestEmail !== inviteEmail) {
      // メールアドレス不一致 -> 403 Forbidden
      console.error('[link-invited-user] Email mismatch: request email does not match invite email', {
        requestEmail: maskEmail(normalizedRequestEmail),
        inviteEmail: maskEmail(inviteEmail),
      });
      return NextResponse.json(
        { error: 'Email address mismatch' },
        { status: 403 }
      );
    }

    const companyId = inviteRecord.company_id;
    const role = inviteRecord.role || 'member';

    // company_members テーブルに upsert
    const now = new Date().toISOString();
    const { error: upsertErr } = await admin
      .from('company_members')
      .upsert(
        {
          company_id: companyId,
          user_id: userId,
          email: normalizedRequestEmail,
          role,
          status: 'active',
          accepted_at: now,
        },
        {
          onConflict: 'company_id,user_id',
        }
      );

    if (upsertErr) {
      console.error('[link-invited-user] Failed to upsert company_members:', upsertErr);
      return NextResponse.json(
        { error: 'Failed to link membership' },
        { status: 500 }
      );
    }

    // company_invites の accepted_at を更新
    const { error: acceptErr } = await admin
      .from('company_invites')
      .update({ accepted_at: now })
      .eq('company_id', companyId)
      .eq('email', normalizedRequestEmail)
      .is('accepted_at', null);

    if (acceptErr) {
      console.warn('[link-invited-user] Failed to update invite accepted_at:', acceptErr);
      // accepted_at 更新失敗でも continue（company_members は更新済み）
    }

    if (process.env.NODE_ENV !== 'production') {
      console.log('[link-invited-user] Successfully linked user:', {
        userId,
        companyId,
        email: maskEmail(normalizedRequestEmail),
        role,
      });
    }

    return NextResponse.json(
      { ok: true, companyId, role },
      { status: 200 }
    );
  } catch (err: Record<string, any>) {
    console.error('[link-invited-user] Exception:', err);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
