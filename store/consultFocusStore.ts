import { create } from 'zustand';
import type { ConsultFocusEntry } from '@/lib/consult/consultFocus';

type ConsultFocusState = {
  entries: Record<string, ConsultFocusEntry>;
  setEntry: (owner: string, entry: ConsultFocusEntry | null) => void;
};

export const useConsultFocusStore = create<ConsultFocusState>((set) => ({
  entries: {},
  setEntry: (owner, entry) =>
    set((s) => {
      const next = { ...s.entries };
      if (entry) next[owner] = entry;
      else delete next[owner];
      return { entries: next };
    }),
}));
