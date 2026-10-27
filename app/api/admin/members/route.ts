// /app/api/admin/members/route.ts
import 'server-only';
import { NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabaseAdmin';
import { getAuthUserIdFromBearer } from '@/lib/server/rbacGuard';
import { requireAdminMfa } from '@/lib/server/mfaGuard';
import { logAuditEvent, extractAuditMetadata } from '@/lib/server/auditLog';
import {
  assertCompanyAdmin,
  isUuid,
  removeCompanyMember,
} from '@/lib/server/companyAdmin';
import type { Role } from '@/lib/rbac';

type MemberItem = {
  userId: string;
  role: Role;
  departmentId: string | null;
  email?: string | null;
  name?: string | null;
};

/**
 * GET /api/admin/members?companyId=<companyId>
 * 指定した会社のメンバー一覧を取得（その会社の admin のみ）
 */
export async function GET(req: Request) {
  try {
    const admin = getSupabaseAdmin();

    const mfa = await requireAdminMfa(admin, req);
    if (!mfa.ok) return NextResponse.json({ error: mfa.error }, { status: mfa.status });

    const userId = await getAuthUserIdFromBearer(admin, req);
    if (!userId) {
      return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
    }

    const companyId = new URL(req.url).searchParams.get('companyId');
    if (!isUuid(companyId)) {
      return NextResponse.json({ error: 'invalid_params' }, { status: 400 });
    }

    const access = await assertCompanyAdmin(admin, userId, companyId);
    if (!access.ok) return NextResponse.json({ error: access.error }, { status: access.status });

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

/**
 * DELETE /api/admin/members?companyId=<companyId>&userId=<targetUserId>
 * 指定した会社からメンバーを削除する（その会社の admin のみ）。
 * Service Role で実行するため、会社の所属・権限・最後の管理者は API 側で検査する。
 */
export async function DELETE(req: Request) {
  try {
    const admin = getSupabaseAdmin();

    const mfa = await requireAdminMfa(admin, req);
    if (!mfa.ok) return NextResponse.json({ error: mfa.error }, { status: mfa.status });

    const userId = await getAuthUserIdFromBearer(admin, req);
    if (!userId) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

    const url = new URL(req.url);
    const companyId = url.searchParams.get('companyId');
    const targetUserId = url.searchParams.get('userId');
    if (!isUuid(companyId) || !isUuid(targetUserId)) {
      return NextResponse.json({ error: 'invalid_params' }, { status: 400 });
    }

    const access = await assertCompanyAdmin(admin, userId, companyId);
    if (!access.ok) return NextResponse.json({ error: access.error }, { status: access.status });

    const removed = await removeCompanyMember(admin, companyId, targetUserId);
    if (!removed.ok) {
      return NextResponse.json(
        removed.message ? { error: removed.error, message: removed.message } : { error: removed.error },
        { status: removed.status }
      );
    }

    const { ip, userAgent } = extractAuditMetadata(req);
    await logAuditEvent({
      companyId,
      actorUserId: userId,
      action: 'member_removed',
      targetType: 'member',
      targetId: targetUserId,
      before: { role: removed.role },
      ip,
      userAgent,
    });

    return NextResponse.json({ ok: true, message: 'Member removed successfully' });
  } catch (e: any) {
    console.error('[api/admin/members] DELETE failed:', e?.message || e);
    return NextResponse.json(
      { error: 'internal_error', detail: e?.message || 'unknown error' },
      { status: 500 }
    );
  }
}
