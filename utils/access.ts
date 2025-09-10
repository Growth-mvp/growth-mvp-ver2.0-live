// /utils/access.ts
'use client';

import { useUserStore } from '@/store/userStore';

/**
 * アクセス制御（フロント専用）
 * 権限の唯一の真実は company_members.role（= useUserStore().role にミラー）
 * Cookie 参照は廃止。MembershipBootstrap で store を同期して使う。
 */

export type AppRole = 'admin' | 'manager' | 'member' | null;

export function useAccess() {
  // 役割と所属は store（membership ミラー）から取得
  const role = useUserStore((s) => s.role);                // 'admin' | 'manager' | 'member' | null
  const companyId = useUserStore((s) => s.companyId);      // 所属会社ID
  const userId = useUserStore((s) => s.user?.id ?? null);  // 自分のユーザーID
  const isLoggedIn = !!userId;
  const hasCompany = !!companyId;

  const isAdmin = role === 'admin';
  const isManager = role === 'admin' || role === 'manager';
  const isMember = role === 'member';

  /** 閲覧許可：ログイン済み かつ 会社所属あり */
  const canView = () => isLoggedIn && hasCompany;

  /** 会社スコープ編集（メンバー管理・会社設定など） */
  const canEditCompany = () => isAdmin;

  /** 部門スコープ編集：Admin/Manager 可（必要なら自部門チェックを追加） */
  const canEditDepartment = (_deptId?: string | null) => isAdmin || isManager;

  /** プロジェクト編集は部門に追従 */
  const canEditProject = (_deptId?: string | null) => canEditDepartment(_deptId);

  /** OKR編集：Admin/Manager 可、Member は自分のOKRのみ */
  const canEditOKR = (ownerUserId?: string | null) =>
    isAdmin || isManager || (isMember && !!ownerUserId && ownerUserId === userId);

  /** 進捗ログ投稿：会社所属のログインユーザーなら可（対象OKRの権限チェックは別途） */
  const canPostProgressLog = () => isLoggedIn && hasCompany;

  return {
    // 基本情報
    userId,
    companyId,
    role,
    isLoggedIn,
    isAdmin,
    isManager,
    isMember,
    hasCompany,
    // 権限判定API
    canView,
    canEditCompany,
    canEditDepartment,
    canEditProject,
    canEditOKR,
    canPostProgressLog,
  };
}

export type AccessApi = ReturnType<typeof useAccess>;
