// /utils/supabase/membership.ts
import { supabase, isValidUUID, setCompanyIdCookie, getCompanyIdFromCookie } from './client';
import { debugExtractPostgrest, isNoRows } from './errors';

/** テーブル名 */
const T_MEMBERS = 'company_members';

export type Role = 'admin' | 'manager' | 'member';

export type Membership = {
  companyId: string | null;
  departmentId: string | null;
  role: Role | null;
};

export type MemberListItem = {
  userId: string;
  role: Role;
  departmentId: string | null;
  email?: string | null;
  name?: string | null;
};

/* ============================== helpers ============================== */

function normRole(v: any): Role | null {
  const s = typeof v === 'string' ? v.toLowerCase() : '';
  return s === 'admin' || s === 'manager' || s === 'member' ? (s as Role) : null;
}

/** 現在の userId を Supabase Auth から取得（未ログイン時は null） */
export async function getCurrentUserId(): Promise<string | null> {
  try {
    const { data, error } = await supabase.auth.getUser();
    if (error) debugExtractPostgrest(error);
    return data?.user?.id ?? null;
  } catch (e) {
    debugExtractPostgrest(e);
    return null;
  }
}

/** 指定列が無い（42703）かどうかの簡易判定 */
function looksMissingColumn(errOrResp: unknown, col: string) {
  const info = debugExtractPostgrest(errOrResp);
  const msg = `${info.code} ${info.message} ${info.details}`.toLowerCase();
  return (
    info.code === '42703' ||
    msg.includes(col.toLowerCase()) ||
    (msg.includes('column') && msg.includes('does not exist'))
  );
}

/** department_id 列が存在しないケースを判定（後方互換用） */
function looksMissingDepartmentId(errOrResp: unknown) {
  return looksMissingColumn(errOrResp, 'department_id');
}

/** 成功時のみ Cookie を設定したい場所で使用（create/joinなど） */
function setCompanyCookieIfValid(id: string | null | undefined) {
  if (id && isValidUUID(id)) {
    try {
      setCompanyIdCookie(id);
    } catch {}
  }
}

/** 選択中の会社への所属が有効ならそれを、なければ作成日時の新しい所属を1件選ぶ */
function pickOneMembership(rows: any[], selectedCompanyId?: string | null): Membership {
  if (!Array.isArray(rows) || rows.length === 0) {
    return { companyId: null, departmentId: null, role: null };
  }
  const sorted = [...rows].sort((a, b) => {
    // created_at が無いスキーマでも安定するように文字列比較で降順
    const ca = String(a?.created_at ?? '');
    const cb = String(b?.created_at ?? '');
    return cb.localeCompare(ca);
  });
  const best = (selectedCompanyId && sorted.find((r) => r?.company_id === selectedCompanyId)) || sorted[0];
  return {
    companyId: typeof best?.company_id === 'string' ? best.company_id : null,
    departmentId: typeof best?.department_id === 'string' ? best.department_id : null,
    role: normRole(best?.role),
  };
}

/* ============================== read ============================== */
/**
 * 所属を決定的に1件返す（Cookieは書き換えない）
 * - 複数行取得 → 選択中の会社（Cookie）が所属にあればそれ、なければ作成日時の新しい順
 * - department_id の有無に自動対応
 * - 所属無しは空オブジェクトで返す
 */
export async function getMembership(userId: string): Promise<Membership> {
  if (!userId) return { companyId: null, departmentId: null, role: null };

  // department_id あり想定で複数行取得
  const q1 = await supabase
    .from(T_MEMBERS)
    .select('company_id, department_id, role, created_at')
    .eq('user_id', userId);

  if (!q1.error) {
    return pickOneMembership(q1.data || [], getCompanyIdFromCookie());
  }

  // 所属なし（No rows）は空
  if (isNoRows(q1)) {
    return { companyId: null, departmentId: null, role: null };
  }

  // 列が無い場合のフォールバック（department_id 抜き）
  if (looksMissingDepartmentId(q1)) {
    const q2 = await supabase
      .from(T_MEMBERS)
      .select('company_id, role, created_at')
      .eq('user_id', userId);
    if (!q2.error) {
      const picked = pickOneMembership(q2.data || [], getCompanyIdFromCookie());
      return { companyId: picked.companyId, departmentId: null, role: picked.role };
    }
    if (isNoRows(q2)) {
      return { companyId: null, departmentId: null, role: null };
    }
    debugExtractPostgrest(q2);
    return { companyId: null, departmentId: null, role: null };
  }

  debugExtractPostgrest(q1);
  return { companyId: null, departmentId: null, role: null };
}

/**
 * 明示会社で所属を取得（削除など company を固定したいときに使用）
 * - Cookieは書き換えない
 */
export async function getMembershipForCompany(userId: string, companyId: string): Promise<Membership> {
  if (!userId || !isValidUUID(companyId)) return { companyId: null, departmentId: null, role: null };

  // department_id あり
  let q = await supabase
    .from(T_MEMBERS)
    .select('company_id, department_id, role')
    .eq('user_id', userId)
    .eq('company_id', companyId)
    .limit(1)
    .maybeSingle();

  if (q.error && looksMissingDepartmentId(q)) {
    // department_id なし
    q = await supabase
      .from(T_MEMBERS)
      .select('company_id, role')
      .eq('user_id', userId)
      .eq('company_id', companyId)
      .limit(1)
      .maybeSingle();
  }

  if (q.error) {
    if (!isNoRows(q)) debugExtractPostgrest(q);
    return { companyId: null, departmentId: null, role: null };
  }

  const row = q.data as any;
  return {
    companyId: typeof row?.company_id === 'string' ? row.company_id : null,
    departmentId: typeof row?.department_id === 'string' ? row.department_id : null,
    role: normRole(row?.role),
  };
}

