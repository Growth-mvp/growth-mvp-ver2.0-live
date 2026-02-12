// /app/api/invites/accept/route.ts
import 'server-only';

export const runtime = 'nodejs';

import { NextResponse } from 'next/server';
import { createHash } from 'crypto';
import { getSupabaseAdmin } from '@/lib/supabaseAdmin';
import { getAuthUserIdFromBearer } from '@/lib/server/rbacGuard';
import type { Role } from '@/lib/rbac';

type Body = {
  token: string; // 平文のトークン
};

/**
 * トークンをSHA-256でハッシュ化（DB検索用）
 */
function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

/**
 * メール正規化（比較用）
 */
function normalizeEmail(e: string): string {
  return e.replace(/\u3000/g, ' ').trim().toLowerCase();
}

/**
 * 列が無い（42703）かどうかの簡易判定
 */
function looksMissingColumn(errOrResp: any, col: string): boolean {
  try {
    const code = errOrResp?.error?.code ?? errOrResp?.code ?? '';
    const msg = `${errOrResp?.error?.message ?? errOrResp?.message ?? ''} ${
      errOrResp?.error?.details ?? errOrResp?.details ?? ''
    }`
      .toLowerCase()
      .trim();

    return (
      code === '42703' ||
      msg.includes(col.toLowerCase()) ||
      (msg.includes('column') && msg.includes('does not exist'))
    );
  } catch {
    return false;
  }
}

const looksMissingDepartmentId = (e: any) => looksMissingColumn(e, 'department_id');

/**
 * role の優先度（昇格のみ許可したい場合に使用）
 * member < manager < admin
 */
const roleRank: Record<Role, number> = {
  member: 0,
  manager: 1,
  admin: 2,
};

function clampRole(r: any): Role {
  return r === 'admin' || r === 'manager' ? r : 'member';
}

