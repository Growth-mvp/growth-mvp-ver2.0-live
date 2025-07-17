import { create } from 'zustand';

type User = {
  id: string;
  email: string;
  role: 'admin' | 'manager' | 'member';
  department?: string;
};

type UserState = {
  user: User | null;
  setUser: (user: User | null) => void;
};

export const useUserStore = create<UserState>((set) => ({
  user: null,
  setUser: (user) => set({ user }),
}));
