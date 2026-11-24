import { create } from 'zustand';
import type { OperationProposal } from './instruction';

/* 承認を待つ入力案。保存はしない。会社・画面が変わったら破棄する（保存の判断は承認の時に行う）。 */
type ProposalState = {
  pending: OperationProposal | null;
  setPending: (proposal: OperationProposal) => void;
  clearPending: () => void;
};

export const useOperationProposalStore = create<ProposalState>()((set) => ({
  pending: null,
  setPending: (proposal) => set({ pending: proposal }),
  clearPending: () => set({ pending: null }),
}));
