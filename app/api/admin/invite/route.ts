// /app/api/admin/invite/route.ts
import 'server-only';
import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SERVICE_ROLE = process.env.SUPABASE_SERVICE_ROLE_KEY!;

type Role = 'admin' | 'manager' | 'member';
type Body = {
  email: string;
  role?: Role;
  departmentId?: string | null;
  companyId?: string;
};

// --- ユーティリティ ---
function asRole(v: any): Role {
  return v === 'admin' || v === 'manager' || v === 'member' ? v : 'member';
}
function normalizeEmail(e: string): string {
  return e.replace(/\u3000/g, ' ').trim().toLowerCase();
}

/** 実行時のオリジンを安全に推定（★ ポート自動スライド対応） */
function resolveOrigin(req: Request): string {
  // 1) ブラウザ/クライアントが送ってくる Origin を最優先
  const h = new Headers(req.headers);
  const origin = h.get('origin');
  if (origin) return origin.replace(/\/+$/, '');

  // 2) プロキシ経由（Vercel など）も考慮
  const proto = h.get('x-forwarded-proto') || 'http';
  const host = h.get('x-forwarded-host') || h.get('host');
  if (host) return `${proto}://${host}`.replace(/\/+$/, '');

  // 3) ローカル開発のフォールバック（3000 を既定）
  return 'http://localhost:3000';
}

export async function POST(req: Request) {
  if (!SUPABASE_URL || !SERVICE_ROLE) {
    return NextResponse.json({ error: 'server_not_configured' }, { status: 500 });
  }
  const admin = createClient(SUPABASE_URL, SERVICE_ROLE, { auth: { persistSession: false } });

  // 1) 認証チェック（Bearer トークン）
  const auth = req.headers.get('authorization') || '';
  const token = auth.toLowerCase().startsWith('bearer ') ? auth.slice(7) : null;
  if (!token) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const { data: userRes, error: getUserErr } = await admin.auth.getUser(token);
  if (getUserErr || !userRes?.user) {
    return NextResponse.json({ error: 'invalid_token' }, { status: 401 });
  }
  const callerId = userRes.user.id;

  // 2) 入力パース
  let body: Body;
  try {
    body = (await req.json()) as Body;
  } catch {
    return NextResponse.json({ error: 'invalid_json' }, { status: 400 });
  }
  const email = normalizeEmail(body.email || '');
  if (!email) return NextResponse.json({ error: 'email_required' }, { status: 400 });
  const nextRole: Role = asRole(body.role);
  const departmentId = body.departmentId ?? null;

  // 3) companyId 解決 + admin チェック
  let companyId = body.companyId || null;
  if (!companyId) {
    const q = await admin
      .from('company_members')
      .select('company_id, role')
      .eq('user_id', callerId)
      .maybeSingle();
    if (q.error || !q.data?.company_id) {
      return NextResponse.json({ error: 'caller_company_not_found' }, { status: 403 });
    }
    if (q.data.role !== 'admin') {
      return NextResponse.json({ error: 'admin_only' }, { status: 403 });
    }
    companyId = q.data.company_id as string;
  } else {
    const chk = await admin
      .from('company_members')
      .select('role')
      .eq('company_id', companyId)
      .eq('user_id', callerId)
      .maybeSingle();
    if (chk.error || chk.data?.role !== 'admin') {
      return NextResponse.json({ error: 'admin_only' }, { status: 403 });
    }
  }

  // 4) 既存ユーザー検索（auth.users は環境により不可の場合があるため try/catch で緩く）
  let existingUserId: string | null = null;
  try {
    // 環境により auth.users は PostgREST 経由で読めない場合あり
    const u = await admin.from('auth.users' as any).select('id').ilike('email', email).maybeSingle();
    if (!u.error && u.data?.id) existingUserId = String(u.data.id);
  } catch {}
  if (!existingUserId) {
    try {
      const p = await admin.from('profiles').select('id').ilike('email', email).maybeSingle();
      if (!p.error && p.data?.id) existingUserId = String(p.data.id);
    } catch {}
  }

  // 5) 既存ユーザーなら upsert（既に所属済みなら何もしない）
  if (existingUserId) {
    const exist = await admin
      .from('company_members')
      .select('user_id')
      .eq('company_id', companyId)
      .eq('user_id', existingUserId)
      .maybeSingle();
    if (!exist.error && exist.data?.user_id) {
      return NextResponse.json({ ok: true, added: false, invited: false, companyId });
    }

    const up = await admin
      .from('company_members')
      .upsert(
        [{ company_id: companyId, user_id: existingUserId, role: nextRole, department_id: departmentId }],
        { onConflict: 'company_id,user_id' }
      );
    if (up.error) {
      console.error('❌ upsert_failed', up.error);
      return NextResponse.json({ error: 'upsert_failed', detail: up.error.message }, { status: 400 });
    }
    return NextResponse.json({ ok: true, added: true, invited: false, companyId });
  }

  // 6) 新規ユーザー → 招待メール or magic link
  // ★ ここが重要：実行時のオリジンを最優先で使用（ポート自動スライドでも正しいURLに）
  const origin = resolveOrigin(req);
  // 直接 /signup?company=... に戻す。/auth/callback を挟みたい場合は
  // `${origin}/auth/callback?next=${encodeURIComponent(`/signup?company=${companyId}`)}`
  const redirectTo = `${origin}/signup?company=${encodeURIComponent(companyId!)}`;

  // 招待メール
  try {
    const { error: inviteErr } = await admin.auth.admin.inviteUserByEmail(
      email,
      { redirectTo } as any
    );
    if (!inviteErr) {
      return NextResponse.json({ ok: true, added: false, invited: true, companyId });
    }
  } catch (e) {
    console.error('inviteUserByEmail failed', e);
  }

  // magic link（fallback）
  try {
    const { data: linkRes, error: linkErr } = await admin.auth.admin.generateLink({
      type: 'magiclink',
      email,
      redirectTo,
    } as any);
    if (linkErr || !linkRes?.properties?.action_link) {
      return NextResponse.json({ error: 'generate_link_failed' }, { status: 500 });
    }
    return NextResponse.json({
      ok: true,
      added: false,
      invited: false,
      inviteLink: linkRes.properties.action_link,
      companyId,
    });
  } catch (e) {
    console.error('generateLink failed', e);
    return NextResponse.json({ error: 'invite_failed' }, { status: 500 });
  }
}
