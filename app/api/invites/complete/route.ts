// /app/api/invites/complete/route.ts
import 'server-only';

export const runtime = 'nodejs';

import { NextResponse } from 'next/server';
import { createHash } from 'crypto';
import { getSupabaseAdmin } from '@/lib/supabaseAdmin';

type Body = {
  token: string;
  password: string;
  email?: string;
};

function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

function normalizeEmail(e: string): string {
  return e.replace(/　/g, ' ').trim().toLowerCase();
}

export async function POST(req: Request) {
  const admin = getSupabaseAdmin();

  try {
    // 1) Parse request body
    let body: Body;
    try {
      body = (await req.json()) as Body;
    } catch (e: any) {
      console.error('[invites/complete] invalid json:', e?.message);
      return NextResponse.json(
        {
          error: 'invalid_json',
          message: 'Request body must be valid JSON',
          detail: e?.message || 'JSON parse failed',
        },
        { status: 400 }
      );
    }

    const { token, password, email } = body;
    const tokenHash = hashToken(token);

    console.log('[invites/complete] Processing invite completion:', {
      tokenHead: (token ?? '').slice(0, 8),
      hasPassword: !!password,
      hasEmail: !!email,
    });

    // 2) Validate token and password
    if (!token || !password) {
      console.error('[invites/complete] missing token or password');
      return NextResponse.json(
        {
          error: 'invalid_request',
          message: 'Token and password are required',
        },
        { status: 400 }
      );
    }

    // 3) Look up invite by token hash
    const { data: invite, error: lookupErr } = await admin
      .from('company_invites')
      .select('id, email, company_id, role, expires_at, accepted_at')
      .eq('token_hash', tokenHash)
      .maybeSingle();

    if (lookupErr || !invite) {
      console.error('[invites/complete] invite not found:', {
        tokenHead: (token ?? '').slice(0, 8),
        error: lookupErr?.message,
      });
      return NextResponse.json(
        {
          error: 'invite_not_found',
          message: '招待が見つかりません',
          detail: '無効または削除されている可能性があります',
        },
        { status: 404 }
      );
    }

    // 4) Check if already used
    if (invite.accepted_at) {
      console.warn('[invites/complete] invite already used:', {
        inviteId: invite.id,
        acceptedAt: invite.accepted_at,
      });
      return NextResponse.json(
        {
          error: 'invite_already_used',
          message: 'この招待は既に使用されています',
        },
        { status: 400 }
      );
    }

    // 5) Check if expired
    const now = new Date();
    const expiresAt = new Date(invite.expires_at);
    if (now > expiresAt) {
      console.warn('[invites/complete] invite expired:', {
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

    // 6) Email mismatch check (if email provided)
    const inviteEmail = normalizeEmail(invite.email);
    if (email) {
      const providedEmail = normalizeEmail(email);
      if (providedEmail !== inviteEmail) {
        console.warn('[invites/complete] email mismatch:', {
          inviteId: invite.id,
          inviteEmail,
          providedEmail,
        });
        return NextResponse.json(
          {
            error: 'email_mismatch',
            message: 'メールアドレスが一致しません',
            detail: `招待は ${inviteEmail} に送信されています`,
          },
          { status: 400 }
        );
      }
    }

    // 7) Check if user already exists
    const { data: existingUser } = await admin.auth.admin.listUsers();
    const userExists = existingUser?.users?.some(
      (u) => normalizeEmail(u.email || '') === inviteEmail
    );

    console.log('[invites/complete] User check:', {
      inviteId: invite.id,
      inviteEmail,
      userExists,
    });

    let userId: string;

    if (userExists) {
      // 既存ユーザー：メールアドレスから user_id を取得
      const { data: users } = await admin.auth.admin.listUsers();
      const user = users?.users?.find(
        (u) => normalizeEmail(u.email || '') === inviteEmail
      );

      if (!user?.id) {
        console.error('[invites/complete] existing user not found:', {
          inviteEmail,
        });
        return NextResponse.json(
          {
            error: 'user_not_found',
            message: 'ユーザーが見つかりません',
          },
          { status: 500 }
        );
      }

      userId = user.id;
      console.log('[invites/complete] Using existing user:', {
        userId,
        inviteEmail,
      });
    } else {
      // 新規ユーザー：作成してパスワード設定
      try {
        const { data: newUser, error: createErr } = await admin.auth.admin.createUser({
          email: inviteEmail,
          password: password,
          email_confirm: true,
        });

        if (createErr || !newUser?.user?.id) {
          console.error('[invites/complete] failed to create user:', {
            inviteEmail,
            error: createErr?.message,
          });
          return NextResponse.json(
            {
              error: 'user_creation_failed',
              message: 'ユーザーの作成に失敗しました',
              detail: createErr?.message || 'auth service error',
            },
            { status: 500 }
          );
        }

        userId = newUser.user.id;
        console.log('[invites/complete] Created new user:', {
          userId,
          inviteEmail,
        });
      } catch (err: any) {
        console.error('[invites/complete] exception creating user:', {
          inviteEmail,
          error: err?.message,
        });
        return NextResponse.json(
          {
            error: 'user_creation_failed',
            message: 'ユーザーの作成に失敗しました',
            detail: err?.message || 'auth service error',
          },
          { status: 500 }
        );
      }
    }

    // 8) Create company membership
    const { error: memberErr } = await admin.from('company_members').insert({
      user_id: userId,
      company_id: invite.company_id,
      role: invite.role,
      // department_id は null または undefined で OK
    });

    if (memberErr) {
      console.error('[invites/complete] failed to create membership:', {
        userId,
        companyId: invite.company_id,
        error: memberErr.message,
        code: memberErr.code,
      });

      // 新規ユーザー作成に失敗した場合は、作成したユーザーを削除
      if (!userExists) {
        try {
          await admin.auth.admin.deleteUser(userId);
          console.log('[invites/complete] cleaned up user after membership failure:', { userId });
        } catch (cleanupErr: any) {
          console.warn('[invites/complete] could not clean up user:', cleanupErr?.message);
        }
      }

      return NextResponse.json(
        {
          error: 'membership_creation_failed',
          message: 'メンバーシップの作成に失敗しました',
          detail: memberErr.message,
        },
        { status: 500 }
      );
    }

    console.log('[invites/complete] Created membership:', {
      userId,
      companyId: invite.company_id,
      role: invite.role,
    });

    // 9) Mark invite as accepted
    const now_iso = new Date().toISOString();
    const { error: acceptErr } = await admin
      .from('company_invites')
      .update({ accepted_at: now_iso })
      .eq('id', invite.id);

    if (acceptErr) {
      console.warn('[invites/complete] failed to mark invite as accepted:', {
        inviteId: invite.id,
        error: acceptErr.message,
      });
      // 継続可能だが、ログで追跡
    }

    console.log('[invites/complete] Invite completed successfully:', {
      inviteId: invite.id,
      userId,
      companyId: invite.company_id,
      isNewUser: !userExists,
    });

    // 10) Return success
    return NextResponse.json(
      {
        ok: true,
        userId,
        companyId: invite.company_id,
        email: inviteEmail,
        role: invite.role,
        isNewUser: !userExists,
      },
      {
        status: 200,
        headers: { 'Cache-Control': 'no-store, max-age=0' },
      }
    );
  } catch (e: any) {
    console.error('[invites/complete] failed:', e?.message || e);
    console.error('[invites/complete] Error stack:', e?.stack);

    return NextResponse.json(
      {
        error: 'invite_failed',
        message: 'Invitation completion failed',
        detail: e?.message || 'unknown error',
      },
      { status: 500 }
    );
  }
}
