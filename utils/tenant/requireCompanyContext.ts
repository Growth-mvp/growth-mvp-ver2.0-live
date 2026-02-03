/**
 * /utils/tenant/requireCompanyContext.ts
 *
 * テナント分離の "唯一の真実" を提供
 *
 * 重要：
 * - companyId は membership.company_id のみから取得（cookie/localStorage は参照しない）
 * - membership が無ければ throw
 * - 全ページ・全API がこれを通す（除外禁止）
 *
 * 使用例：
 *   const context = await requireCompanyContext();
 *   const { userId, companyId, role } = context;
 */

import { getCurrentUserId, getMembership, type Role } from '@/utils/supabase/membership';

export type CompanyContext = {
  /** 認証ユーザー ID（auth.uid） */
  userId: string;
  /** 所属会社 ID（membership.company_id が唯一の源泉） */
  companyId: string;
  /** ロール（admin/manager/member） */
  role: Role;
};

/**
 * テナントコンテキストを取得（認証必須）
 *
 * 前提：
 * - auth.uid が取得可能（≒ ログイン状態）
 * - membership が存在（≒ 会社に所属）
 *
 * 不足時：
 * - ユーザー未認証 → throw "User not authenticated"
 * - 会社未所属 → throw "User has no company membership"
 * - role が null → throw "Invalid role"
 *
 * @returns CompanyContext
 * @throws Error when user not authenticated or has no membership
 */
export async function requireCompanyContext(): Promise<CompanyContext> {
  // 1. ユーザー ID を取得
  const userId = await getCurrentUserId();
  if (!userId) {
    throw new Error('User not authenticated. Cannot access company context.');
  }

  // 2. Membership を取得（membership.company_id が唯一の源泉）
  const membership = await getMembership(userId);
  const companyId = membership.companyId;
  if (!companyId) {
    throw new Error('User has no company membership. Access denied.');
  }

  // 3. Role を検証
  const role = membership.role;
  if (!role) {
    throw new Error('Invalid membership role. Access denied.');
  }

  return {
    userId,
    companyId,
    role,
  };
}

/**
 * 指定会社のコンテキストを検証
 *
 * 用途：API で companyId パラメータが指定された場合、membership に一致するか確認
 *
 * 前提：
 * - auth.uid が取得可能
 * - 指定 companyId が有効な UUID
 *
 * 不一致時：
 * - throw "Unauthorized: company_id mismatch"
 *
 * @param companyId - 検証対象の company_id（URLパラメータなど）
 * @returns CompanyContext
 * @throws Error when company_id does not match user's membership
 */
export async function requireCompanyContextForCompany(companyId: string): Promise<CompanyContext> {
  const context = await requireCompanyContext();

  // URL/パラメータの companyId と membership の companyId が一致するか確認
  if (context.companyId !== companyId) {
    throw new Error(`Unauthorized: company_id mismatch. Expected ${context.companyId}, got ${companyId}`);
  }

  return context;
}

/**
 * ロール チェック ヘルパー
 *
 * @param context - CompanyContext
 * @param allowedRoles - 許可するロール（例: ['admin', 'manager']）
 * @throws Error when role is not in allowedRoles
 */
export function requireRole(context: CompanyContext, allowedRoles: Role[]): void {
  if (!allowedRoles.includes(context.role)) {
    throw new Error(`Forbidden: role "${context.role}" is not in ${allowedRoles.join(',')}. Access denied.`);
  }
}

/**
 * Admin ロール必須
 *
 * @param context - CompanyContext
 * @throws Error when role is not 'admin'
 */
export function requireAdmin(context: CompanyContext): void {
  requireRole(context, ['admin']);
}

/**
 * Manager 以上のロール必須
 *
 * @param context - CompanyContext
 * @throws Error when role is not 'admin' or 'manager'
 */
export function requireManager(context: CompanyContext): void {
  requireRole(context, ['admin', 'manager']);
}
