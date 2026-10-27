// /app/api/invites/complete/route.ts
import 'server-only';

export const runtime = 'nodejs';

import { NextResponse } from 'next/server';
import { createHash } from 'crypto';
import { getSupabaseAdmin } from '@/lib/supabaseAdmin';
import { getAuthenticatedUserIdWithVerification } from '@/lib/authUtils';
import { findAuthUserByEmail, AuthUserLookupError } from '@/lib/server/authUsers';
import { readInviteCookie, clearInviteCookieHeader, isSameOriginJsonRequest } from '@/lib/server/inviteCookie';
import { sendInviteMail } from '@/lib/server/inviteMail';

type Body = {
  password?: string;
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

function respond(body: unknown, status: number, opts: { clearCookie?: boolean } = {}) {
  const res = NextResponse.json(body, { status, headers: NO_STORE });
  if (opts.clearCookie) res.headers.append('Set-Cookie', clearInviteCookieHeader());
  return res;
}

function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

function normalizeEmail(e: string): string {
  return e.replace(/　/g, ' ').trim().toLowerCase();
}

const JUST_CREATED_WINDOW_MS = 5 * 60 * 1000;

/** 今この処理で作られた、確認前のアカウントかどうか（既存ユーザーを削除しないための条件） */
function isJustCreatedUnconfirmed(
  user: { id?: string; email?: string | null; created_at?: string; email_confirmed_at?: string | null },
  inviteEmail: string
): boolean {
  if (!user.id || !user.created_at) return false;
  if (user.email_confirmed_at) return false;
  if (normalizeEmail(user.email ?? '') !== inviteEmail) return false;
  const age = Date.now() - Date.parse(user.created_at);
  return age >= 0 && age < JUST_CREATED_WINDOW_MS;
}

function hasBearer(req: Request): boolean {
  return /^bearer\s+\S+/i.test(req.headers.get('authorization') || '');
}

function siteOrigin(req: Request): string {
  return (process.env.NEXT_PUBLIC_SITE_URL || new URL(req.url).origin).replace(/\/$/, '');
}

async function readBody(req: Request): Promise<Body> {
  try {
    return (await req.json()) as Body;
  } catch {
    return {};
  }
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

/** メール確認済みの本人として受諾する（所属はここで初めて作る） */
async function acceptForSignedInUser(admin: Admin, invite: Invite, inviteEmail: string, callerId: string) {
  const { data: authRes, error: authErr } = await admin.auth.admin.getUserById(callerId);
  const user = authRes?.user;
  if (authErr || !user) {
    return respond({ error: 'unauthorized' }, 401);
  }

  if (normalizeEmail(user.email ?? '') !== inviteEmail) {
    return respond({ error: 'email_mismatch', message: 'メールアドレスが一致しません' }, 403);
  }

  if (!user.email_confirmed_at) {
    return respond({ error: 'email_not_confirmed', message: 'メールアドレスの確認が完了していません' }, 403);
  }

  // 既存所属者の再実行で 500 にしない（既存行は変更しない）
  const { error: memberErr } = await admin.from('company_members').upsert(
    { company_id: invite.company_id, user_id: callerId, role: invite.role },
    { onConflict: 'company_id,user_id', ignoreDuplicates: true }
  );

  if (memberErr) {
    console.error('[invites/complete] membership upsert failed:', { code: memberErr.code });
    return respond({ error: 'membership_creation_failed', message: 'メンバーシップの作成に失敗しました' }, 500);
  }

  const { data: membership, error: readErr } = await admin
    .from('company_members')
    .select('role')
    .eq('company_id', invite.company_id)
    .eq('user_id', callerId)
    .maybeSingle();

  if (readErr || !membership) {
    console.error('[invites/complete] membership read failed:', { code: readErr?.code });
    return respond({ error: 'membership_creation_failed', message: 'メンバーシップの作成に失敗しました' }, 500);
  }

  await markInviteAccepted(admin, invite.id, callerId);
  return respond({ ok: true, companyId: invite.company_id, role: membership.role }, 200, { clearCookie: true });
}

/**
 * 未ログインの経路。
 * 新規: アカウントは作るがメール確認までは所属を作らない。確認メール（Supabase 標準の確認リンク）を送る。
 * 既存: アカウントは変更しない。ログインを促す通知メールを送る。
 * 応答は既存・新規で同一にし、アカウントの有無を漏らさない。
 */
async function sendConfirmationOrNotice(
  req: Request,
  admin: Admin,
  inviteEmail: string,
  password: string | undefined
) {
  if (!password) {
    return respond({ error: 'invalid_request', message: 'Password is required' }, 400);
  }

  let existing;
  try {
    existing = await findAuthUserByEmail(admin, inviteEmail);
  } catch (e) {
    const reason = e instanceof AuthUserLookupError ? e.message : 'unknown';
    console.error('[invites/complete] user lookup failed:', { reason });
    return respond({ error: 'account_setup_failed', message: 'アカウントの確認に失敗しました。時間をおいて再度お試しください' }, 500);
  }

  const site = siteOrigin(req);
  const next = encodeURIComponent('/invite/accept');
  const loginUrl = `${site}/login?redirect_to=${next}`;

  if (existing) {
    const sent = await sendInviteMail({
      to: inviteEmail,
      subject: 'GROWTH SHIFT：会社への招待が届いています',
      text:
        'GROWTH SHIFT から会社への招待が届いています。\n\n' +
        `既存のアカウントでログインすると、招待を受け入れられます。\n${loginUrl}\n\n` +
        '心当たりがない場合は、このメールを無視してください。',
    });
    if (!sent) {
      return respond({ error: 'mail_failed', message: '確認メールを送信できませんでした。時間をおいて再度お試しください' }, 500);
    }
    return respond({ ok: true, next: 'check_email' }, 200);
  }

  const { data, error } = await admin.auth.admin.generateLink({
    type: 'signup',
    email: inviteEmail,
    password,
    options: { redirectTo: `${site}/auth/callback?next=${next}` },
  });
  const actionLink = data?.properties?.action_link;
  if (error || !actionLink) {
    console.error('[invites/complete] signup link generation failed:', { code: error?.code });
    return respond({ error: 'account_setup_failed', message: 'アカウントの作成に失敗しました' }, 500);
  }

  const sent = await sendInviteMail({
    to: inviteEmail,
    subject: 'GROWTH SHIFT：メールアドレスの確認',
    text:
      'GROWTH SHIFT の会社への招待を受け入れるため、メールアドレスの確認をお願いします。\n\n' +
      `下記のリンクを開くと確認が完了し、招待の受け入れに進みます。\n${actionLink}\n\n` +
      '心当たりがない場合は、このメールを無視してください。',
  });

  if (!sent) {
    // 今回の呼び出しで作られた未確認アカウントだけを削除する（既存ユーザーは対象外）
    const createdUser = data?.user;
    if (createdUser && isJustCreatedUnconfirmed(createdUser, inviteEmail)) {
      try {
        await admin.auth.admin.deleteUser(createdUser.id);
      } catch (cleanupErr: unknown) {
        console.warn('[invites/complete] could not clean up unsent account:', cleanupErr instanceof Error ? cleanupErr.name : 'unknown');
      }
    }
    return respond({ error: 'mail_failed', message: '確認メールを送信できませんでした。時間をおいて再度お試しください' }, 500);
  }

  return respond({ ok: true, next: 'check_email' }, 200);
}

export async function POST(req: Request) {
  if (!isSameOriginJsonRequest(req)) {
    return respond({ error: 'forbidden' }, 403);
  }

  const admin = getSupabaseAdmin();

  try {
    const token = readInviteCookie(req);
    if (!token) {
      return respond({ error: 'invite_not_found', message: '招待情報が見つかりません。招待リンクを開き直してください' }, 404);
    }

    const body = await readBody(req);

    const { data: invite, error: lookupErr } = await admin
      .from('company_invites')
      .select('id, email, company_id, role, expires_at, accepted_at, accepted_by')
      .eq('token_hash', hashToken(token))
      .maybeSingle();

    if (lookupErr || !invite) {
      return respond({ error: 'invite_not_found', message: '招待が見つかりません' }, 404, { clearCookie: true });
    }

    const typedInvite = invite as Invite;
    const inviteEmail = normalizeEmail(typedInvite.email);

    const callerId = hasBearer(req) ? await getAuthenticatedUserIdWithVerification(req) : null;
    if (hasBearer(req) && !callerId) {
      return respond({ error: 'unauthorized' }, 401);
    }

    if (typedInvite.accepted_at) {
      if (callerId && typedInvite.accepted_by === callerId) {
        return respond({ ok: true, companyId: typedInvite.company_id, role: typedInvite.role }, 200, { clearCookie: true });
      }
      return respond({ error: 'invite_already_used', message: 'この招待は既に使用されています' }, 400, { clearCookie: true });
    }

    if (new Date() > new Date(typedInvite.expires_at)) {
      return respond({ error: 'invite_expired', message: '招待の有効期限が切れています' }, 400, { clearCookie: true });
    }

    if (callerId) {
      return acceptForSignedInUser(admin, typedInvite, inviteEmail, callerId);
    }

    return sendConfirmationOrNotice(req, admin, inviteEmail, body.password);
  } catch (e: unknown) {
    console.error('[invites/complete] failed:', e instanceof Error ? e.name : 'unknown');
    return respond({ error: 'invite_failed', message: 'Invitation completion failed' }, 500);
  }
}
