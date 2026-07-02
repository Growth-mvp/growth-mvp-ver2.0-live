// /app/api/invites/info/route.ts
import 'server-only';

export const runtime = 'nodejs';

import { NextResponse } from 'next/server';
import { createHash } from 'crypto';
import { getSupabaseAdmin } from '@/lib/supabaseAdmin';

function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

export async function GET(req: Request) {
  const admin = getSupabaseAdmin();

  try {
    // 1) Get token from query string
    const { searchParams } = new URL(req.url);
    const token = searchParams.get('token');

    if (!token) {
      console.error('[invites/info] token missing');
      return NextResponse.json(
        {
          error: 'token_required',
          message: 'Token is required',
        },
        { status: 400 }
      );
    }

    const tokenHash = hashToken(token);

    console.log('[invites/info] Looking up invite:', {
      tokenHead: token.slice(0, 8),
    });

    // 2) Look up invite by token hash
    const { data: invite, error: lookupErr } = await admin
      .from('company_invites')
      .select('id, email, company_id, role, expires_at, accepted_at, created_by')
      .eq('token_hash', tokenHash)
      .maybeSingle();

    if (lookupErr || !invite) {
      console.error('[invites/info] invite not found:', {
        tokenHead: token.slice(0, 8),
        error: lookupErr?.message,
      });
      return NextResponse.json(
        {
          error: 'invite_not_found',
          message: '招待が見つかりません',
        },
        { status: 404 }
      );
    }

    // 3) Check if already used
    if (invite.accepted_at) {
      console.warn('[invites/info] invite already used:', {
        inviteId: invite.id,
      });
      return NextResponse.json(
        {
          error: 'invite_already_used',
          message: 'この招待は既に使用されています',
        },
        { status: 400 }
      );
    }

    // 4) Check if expired
    const now = new Date();
    const expiresAt = new Date(invite.expires_at);
    if (now > expiresAt) {
      console.warn('[invites/info] invite expired:', {
        inviteId: invite.id,
        expiresAt: invite.expires_at,
      });
      return NextResponse.json(
        {
          error: 'invite_expired',
          message: '招待の有効期限が切れています',
        },
        { status: 400 }
      );
    }

    // 5) Get company name
    const { data: company, error: compErr } = await admin
      .from('companies')
      .select('id, name')
      .eq('id', invite.company_id)
      .maybeSingle();

    if (compErr || !company) {
      console.warn('[invites/info] company not found:', {
        companyId: invite.company_id,
        error: compErr?.message,
      });
      // 継続可能：会社名なしで返す
    }

    console.log('[invites/info] Found valid invite:', {
      inviteId: invite.id,
      inviteEmail: invite.email,
      companyId: invite.company_id,
      role: invite.role,
    });

    // 6) Return invite info
    return NextResponse.json(
      {
        ok: true,
        email: invite.email,
        companyId: invite.company_id,
        companyName: company?.name || '(会社情報取得失敗)',
        role: invite.role,
        expiresAt: invite.expires_at,
        inviteId: invite.id,
      },
      {
        status: 200,
        headers: { 'Cache-Control': 'no-store, max-age=0' },
      }
    );
  } catch (e: any) {
    console.error('[invites/info] failed:', e?.message || e);
    console.error('[invites/info] Error stack:', e?.stack);

    return NextResponse.json(
      {
        error: 'invite_lookup_failed',
        message: 'Invite lookup failed',
        detail: e?.message || 'unknown error',
      },
      { status: 500 }
    );
  }
}
