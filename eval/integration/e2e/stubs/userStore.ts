/* 評価用：ログイン中の架空の利用者（会社と役割だけ）。実際の認証には接続しない */
import { create } from 'zustand';
import { IDS } from '../ids';

export const useUserStore = create<any>(() => ({
  companyId: IDS.companyA,
  role: 'admin',
  isAdmin: true,
  isManager: false,
  isMember: false,
  user: { id: IDS.alice },
}));
