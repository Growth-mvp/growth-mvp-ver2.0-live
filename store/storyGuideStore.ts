import { create } from 'zustand';

interface StoryGuideState {
  // 第1ラウンド
  questions: string[];
  answers: string[];
  setQuestions: (q: string[]) => void;
  setAnswers: (a: string[]) => void; // ✅ 一括設定
  setAnswer: (index: number, value: string) => void;

  // 第2ラウンド
  questions2: string[];
  answers2: string[];
  setQuestions2: (q: string[]) => void;
  setAnswers2: (a: string[]) => void; // ✅ 一括設定
  setAnswer2: (index: number, value: string) => void;

  // リセット
  reset: () => void;
}

export const useStoryGuideStore = create<StoryGuideState>((set) => ({
  // 初期値
  questions: [],
  answers: [],
  questions2: [],
  answers2: [],

  // 第1ラウンド
  setQuestions: (q) => set({ questions: q }),
  setAnswers: (a) => set({ answers: a }),
  setAnswer: (index, value) =>
    set((state) => {
      const updated = [...state.answers];
      updated[index] = value;
      return { answers: updated };
    }),

  // 第2ラウンド
  setQuestions2: (q) => set({ questions2: q }),
  setAnswers2: (a) => set({ answers2: a }),
  setAnswer2: (index, value) =>
    set((state) => {
      const updated = [...state.answers2];
      updated[index] = value;
      return { answers2: updated };
    }),

  // リセット
  reset: () =>
    set({
      questions: [],
      answers: [],
      questions2: [],
      answers2: [],
    }),
}));
