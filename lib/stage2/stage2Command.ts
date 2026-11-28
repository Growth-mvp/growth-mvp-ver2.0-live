import { create } from 'zustand';

/** チャットからの生成の依頼。画面（STAGE2）の既存の生成処理が受け取って実行する */
type Stage2CommandState = {
  pending: 'draft' | 'final' | null;
  request: (kind: 'draft' | 'final') => void;
  clear: () => void;
};

export const useStage2CommandStore = create<Stage2CommandState>((set) => ({
  pending: null,
  request: (kind) => set({ pending: kind }),
  clear: () => set({ pending: null }),
}));
