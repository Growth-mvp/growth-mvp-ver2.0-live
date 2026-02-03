// /app/api/_diag/whoami/route.ts
import { NextResponse } from 'next/server';
import { cookies, headers } from 'next/headers';
import { createClient } from '@supabase/supabase-js';

type WhoamiResponse = {
  ok: boolean;
  audit: {
    authUserId: string | null;
    membershipCompanyId: string | null;
    cookieCompanyId: string | null;
    effectiveCompanyId: string | null;
  };
  notes: string[];
};

function maskUuid(u: string | null) {
  if (!u) return null;
  return u.slice(0, 8) + '***';
}

export async function GET() {
  const notes: string[] = [];

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !serviceKey) {
    return NextResponse.json<WhoamiResponse>(
      {
        ok: false,
        audit: {
          authUserId: null,
          membershipCompanyId: null,
          cookieCompanyId: null,
          effectiveCompanyId: null,
        },
        notes: ['missing env: NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY'],
      },
      { status: 500 }
    );
  }

  const h = await headers();
const authz = h.get('authorization') || '';
const bearer = authz.toLowerCase().startsWith('bearer ') ? authz.slice(7) : null;

  // Bearer トークン必須（誤診防止）
  if (!bearer) {
    return NextResponse.json<WhoamiResponse>(
      {
        ok: false,
        audit: {
          authUserId: null,
          membershipCompanyId: null,
          cookieCompanyId: null,
          effectiveCompanyId: null,
        },
        notes: ['missing authorization bearer token'],
      },
      { status: 401 }
    );
  }

// cookieのcompany_id（補助）
const cookieStore = await cookies();
const cookieCompanyId = cookieStore.get('company_id')?.value ?? null;

  // サーバ側でユーザーを特定
  let authUserId: string | null = null;

  const admin = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false } });

  const { data, error } = await admin.auth.getUser(bearer);
  if (error) {
    notes.push(`auth.getUser failed: ${error.message}`);
  } else {
    authUserId = data.user?.id ?? null;
  }

  // membership.company_id を引く（service roleで引くが、user_idで絞る）
  let membershipCompanyId: string | null = null;
  if (authUserId) {
    const { data, error } = await admin
      .from('company_members')
      .select('company_id')
      .eq('user_id', authUserId)
      .maybeSingle();

    if (error) {
      notes.push(`company_members query failed: ${error.message}`);
    } else {
      membershipCompanyId = (data?.company_id as string | undefined) ?? null;
    }
  }

  const effectiveCompanyId = membershipCompanyId; // ルール：membershipのみを正とする

  if (cookieCompanyId && membershipCompanyId && cookieCompanyId !== membershipCompanyId) {
    notes.push(
      `cookie company_id (${maskUuid(cookieCompanyId)}) != membership company_id (${maskUuid(
        membershipCompanyId
      )})`
    );
  }

  return NextResponse.json<WhoamiResponse>({
    ok: true,
    audit: {
      authUserId: maskUuid(authUserId),
      membershipCompanyId: maskUuid(membershipCompanyId),
      cookieCompanyId: maskUuid(cookieCompanyId),
      effectiveCompanyId: maskUuid(effectiveCompanyId),
    },
    notes,
  });
}
