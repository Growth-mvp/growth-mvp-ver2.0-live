// /utils/supabase/membership.ts
import { supabase, isValidUUID, setCompanyIdCookie } from './client';
import { debugExtractPostgrest, isRlsDenied, isNoRows } from './errors';

/** テーブル名 */
const T_COMPANIES = 'companies';
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

/** 複数所属から 役割優先（admin > manager > member）かつ新しい順で1件選ぶ */
function pickOneMembership(rows: any[]): Membership {
  if (!Array.isArray(rows) || rows.length === 0) {
    return { companyId: null, departmentId: null, role: null };
  }
  const weight: Record<Role, number> = { admin: 3, manager: 2, member: 1 };
  const sorted = [...rows].sort((a, b) => {
    const ra = normRole(a?.role) ?? 'member';
    const rb = normRole(b?.role) ?? 'member';
    const wa = weight[ra];
    const wb = weight[rb];
    if (wa !== wb) return wb - wa; // 役割優先
    // created_at が無いスキーマでも安定するように文字列比較で降順
    const ca = String(a?.created_at ?? '');
    const cb = String(b?.created_at ?? '');
    return cb.localeCompare(ca);
  });
  const best = sorted[0];
  return {
    companyId: typeof best?.company_id === 'string' ? best.company_id : null,
    departmentId: typeof best?.department_id === 'string' ? best.department_id : null,
    role: normRole(best?.role),
  };
}

/* ============================== read ============================== */
/**
 * 所属を決定的に1件返す（Cookieは書き換えない）
 * - 複数行取得 → admin > manager > member の優先度で選択
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
    return pickOneMembership(q1.data || []);
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
      const picked = pickOneMembership(q2.data || []);
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
 * 会社を新規作成し、自分を admin で参加させる
 * - department_id が無いスキーマでも成功するようフォールバック実装
 * - RLSで companies / company_members の insert が拒否される場合は、Service Role API 経由の作成が必要
 * - 成功時のみ Cookie を設定
 */
export async function createCompanyAndJoin(params: {
  userId: string;
  companyName?: string;
  departmentId?: string | null;
}): Promise<Membership> {
  const { userId, companyName, departmentId = null } = params;
  if (!userId) return { companyId: null, departmentId: null, role: null };

  const name = (companyName?.trim() || `Personal Company ${userId.slice(0, 8)}`).slice(0, 120);

  // 1) companies を作成
  const insCompany = await supabase
    .from(T_COMPANIES)
    .insert([{ name, created_by: userId }])
    .select('id')
    .single();

  if (insCompany.error) {
    if (isRlsDenied(insCompany)) {
      debugExtractPostgrest(insCompany);
      return { companyId: null, departmentId: null, role: null };
    }
    debugExtractPostgrest(insCompany);
    return { companyId: null, departmentId: null, role: null };
  }

  const companyIdRaw = (insCompany.data as any)?.id ?? '';
  const companyId = typeof companyIdRaw === 'string' ? companyIdRaw : String(companyIdRaw || '');
  if (!isValidUUID(companyId)) {
    // 期待通りに UUID が返らない場合は異常系として扱う
    return { companyId: null, departmentId: null, role: null };
  }

  // 2) 自分を admin として upsert（まず department_id ありで試す）
  const payloadWithDept = [{ company_id: companyId, user_id: userId, role: 'admin', department_id: departmentId }];
  let insMember = await supabase
    .from(T_MEMBERS)
    .upsert(payloadWithDept, { onConflict: 'company_id,user_id', ignoreDuplicates: false })
    .select('company_id, department_id, role')
    .maybeSingle();

  // department_id 列が無ければ、列抜きで再実行
  if (insMember.error && looksMissingDepartmentId(insMember)) {
    insMember = await supabase
      .from(T_MEMBERS)
      .upsert([{ company_id: companyId, user_id: userId, role: 'admin' }], {
        onConflict: 'company_id,user_id',
        ignoreDuplicates: false,
      })
      .select('company_id, role')
      .maybeSingle();
  }

  if (insMember.error) {
    debugExtractPostgrest(insMember);
    return { companyId: null, departmentId: null, role: null };
  }

  const row = insMember.data as any;

  // ★ 成功時のみ Cookie を設定（getMembership では設定しない）
  setCompanyCookieIfValid(companyId);

  return {
    companyId,
    departmentId: typeof row?.department_id === 'string' ? row.department_id : null,
    role: normRole(row?.role) ?? 'admin',
  };
}

