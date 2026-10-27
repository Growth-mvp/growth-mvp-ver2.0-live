import 'server-only';

import type { SupabaseClient } from '@supabase/supabase-js';

export const APP_ROLES = ['admin', 'manager', 'member'] as const;
export type AppRole = (typeof APP_ROLES)[number];

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isUuid(value: unknown): value is string {
  return typeof value === 'string' && UUID_PATTERN.test(value);
}

export function isAppRole(value: unknown): value is AppRole {
  return typeof value === 'string' && (APP_ROLES as readonly string[]).includes(value);
}

/** DB トリガー（company_members の最後の管理者保護）が投げる例外かどうか */
export function isLastAdminViolation(error: unknown): boolean {
  const e = error as { code?: string; message?: string } | null;
  return !!e && e.code === 'P0001' && typeof e.message === 'string' && e.message.includes('last_admin');
}

export type CompanyAdminCheck = { ok: true } | { ok: false; status: 403 | 503; error: string };

/** 要求で明示された会社について、userId がその会社の admin であることを確認する。 */
export async function assertCompanyAdmin(
  admin: SupabaseClient,
  userId: string,
  companyId: string
): Promise<CompanyAdminCheck> {
  const { data, error } = await admin
    .from('company_members')
    .select('role')
    .eq('company_id', companyId)
    .eq('user_id', userId)
    .maybeSingle();
  if (error) return { ok: false, status: 503, error: 'membership_check_failed' };
  if (!data || data.role !== 'admin') return { ok: false, status: 403, error: 'forbidden' };
  return { ok: true };
}

export type CompanyMemberLookup =
  | { ok: true; role: AppRole }
  | { ok: false; status: 404 | 503; error: 'member_not_found' | 'member_lookup_failed' };

/** 対象の会社に所属するメンバーを取得する。別会社のメンバーは見つからない扱いになる。 */
export async function findCompanyMember(
  admin: SupabaseClient,
  companyId: string,
  userId: string
): Promise<CompanyMemberLookup> {
  const { data, error } = await admin
    .from('company_members')
    .select('role')
    .eq('company_id', companyId)
    .eq('user_id', userId)
    .maybeSingle();
  if (error) return { ok: false, status: 503, error: 'member_lookup_failed' };
  if (!data) return { ok: false, status: 404, error: 'member_not_found' };
  return { ok: true, role: data.role as AppRole };
}

/** 対象会社の admin のうち、excludeUserId 以外の人数。取得に失敗したら null。 */
export async function countOtherAdmins(
  admin: SupabaseClient,
  companyId: string,
  excludeUserId: string
): Promise<number | null> {
  const { count, error } = await admin
    .from('company_members')
    .select('user_id', { count: 'exact', head: true })
    .eq('company_id', companyId)
    .eq('role', 'admin')
    .neq('user_id', excludeUserId);
  if (error) return null;
  return count ?? 0;
}

export type RemoveCompanyMemberResult =
  | { ok: true; role: AppRole }
  | { ok: false; status: 400 | 404 | 500 | 503; error: string; message?: string };

/** 会社からメンバーを削除する。最後の管理者は削除しない。呼び出し側で admin 権限を確認済みであること。 */
export async function removeCompanyMember(
  admin: SupabaseClient,
  companyId: string,
  targetUserId: string
): Promise<RemoveCompanyMemberResult> {
  const target = await findCompanyMember(admin, companyId, targetUserId);
  if (!target.ok) return { ok: false, status: target.status, error: target.error };

  if (target.role === 'admin') {
    const others = await countOtherAdmins(admin, companyId, targetUserId);
    if (others === null) return { ok: false, status: 503, error: 'count_check_failed' };
    if (others === 0) {
      return {
        ok: false,
        status: 400,
        error: 'cannot_remove_last_admin',
        message: '最後の管理者は削除できません。',
      };
    }
  }

  const { error } = await admin
    .from('company_members')
    .delete()
    .eq('company_id', companyId)
    .eq('user_id', targetUserId);
  if (isLastAdminViolation(error)) {
    return {
      ok: false,
      status: 400,
      error: 'cannot_remove_last_admin',
      message: '最後の管理者は削除できません。',
    };
  }
  if (error) return { ok: false, status: 500, error: 'delete_failed' };

  return { ok: true, role: target.role };
}
