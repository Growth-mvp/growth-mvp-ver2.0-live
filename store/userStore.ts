
// /store/userStore.ts
import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';

/* =========================================================
 * 型定義（互換維持 + RBAC拡張）
 * ========================================================= */
export type Role = 'admin' | 'manager' | 'member';

// ユーザー（個人プロフィール用）
export type User = {
  id: string;
  name: string;
  email: string;
  role: Role;              // ★ プロフィール上のロール（UI判定には使わない）
  departmentId?: string;   // ★ department → departmentId に統一
};

// 所属（会社・部門ID＋会社内ロール）
export type Membership = {
  companyId: string | null;
  departmentId: string | null;
  role: Role | null;       // ★ UI判定の唯一の真実
};

export type UserState = {
  user: User | null;

  companyId: string | null;
  departmentId: string | null;
  role: Role | null;       // UI権限（membership.roleのミラー）

  isLoggedIn: boolean;
  hydrated: boolean;
  membershipLoaded: boolean;

  // 互換用フラグ
  isAdmin: boolean;
  isManager: boolean;
  isMember: boolean;

  /* ---------- actions ---------- */
  setUser: (user: User | null) => void;
  setMembership: (m: Partial<Membership>) => void;
  setCompanyId: (companyId: string | null | undefined) => void;     // ← ここだけ拡張
  setDepartmentId: (departmentId: string | null | undefined) => void; // ← ここだけ拡張
  setRole: (role: Role | null) => void;

  clearUser: () => void;
  setHydrated: (v: boolean) => void;
  setMembershipLoaded: (v: boolean) => void;
  resetMembershipLoading: () => void;

  /* ---------- RBAC helpers ---------- */
  canView: () => boolean;
  canEditCompany: () => boolean;
  canEditDepartment: (deptId?: string | null) => boolean;
  canEditProject: (deptId?: string | null) => boolean;
};

/* =========================================================
 * SSR安全な storage
 * ========================================================= */
const isClient = typeof window !== 'undefined';

function deriveRoleFlags(role: Role | null) {
  const isAdmin = role === 'admin';
  const isManager = role === 'admin' || role === 'manager';
  const isMember = role != null; // ロールがあれば参加済み
  return { isAdmin, isManager, isMember };
}

/* =========================================================
 * ストア本体
 * ========================================================= */
export const useUserStore = create<UserState>()(
  persist(
    (set, get) => ({
      user: null,
      companyId: null,
      departmentId: null,
      role: null,
      isLoggedIn: false,
      hydrated: false,
      membershipLoaded: false,
      ...deriveRoleFlags(null),

      /* ---------- setUser ----------
       * プロフィール更新のみ。
       * UI権限(root role)はここで変更しない。
       */
      setUser: (user) => {
        set({
          user,
          isLoggedIn: !!user,
        });
      },

      /* ---------- setMembership ----------
       * 会社所属とUI権限を更新。
       * - companyId/departmentId は undefined を null に正規化
       * - role は UI 判定の唯一の真実（互換: user.role も上書き）
       */
      setMembership: (m) => {
        const next: Partial<UserState> = {};
        if ('companyId' in m) next.companyId = m.companyId ?? null;
        if ('departmentId' in m) next.departmentId = m.departmentId ?? null;

        if ('role' in m) {
          const newRole = (m.role ?? null) as Role | null;
          next.role = newRole;
          Object.assign(next, deriveRoleFlags(newRole));

          const u = get().user;
          if (u && newRole) {
            // 互換維持：プロフィール側の role もミラー更新
            next.user = { ...u, role: newRole } as User;
          }
        }
        set(next as UserState);
      },

      setCompanyId: (companyId) => set({ companyId: companyId ?? null }),
      setDepartmentId: (departmentId) => set({ departmentId: departmentId ?? null }),

      /* ---------- setRole ----------
       * 明示的にUI権限を更新したいときだけ。
       * - プロフィール側 user.role もミラー（互換）
       */
      setRole: (role) => {
        const derived = deriveRoleFlags(role);
        const u = get().user;
        set({
          role,
          ...derived,
          user: u ? { ...u, role: (role ?? u.role ?? 'member') as Role } : null,
        });
      },

      clearUser: () => {
        set({
          user: null,
          companyId: null,
          departmentId: null,
          role: null,
          isLoggedIn: false,
          membershipLoaded: false,
          ...deriveRoleFlags(null),
        });
      },

      setHydrated: (v) => set({ hydrated: v }),
      setMembershipLoaded: (v) => set({ membershipLoaded: v }),

      resetMembershipLoading: () => {
        set({
          companyId: null,
          departmentId: null,
          role: null,
          membershipLoaded: false,
          ...deriveRoleFlags(null),
        });
      },

      /* ---------- RBAC helpers ---------- */
      canView: () => !!get().companyId,
      canEditCompany: () => get().role === 'admin',
      canEditDepartment: (deptId?: string | null) => {
        const role = get().role;
        if (role === 'admin') return true;
        if (role === 'manager') {
          if (deptId == null) return true; // 部門未指定なら許可
          return get().departmentId != null && get().departmentId === deptId;
        }
        return false;
      },
      canEditProject: (deptId?: string | null) => {
        return get().canEditDepartment(deptId);
      },
    }),
    {
      name: 'user-storage',
      version: 6, // ★ version を1つ上げる（移行処理を走らせるため）
      ...(isClient ? { storage: createJSONStorage(() => localStorage) } : {}),

      // 既存データからの移行
      migrate: (persistedState: any, version) => {
        if (!persistedState) return persistedState;
        if (version < 6) {
          const user = persistedState.user ?? null;
          const role: Role | null = (persistedState.role as Role | null) ?? null;
          const derived = deriveRoleFlags(role);

          // department → departmentId に移行
          const departmentId =
            persistedState.departmentId ??
            persistedState.department ??
            null;

          return {
            ...persistedState,
            companyId: persistedState.companyId ?? null,
            departmentId,
            role,
            isLoggedIn: !!user,
            hydrated: false,
            membershipLoaded: persistedState.membershipLoaded ?? false,
            ...derived,
          } as UserState;
        }
        return persistedState as UserState;
      },

      onRehydrateStorage: () => (state) => {
        if (state?.setHydrated) state.setHydrated(true);
      },
    }
  )
);
