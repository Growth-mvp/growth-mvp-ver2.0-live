import { create } from 'zustand';
import type { StageOp } from './stage1Input';
import type { Stage2Op } from '@/lib/stage2/stage2Input';

/** AIが反映した直前の入力。取り消しは、対象の値が反映時のまま（他の変更がない）場合だけ行う */
export type AiWriteRecord = {
  companyId: string;
  strategyId: string;
  userId: string;
  op: StageOp | Stage2Op;
  undo: StageOp | Stage2Op;
  afterSignature: string;
  label: string;
};

type AiUndoState = {
  last: AiWriteRecord | null;
  record: (r: AiWriteRecord) => void;
  clear: () => void;
};

export const useAiUndoStore = create<AiUndoState>((set) => ({
  last: null,
  record: (r) => set({ last: r }),
  clear: () => set({ last: null }),
}));
