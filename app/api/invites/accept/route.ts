// /app/api/invites/accept/route.ts
import 'server-only';

export const runtime = 'nodejs';

import { NextResponse } from 'next/server';
import { createHash } from 'crypto';
import { getSupabaseAdmin } from '@/lib/supabaseAdmin';
import { getAuthUserIdFromBearer } from '@/lib/server/rbacGuard';
import type { Role } from '@/lib/rbac';
import { logAuditEvent, extractAuditMetadata } from '@/lib/server/auditLog';

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
    // ★ requireMembership は呼ばない（招待受諾前なので所属不要）
    const userId = await getAuthUserIdFromBearer(admin, req);
    if (!userId) {
      console.error('[invites/accept] unauthorized - no bearer token');
      return NextResponse.json(
        {
          error: 'unauthorized',
          message: 'Bearer token is required and must be valid',
          detail: 'No valid authentication found in Authorization header',
        },
        { status: 401 }
      );
    }

    // 2) リクエストボディをパース
    let body: Body;
    try {
      body = (await req.json()) as Body;
    } catch (e: any) {
      console.error('[invites/accept] invalid json:', e?.message);
      return NextResponse.json(
        {
          error: 'invalid_json',
          message: 'Request body must be valid JSON',
          detail: e?.message || 'JSON parse failed',
        },
        { status: 400 }
      );
    }

    const token = body.token?.trim() || '';
    if (!token) {
      console.error('[invites/accept] token missing:', { userId });
      return NextResponse.json(
        {
          error: 'token_required',
          message: 'Invitation token is required',
          detail: 'Field "token" must be a non-empty string',
        },
        { status: 400 }
      );
    }

    // ざっくり防衛（hex 64文字=32byte想定。違っても弾きたい）
    if (!/^[0-9a-f]{32,256}$/i.test(token)) {
      console.error('[invites/accept] token invalid format:', {
        userId,
        tokenHead: token.slice(0, 8),
      });
      return NextResponse.json(
        {
          error: 'token_invalid_format',
          message: 'Invitation token format is invalid',
          detail: 'Token must be a hex string (32-256 characters)',
        },
        { status: 400 }
      );
    }

    // 3) トークンをハッシュ化して招待を検索
    const tokenHash = hashToken(token);

    const { data: invite, error: findErr } = await admin
      .from('company_invites')
      .select('id, company_id, email, role, expires_at, accepted_at, accepted_by')
      .eq('token_hash', tokenHash)
      .maybeSingle();

    if (findErr) {
      console.error('[invites/accept] find failed:', {
        userId,
        tokenHead: token.slice(0, 8),
        error: findErr.message,
        code: findErr.code,
      });
      return NextResponse.json(
        {
          error: 'invite_lookup_failed',
          message: 'Failed to look up invitation',
          detail: findErr.message,
        },
        { status: 500 }
      );
    }

    // 4) 招待が見つからない
    if (!invite) {
      console.error('[invites/accept] invite not found:', {
        userId,
        tokenHead: token.slice(0, 8),
      });
      return NextResponse.json(
        {
          error: 'invite_not_found',
          message: 'Invitation not found',
          detail: 'The invitation token is invalid, expired, or already used',
        },
        { status: 404 }
      );
    }

    // 5) 期限チェック
    if (new Date(invite.expires_at) < new Date()) {
      console.error('[invites/accept] invite expired:', {
        userId,
        tokenHead: token.slice(0, 8),
        expiresAt: invite.expires_at,
      });
      return NextResponse.json(
        {
          error: 'invite_expired',
          message: 'Invitation has expired',
          detail: `This invitation expired on ${new Date(invite.expires_at).toISOString()}`,
        },
        { status: 410 }
      );
    }

    // 6) 使用済みチェック
    if (invite.accepted_at) {
      console.warn('[invites/accept] invite already used:', {
        userId,
        tokenHead: token.slice(0, 8),
        acceptedAt: invite.accepted_at,
        acceptedBy: invite.accepted_by,
      });
      return NextResponse.json(
        {
          error: 'invite_already_used',
          message: 'Invitation has already been accepted',
          detail: `This invitation was accepted on ${new Date(invite.accepted_at).toISOString()}`,
        },
        { status: 410 }
      );
    }

    // 7) メール一致チェック（乗っ取り防止）
    const { data: authUser, error: authErr } = await admin.auth.admin.getUserById(userId);
    if (authErr || !authUser?.user) {
      console.error('[invites/accept] auth user lookup failed:', {
        userId,
        tokenHead: token.slice(0, 8),
        error: authErr?.message,
      });
      return NextResponse.json(
        {
          error: 'user_lookup_failed',
          message: 'Failed to verify your account',
          detail: authErr?.message || 'Could not retrieve user information',
        },
        { status: 500 }
      );
    }

    const userEmail = normalizeEmail(authUser.user.email || '');
    const inviteEmail = normalizeEmail(invite.email || '');

    if (!userEmail || userEmail !== inviteEmail) {
      console.error('[invites/accept] email mismatch:', {
        userId,
        tokenHead: token.slice(0, 8),
        userEmail: userEmail || '(no email)',
        inviteEmail,
      });
      return NextResponse.json(
        {
          error: 'email_mismatch',
          message: 'Email address mismatch',
          detail: `This invitation is for ${inviteEmail}, but you are logged in as ${userEmail || '(no email)'}`,
        },
        { status: 403 }
      );
    }

    // ★ 既存ユーザーか新規ユーザーかを判定
    // 主判定：
    // 1. identities に email_password パターンがあるか → パスワード設定済み
    // 2. user_metadata に password_set_at フラグがあるか → パスワード設定済みの指標
    // 補助情報：
    // - created_at が1時間以内 → 招待メール経由で新規作成の可能性あり（ログ用）

    // identities をチェック（パスワード設定済みの確認）
    const emailIdentities = (authUser.user.identities || []).filter(
      (id) => id.provider === 'email'
    );
    const hasEmailPasswordIdentity = emailIdentities.some(
      (id) => id.identity_data?.['sign_in_method'] === 'password'
    );

    // user_metadata に独自フラグがあるか確認
    const hasPasswordInMetadata = !!authUser.user.user_metadata?.['password_set_at'];

    // ★ 主判定：email_password identity または password_set_at がある → パスワード設定済み
    const hasPassword = hasEmailPasswordIdentity || hasPasswordInMetadata;
    const needsPasswordSetup = !hasPassword;

    // 補助情報：created_at の1時間以内判定（ログ用）
    const userCreatedTime = new Date(authUser.user.created_at).getTime();
    const oneHourAgo = Date.now() - 60 * 60 * 1000;
    const isRecentlyCreated = userCreatedTime > oneHourAgo;

    console.log('[invites/accept] password status check:', {
      userId,
      hasPassword,
      hasEmailPasswordIdentity,
      hasPasswordInMetadata,
      needsPasswordSetup,
      createdAt: authUser.user.created_at,
      isRecentlyCreated,
      identitiesCount: (authUser.user.identities || []).length,
    });

    // 8) membership の role は「昇格のみ」許可（既存を勝手に上書きしない）
    const inviteRole = clampRole(invite.role);

    // 既存 membership を確認（存在すれば role の昇格判断）
    // ★ idempotent 対応：既存の membership が在った場合、role は保持（昇格のみ）
    const { data: existing, error: exErr } = await admin
      .from('company_members')
      .select('company_id, user_id, role')
      .eq('company_id', invite.company_id)
      .eq('user_id', userId)
      .maybeSingle();

    if (exErr && exErr.code !== 'PGRST116') {
      // PGRST116: 0 rows は許容（maybeSingleの仕様）
      console.error('[invites/accept] membership lookup failed:', {
        userId,
        tokenHead: token.slice(0, 8),
        companyId: invite.company_id,
        error: exErr.message,
        code: exErr.code,
      });
      return NextResponse.json(
        {
          error: 'membership_lookup_failed',
          message: 'Failed to check existing membership',
          detail: exErr.message,
        },
        { status: 500 }
      );
    }

    const existingRole: Role | null = existing?.role ? clampRole(existing.role) : null;
    const finalRole: Role =
      existingRole && roleRank[existingRole] >= roleRank[inviteRole] ? existingRole : inviteRole;

    console.log('[invites/accept] membership status:', {
      userId,
      companyId: invite.company_id,
      existing: !!existing,
      existingRole,
      inviteRole,
      finalRole,
    });

    // 9) company_members に upsert（department_id が無い環境にフォールバック）
    // ★ onConflict: 'company_id,user_id' で重複を許す（idempotent）
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
        console.error('[invites/accept] upsert failed (no department_id):', {
          error: upsertErr2.message,
          code: upsertErr2.code,
          userId,
          companyId: invite.company_id,
        });
        return NextResponse.json(
          { error: 'membership_creation_failed', detail: upsertErr2.message },
          { status: 500 }
        );
      }
    } else if (upsertErr) {
      console.error('[invites/accept] upsert failed:', {
        error: upsertErr.message,
        code: upsertErr.code,
        userId,
        companyId: invite.company_id,
      });
      return NextResponse.json(
        { error: 'membership_creation_failed', detail: upsertErr.message },
        { status: 500 }
      );
    }

    console.log('[invites/accept] membership upserted successfully:', {
      userId,
      companyId: invite.company_id,
      finalRole,
    });

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

    // 11) Audit logging
    const { ip, userAgent } = extractAuditMetadata(req);
    await logAuditEvent({
      companyId: invite.company_id,
      actorUserId: userId,
      action: 'invite_accepted',
      targetType: 'invite',
      targetId: invite.email,
      after: { email: userEmail, role: finalRole },
      ip,
      userAgent,
    });

    // 12) 成功
    return NextResponse.json({
      ok: true,
      companyId: invite.company_id,
      role: finalRole,
      email: userEmail,
      needsPasswordSetup,
    });
  } catch (e: any) {
    console.error('[invites/accept] failed:', e?.message || e);
    return NextResponse.json(
      { error: 'invite_acceptance_failed', detail: e?.message || 'unknown error' },
      { status: 500 }
    );
  }
}
