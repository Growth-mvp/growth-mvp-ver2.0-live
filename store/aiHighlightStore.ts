import { create } from 'zustand';
import { revealOf, type Reveal } from '@/lib/stage1/revealTargets';

type AiHighlightState = {
  target: string | null;
  at: number;
  /** 対象を見せるための、タブ・折りたたみ欄・事業の選択 */
  reveal: Reveal | null;
  flash: (target: string) => void;
};

/** AIが入力欄に反映した箇所を、表示の切り替えと強調のために知らせる（値は持たない） */
export const useAiHighlightStore = create<AiHighlightState>((set) => ({
  target: null,
  at: 0,
  reveal: null,
  flash: (target) => set({ target, at: Date.now(), reveal: revealOf(target) }),
}));
