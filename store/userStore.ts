import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';

// 🔹 ユーザー型（ロール、部署などを含む）
export type User = {
  id: string;
  name: string;
  email: string;
  role: 'admin' | 'manager' | 'member';
  department?: string;
};

// 🔹 Zustand のストア型
export type UserState = {
  user: User | null;
  setUser: (user: User | null) => void;
  clearUser: () => void;
};

// 🔹 Zustand ストアの定義（localStorage永続化を明示）
export const useUserStore = create<UserState>()(
  persist(
    (set) => ({
      user: null,
      setUser: (user) => set({ user }),
      clearUser: () => set({ user: null }),
    }),
    {
      name: 'user-storage',
      storage: createJSONStorage(() => localStorage), // 🔸明示的に localStorage を使用
    }
  )
);
