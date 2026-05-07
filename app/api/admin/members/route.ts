// /app/api/admin/members/route.ts
import 'server-only';
import { NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabaseAdmin';
import { getAuthUserIdFromBearer } from '@/lib/server/rbacGuard';
import type { Role } from '@/lib/rbac';

type MemberItem = {
  userId: string;
  role: Role;
  departmentId: string | null;
  email?: string | null;
  name?: string | null;
};

/**
 * GET /api/admin/members
 * 会社のメンバー一覧を取得（admin のみ）
 *
 * 処理フロー：
 * 1) Bearer トークンから userId を抽出（認証）
 * 2) userId の company_members から admin である company を特定（複数所属の場合は limit(1)）
 * 3) その company のメンバー一覧を Service Role で取得（RLS 回避）
 *
 * Query param は使わず、認証済み userId から company_id をサーバ側で確定
 */
export async function GET(req: Request) {
  try {
    const admin = getSupabaseAdmin();

    // 1) Bearer から userId を抽出
    const userId = await getAuthUserIdFromBearer(admin, req);
    if (!userId) {
      return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
    }

    // 2) userId の所属から、admin である company を特定
    const { data: myMembership, error: myMemErr } = await admin
      .from('company_members')
      .select('company_id, role')
      .eq('user_id', userId)
      .eq('role', 'admin')
      .limit(1)
      .maybeSingle();

    if (myMemErr || !myMembership?.company_id) {
      console.warn('[api/admin/members] user is not admin of any company:', { myMemErr, myMembership });
      return NextResponse.json({ error: 'forbidden' }, { status: 403 });
    }

    const companyId = myMembership.company_id;
    console.log('[api/admin/members] fetching members for company:', companyId);

    // 3) メンバー一覧を取得（Service Role で RLS 回避）
    const { data: members, error: listErr } = await admin
      .from('company_members')
      .select('user_id, role, department_id')
      .eq('company_id', companyId);

    if (listErr) {
      console.warn('[api/admin/members] list with department_id failed, trying fallback:', listErr);
      // Fallback: department_id なし
      const { data: membersFallback, error: listErr2 } = await admin
        .from('company_members')
        .select('user_id, role')
        .eq('company_id', companyId);

      if (listErr2) {
        console.error('[api/admin/members] fallback list failed:', listErr2);
        return NextResponse.json(
          { error: 'list_failed', detail: listErr2.message },
          { status: 500 }
        );
      }

      // ★ auth.admin.listUsers() で全ユーザーを取得して usersById Map を作成
      const { data: usersData, error: usersError } = await admin.auth.admin.listUsers();

      if (usersError) {
        console.error('[api/admin/members] fallback listUsers error', usersError);
      }

      const usersById = new Map(
        (usersData?.users ?? []).map((u: any) => [
          u.id,
          {
            email: u.email ?? null,
            name:
              (u.user_metadata?.name as string | undefined) ??
              (u.user_metadata?.full_name as string | undefined) ??
              null,
          },
        ])
      );

      const items: MemberItem[] = (membersFallback || []).map((m: any) => {
        const authUser = usersById.get(m.user_id);
        return {
          userId: String(m.user_id),
          role: (m.role as Role) || 'member',
          departmentId: null,
          email: authUser?.email ?? null,
          name: authUser?.name ?? null,
        };
      });

      const response = NextResponse.json({ ok: true, members: items });
      response.headers.set('Cache-Control', 'no-store');
      return response;
    }

    // 4) 成功
    // ★ auth.admin.listUsers() で全ユーザーを取得して usersById Map を作成
    const { data: usersData, error: usersError } = await admin.auth.admin.listUsers();

    if (usersError) {
      console.error('[api/admin/members] listUsers error', usersError);
    }

    const usersById = new Map(
      (usersData?.users ?? []).map((u: any) => [
        u.id,
        {
          email: u.email ?? null,
          name:
            (u.user_metadata?.name as string | undefined) ??
            (u.user_metadata?.full_name as string | undefined) ??
            null,
        },
      ])
    );

    const items: MemberItem[] = (members || []).map((m: any) => {
      const authUser = usersById.get(m.user_id);
      return {
        userId: String(m.user_id),
        role: (m.role as Role) || 'member',
        departmentId: typeof m.department_id === 'string' ? m.department_id : null,
        email: authUser?.email ?? null,
        name: authUser?.name ?? null,
      };
    });

    console.log('[api/admin/members] success, returning', items.length, 'members', { items });
    const response = NextResponse.json({ ok: true, members: items });
    response.headers.set('Cache-Control', 'no-store');
    return response;
  } catch (e: any) {
    console.error('[api/admin/members] failed:', e?.message || e);
    return NextResponse.json(
      { error: 'internal_error', detail: e?.message || 'unknown error' },
      { status: 500 }
    );
  }
}
