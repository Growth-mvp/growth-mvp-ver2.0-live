// /utils/supabase/membership.ts
import { supabase, isValidUUID, setCompanyIdCookie } from './client';
import { debugExtractPostgrest, isRlsDenied } from './errors';

/** テーブル名 */
const T_COMPANIES = 'companies';
const T_MEMBERS   = 'company_members';

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
};

/* ============================== helpers ============================== */

function normRole(v: any): Role | null {
  return v === 'admin' || v === 'manager' || v === 'member' ? v : null;
}

/** 現在の userId を Supabase Auth から取得 */
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

/* ============================== read ============================== */
/**
 * 所属を1件だけ取得（**created_at に依存しない**：limit(1) のみ）
 * - まず department_id ありで取得
 * - 列が無ければ department_id を要求しないクエリにフォールバック
 */
export async function getMembership(userId: string): Promise<Membership> {
  if (!userId) return { companyId: null, departmentId: null, role: null };

  // department_id あり
  const q1 = await supabase
    .from(T_MEMBERS)
    .select('company_id, department_id, role')
    .eq('user_id', userId)
    .limit(1)
    .maybeSingle();

  if (!q1.error && q1.data) {
    const row = q1.data as any;
    const companyId = typeof row.company_id === 'string' ? row.company_id : null;
    const departmentId = typeof row.department_id === 'string' ? row.department_id : null;
    const role = normRole(row.role);
    if (companyId) setCompanyIdCookie(companyId);
    return { companyId, departmentId, role };
  }

  // 列が無い場合のフォールバック（department_id を要求しない）
  if (q1.error && looksMissingDepartmentId(q1)) {
    const q2 = await supabase
      .from(T_MEMBERS)
      .select('company_id, role')
      .eq('user_id', userId)
      .limit(1)
      .maybeSingle();

    if (!q2.error && q2.data) {
      const row = q2.data as any;
      const companyId = typeof row.company_id === 'string' ? row.company_id : null;
      const role = normRole(row.role);
      if (companyId) setCompanyIdCookie(companyId);
      return { companyId, departmentId: null, role };
    }
    if (q2.error) debugExtractPostgrest(q2);
    return { companyId: null, departmentId: null, role: null };
  }

  if (q1.error) debugExtractPostgrest(q1);
  return { companyId: null, departmentId: null, role: null };
}

/* ============================== create/join ============================== */
/**
 * 会社を新規作成し、自分を admin で参加させる
 * - department_id が無いスキーマでも成功するようフォールバック実装
 * - RLSで companies/ company_members の insert が拒否される場合は、Service Role API 経由の作成が必要
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

  const companyId = String((insCompany.data as any)?.id || '');
  if (!companyId) return { companyId: null, departmentId: null, role: null };

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
  if (companyId) setCompanyIdCookie(companyId);

  return {
    companyId,
    departmentId: typeof row?.department_id === 'string' ? row.department_id : null,
    role: normRole(row?.role) ?? 'admin',
  };
}

/**
 * 既存会社へ参加（department_id 無しスキーマにも対応）
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
  if (companyId) setCompanyIdCookie(companyId);

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
  if (!myUid) return [];
  const m = await getMembership(myUid);
  if (!m.companyId) return [];

  // department_id あり
  const q1 = await supabase
    .from(T_MEMBERS)
    .select('user_id, role, department_id')
    .eq('company_id', m.companyId);

  if (!q1.error) {
    return (q1.data || []).map((r: any) => ({
      userId: String(r.user_id),
      role: normRole(r.role) ?? 'member',
      departmentId: typeof r?.department_id === 'string' ? r.department_id : null,
    }));
  }

  // department_id なし（フォールバック）
  if (looksMissingDepartmentId(q1)) {
    const q2 = await supabase
      .from(T_MEMBERS)
      .select('user_id, role')
      .eq('company_id', m.companyId);
    if (q2.error) {
      debugExtractPostgrest(q2);
      return [];
    }
    return (q2.data || []).map((r: any) => ({
      userId: String(r.user_id),
      role: normRole(r.role) ?? 'member',
      departmentId: null,
    }));
  }

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
