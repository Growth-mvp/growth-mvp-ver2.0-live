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
import { resendSignupConfirmation } from '@/lib/server/signupConfirmation';
import { isInviteMailAllowed, recordInviteMail } from '@/lib/server/inviteMailLimit';

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
type ExistingUser = { id: string; email_confirmed_at?: string | null };
type CreateResult = { status: 'created'; actionLink: string } | { status: 'exists' } | { status: 'error' };

const NO_STORE = { 'Cache-Control': 'no-store, max-age=0' };
const CONFIRM_NEXT = '/invite/accept';

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

function hasBearer(req: Request): boolean {
  return /^bearer\s+\S+/i.test(req.headers.get('authorization') || '');
}

function siteOrigin(req: Request): string {
  return (process.env.NEXT_PUBLIC_SITE_URL || new URL(req.url).origin).replace(/\/$/, '');
}

function confirmRedirectUrl(req: Request): string {
  return `${siteOrigin(req)}/auth/callback?next=${encodeURIComponent(CONFIRM_NEXT)}`;
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

async function lookupExisting(admin: Admin, inviteEmail: string): Promise<ExistingUser | null | 'error'> {
  try {
    return (await findAuthUserByEmail(admin, inviteEmail)) as ExistingUser | null;
  } catch (e) {
    const reason = e instanceof AuthUserLookupError ? e.message : 'unknown';
    console.error('[invites/complete] user lookup failed:', { reason });
    return 'error';
  }
}

/** 確認済みの既存ユーザー：アカウントは変えず、ログインを促す通知メールだけ送る */
async function sendNotice(req: Request, admin: Admin, invite: Invite, inviteEmail: string) {
  const loginUrl = `${siteOrigin(req)}/login?redirect_to=${encodeURIComponent(CONFIRM_NEXT)}`;
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
  await recordInviteMail(invite.id, 'notice');
  return respond({ ok: true, next: 'check_email' }, 200);
}

/**
 * 未確認の既存アカウント：アカウントもパスワードも変えず、Supabase 標準の確認メールを再送する。
 * 再送時に入力されたパスワードは使わない（初回登録時のパスワードを維持する）。
 * 再送の上限（Supabase 側）に達した場合も、応答は同一にする。
 */
async function resendForUnconfirmed(req: Request, invite: Invite, inviteEmail: string) {
  const result = await resendSignupConfirmation(inviteEmail, confirmRedirectUrl(req));
  if (result === 'failed') {
    return respond({ error: 'mail_failed', message: '確認メールを送信できませんでした。時間をおいて再度お試しください' }, 500);
  }
  if (result === 'sent') {
    await recordInviteMail(invite.id, 'resend');
  }
  return respond({ ok: true, next: 'check_email' }, 200);
}

async function createUnconfirmedAccount(admin: Admin, email: string, password: string, redirectTo: string): Promise<CreateResult> {
  const { data, error } = await admin.auth.admin.generateLink({
    type: 'signup',
    email,
    password,
    options: { redirectTo },
  });

  if (error) {
    const { code, status, message } = error as { code?: string; status?: number; message?: string };
    if (code === 'user_already_exists' || status === 422 || /already/i.test(message ?? '')) {
      return { status: 'exists' };
    }
    console.error('[invites/complete] signup link generation failed:', { code, status });
    return { status: 'error' };
  }

  const actionLink = data?.properties?.action_link;
  return actionLink ? { status: 'created', actionLink } : { status: 'error' };
}

/**
 * 未ログインの経路。応答は既存・新規で同一にし、アカウントの有無を漏らさない。
 * - 新規: 未確認のアカウントを作り、確認リンクを送る。所属はまだ作らない。
 * - 未確認の既存: パスワードは変えず、確認メールを再送する（削除・再作成もしない）。
 * - 確認済みの既存: アカウントは変えず、ログインを促す通知メールを送る。
 */
async function sendConfirmationOrNotice(req: Request, admin: Admin, invite: Invite, inviteEmail: string, password: string | undefined) {
  if (!password) {
    return respond({ error: 'invalid_request', message: 'Password is required' }, 400);
  }

  if (!(await isInviteMailAllowed(admin, invite.id))) {
    console.warn('[invites/complete] mail rate limited');
    return respond({ ok: true, next: 'check_email' }, 200);
  }

  const existing = await lookupExisting(admin, inviteEmail);
  if (existing === 'error') {
    return respond({ error: 'account_setup_failed', message: 'アカウントの確認に失敗しました。時間をおいて再度お試しください' }, 500);
  }
  if (existing?.email_confirmed_at) {
    return sendNotice(req, admin, invite, inviteEmail);
  }
  if (existing) {
    return resendForUnconfirmed(req, invite, inviteEmail);
  }

  const created = await createUnconfirmedAccount(admin, inviteEmail, password, confirmRedirectUrl(req));

  if (created.status === 'exists') {
    // 同時に別の要求が作成した場合。作成済みの状態に合わせて続ける
    const again = await lookupExisting(admin, inviteEmail);
    if (!again || again === 'error') {
      return respond({ error: 'account_setup_failed', message: 'アカウントの確認に失敗しました。時間をおいて再度お試しください' }, 500);
    }
    if (again.email_confirmed_at) {
      return sendNotice(req, admin, invite, inviteEmail);
    }
    return resendForUnconfirmed(req, invite, inviteEmail);
  }

  if (created.status === 'error') {
    return respond({ error: 'account_setup_failed', message: 'アカウントの作成に失敗しました' }, 500);
  }

  // 送信に失敗しても未確認アカウントは残す。再試行は上の「未確認の既存」の経路で再送される
  const sent = await sendInviteMail({
    to: inviteEmail,
    subject: 'GROWTH SHIFT：メールアドレスの確認',
    text:
      'GROWTH SHIFT の会社への招待を受け入れるため、メールアドレスの確認をお願いします。\n\n' +
      `下記のリンクを開くと確認が完了し、招待の受け入れに進みます。\n${created.actionLink}\n\n` +
      '心当たりがない場合は、このメールを無視してください。',
  });
  if (!sent) {
    return respond({ error: 'mail_failed', message: '確認メールを送信できませんでした。時間をおいて再度お試しください' }, 500);
  }

  await recordInviteMail(invite.id, 'signup');
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

    return sendConfirmationOrNotice(req, admin, typedInvite, inviteEmail, body.password);
  } catch (e: unknown) {
    console.error('[invites/complete] failed:', e instanceof Error ? e.name : 'unknown');
    return respond({ error: 'invite_failed', message: 'Invitation completion failed' }, 500);
  }
}
