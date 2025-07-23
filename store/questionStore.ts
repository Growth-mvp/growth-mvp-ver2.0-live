import { create } from 'zustand';

interface QuestionStore {
  // 第1ラウンド用
  currentQuestion: string;
  questionReason: string;
  answer: string;
  step: number;
  loading: boolean;
  setQuestion: (question: string, reason: string) => void;
  setAnswer: (answer: string) => void;
  nextStep: () => void;
  reset: () => void;
  setLoading: (loading: boolean) => void;

  // ✅ 第2ラウンド用
  questions2: string[];
  answers2: string[];
  setQuestions2: (questions: string[]) => void;
  setAnswers2: (answers: string[]) => void;
}

export const useQuestionStore = create<QuestionStore>((set) => ({
  // 第1ラウンド初期状態
  currentQuestion: '',
  questionReason: '',
  answer: '',
  step: 0,
  loading: false,
  setQuestion: (question, reason) => set({ currentQuestion: question, questionReason: reason }),
  setAnswer: (answer) => set({ answer }),
  nextStep: () => set((state) => ({ step: state.step + 1, answer: '' })),
  reset: () => set({
    step: 0,
    currentQuestion: '',
    questionReason: '',
    answer: '',
  }),
  setLoading: (loading) => set({ loading }),

  // ✅ 第2ラウンド初期状態
  questions2: [],
  answers2: [],
  setQuestions2: (questions) => set({ questions2: questions }),
  setAnswers2: (answers) => set({ answers2: answers }),
}));