/** 指定会社に対する admin 判定（RLSのDELETE可否の事前チェックに） */
export async function isAdminOf(userId: string, companyId: string): Promise<boolean> {
  const m = await getMembershipForCompany(userId, companyId);
  return m.companyId === companyId && m.role === 'admin';
}

/* ============================== create/join ============================== */
/**
 * 新規会社を作成し、呼び出し者を admin として所属させる。作成はサーバーの /api/companies/provision が行う。
 * - 認証と会社作成の可否（ENABLE_SIGNUP_ADMIN、導入コード）はサーバーの判定に従う。
 * - companies / company_members へブラウザから直接書き込まない。
 */
export async function createCompanyAndJoin(params: {
  userId: string;
  companyName?: string;
  departmentId?: string | null;
}): Promise<Membership> {
  const { userId, companyName, departmentId = null } = params;
  if (!userId) return { companyId: null, departmentId: null, role: null };

  const { data: sess } = await supabase.auth.getSession();
  const token = sess?.session?.access_token;
  if (!token) return { companyId: null, departmentId: null, role: null };

  const name = companyName?.trim() ? companyName.trim().slice(0, 120) : undefined;
  let res: Response;
  try {
    res = await fetch('/api/companies/provision', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${token}`,
        'x-growth-provision-mode': 'create',
      },
      body: JSON.stringify({ companyName: name, departmentId, allowCreateCompany: true }),
    });
  } catch {
    return { companyId: null, departmentId: null, role: null };
  }

  const body = await res.json().catch(() => null);
  const companyId = typeof body?.companyId === 'string' ? body.companyId : null;
  if (!res.ok || body?.ok !== true || !isValidUUID(companyId)) {
    return { companyId: null, departmentId: null, role: null };
  }

  setCompanyCookieIfValid(companyId);
  return {
    companyId,
    departmentId,
    role: normRole(body?.role) ?? 'admin',
  };
}

/**
 * 既存会社への直接参加は行わない。既存会社への参加は、管理者の招待（/api/invites/accept）だけで行う。
 * 以前の直接書込みは RLS で拒否されていたため、この関数が参加させられる範囲は変わらない。
 */
export async function joinCompany(_params: {
  userId: string;
  companyId: string;
  role?: Role;
  departmentId?: string | null;
}): Promise<Membership> {
  return { companyId: null, departmentId: null, role: null };
}

/* ============================== list / update / remove ============================== */

/** 自社メンバー一覧（department_id が無くても動く） */
export async function listCompanyMembers(): Promise<MemberListItem[]> {
  const myUid = await getCurrentUserId();
  if (!myUid) {
    console.warn('[listCompanyMembers] no user id');
    return [];
  }
  const m = await getMembership(myUid);
  if (!m.companyId) {
    console.warn('[listCompanyMembers] no company id for user:', myUid);
    return [];
  }

  console.log('[listCompanyMembers] querying for company:', m.companyId);

  // department_id あり
  const q1 = await supabase
    .from(T_MEMBERS)
    .select('user_id, role, department_id')
    .eq('company_id', m.companyId);

  if (!q1.error) {
    const result = (q1.data || []).map((r: any) => ({
      userId: String(r.user_id),
      role: (normRole(r.role) ?? 'member') as Role,
      departmentId: typeof r?.department_id === 'string' ? r.department_id : null,
    }));
    console.log('[listCompanyMembers] success:', result.length, 'members');
    return result;
  }

  // department_id なし（フォールバック）
  if (looksMissingDepartmentId(q1)) {
    console.warn('[listCompanyMembers] department_id column not found, retrying without it');
    const q2 = await supabase.from(T_MEMBERS).select('user_id, role').eq('company_id', m.companyId);
    if (q2.error) {
      console.error('[listCompanyMembers] fallback query failed:', q2.error);
      debugExtractPostgrest(q2);
      return [];
    }
    const result = (q2.data || []).map((r: any) => ({
      userId: String(r.user_id),
      role: (normRole(r.role) ?? 'member') as Role,
      departmentId: null,
    }));
    console.log('[listCompanyMembers] fallback success:', result.length, 'members');
    return result;
  }

  console.error('[listCompanyMembers] query error:', q1.error);
  debugExtractPostgrest(q1);
  return [];
}

/** 同一会社内のロール更新。会社は明示する。権限判定と MFA は API 側で行う */
export async function updateMemberRole(
  companyId: string,
  targetUserId: string,
  nextRole: Role
): Promise<{ ok: boolean; error?: any }> {
  return callMemberApi("/api/members/role", {
    method: "PATCH",
    body: JSON.stringify({ companyId, targetUserId, newRole: nextRole }),
  });
}

async function callMemberApi(url: string, init: { method: string; body?: string }): Promise<{ ok: boolean; error?: any }> {
  const { data } = await supabase.auth.getSession();
  const token = data?.session?.access_token;
  if (!token) return { ok: false, error: new Error("not signed in") };
  const res = await fetch(url, {
    method: init.method,
    headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
    body: init.body,
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    return { ok: false, error: new Error(body?.error || `HTTP ${res.status}`) };
  }
  return { ok: true };
}
