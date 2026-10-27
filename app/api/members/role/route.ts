// /app/api/members/role/route.ts
import 'server-only';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

import { NextResponse } from 'next/server';
import type { SupabaseClient } from '@supabase/supabase-js';
import { getSupabaseAdmin } from '@/lib/supabaseAdmin'; // ★ named import に修正
import { logAuditEvent, extractAuditMetadata } from '@/lib/server/auditLog';
import { requireAdminMfa } from '@/lib/server/mfaGuard';
import {
  assertCompanyAdmin,
  countOtherAdmins,
  findCompanyMember,
  isAppRole,
  isLastAdminViolation,
  isUuid,
} from '@/lib/server/companyAdmin';

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

    const mfa = await requireAdminMfa(admin, req);
    if (!mfa.ok) return NextResponse.json({ error: mfa.error }, { status: mfa.status });

    const { data: ures, error: uerr } = await admin.auth.getUser(token);
    if (uerr || !ures?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    const me = ures.user;

    const body = await req.json().catch(() => ({}));
    const companyId: unknown = body?.companyId;
    const targetUserId: unknown = body?.targetUserId;
    const newRole: unknown = body?.newRole;
    if (!isUuid(companyId) || !isUuid(targetUserId) || !isAppRole(newRole)) {
      return NextResponse.json({ error: 'invalid body' }, { status: 400 });
    }

    const access = await assertCompanyAdmin(admin, me.id, companyId);
    if (!access.ok) return NextResponse.json({ error: access.error }, { status: access.status });

    // 別会社のメンバーは、この会社の所属として見つからない
    const target = await findCompanyMember(admin, companyId, targetUserId);
    if (!target.ok) return NextResponse.json({ error: target.error }, { status: target.status });

    // 最後の admin を降格させない
    if (target.role === 'admin' && newRole !== 'admin') {
      const others = await countOtherAdmins(admin, companyId, targetUserId);
      if (others === null) return NextResponse.json({ error: 'admin_count_failed' }, { status: 503 });
      if (others === 0) {
        return NextResponse.json({ error: 'last_admin_cannot_be_downgraded' }, { status: 403 });
      }
    }

    const { error: uperr } = await admin
      .from('company_members')
      .update({ role: newRole })
      .eq('company_id', companyId)
      .eq('user_id', targetUserId);
    if (isLastAdminViolation(uperr)) {
      return NextResponse.json({ error: 'last_admin_cannot_be_downgraded' }, { status: 403 });
    }
    if (uperr) throw uperr;

    const { ip, userAgent } = extractAuditMetadata(req);
    await logAuditEvent({
      companyId,
      actorUserId: me.id,
      action: 'member_role_changed',
      targetType: 'member',
      targetId: targetUserId,
      before: { role: target.role },
      after: { role: newRole },
      ip,
      userAgent,
    });

    return NextResponse.json({ ok: true });
  } catch (e: any) {
    console.error('update role failed:', e?.message || e);
    return NextResponse.json({ error: e?.message || 'failed' }, { status: 500 });
  }
}
