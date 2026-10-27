// /app/api/invites/clear/route.ts
import 'server-only';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

import { NextResponse } from 'next/server';
import { clearInviteCookieHeader, isSameOriginJsonRequest } from '@/lib/server/inviteCookie';

const NO_STORE = { 'Cache-Control': 'no-store, max-age=0' };

/** ログアウト時などに招待 Cookie を消す。同一オリジンの JSON 要求だけを受け付ける。 */
export async function POST(req: Request) {
  if (!isSameOriginJsonRequest(req)) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403, headers: NO_STORE });
  }

  const res = NextResponse.json({ ok: true }, { status: 200, headers: NO_STORE });
  res.headers.append('Set-Cookie', clearInviteCookieHeader());
  return res;
}
