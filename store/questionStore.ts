import { create } from 'zustand';

interface QuestionStore {
  // 第1ラウンド
  currentQuestion: string;
  questionReason: string;
  answer: string;
  answers: string[]; // 🔹 ラウンド1の回答履歴を保持
  step: number;
  loading: boolean;

  setQuestion: (question: string, reason: string) => void;
  setAnswer: (answer: string) => void;
  setAnswers: (answers: string[]) => void; // 🔹 回答配列を直接設定
  nextStep: () => void;
  setStep: (step: number) => void;
  reset: () => void;
  setLoading: (loading: boolean) => void;

  // 第2ラウンド（Follow-up）
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
  answers: [], // 🔹 初期化
  step: 0,
  loading: false,

  setQuestion: (question, reason) =>
    set({ currentQuestion: question, questionReason: reason }),

  setAnswer: (answer) => set({ answer }),

  setAnswers: (answers) => set({ answers }), // 🔹 配列設定

  nextStep: () =>
    set((state) => ({
      step: state.step + 1,
      answers: [...state.answers, state.answer], // 🔹 回答蓄積
      answer: '',
    })),

  setStep: (step) => set({ step }),

  reset: () =>
    set({
      step: 0,
      currentQuestion: '',
      questionReason: '',
      answer: '',
      answers: [], // 🔹 忘れずに初期化
      questions2: [],
      answers2: [],
    }),

  setLoading: (loading) => set({ loading }),

  // 第2ラウンド初期状態
  questions2: [],
  answers2: [],
  setQuestions2: (questions) => set({ questions2: questions }),
  setAnswers2: (answers) => set({ answers2: answers }),
}));
