// ✅ ③ store/storyGuideStore.ts
import { create } from 'zustand'

interface StoryGuideState {
  answers: string[]
  setAnswer: (index: number, value: string) => void
}

export const useStoryGuideStore = create<StoryGuideState>((set) => ({
  answers: [],
  setAnswer: (index, value) =>
    set((state) => {
      const updated = [...state.answers]
      updated[index] = value
      return { answers: updated }
    }),
}))
