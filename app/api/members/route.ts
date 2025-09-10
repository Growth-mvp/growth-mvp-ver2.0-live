// /app/api/members/route.ts
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

type AppRole = 'admin' | 'manager' | 'member';

/* ========================================================
 * GET: 所属会社のメンバー一覧
 * ====================================================== */
export async function GET(req: Request) {
  let admin: SupabaseClient;
  try {
    admin = getSupabaseAdmin();
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || 'admin env missing' }, { status: 500 });
  }

  try {
    const token = bearer(req);
    if (!token) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const { data: ures } = await admin.auth.getUser(token);
    if (!ures?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    const me = ures.user;

    const { data: mine } = await admin
      .from('company_members')
      .select('company_id, role')
      .eq('user_id', me.id)
      .maybeSingle();
    if (!mine?.company_id) return NextResponse.json({ error: 'no company' }, { status: 403 });

    const companyId: string = mine.company_id;
    const myRole = (mine.role as AppRole) ?? 'member';

    const { data: members, error: lerr } = await admin
      .from('company_members')
      .select('user_id, role')
      .eq('company_id', companyId);
    if (lerr) throw lerr;

    const payload = (members ?? []).map((m: any) => ({
      user_id: String(m.user_id),
      role: (m.role as AppRole) ?? 'member',
    }));

    return NextResponse.json({ companyId, myRole, members: payload });
  } catch (e: any) {
    console.error('members list failed:', e?.message || e);
    return NextResponse.json({ error: e?.message || 'failed' }, { status: 500 });
  }
}

/* ========================================================
 * POST: メンバー追加（既存ユーザーを追加）
 * body: { targetUserId: string, role: AppRole, departmentId?: string }
 * ====================================================== */
export async function POST(req: Request) {
  let admin: SupabaseClient;
  try {
    admin = getSupabaseAdmin();
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || 'admin env missing' }, { status: 500 });
  }

  try {
    const token = bearer(req);
    if (!token) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const { data: ures } = await admin.auth.getUser(token);
    if (!ures?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    const me = ures.user;

    const { data: mine } = await admin
      .from('company_members')
      .select('company_id, role')
      .eq('user_id', me.id)
      .maybeSingle();
    if (!mine?.company_id) return NextResponse.json({ error: 'no company' }, { status: 403 });
    if (mine.role !== 'admin') return NextResponse.json({ error: 'forbidden' }, { status: 403 });

    const companyId: string = mine.company_id;

    const body = await req.json().catch(() => ({}));
    const targetUserId: string | undefined = body?.targetUserId;
    const role: AppRole = body?.role || 'member';
    const departmentId: string | null = body?.departmentId ?? null;
    if (!targetUserId) return NextResponse.json({ error: 'invalid body' }, { status: 400 });

    const { error: upErr } = await admin
      .from('company_members')
      .upsert([{ company_id: companyId, user_id: targetUserId, role, department_id: departmentId }], {
        onConflict: 'company_id,user_id',
      });
    if (upErr) throw upErr;

    return NextResponse.json({ ok: true });
  } catch (e: any) {
    console.error('add member failed:', e?.message || e);
    return NextResponse.json({ error: e?.message || 'failed' }, { status: 500 });
  }
}

/* ========================================================
 * DELETE: メンバー削除
 * body: { targetUserId: string }
 * ====================================================== */
export async function DELETE(req: Request) {
  let admin: SupabaseClient;
  try {
    admin = getSupabaseAdmin();
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || 'admin env missing' }, { status: 500 });
  }

  try {
    const token = bearer(req);
    if (!token) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const { data: ures } = await admin.auth.getUser(token);
    if (!ures?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    const me = ures.user;

    const { data: mine } = await admin
      .from('company_members')
      .select('company_id, role')
      .eq('user_id', me.id)
      .maybeSingle();
    if (!mine?.company_id) return NextResponse.json({ error: 'no company' }, { status: 403 });
    if (mine.role !== 'admin') return NextResponse.json({ error: 'forbidden' }, { status: 403 });

    const companyId: string = mine.company_id;

    const body = await req.json().catch(() => ({}));
    const targetUserId: string | undefined = body?.targetUserId;
    if (!targetUserId) return NextResponse.json({ error: 'invalid body' }, { status: 400 });
    if (targetUserId === me.id) return NextResponse.json({ error: 'cannot_remove_self' }, { status: 400 });

    // 最後の admin を削除できないように保護
    const { data: target } = await admin
      .from('company_members')
      .select('role')
      .eq('company_id', companyId)
      .eq('user_id', targetUserId)
      .maybeSingle();
    if (target?.role === 'admin') {
      const { count } = await admin
        .from('company_members')
        .select('*', { count: 'exact', head: true })
        .eq('company_id', companyId)
        .eq('role', 'admin');
      if ((count ?? 0) <= 1) {
        return NextResponse.json({ error: 'last_admin_cannot_be_removed' }, { status: 403 });
      }
    }

    const { error: delErr } = await admin
      .from('company_members')
      .delete()
      .eq('company_id', companyId)
      .eq('user_id', targetUserId);
    if (delErr) throw delErr;

    return NextResponse.json({ ok: true });
  } catch (e: any) {
    console.error('delete member failed:', e?.message || e);
    return NextResponse.json({ error: e?.message || 'failed' }, { status: 500 });
  }
}
