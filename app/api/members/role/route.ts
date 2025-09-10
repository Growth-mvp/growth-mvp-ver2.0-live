// /app/api/members/role/route.ts
import 'server-only';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

import { NextResponse } from 'next/server';
import getSupabaseAdmin from '@/lib/supabaseAdmin';
import type { SupabaseClient } from '@supabase/supabase-js';

function bearer(req: Request) {
  const h = req.headers.get('authorization') || req.headers.get('Authorization') || '';
  const m = /^Bearer\s+(.+)$/i.exec(h);
  return m ? m[1] : null;
}

export async function PATCH(req: Request) {
  let admin: SupabaseClient;
  try {
    admin = getSupabaseAdmin();
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || 'admin env missing' }, { status: 500 });
  }

  try {
    const token = bearer(req);
    if (!token) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const { data: ures, error: uerr } = await admin.auth.getUser(token);
    if (uerr || !ures?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    const me = ures.user;

    const body = await req.json().catch(() => ({}));
    const targetUserId: string | undefined = body?.targetUserId;
    const newRole: 'admin' | 'manager' | 'member' | undefined = body?.newRole;
    if (!targetUserId || !newRole) {
      return NextResponse.json({ error: 'invalid body' }, { status: 400 });
    }

    // 自分の所属＆権限
    const { data: mine, error: merr } = await admin
      .from('company_members')
      .select('company_id, role')
      .eq('user_id', me.id)
      .maybeSingle();
    if (merr) throw merr;
    if (!mine?.company_id) return NextResponse.json({ error: 'no company' }, { status: 403 });
    if (mine.role !== 'admin') return NextResponse.json({ error: 'forbidden' }, { status: 403 });

    const companyId = mine.company_id;

    // 変更対象が同じ会社のメンバーか確認
    const { data: target, error: terr } = await admin
      .from('company_members')
      .select('user_id, role')
      .eq('company_id', companyId)
      .eq('user_id', targetUserId)
      .maybeSingle();
    if (terr) throw terr;
    if (!target?.user_id) return NextResponse.json({ error: 'not found' }, { status: 404 });

    // ⚠️ 最後の admin を降格させない
    if (target.role === 'admin' && newRole !== 'admin') {
      const { count } = await admin
        .from('company_members')
        .select('*', { count: 'exact', head: true })
        .eq('company_id', companyId)
        .eq('role', 'admin');
      if ((count ?? 0) <= 1) {
        return NextResponse.json({ error: 'last_admin_cannot_be_downgraded' }, { status: 403 });
      }
    }

    // 更新
    const { error: uperr } = await admin
      .from('company_members')
      .update({ role: newRole })
      .eq('company_id', companyId)
      .eq('user_id', targetUserId);
    if (uperr) throw uperr;

    return NextResponse.json({ ok: true });
  } catch (e: any) {
    console.error('update role failed:', e?.message || e);
    return NextResponse.json({ error: e?.message || 'failed' }, { status: 500 });
  }
}
