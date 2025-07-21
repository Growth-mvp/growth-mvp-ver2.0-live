import { create } from 'zustand';
import { persist } from 'zustand/middleware';

// 🔹 ユーザー型（ロール、部署などを含む）
export type User = {
  id: string;
  name: string;
  email: string;
  role: 'admin' | 'manager' | 'member'; // ✅ 明示的に役割を定義
  department?: string; // オプション（部門紐付け）
};

// 🔹 Zustand のストア型
export type UserState = {
  user: User | null;
  setUser: (user: User | null) => void;
  clearUser: () => void;
};

// 🔹 Zustand ストアの定義
export const useUserStore = create<UserState>()(
  persist(
    (set) => ({
      user: null,
      setUser: (user) => set({ user }),
      clearUser: () => set({ user: null }),
    }),
    {
      name: 'user-storage', // localStorage のキー名
    }
  )
);
