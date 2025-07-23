import { create } from 'zustand';

interface StoryState {
  story: string;
  summary: string;
  setStory: (story: string) => void;
  setSummary: (summary: string) => void;
}

export const useStoryStore = create<StoryState>((set) => ({
  story: '',
  summary: '',
  setStory: (story) => set({ story }),
  setSummary: (summary) => set({ summary }),
}));
