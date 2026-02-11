// /app/api/admin/invite/route.ts
import 'server-only';
import { NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabaseAdmin';
import {
  getAuthUserIdFromBearer,
  pickOneMembershipServer,
  assertMinRole,
} from '@/lib/server/rbacGuard';
import type { Role } from '@/lib/rbac';
type Body = {
  email: string;
  role?: Role;
  departmentId?: string | null;
  companyId?: string;
};

// --- ユーティリティ ---
function asRole(v: any): Role {
  return v === 'admin' || v === 'manager' || v === 'member' ? v : 'member';
}
function normalizeEmail(e: string): string {
  return e.replace(/\u3000/g, ' ').trim().toLowerCase();
}

/** 実行時のオリジンを安全に推定（★ ポート自動スライド対応） */
function resolveOrigin(req: Request): string {
  const h = new Headers(req.headers);
  const origin = h.get('origin');
  if (origin) return origin.replace(/\/+$/, '');

  const proto = h.get('x-forwarded-proto') || 'http';
  const host = h.get('x-forwarded-host') || h.get('host');
  if (host) return `${proto}://${host}`.replace(/\/+$/, '');

  return 'http://localhost:3000';
}

/** 指定列が無い（42703）かどうかの簡易判定 */
function looksMissingColumn(errOrResp: any, col: string) {
  try {
    const code = errOrResp?.error?.code ?? errOrResp?.code ?? '';
    const msg = `${errOrResp?.error?.message ?? errOrResp?.message ?? ''} ${
      errOrResp?.error?.details ?? errOrResp?.details ?? ''
    }`
      .toLowerCase()
      .trim();
    return code === '42703' || msg.includes(col.toLowerCase()) || (msg.includes('column') && msg.includes('does not exist'));
  } catch {
    return false;
  }
}
const looksMissingDepartmentId = (e: any) => looksMissingColumn(e, 'department_id');

export async function POST(req: Request) {
  try {
    const admin = getSupabaseAdmin();

    // 1) 認証チェック（Bearer トークン - rbacGuard統一）
    const callerId = await getAuthUserIdFromBearer(admin, req);
    if (!callerId) {
      return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
    }

    // 2) 入力パース
    let body: Body;
    try {
      body = (await req.json()) as Body;
    } catch {
      return NextResponse.json({ error: 'invalid_json' }, { status: 400 });
    }
    const email = normalizeEmail(body.email || '');
    if (!email) return NextResponse.json({ error: 'email_required' }, { status: 400 });
    const nextRole: Role = asRole(body.role);
    const departmentId = body.departmentId ?? null;

    // 3) companyId 解決 + admin チェック（複数所属対応）
    let companyId = body.companyId || null;
    let callerMembership: any = null;

    if (!companyId) {
      // 複数所属時の「既定 company」を正しく選択（pickOneMembershipServer使用）
      callerMembership = await pickOneMembershipServer(admin, callerId);
      if (!callerMembership?.companyId) {
        return NextResponse.json(
          { error: 'caller_company_not_found', detail: 'No membership found' },
          { status: 403 }
        );
      }
      companyId = callerMembership.companyId;
    } else {
      // 指定された companyId での membership を確認
      const chk = await admin
        .from('company_members')
        .select('company_id, role, department_id, user_id')
        .eq('company_id', companyId)
        .eq('user_id', callerId)
        .maybeSingle();
      if (chk.error || !chk.data?.company_id) {
        return NextResponse.json({ error: 'admin_only', detail: chk.error?.message }, { status: 403 });
      }
      callerMembership = {
        userId: chk.data.user_id,
        companyId: chk.data.company_id,
        role: chk.data.role as Role,
        departmentId: chk.data.department_id ?? null,
      };
    }

    // Admin 権限確認
    if (callerMembership.role !== 'admin') {
      return NextResponse.json({ error: 'admin_only' }, { status: 403 });
    }

    // 4) 既存ユーザー検索（auth.users は環境により不可の場合があるため try/catch で緩く）
    let existingUserId: string | null = null;
    try {
      const u = await admin.from('auth.users' as any).select('id').ilike('email', email).maybeSingle();
      if (!u.error && u.data?.id) existingUserId = String(u.data.id);
    } catch {}
    if (!existingUserId) {
      try {
        const p = await admin.from('profiles').select('id').ilike('email', email).maybeSingle();
        if (!p.error && p.data?.id) existingUserId = String(p.data.id);
      } catch {}
    }

    // 5) 既存ユーザーなら upsert（既に所属済みなら何もしない）
    if (existingUserId) {
      const exist = await admin
        .from('company_members')
        .select('user_id')
        .eq('company_id', companyId)
        .eq('user_id', existingUserId)
        .maybeSingle();
      if (!exist.error && exist.data?.user_id) {
        return NextResponse.json({ ok: true, added: false, invited: false, companyId });
      }

      // まず department_id ありで upsert を試行 → なければフォールバック
      let up = await admin
        .from('company_members')
        .upsert([{ company_id: companyId, user_id: existingUserId, role: nextRole, department_id: departmentId }], {
          onConflict: 'company_id,user_id',
        });
      if (up.error && looksMissingDepartmentId(up)) {
        up = await admin
          .from('company_members')
          .upsert([{ company_id: companyId, user_id: existingUserId, role: nextRole }], {
            onConflict: 'company_id,user_id',
          });
      }
      if (up.error) {
        console.error('❌ upsert_failed', up.error);
        return NextResponse.json({ error: 'upsert_failed', detail: up.error.message }, { status: 400 });
      }
      return NextResponse.json({ ok: true, added: true, invited: false, companyId });
    }

    // 6) 新規ユーザー → 招待メール or magic link
    const origin = resolveOrigin(req);
    const redirectTo = `${origin}/signup?company=${encodeURIComponent(companyId!)}`;

    // 招待メール
    try {
      const { error: inviteErr } = await admin.auth.admin.inviteUserByEmail(email, { redirectTo } as any);
      if (!inviteErr) {
        return NextResponse.json({ ok: true, added: false, invited: true, companyId });
      }
    } catch (e) {
      console.error('inviteUserByEmail failed', e);
    }

    // magic link（fallback）
    try {
      const { data: linkRes, error: linkErr } = await admin.auth.admin.generateLink({
        type: 'magiclink',
        email,
        redirectTo,
      } as any);
      if (linkErr || !linkRes?.properties?.action_link) {
        return NextResponse.json({ error: 'generate_link_failed', detail: linkErr?.message }, { status: 500 });
      }
      return NextResponse.json({
        ok: true,
        added: false,
        invited: false,
        inviteLink: linkRes.properties.action_link,
        companyId,
      });
    } catch (e: any) {
      console.error('generateLink failed', e);
      return NextResponse.json({ error: 'invite_failed', detail: e?.message }, { status: 500 });
    }
  } catch (e: any) {
    console.error('[admin/invite] failed:', e?.message || e);
    return NextResponse.json({ error: 'invite_failed', detail: e?.message || 'unknown error' }, { status: 500 });
  }
}
