import { create } from 'zustand';

// 🔽 第2ラウンド用の型を追加
export type AnswerStep = {
  question: string;
  reason: string;
  answer: string;
};

export type ChapterAnswers = {
  chapterTitle: string;
  steps: AnswerStep[];
};

interface QuestionStore {
  // 第1ラウンド
  currentQuestion: string;
  questionReason: string;
  answer: string;
  answers: string[];
  step: number;
  loading: boolean;

  setQuestion: (question: string, reason: string) => void;
  setAnswer: (answer: string) => void;
  setAnswers: (answers: string[]) => void;
  nextStep: () => void;
  setStep: (step: number) => void;
  reset: () => void;
  setLoading: (loading: boolean) => void;

  // 第2ラウンド（章ごとの深掘り質問）
  answers2: ChapterAnswers[];
  setAnswers2: (answers: ChapterAnswers[]) => void;
}

export const useQuestionStore = create<QuestionStore>((set) => ({
  // 第1ラウンド初期状態
  currentQuestion: '',
  questionReason: '',
  answer: '',
  answers: [],
  step: 0,
  loading: false,

  setQuestion: (question, reason) =>
    set({ currentQuestion: question, questionReason: reason }),

  setAnswer: (answer) => set({ answer }),

  setAnswers: (answers) => set({ answers }),

  nextStep: () =>
    set((state) => ({
      step: state.step + 1,
      answers: [...state.answers, state.answer],
      answer: '',
    })),

  setStep: (step) => set({ step }),

  reset: () =>
    set({
      step: 0,
      currentQuestion: '',
      questionReason: '',
      answer: '',
      answers: [],
      answers2: [],
    }),

  setLoading: (loading) => set({ loading }),

  // 第2ラウンド初期状態（新形式）
  answers2: [],
  setAnswers2: (answers) => set({ answers2: answers }),
}));
