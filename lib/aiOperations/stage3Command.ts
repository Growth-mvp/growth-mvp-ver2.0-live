import { create } from 'zustand';

/* AI経営コンサルタントからの「戦略書を再生成」の指示を、STAGE3の画面へ渡す一時的な状態。保存はしない。
 * 画面の既存の生成処理（6問の回答を保存してから再生成する）を、画面側が実行する。 */
type Stage3CommandState = {
  pendingDepartmentName: string | null;
  setPendingDepartmentName: (name: string) => void;
  clearPending: () => void;
};

export const useStage3CommandStore = create<Stage3CommandState>()((set) => ({
  pendingDepartmentName: null,
  setPendingDepartmentName: (name) => set({ pendingDepartmentName: name }),
  clearPending: () => set({ pendingDepartmentName: null }),
}));
