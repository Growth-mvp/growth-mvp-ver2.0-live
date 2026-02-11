/**
 * /lib/server/rbacGuard.ts
 * API層の統一権限ガード（server-only）
 *
 * 全ての書き込みAPIでこれを使用する。
 * 目的：
 *   - Bearer token の安全な検証
 *   - Membership の取得と検証
 *   - Capability の強制
 *   - company_id スコープの検証
 */

import 'server-only';

import type { SupabaseClient } from '@supabase/supabase-js';
import { type Action, type Role, getCapabilities, can, canActionInDepartment } from '@/lib/rbac';

export type Membership = {
  companyId: string;
  role: Role;
  departmentId: string | null;
  userId: string;
};

/**
 * Bearer token から userId を抽出・検証
 *
 * @param admin - Supabase admin client
 * @param req - Request オブジェクト
 * @returns userId or null （トークン無効の場合）
 */
export async function getAuthUserIdFromBearer(
  admin: SupabaseClient,
  req: Request
): Promise<string | null> {
  const auth = req.headers.get('authorization') || '';
  const token = auth.toLowerCase().startsWith('bearer ') ? auth.slice(7) : null;

  if (!token) {
    return null;
  }

  try {
    const { data: userRes, error } = await admin.auth.getUser(token);
    if (error || !userRes?.user) {
      return null;
    }
    return userRes.user.id;
  } catch {
    return null;
  }
}

/**
 * userId の一致を確認
 *
 * 例：ユーザーが自分の OKR のみ更新可能な場合、body の targetUserId と auth の userId が一致するか確認
 *
 * @throws Error if mismatch
 */
export function requireUserMatch(authUserId: string, bodyUserId: string | undefined) {
  if (!bodyUserId || bodyUserId !== authUserId) {
    throw new Error('user_mismatch');
  }
}

/**
 * strategy_id から company_id を解決
 *
 * 例：ask-ceo-agent が strategy_id を受け取り、同じ company に属しているか確認する時に使用
 *
 * @param admin - Supabase admin client
 * @param strategyId - strategy_data.id
 * @returns companyId or null
 */
export async function resolveCompanyIdFromStrategyId(
  admin: SupabaseClient,
  strategyId: string
): Promise<string | null> {
  try {
    const { data, error } = await admin
      .from('strategy_data')
      .select('company_id')
      .eq('id', strategyId)
      .maybeSingle();

    if (error || !data) {
      return null;
    }

    return data.company_id ?? null;
  } catch {
    return null;
  }
}

/**
 * ユーザーの membership を取得
 *
 * 指定 companyId での membership を取得。
 * department_id 列が無い場合でもフォールバック対応。
 *
 * @param admin - Supabase admin client
 * @param userId - auth.users.id
 * @param companyId - company_id（指定時は company_members を company_id + user_id で取得）
 * @returns Membership or null
 */
export async function requireMembership(
  admin: SupabaseClient,
  userId: string,
  companyId?: string
): Promise<Membership | null> {
  try {
    // department_id ありで試行
    let query: any = admin
      .from('company_members')
      .select('company_id, role, department_id, user_id')
      .eq('user_id', userId);

    if (companyId) {
      query = query.eq('company_id', companyId).limit(1).maybeSingle();
    } else {
      query = query.limit(1).maybeSingle();  // 複数所属時は pickOneMembership ロジック相当
    }

    let result: any = await query;

    // department_id 列が無い場合のフォールバック（42703: undefined column）
    if (
      result?.error?.code === '42703' ||
      (result?.error?.message?.toLowerCase() || '').includes('department_id')
    ) {
      query = admin
        .from('company_members')
        .select('company_id, role, user_id')
        .eq('user_id', userId);

      if (companyId) {
        query = query.eq('company_id', companyId).limit(1).maybeSingle();
      } else {
        query = query.limit(1).maybeSingle();
      }

      result = await query;
    }

    if (result?.error || !result?.data) {
      return null;
    }

    const row = result.data;
    return {
      userId: row.user_id ?? userId,
      companyId: row.company_id,
      role: (row.role as Role) ?? 'member',
      departmentId: row.department_id ?? null,
    };
  } catch {
    return null;
  }
}

/**
 * 複数所属時の「既定 company」を選択（Server側版）
 *
 * 優先度：admin > manager > member、同じ role なら created_at が新しい順
 *
 * @param admin - Supabase admin client
 * @param userId - auth.users.id
 * @returns 選択された Membership or null
 */
