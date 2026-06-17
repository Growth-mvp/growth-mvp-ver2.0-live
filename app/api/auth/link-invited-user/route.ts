// /app/api/auth/link-invited-user/route.ts
import 'server-only';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

import { NextResponse, NextRequest } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabaseAdmin';
import { getAuthUserIdFromBearer } from '@/lib/server/rbacGuard';

export async function POST(req: NextRequest) {
  try {
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

    console.log('[link-invited-user] Linking company membership:', { userId, email });

    // company_invites テーブルから招待レコードを探す
    const { data: inviteRecord, error: inviteErr } = await admin
      .from('company_invites')
      .select('company_id, role')
      .eq('email', email.toLowerCase())
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
      console.warn('[link-invited-user] No valid invite found for email:', email);
      // 招待レコードがなくても処理を続行する（既に参加している可能性）
      return NextResponse.json({ ok: true, message: 'No invite record found' }, { status: 200 });
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
          email: email.toLowerCase(),
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
      .eq('email', email.toLowerCase())
      .is('accepted_at', null);

    if (acceptErr) {
      console.warn('[link-invited-user] Failed to update invite accepted_at:', acceptErr);
      // accepted_at 更新失敗でも continue（company_members は更新済み）
    }

    console.log('[link-invited-user] Successfully linked user:', {
      userId,
      companyId,
      email,
      role,
    });

    return NextResponse.json(
      { ok: true, companyId, role },
      { status: 200 }
    );
  } catch (err: any) {
    console.error('[link-invited-user] Exception:', err);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
