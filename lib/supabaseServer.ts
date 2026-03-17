// /lib/supabaseServer.ts
import 'server-only';
import { cookies, headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { createServerClient, type CookieOptions } from '@supabase/ssr';
import type { SupabaseClient, Session, User } from '@supabase/supabase-js';

/* ========= Env ========= */
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SUPABASE_PUBLISHABLE_KEY = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!;

if (!SUPABASE_URL || !SUPABASE_PUBLISHABLE_KEY) {
  throw new Error('Missing env: NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY');
}

/* ========= 型 ========= */
export type AppRole = 'admin' | 'manager' | 'member';
export type MembershipRow = {
  company_id: string | null;
  role: AppRole | null;
  department_id?: string | null;
  updated_at?: string | null;
};
export type Membership = {
  companyId: string | null;
  role: AppRole | null;
  departmentId: string | null;
};

/* ========= SSR 用 Supabase クライアント（Next15対応：await cookies/headers） ========= */
export async function createSupabaseServerClient(): Promise<SupabaseClient> {
  const cookieStore = await cookies(); // Next 15+: Promise
  const hdrs = await headers();

  return createServerClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
    cookies: {
      async get(name: string) {
        return cookieStore.get(name)?.value;
      },
      async set(name: string, value: string, options: CookieOptions) {
        cookieStore.set({ name, value, ...options });
      },
      async remove(name: string, options: CookieOptions) {
        cookieStore.set({ name, value: '', ...options, maxAge: 0 });
      },
    },
    global: { headers: Object.fromEntries(hdrs) },
  });
}

/* ========= セッション / ユーザー ========= */
export async function getServerSession(): Promise<{
  supabase: SupabaseClient;
  session: Session | null;
  error: any;
}> {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.auth.getSession();
  return { supabase, session: data?.session ?? null, error };
}

export async function getServerUser(): Promise<{
  supabase: SupabaseClient;
  user: User | null;
  error: any;
}> {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.auth.getUser();
  return { supabase, user: data?.user ?? null, error };
}

/* ========= 未ログインなら /login へ（サーバー専用） ========= */
export async function requireServerSession(loginPath: string = '/login') {
  const { supabase, session } = await getServerSession();
  if (!session) redirect(loginPath);
  return { supabase, session };
}

/* ========= 内部: Cookie の company_id を取得 ========= */
async function getCompanyIdFromCookieServer(): Promise<string | null> {
  try {
    const c = await cookies();
    const v = c.get('company_id')?.value || null;
    return v || null;
  } catch {
    return null;
  }
}

/* ========= 所属取得（0件は正常） =========
 * 原則：
 * - order() は使わない（PostgREST 400回避 & RLS下での安定性）
 * - まず department_id ありで試し、列なし（42703）なら列抜きで再実行
 * - Cookie の company_id があれば、その company_id で 1 行だけ取得
 */
export async function getMembership(): Promise<{
  supabase: SupabaseClient;
  membershipRows: MembershipRow[]; // 互換のため配列で返す（実際は 0/1 件）
  membership: Membership | null;   // 1件 or null
  error: any;
}> {
  const supabase = await createSupabaseServerClient();

  // 1) Cookie の company_id を優先
  const cookieCompanyId = await getCompanyIdFromCookieServer();

  // 2) クエリ実装（戻り型を any に統一して TS2322 を回避）
  const tryWithDept = async (): Promise<any> => {
    if (cookieCompanyId) {
      return supabase
        .from('company_members')
        .select('company_id, role, department_id')
        .eq('company_id', cookieCompanyId)
        .limit(1)
        .maybeSingle();
    }
    return supabase
      .from('company_members')
      .select('company_id, role, department_id')
      .limit(1)
      .maybeSingle();
  };

  const tryWithoutDept = async (): Promise<any> => {
    if (cookieCompanyId) {
      return supabase
        .from('company_members')
        .select('company_id, role')
        .eq('company_id', cookieCompanyId)
        .limit(1)
        .maybeSingle();
    }
    return supabase
      .from('company_members')
      .select('company_id, role')
      .limit(1)
      .maybeSingle();
  };

  // 3) 実行
  let q: any = await tryWithDept();

  // department_id 列がない（42703）場合のフォールバック
  const looksMissingDeptCol = (errOrResp: any) => {
    const code = errOrResp?.error?.code || errOrResp?.code || errOrResp?.status;
    const message = `${errOrResp?.error?.message ?? ''} ${errOrResp?.error?.details ?? ''}`.toLowerCase();
    return code === '42703' || (message.includes('column') && message.includes('does not exist'));
  };

  if (q?.error && looksMissingDeptCol(q)) {
    q = await tryWithoutDept();
  }

  if (q?.error) {
    return { supabase, membershipRows: [], membership: null, error: q.error };
  }

  const row = (q?.data as any) ?? null;
  const membership: Membership | null = row
    ? {
        companyId: row.company_id ?? null,
        role: (row.role ?? null) as AppRole | null,
        departmentId: typeof row?.department_id === 'string' ? row.department_id : null,
      }
    : null;

  // rows は互換のため配列で返す（単一取得なので 0/1 件）
  return { supabase, membershipRows: row ? [row as MembershipRow] : [], membership, error: null };
}

export async function getCompanyId(): Promise<string | null> {
  const { membership } = await getMembership();
  return membership?.companyId ?? null;
}

export async function getRole(): Promise<AppRole | null> {
  const { membership } = await getMembership();
  return membership?.role ?? null;
}

/* ========= 管理者ガード（例：/admin 用） ========= */
export async function requireAdmin(options?: { loginPath?: string; notAllowedPath?: string }) {
  const { loginPath = '/login', notAllowedPath = '/' } = options ?? {};
  const { session } = await requireServerSession(loginPath);
  const role = await getRole();
  if (role !== 'admin') redirect(notAllowedPath);
  return session;
}

/* ========= API ルート用ラッパー ========= */
export async function withServerSupabase<T>(
  handler: (ctx: {
    supabase: SupabaseClient;
    session: Session | null;
    user: User | null;
    membership: Membership | null;
  }) => Promise<T>
): Promise<T> {
  const supabase = await createSupabaseServerClient();

  const [{ data: sessionData }, { data: userData }, membershipRes] = await Promise.all([
    supabase.auth.getSession(),
    supabase.auth.getUser(),
    getMembership(),
  ]);

  return handler({
    supabase,
    session: sessionData?.session ?? null,
    user: userData?.user ?? null,
    membership: membershipRes.membership,
  });
}

/* ========= 小ユーティリティ ========= */
export function isLoggedIn(session: Session | null): boolean {
  return !!session?.access_token;
}
export function hasMembership(m: Membership | null): boolean {
  return !!m?.companyId;
}
