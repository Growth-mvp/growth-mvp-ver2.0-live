import { create } from 'zustand';

type AiHighlightState = {
  target: string | null;
  at: number;
  flash: (target: string) => void;
};

/** AIが入力欄に反映した箇所を、画面側でスクロール・強調するための合図（値は持たない） */
export const useAiHighlightStore = create<AiHighlightState>((set) => ({
  target: null,
  at: 0,
  flash: (target) => set({ target, at: Date.now() }),
}));
