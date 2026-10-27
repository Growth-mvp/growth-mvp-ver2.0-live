// /app/api/invites/complete/route.ts
import 'server-only';

export const runtime = 'nodejs';

import { NextResponse } from 'next/server';
import { createHash } from 'crypto';
import { getSupabaseAdmin } from '@/lib/supabaseAdmin';
import { getAuthenticatedUserIdWithVerification } from '@/lib/authUtils';
import { findAuthUserByEmail, AuthUserLookupError } from '@/lib/server/authUsers';

type Body = {
  token?: string;
  password?: string;
  email?: string;
};

type Invite = {
  id: string;
  email: string;
  company_id: string;
  role: string;
  expires_at: string;
  accepted_at: string | null;
  accepted_by: string | null;
};

type Admin = ReturnType<typeof getSupabaseAdmin>;

const NO_STORE = { 'Cache-Control': 'no-store, max-age=0' };

function json(body: unknown, status: number) {
  return NextResponse.json(body, { status, headers: NO_STORE });
}

function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

function normalizeEmail(e: string): string {
  return e.replace(/　/g, ' ').trim().toLowerCase();
}

function hasBearer(req: Request): boolean {
  return /^bearer\s+\S+/i.test(req.headers.get('authorization') || '');
}

async function markInviteAccepted(admin: Admin, inviteId: string, userId: string) {
  const { error } = await admin
    .from('company_invites')
    .update({ accepted_at: new Date().toISOString(), accepted_by: userId })
    .eq('id', inviteId)
    .is('accepted_at', null);

  if (error) {
    console.warn('[invites/complete] failed to mark invite accepted:', { inviteId, code: error.code });
  }
}

/** 認証済みユーザーとして招待を受諾する（本人メール一致・メール確認済みが必須） */
async function acceptForSignedInUser(admin: Admin, invite: Invite, inviteEmail: string, callerId: string) {
  if (invite.accepted_at) {
    if (invite.accepted_by === callerId) {
      return json({ ok: true, companyId: invite.company_id, role: invite.role }, 200);
    }
    return json({ error: 'invite_already_used', message: 'この招待は既に使用されています' }, 400);
  }

  if (new Date() > new Date(invite.expires_at)) {
    return json({ error: 'invite_expired', message: '招待の有効期限が切れています' }, 400);
  }

  const { data: authRes, error: authErr } = await admin.auth.admin.getUserById(callerId);
  const user = authRes?.user;
  if (authErr || !user) {
    return json({ error: 'unauthorized' }, 401);
  }

  if (normalizeEmail(user.email ?? '') !== inviteEmail) {
    return json({ error: 'email_mismatch', message: 'メールアドレスが一致しません' }, 403);
  }

  if (!user.email_confirmed_at) {
    return json({ error: 'email_not_confirmed', message: 'メールアドレスの確認が完了していません' }, 403);
  }

  const { error: memberErr } = await admin
    .from('company_members')
    .insert({ company_id: invite.company_id, user_id: callerId, role: invite.role });

  if (memberErr) {
    console.error('[invites/complete] membership insert failed:', { code: memberErr.code });
    return json({ error: 'membership_creation_failed', message: 'メンバーシップの作成に失敗しました' }, 500);
  }

  await markInviteAccepted(admin, invite.id, callerId);
  return json({ ok: true, companyId: invite.company_id, role: invite.role }, 200);
}

/**
 * 未ログインの経路。アカウントが無ければ作成して所属を作る。
 * 既存アカウントには何もしない。応答は既存・新規で同一にし、アカウントの有無を漏らさない。
 */
async function setupAccountWithoutSession(admin: Admin, invite: Invite, inviteEmail: string, password: string | undefined) {
  if (!password) {
    return json({ error: 'invalid_request', message: 'Password is required' }, 400);
  }

  let existing;
  try {
    existing = await findAuthUserByEmail(admin, inviteEmail);
  } catch (e) {
    const reason = e instanceof AuthUserLookupError ? e.message : 'unknown';
    console.error('[invites/complete] user lookup failed:', { reason });
    return json({ error: 'account_setup_failed', message: 'アカウントの確認に失敗しました。時間をおいて再度お試しください' }, 500);
  }

  if (!existing) {
    const { data: created, error: createErr } = await admin.auth.admin.createUser({
      email: inviteEmail,
      password,
      email_confirm: true,
    });

    if (createErr || !created?.user?.id) {
      console.error('[invites/complete] createUser failed:', { code: createErr?.code });
      return json({ error: 'account_setup_failed', message: 'アカウントの作成に失敗しました' }, 500);
    }

    const newUserId = created.user.id;
    const { error: memberErr } = await admin
      .from('company_members')
      .insert({ company_id: invite.company_id, user_id: newUserId, role: invite.role });

    if (memberErr) {
      console.error('[invites/complete] membership insert failed:', { code: memberErr.code });
      try {
        await admin.auth.admin.deleteUser(newUserId);
      } catch (cleanupErr: unknown) {
        console.warn('[invites/complete] could not clean up user:', cleanupErr instanceof Error ? cleanupErr.message : 'unknown');
      }
      return json({ error: 'membership_creation_failed', message: 'メンバーシップの作成に失敗しました' }, 500);
    }

    await markInviteAccepted(admin, invite.id, newUserId);
  }

  return json({ ok: true, next: 'login' }, 200);
}

export async function POST(req: Request) {
  const admin = getSupabaseAdmin();

  try {
    let body: Body;
    try {
      body = (await req.json()) as Body;
    } catch {
      return json({ error: 'invalid_json', message: 'Request body must be valid JSON' }, 400);
    }

    const token = (body.token ?? '').trim();
    if (!token) {
      return json({ error: 'invalid_request', message: 'Token is required' }, 400);
    }

    const { data: invite, error: lookupErr } = await admin
      .from('company_invites')
      .select('id, email, company_id, role, expires_at, accepted_at, accepted_by')
      .eq('token_hash', hashToken(token))
      .maybeSingle();

    if (lookupErr || !invite) {
      return json(
        { error: 'invite_not_found', message: '招待が見つかりません', detail: '無効または削除されている可能性があります' },
        404
      );
    }

    const inviteEmail = normalizeEmail(invite.email);

    if (body.email && normalizeEmail(body.email) !== inviteEmail) {
      return json({ error: 'email_mismatch', message: 'メールアドレスが一致しません' }, 400);
    }

    if (hasBearer(req)) {
      const callerId = await getAuthenticatedUserIdWithVerification(req);
      if (!callerId) {
        return json({ error: 'unauthorized' }, 401);
      }
      return acceptForSignedInUser(admin, invite as Invite, inviteEmail, callerId);
    }

    if (invite.accepted_at) {
      return json({ error: 'invite_already_used', message: 'この招待は既に使用されています' }, 400);
    }

    if (new Date() > new Date(invite.expires_at)) {
      return json({ error: 'invite_expired', message: '招待の有効期限が切れています' }, 400);
    }

    return setupAccountWithoutSession(admin, invite as Invite, inviteEmail, body.password);
  } catch (e: unknown) {
    console.error('[invites/complete] failed:', e instanceof Error ? e.message : 'unknown');
    return json({ error: 'invite_failed', message: 'Invitation completion failed' }, 500);
  }
}