export async function POST(req: Request) {
  try {
    const admin = getSupabaseAdmin();

    // 1) 認証チェック（ログイン必須 / Bearer）
    const userId = await getAuthUserIdFromBearer(admin, req);
    if (!userId) {
      return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
    }

    // 2) リクエストボディをパース
    let body: Body;
    try {
      body = (await req.json()) as Body;
    } catch {
      return NextResponse.json({ error: 'invalid_json' }, { status: 400 });
    }

    const token = body.token?.trim() || '';
    if (!token) {
      return NextResponse.json({ error: 'token_required' }, { status: 400 });
    }
    // ざっくり防衛（hex 64文字=32byte想定。違っても弾きたい）
    if (!/^[0-9a-f]{32,256}$/i.test(token)) {
      return NextResponse.json({ error: 'token_invalid_format' }, { status: 400 });
    }

    // 3) トークンをハッシュ化して招待を検索
    const tokenHash = hashToken(token);

    const { data: invite, error: findErr } = await admin
      .from('company_invites')
      .select('id, company_id, email, role, expires_at, accepted_at, accepted_by')
      .eq('token_hash', tokenHash)
      .maybeSingle();

    if (findErr) {
      console.error('[invites/accept] find failed:', findErr);
      return NextResponse.json(
        { error: 'invite_lookup_failed', detail: findErr.message },
        { status: 500 }
      );
    }

    // 4) 招待が見つからない
    if (!invite) {
      return NextResponse.json(
        { error: 'invite_not_found', detail: 'Invalid or expired token' },
        { status: 404 }
      );
    }

    // 5) 期限チェック
    if (new Date(invite.expires_at) < new Date()) {
      return NextResponse.json(
        { error: 'invite_expired', detail: 'This invitation has expired' },
        { status: 410 }
      );
    }

    // 6) 使用済みチェック
    if (invite.accepted_at) {
      return NextResponse.json(
        { error: 'invite_already_used', detail: 'This invitation has already been accepted' },
        { status: 410 }
      );
    }

    // 7) メール一致チェック（乗っ取り防止）
    const { data: authUser, error: authErr } = await admin.auth.admin.getUserById(userId);
    if (authErr || !authUser?.user) {
      console.error('[invites/accept] auth user lookup failed:', authErr);
      return NextResponse.json({ error: 'user_lookup_failed' }, { status: 500 });
    }

    const userEmail = normalizeEmail(authUser.user.email || '');
    const inviteEmail = normalizeEmail(invite.email || '');

    if (!userEmail || userEmail !== inviteEmail) {
      return NextResponse.json(
        {
          error: 'email_mismatch',
          detail: `This invitation is for ${inviteEmail}, but you are logged in as ${userEmail || '(no email)'}`,
        },
        { status: 403 }
      );
    }

    // 8) membership の role は「昇格のみ」許可（既存を勝手に上書きしない）
    const inviteRole = clampRole(invite.role);

    // 既存 membership を確認（存在すれば role の昇格判断）
    const { data: existing, error: exErr } = await admin
      .from('company_members')
      .select('company_id, user_id, role')
      .eq('company_id', invite.company_id)
      .eq('user_id', userId)
      .maybeSingle();

    if (exErr && exErr.code !== 'PGRST116') {
      // PGRST116: 0 rows は許容（maybeSingleの仕様）
      console.error('[invites/accept] membership lookup failed:', exErr);
      return NextResponse.json(
        { error: 'membership_lookup_failed', detail: exErr.message },
        { status: 500 }
      );
    }

    const existingRole: Role | null = existing?.role ? clampRole(existing.role) : null;
    const finalRole: Role =
      existingRole && roleRank[existingRole] >= roleRank[inviteRole] ? existingRole : inviteRole;

    // 9) company_members に upsert（department_id が無い環境にフォールバック）
    const { error: upsertErr } = await admin.from('company_members').upsert(
      [
        {
          company_id: invite.company_id,
          user_id: userId,
          role: finalRole,
          department_id: null,
        },
      ],
      { onConflict: 'company_id,user_id' }
    );

    if (upsertErr && looksMissingDepartmentId(upsertErr)) {
      const { error: upsertErr2 } = await admin.from('company_members').upsert(
        [
          {
            company_id: invite.company_id,
            user_id: userId,
            role: finalRole,
          },
        ],
        { onConflict: 'company_id,user_id' }
      );

      if (upsertErr2) {
        console.error('[invites/accept] upsert failed (no department_id):', upsertErr2);
        return NextResponse.json(
          { error: 'membership_creation_failed', detail: upsertErr2.message },
          { status: 500 }
        );
      }
    } else if (upsertErr) {
      console.error('[invites/accept] upsert failed:', upsertErr);
      return NextResponse.json(
        { error: 'membership_creation_failed', detail: upsertErr.message },
        { status: 500 }
      );
    }

    // 10) 招待を "accepted" にマーク（競合回避：accepted_at is null 条件）
    const nowIso = new Date().toISOString();
    const { data: upd, error: updateErr } = await admin
      .from('company_invites')
      .update({
        accepted_at: nowIso,
        accepted_by: userId,
      })
      .eq('id', invite.id)
      .is('accepted_at', null)
      .select('id')
      .maybeSingle();

    if (updateErr) {
      console.error('[invites/accept] update failed:', updateErr);
      // membership は成功しているので OK を返すが、ログで追えるようにする
      console.warn('[invites/accept] invite mark accepted failed, but membership is created');
    } else if (!upd?.id) {
      // 同時実行で先に消費された可能性
      return NextResponse.json(
        { error: 'invite_already_used', detail: 'This invitation has already been accepted' },
        { status: 410 }
      );
    }

    // 11) 成功
    return NextResponse.json({
      ok: true,
      companyId: invite.company_id,
      role: finalRole,
      email: userEmail,
    });
  } catch (e: any) {
    console.error('[invites/accept] failed:', e?.message || e);
    return NextResponse.json(
      { error: 'invite_acceptance_failed', detail: e?.message || 'unknown error' },
      { status: 500 }
    );
  }
}
