// /app/api/invites/handoff/route.ts
import 'server-only';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

import { NextResponse } from 'next/server';
import { createHash } from 'crypto';
import { getSupabaseAdmin } from '@/lib/supabaseAdmin';
import {
  INVITE_COOKIE_MAX_AGE_SECONDS,
  clearInviteCookieHeader,
  inviteCookieHeader,
  isInviteTokenFormat,
} from '@/lib/server/inviteCookie';

const ACCEPT_PATH = '/invite/accept';

function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

function redirectTo(req: Request, query: string, cookieHeader: string) {
  const res = NextResponse.redirect(new URL(`${ACCEPT_PATH}${query}`, req.url), 303);
  res.headers.append('Set-Cookie', cookieHeader);
  res.headers.set('Cache-Control', 'no-store, max-age=0');
  return res;
}

/**
 * 招待リンクのトークンを HttpOnly Cookie へ移し、URL からは取り除く（303 で受諾画面へ戻す）。
 * トークンは URL・ログ・レスポンス本文に出さない。
 */
export async function GET(req: Request) {
  const token = (new URL(req.url).searchParams.get('token') || '').trim();

  if (!isInviteTokenFormat(token)) {
    return redirectTo(req, '?error=invalid_invite', clearInviteCookieHeader());
  }

  const admin = getSupabaseAdmin();
  try {
    const { data: invite, error } = await admin
      .from('company_invites')
      .select('expires_at, accepted_at')
      .eq('token_hash', hashToken(token))
      .maybeSingle();

    if (error || !invite || invite.accepted_at) {
      return redirectTo(req, '?error=invalid_invite', clearInviteCookieHeader());
    }

    const secondsLeft = (new Date(invite.expires_at).getTime() - Date.now()) / 1000;
    if (secondsLeft <= 0) {
      return redirectTo(req, '?error=invite_expired', clearInviteCookieHeader());
    }

    return redirectTo(
      req,
      '',
      inviteCookieHeader(token, Math.min(INVITE_COOKIE_MAX_AGE_SECONDS, secondsLeft))
    );
  } catch (e: unknown) {
    console.error('[invites/handoff] failed:', e instanceof Error ? e.name : 'unknown');
    return redirectTo(req, '?error=invalid_invite', clearInviteCookieHeader());
  }
}
