// /utils/access.ts
'use client';

import { useUserStore } from '@/store/userStore';

export type AppRole = 'admin' | 'manager' | 'member' | null;

export function useAccess() {
  const role = useUserStore((s) => s.role);           // 'admin' | 'manager' | 'member' | null | undefined
  const companyId = useUserStore((s) => s.companyId); // string | null | undefined
  const user = useUserStore((s) => s.user);           // { id:string } | null | undefined

  // hydrate 完了フラグ（無ければ undefined 想定）
  // @ts-ignore
  const hasHydrated = useUserStore.persist?.hasHydrated?.();

  // MembershipBootstrap 側で立てる任意のフラグ（無ければ undefined）
  const bootstrapReady = useUserStore((s) => (s as any).bootstrapReady as boolean | undefined);

  // “値が未確定” なら loading
  const loading =
    (hasHydrated === false) ||
    (bootstrapReady === false) ||
    (user === undefined || role === undefined || companyId === undefined);

  const userId = user?.id ?? null;
  const isLoggedIn = !!userId;
  const hasCompany = !!companyId;

  const isAdmin = role === 'admin';
  const isManager = role === 'admin' || role === 'manager';
  const isMember = role === 'member';

  const canView = () => isLoggedIn && hasCompany;
  const canEditCompany = () => isAdmin;
  const canEditDepartment = (_?: string | null) => isAdmin || isManager;

  // ★Phase 1: Project owner に対応
  // admin/manager は全編集可、member は自 owner project のみ
  const canEditProject = (projectOwnerUserId?: string | null, _departmentId?: string | null) =>
    isAdmin || isManager || (isMember && !!projectOwnerUserId && projectOwnerUserId === userId);

  // Project owner 割り当て権限（admin/manager のみ）
  const canAssignProjectOwner = (_?: string | null) => isAdmin || isManager;

  const canEditOKR = (ownerUserId?: string | null) =>
    isAdmin || isManager || (isMember && !!ownerUserId && ownerUserId === userId);
  const canPostProgressLog = () => isLoggedIn && hasCompany;

  return {
    userId, companyId, role,
    isLoggedIn, isAdmin, isManager, isMember, hasCompany,
    loading,                // ← 重要
    canView, canEditCompany, canEditDepartment, canEditProject, canAssignProjectOwner, canEditOKR, canPostProgressLog,
  };
}

export type AccessApi = ReturnType<typeof useAccess>;