export async function pickOneMembershipServer(
  admin: SupabaseClient,
  userId: string
): Promise<Membership | null> {
  try {
    // department_id ありで試行
    let query: any = admin
      .from('company_members')
      .select('company_id, role, department_id, user_id, created_at')
      .eq('user_id', userId)
      .order('created_at', { ascending: false });

    let result: any = await query;

    // フォールバック
    if (
      result?.error?.code === '42703' ||
      (result?.error?.message?.toLowerCase() || '').includes('department_id')
    ) {
      query = admin
        .from('company_members')
        .select('company_id, role, user_id, created_at')
        .eq('user_id', userId)
        .order('created_at', { ascending: false });

      result = await query;
    }

    if (result?.error || !result?.data || result.data.length === 0) {
      return null;
    }

    // 複数行がある場合、優先度順でソート
    const rows: any[] = result.data;
    const sorted = rows.sort((a, b) => {
      // Role 優先度
      const roleWeightMap = { admin: 3, manager: 2, member: 1 };
      const aWeight = roleWeightMap[a.role as Role] ?? 0;
      const bWeight = roleWeightMap[b.role as Role] ?? 0;
      if (aWeight !== bWeight) return bWeight - aWeight;

      // 同じ role なら created_at が新しい順
      const aTime = new Date(a.created_at).getTime();
      const bTime = new Date(b.created_at).getTime();
      return bTime - aTime;
    });

    const picked = sorted[0];
    return {
      userId: picked.user_id ?? userId,
      companyId: picked.company_id,
      role: (picked.role as Role) ?? 'member',
      departmentId: picked.department_id ?? null,
    };
  } catch {
    return null;
  }
}

/**
 * アクション実行権限を強制する（単純な action 判定）
 *
 * 使用例（API層）:
 *   await assertCapability(membership, 'members:invite');
 *   // -> 権限がない場合は Error('forbidden') をスロー
 *
 * @throws Error('forbidden') if capability is false
 */
export async function assertCapability(
  membership: Membership,
  action: Action,
  opts?: {
    targetDeptId?: string | null;
  }
) {
  const capabilities = getCapabilities(membership.role);

  // 部門スコープが必要な action の場合
  if (action === 'department:edit' || action === 'department:delete') {
    const allowed = canActionInDepartment(
      membership.role,
      membership.departmentId,
      opts?.targetDeptId,
      action
    );
    if (!allowed) {
      throw new Error('forbidden');
    }
    return;
  }

  // 通常の action
  if (!can(capabilities, action)) {
    throw new Error('forbidden');
  }
}

/**
 * ロール最小値を要求する（例：admin のみ）
 *
 * 使用例：
 *   await assertMinRole(membership, 'admin');
 *   // -> admin のみ OK、manager/member は Error
 *
 * @throws Error('forbidden')
 */
export async function assertMinRole(
  membership: Membership,
  minRole: 'admin' | 'manager' | 'member'
) {
  const roleMap = { member: 1, manager: 2, admin: 3 };
  const memberWeight = roleMap[membership.role] ?? 0;
  const minWeight = roleMap[minRole] ?? 0;

  if (memberWeight < minWeight) {
    throw new Error('forbidden');
  }
}

/**
 * Company スコープ検証: strategyId が membership.companyId に属しているか確認
 *
 * 仕様：
 * - strategy_data から strategyId の company_id を取得
 * - membership.companyId と一致しなければ throw
 * - OKなら companyId を返す（下流で使えるように）
 *
 * @param admin - Supabase admin client
 * @param membership - ユーザーのメンバーシップ
 * @param strategyId - 対象の strategy_data.id
 * @returns companyId (検証済み)
 * @throws Error('forbidden') if scope mismatch
 */
export async function assertCompanyScopeByStrategyId(
  admin: SupabaseClient,
  membership: Membership,
  strategyId: string
): Promise<string> {
  try {
    const { data, error } = await admin
      .from('strategy_data')
      .select('company_id')
      .eq('id', strategyId)
      .maybeSingle();

    if (error || !data?.company_id) {
      throw new Error('forbidden');
    }

    // companyId が一致しなければ 403
    if (data.company_id !== membership.companyId) {
      throw new Error('forbidden');
    }

    return data.company_id;
  } catch (e: any) {
    if (e?.message === 'forbidden') throw e;
    throw new Error('forbidden');
  }
}

/**
 * Department スコープ検証: manager は "自部門だけ" の編集に限定
 *
 * 仕様（固定）:
 * - admin：常にOK
 * - manager：membership.departmentId が存在し、かつ targetDepartmentId === membership.departmentId の場合のみOK
 * - member：常にNG（編集系は）
 *
 * 注意：departmentId が DB に無い環境対策
 * - manager が departmentId を持っていない場合は編集不可（403）に倒す（安全側）
 *
 * @param membership - ユーザーのメンバーシップ
 * @param targetDepartmentId - 編集対象の department_id
 * @throws Error('forbidden') if scope mismatch
 */
export function assertDepartmentScope(
  membership: Membership,
  targetDepartmentId: string | null | undefined
): void {
  // admin は常に OK
  if (membership.role === 'admin') {
    return;
  }

  // manager は自部門のみ
  if (membership.role === 'manager') {
    // 自身に departmentId がない場合は編集不可（安全側）
    if (!membership.departmentId) {
      throw new Error('forbidden');
    }
    // targetDepartmentId が自身のと異なれば不可
    if (targetDepartmentId !== membership.departmentId) {
      throw new Error('forbidden');
    }
    return;
  }

  // member は常に NG（編集系）
  throw new Error('forbidden');
}