/**
 * 既存会社へ参加（department_id 無しスキーマにも対応）
 * - 成功時のみ Cookie を設定
 */
export async function joinCompany(params: {
  userId: string;
  companyId: string;
  role?: Role;
  departmentId?: string | null;
}): Promise<Membership> {
  const { userId, companyId, role = 'member', departmentId = null } = params;
  if (!userId || !isValidUUID(companyId)) return { companyId: null, departmentId: null, role: null };

  // まず department_id ありで upsert
  let up = await supabase
    .from(T_MEMBERS)
    .upsert([{ company_id: companyId, user_id: userId, role, department_id: departmentId }], {
      onConflict: 'company_id,user_id',
      ignoreDuplicates: false,
    })
    .select('company_id, department_id, role')
    .maybeSingle();

  // 列が無ければ department_id 抜きで再実行
  if (up.error && looksMissingDepartmentId(up)) {
    up = await supabase
      .from(T_MEMBERS)
      .upsert([{ company_id: companyId, user_id: userId, role }], {
        onConflict: 'company_id,user_id',
        ignoreDuplicates: false,
      })
      .select('company_id, role')
      .maybeSingle();
  }

  if (up.error) {
    debugExtractPostgrest(up);
    return { companyId: null, departmentId: null, role: null };
  }

  const row = up.data as any;

  // ★ 成功時のみ Cookie を設定（getMembership では設定しない）
  setCompanyCookieIfValid(companyId);

  return {
    companyId,
    departmentId: typeof row?.department_id === 'string' ? row.department_id : null,
    role: normRole(row?.role) ?? role,
  };
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

/** ロール更新（自社内のみ） */
export async function updateMemberRole(
  targetUserId: string,
  nextRole: Role
): Promise<{ ok: boolean; error?: any }> {
  const myUid = await getCurrentUserId();
  if (!myUid) return { ok: false, error: new Error('not signed in') };

  // 明示会社IDで判定したい場合は呼び出し側で getMembershipForCompany を使って渡す
  const m = await getMembership(myUid);
  if (!m.companyId) return { ok: false, error: new Error('company not found') };

  const { error } = await supabase
    .from(T_MEMBERS)
    .update({ role: nextRole })
    .eq('company_id', m.companyId)
    .eq('user_id', targetUserId)
    .select('user_id')
    .maybeSingle();

  if (error) {
    debugExtractPostgrest(error);
    return { ok: false, error };
  }
  return { ok: true };
}

/** メンバー削除（自社内のみ） */
export async function removeMember(targetUserId: string): Promise<{ ok: boolean; error?: any }> {
  const myUid = await getCurrentUserId();
  if (!myUid) return { ok: false, error: new Error('not signed in') };

  const m = await getMembership(myUid);
  if (!m.companyId) return { ok: false, error: new Error('company not found') };

  const { error } = await supabase
    .from(T_MEMBERS)
    .delete()
    .eq('company_id', m.companyId)
    .eq('user_id', targetUserId);

  if (error) {
    debugExtractPostgrest(error);
    return { ok: false, error };
  }
  return { ok: true };
}

/** 既存ユーザーを追加（department_id 無しスキーマにも対応） */
export async function addMemberByUserId(
  targetUserId: string,
  role: Role = 'member',
  departmentId: string | null = null
): Promise<{ ok: boolean; error?: any }> {
  const myUid = await getCurrentUserId();
  if (!myUid) return { ok: false, error: new Error('not signed in') };

  const m = await getMembership(myUid);
  if (!m.companyId) return { ok: false, error: new Error('company not found') };

  // まず department_id ありで upsert
  let up = await supabase
    .from(T_MEMBERS)
    .upsert([{ company_id: m.companyId, user_id: targetUserId, role, department_id: departmentId }], {
      onConflict: 'company_id,user_id',
      ignoreDuplicates: false,
    });

  // 列が無ければ department_id 抜きで再実行
  if (up.error && looksMissingDepartmentId(up)) {
    up = await supabase
      .from(T_MEMBERS)
      .upsert([{ company_id: m.companyId, user_id: targetUserId, role }], {
        onConflict: 'company_id,user_id',
        ignoreDuplicates: false,
      });
  }

  if (up.error) {
    debugExtractPostgrest(up);
    return { ok: false, error: up.error };
  }
  return { ok: true };
}
