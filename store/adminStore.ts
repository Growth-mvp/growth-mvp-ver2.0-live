// /store/adminStore.ts
import { create } from 'zustand'

type AdminKnowledge = {
  purpose: string
  founderStory: string
  ceoMessage: string
  values: string
  midTermPlan: string
  currentPolicy: string
  competitiveEdge: string
  focusAreas: string
  orgStructure: string
  behaviorGuidelines: string
  evaluationPolicy: string
  faq: string
}

type AdminStore = AdminKnowledge & {
  setField: (key: keyof AdminKnowledge, value: string) => void
  reset: () => void
}

const initialState: AdminKnowledge = {
  purpose: '',
  founderStory: '',
  ceoMessage: '',
  values: '',
  midTermPlan: '',
  currentPolicy: '',
  competitiveEdge: '',
  focusAreas: '',
  orgStructure: '',
  behaviorGuidelines: '',
  evaluationPolicy: '',
  faq: '',
}

export const useAdminStore = create<AdminStore>((set) => ({
  ...initialState,
  setField: (key, value) => set((state) => ({ ...state, [key]: value })),
  reset: () => set(initialState),
}))
