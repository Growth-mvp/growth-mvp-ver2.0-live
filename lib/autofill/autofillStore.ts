/* AI経営コンサルタントが作った入力候補を、STAGE1の入力欄（承認の画面）へ渡す。反映はしない。 */
import { create } from 'zustand';
import type { FilingCandidate } from './filingCandidates';
import type { PublicCandidate } from './publicCandidate';

export type AutofillCandidate = FilingCandidate | PublicCandidate;

export type PendingAutofill = {
  companyId: string;
  strategyId: string;
  fetchedAt: string;
  candidate: AutofillCandidate;
};

type AutofillState = {
  pending: PendingAutofill | null;
  setPending: (p: PendingAutofill | null) => void;
};

export const useAutofillStore = create<AutofillState>()((set) => ({
  pending: null,
  setPending: (pending) => set({ pending }),
}));
