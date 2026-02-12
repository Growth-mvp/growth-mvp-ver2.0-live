// /app/api/invites/create/route.ts
import 'server-only';

export const runtime = 'nodejs';

import { NextResponse } from 'next/server';
import { randomBytes, createHash } from 'crypto';
import { getSupabaseAdmin } from '@/lib/supabaseAdmin';
import {
  getAuthUserIdFromBearer,
  pickOneMembershipServer,
} from '@/lib/server/rbacGuard';
import type { Role } from '@/lib/rbac';

type Body = {
  email: string;
  role?: Role;
  companyId?: string;
};

/**
 * 招待トークンを生成（32 byte = 256 bit のランダム値）
 * トークンは平文で返す、ハッシュ値をDBに保存する
 */
function generateInviteToken(): string {
  return randomBytes(32).toString('hex');
}

/**
 * トークンをSHA-256でハッシュ化（DB保存用）
 */
function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

/**
 * メールアドレスを正規化（lowercase + whitespace trim）
 */
function normalizeEmail(e: string): string {
  return e.replace(/\u3000/g, ' ').trim().toLowerCase();
}

/**
 * オリジンを推定（リクエストヘッダから）
 */
function resolveOrigin(req: Request): string {
  const h = new Headers(req.headers);
  const origin = h.get('origin');
  if (origin) return origin.replace(/\/+$/, '');

  const proto = h.get('x-forwarded-proto') || 'http';
  const host = h.get('x-forwarded-host') || h.get('host');
  if (host) return `${proto}://${host}`.replace(/\/+$/, '');

  return process.env.NEXT_PUBLIC_SITE_URL?.replace(/\/+$/, '') || 'http://localhost:3000';
}

/**
 * 招待URLを生成
 */
function generateInviteUrl(origin: string, token: string): string {
  return `${origin}/invite/accept?token=${encodeURIComponent(token)}`;
}

export async function POST(req: Request) {
  try {
    const admin = getSupabaseAdmin();

    // 1) 認証チェック（Bearer トークン）
    const callerId = await getAuthUserIdFromBearer(admin, req);
    if (!callerId) {
      return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
    }

    // 2) リクエストボディをパース
    let body: Body;
    try {
      body = (await req.json()) as Body;
    } catch {
      return NextResponse.json({ error: 'invalid_json' }, { status: 400 });
    }

    const email = normalizeEmail(body.email || '');
    if (!email) {
      return NextResponse.json({ error: 'email_required' }, { status: 400 });
    }

    const nextRole: Role =
      body.role === 'admin' || body.role === 'manager' ? body.role : 'member';

    // 3) companyId を解決 & admin チェック
    let companyId = body.companyId || null;

    if (!companyId) {
      const membership = await pickOneMembershipServer(admin, callerId);
      if (!membership?.companyId) {
        return NextResponse.json(
          { error: 'caller_company_not_found', detail: 'No membership found' },
          { status: 403 }
        );
      }
      companyId = membership.companyId;
    } else {
      // 指定された companyId での membership を確認（adminのみ）
      const chk = await admin
        .from('company_members')
        .select('company_id, role')
        .eq('company_id', companyId)
        .eq('user_id', callerId)
        .maybeSingle();

      if (chk.error || !chk.data?.company_id) {
        return NextResponse.json(
          { error: 'admin_only', detail: chk.error?.message },
          { status: 403 }
        );
      }

      if (chk.data.role !== 'admin') {
        return NextResponse.json({ error: 'admin_only' }, { status: 403 });
      }
    }

    // 4) トークン生成 & ハッシュ化
    const token = generateInviteToken();
    const tokenHash = hashToken(token);

    // 5) 招待の有効期限（7日間）
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);

    // 6) company_invites テーブルに insert
    const { error: insertErr } = await admin
      .from('company_invites')
      .insert({
        company_id: companyId,
        email,
        role: nextRole,
        token_hash: tokenHash,
        expires_at: expiresAt.toISOString(),
        created_by: callerId,
      });

    if (insertErr) {
      console.error('[invites/create] insert failed:', insertErr);
      console.error('[INVITE_TOKEN_ERROR] Failed to create invite token for:', email);

      // token_hash unique など
      if (insertErr.code === '23505' || insertErr.message?.toLowerCase().includes('duplicate')) {
        return NextResponse.json(
          { error: 'invite_already_exists', detail: `${email} はすでに招待されています` },
          { status: 409 }
        );
      }

      return NextResponse.json(
        { error: 'invite_creation_failed', detail: insertErr.message },
        { status: 500 }
      );
    }

    // 7) 招待URLを生成
    const origin = resolveOrigin(req);
    const inviteUrl = generateInviteUrl(origin, token);

    console.log('[INVITE_TOKEN_CREATED] New invitation created:', {
      email,
      role: nextRole,
      companyId,
      expiresAt: expiresAt.toISOString(),
    });

    return NextResponse.json({
      ok: true,
      inviteUrl,
      email,
      role: nextRole,
      expiresAt: expiresAt.toISOString(),
      companyId,
    });
  } catch (e: any) {
    console.error('[invites/create] failed:', e?.message || e);
    return NextResponse.json(
      { error: 'invite_failed', detail: e?.message || 'unknown error' },
      { status: 500 }
    );
  }
}
