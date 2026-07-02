// /app/api/admin/members/invite/route.ts
import 'server-only';

export const runtime = 'nodejs';

import { NextResponse } from 'next/server';
import { randomBytes, createHash } from 'crypto';
import { getSupabaseAdmin } from '@/lib/supabaseAdmin';
import { getAuthUserIdFromBearer } from '@/lib/server/rbacGuard';
import type { Role } from '@/lib/rbac';

type Body = {
  email: string;
  role?: Role;
};

// Token generation (same as /api/invites/create)
function generateInviteToken(): string {
  return randomBytes(32).toString('hex');
}

function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

// Email normalization (same as /api/invites/accept)
function normalizeEmail(e: string): string {
  return e.replace(/\u3000/g, ' ').trim().toLowerCase();
}

export async function POST(req: Request) {
  try {
    const admin = getSupabaseAdmin();

    // 1) Authentication check (Bearer token required)
    const callerId = await getAuthUserIdFromBearer(admin, req);
    if (!callerId) {
      console.error('[admin/members/invite] unauthorized - no bearer token');
      return NextResponse.json(
        {
          error: 'unauthorized',
          message: 'Bearer token is required and must be valid',
          detail: 'No valid authentication found in Authorization header',
        },
        { status: 401 }
      );
    }

    // 2) Parse request body
    let body: Body;
    try {
      body = (await req.json()) as Body;
    } catch (e: any) {
      console.error('[admin/members/invite] invalid json:', e?.message);
      return NextResponse.json(
        {
          error: 'invalid_json',
          message: 'Request body must be valid JSON',
          detail: e?.message || 'JSON parse failed',
        },
        { status: 400 }
      );
    }

    const email = normalizeEmail(body.email || '');
    if (!email) {
      console.error('[admin/members/invite] email missing:', { callerId });
      return NextResponse.json(
        {
          error: 'email_required',
          message: 'Email address is required',
          detail: 'Field "email" must be a non-empty string',
        },
        { status: 400 }
      );
    }

    const inviteRole: Role =
      body.role === 'admin' || body.role === 'manager' ? body.role : 'member';

    // 3) Resolve companyId and verify admin role
    const { data: membership, error: memErr } = await admin
      .from('company_members')
      .select('company_id, role')
      .eq('user_id', callerId)
      .eq('role', 'admin')
      .limit(1)
      .maybeSingle();

    if (memErr || !membership?.company_id) {
      console.error('[admin/members/invite] caller is not admin:', {
        callerId,
        error: memErr?.message,
      });
      return NextResponse.json(
        {
          error: 'admin_only',
          message: 'Only administrators can send invitations',
          detail: 'You must be an admin of a company to send invitations',
        },
        { status: 403 }
      );
    }

    const companyId = membership.company_id;

    // ✅ 修正A：NEXT_PUBLIC_APP_URL チェック、なければ request.nextUrl.origin から fallback
    const appUrl =
      process.env.NEXT_PUBLIC_APP_URL ||
      new URL(req.url).origin;

    console.log('[admin/members/invite] App URL resolved:', {
      configured: process.env.NEXT_PUBLIC_APP_URL,
      resolved: appUrl,
    });

    // 4) Handle duplicate invites
    // Strategy: Invalidate old unused invite and create new one
    const { data: existingInvite } = await admin
      .from('company_invites')
      .select('id, accepted_at')
      .eq('company_id', companyId)
      .eq('email', email)
      .is('accepted_at', null)
      .maybeSingle();

    if (existingInvite?.id) {
      console.log('[admin/members/invite] Invalidating old unused invite:', {
        inviteId: existingInvite.id,
        email,
        companyId,
      });

      // ✅ 修正B：Mark old invite as expired by setting expires_at to past
      const { error: updateErr } = await admin
        .from('company_invites')
        .update({ expires_at: new Date(0).toISOString() })
        .eq('id', existingInvite.id);

      if (updateErr) {
        console.error('[admin/members/invite] Failed to invalidate old invite:', {
          inviteId: existingInvite.id,
          error: updateErr.message,
          code: updateErr.code,
        });
        // 継続可能（新招待は作成される）だが、ログで追跡できるようにする
      }
    }

    // 5) Generate token and hash
    const token = generateInviteToken();
    const tokenHash = hashToken(token);

    // 6) Set expiration (7 days)
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);

    // 7) Insert invite record
    const { error: insertErr } = await admin
      .from('company_invites')
      .insert({
        company_id: companyId,
        email,
        role: inviteRole,
        token_hash: tokenHash,
        expires_at: expiresAt.toISOString(),
        created_by: callerId,
      });

    if (insertErr) {
      console.error('[admin/members/invite] insert failed:', {
        error: insertErr.message,
        code: insertErr.code,
        email,
        companyId,
      });
      return NextResponse.json(
        {
          error: 'invite_creation_failed',
          message: 'Failed to create invitation record',
          detail: insertErr.message,
        },
        { status: 500 }
      );
    }

    // 8) Generate our custom invite link (GROWTHSHIFT's own invite flow)
    // ⚠️ Important: We do NOT use Supabase's inviteUserByEmail because:
    //   - It sends the standard Supabase email with "Accept the invite" button
    //   - That button goes through Supabase's auth flow, not our custom /invite/accept flow
    //   - Users end up at /auth/welcome without company membership
    // ✅ Solution: Use our own invite token system only
    const inviteLink = `${appUrl}/invite/accept?token=${encodeURIComponent(token)}`;

    console.log('[admin/members/invite] Generated custom invite link:', {
      email,
      tokenHead: token.slice(0, 8),
      inviteLink: inviteLink.substring(0, 80) + '...',
    });

    // Note: Email sending should be handled separately via:
    // - A separate Supabase Edge Function with Resend/SendGrid
    // - Or admin manually shares the link
    // For now, we return the link and let admin choose how to send it

    console.log('[admin/members/invite] Invite link generated successfully:', {
      email,
      role: inviteRole,
      companyId,
      expiresAt: expiresAt.toISOString(),
      tokenHead: token.slice(0, 8),
    });

    // 9) Return success with the invite link
    // Admin can copy this link and send it via email, chat, or other means
    const responseBody = {
      ok: true,
      email,
      role: inviteRole,
      companyId,
      expiresAt: expiresAt.toISOString(),
      inviteLink,
      message: '招待リンクを生成しました。このリンクをメールなどで先方に共有してください。',
    };

    return NextResponse.json(responseBody, {
      status: 200,
      headers: { 'Cache-Control': 'no-store, max-age=0' },
    });
  } catch (e: any) {
    console.error('[admin/members/invite] failed:', e?.message || e);
    console.error('[admin/members/invite] Error stack:', e?.stack);

    // Try to clean up the created invite record if something goes wrong
    try {
      await admin
        .from('company_invites')
        .delete()
        .eq('token_hash', tokenHash)
        .throwOnError();
    } catch (cleanupErr: any) {
      console.warn('[admin/members/invite] Could not clean up failed invite record:', cleanupErr?.message);
    }

    return NextResponse.json(
      {
        error: 'invite_failed',
        message: 'Invitation process failed',
        detail: e?.message || 'unknown error',
      },
      { status: 500 }
    );
  }
}
