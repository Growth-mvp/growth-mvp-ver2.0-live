// 'use client';  
import { create } from 'zustand';
import {
  saveStrategyData,
  loadStrategyData,
  deleteStrategyData,
} from '../utils/supabase';
import { useUserStore } from './userStore';
import {
  Department,
  Project,
  ChapterAnswers,
  ChapterStory,
  StrategyData,
  AnswerStep,
} from '@/types/strategy';

export interface StrategyState extends StrategyData {
  // Setter関数
  setCompanyName: (v: string) => void;
  setFoundationYear: (v: string) => void;
  setLocation: (v: string) => void;
  setIndustry: (v: string) => void;
  setRevenue: (v: string) => void;
  setEmployees: (v: string) => void;
  setBusinessContent: (v: string) => void;
  setCustomerSegment: (v: string) => void;
  setThought: (v: string) => void;
  setStrength: (v: string) => void;
  setWeakness: (v: string) => void;
  setOpportunity: (v: string) => void;
  setThreat: (v: string) => void;
  setRole: (v: 'admin' | 'manager' | 'member') => void;
  setMission: (v: string) => void;
  setVision: (v: string) => void;
  setValue: (v: string) => void;

  // ストーリー・戦略要約
  setStory: (v: string | ChapterStory[]) => void;
  setFinalStory: (v: ChapterStory[]) => void;
  setStrategySummary: (v: string) => void;

  // カスケード
  setEditableCascadeResult: (v: Department[]) => void;
  updateDepartmentStrategy: (deptName: string, newStrategy: string) => void;
  updateProject: (deptName: string, projIndex: number, newProj: Project) => void;
  addProject: (deptName: string, newProj: Project) => void;
  deleteProject: (deptName: string, projIndex: number) => void;

  // その他
  setCsvFinanceData: (data: any[]) => void;
  setFinanceData: (data: any[]) => void;
  setNotification: (v: string) => void;

  // 質問・回答
  setAnswers: (v: string[]) => void;
  setAnswers2: (v: ChapterAnswers[]) => void;
  setAnswersToStrategyStore: (payload: {
    answers: string[];
    questions?: string[];
    reasons?: string[];
    answers2?: ChapterAnswers[];
    questions2?: string[];
    reasons2?: string[];
  }) => void;
  updateDepartmentAnswer: (chapterIdx: number, stepIdx: number, answer: string) => void;

  // Supabase
  saveToSupabase: () => Promise<void>;
  loadFromSupabase: () => Promise<void>;
  clearAllData: () => Promise<void>;
}

export const useStrategyStore = create<StrategyState>((set, get) => ({
  // 初期状態
  companyName: '',
  foundationYear: '',
  location: '',
  industry: '',
  revenue: '',
  employees: '',
  role: 'member',
  businessContent: '',
  customerSegment: '',
  thought: '',
  strength: '',
  weakness: '',
  opportunity: '',
  threat: '',
  mission: '',
  vision: '',
  value: '',
  story: [],
  finalStory: [],
  strategySummary: '',
  editableCascadeResult: [],
  csvFinanceData: [],
  notification: '',
  answers: [],
  questions: [],
  reasons: [],
  answers2: [],
  questions2: [],
  reasons2: [],

  // Setter
  setCompanyName: (v) => set({ companyName: v }),
  setFoundationYear: (v) => set({ foundationYear: v }),
  setLocation: (v) => set({ location: v }),
  setIndustry: (v) => set({ industry: v }),
  setRevenue: (v) => set({ revenue: v }),
  setEmployees: (v) => set({ employees: v }),
  setBusinessContent: (v) => set({ businessContent: v }),
  setCustomerSegment: (v) => set({ customerSegment: v }),
  setThought: (v) => set({ thought: v }),
  setStrength: (v) => set({ strength: v }),
  setWeakness: (v) => set({ weakness: v }),
  setOpportunity: (v) => set({ opportunity: v }),
  setThreat: (v) => set({ threat: v }),
  setRole: (v) => set({ role: v }),
  setMission: (v) => set({ mission: v }),
  setVision: (v) => set({ vision: v }),
  setValue: (v) => set({ value: v }),
  setStory: (v) => set({ story: v }),
  setFinalStory: (v) => set({ finalStory: v }),
  setStrategySummary: (v) => set({ strategySummary: v }),
  setEditableCascadeResult: (v) => set({ editableCascadeResult: v }),
  setCsvFinanceData: (v) => set({ csvFinanceData: v }),
  setFinanceData: (v) => set({ csvFinanceData: v }),
  setNotification: (v) => set({ notification: v }),
  setAnswers: (v) => set({ answers: v }),
  setAnswers2: (v) => set({ answers2: v }),

  setAnswersToStrategyStore: (payload) =>
    set((state) => ({
      ...state,
      answers: payload.answers,
      questions: payload.questions ?? state.questions,
      reasons: payload.reasons ?? state.reasons,
      answers2: payload.answers2 ?? state.answers2,
      questions2: payload.questions2 ?? state.questions2,
      reasons2: payload.reasons2 ?? state.reasons2,
    })),

  updateDepartmentAnswer: (chapterIdx, stepIdx, newAnswer) => {
  set((state) => {
    const updatedDepartments = [...state.editableCascadeResult];
    const department = updatedDepartments[chapterIdx];

    if (!department) return state;

    const currentAnswers = department.answers2 || [];
    const updatedAnswers = [...currentAnswers];

    if (!updatedAnswers[0]) {
      updatedAnswers[0] = { chapterIndex: chapterIdx, chapterTitle: department.name, steps: [] };
    }

    const updatedSteps: AnswerStep[] = [...updatedAnswers[0].steps];
    updatedSteps[stepIdx] = {
      ...(updatedSteps[stepIdx] || {}),
      stepNumber: stepIdx + 1,
      answer: newAnswer,
    };

    updatedAnswers[0] = {
      ...updatedAnswers[0],
      steps: updatedSteps,
    };

    updatedDepartments[chapterIdx] = {
      ...department,
      answers2: updatedAnswers,
    };

    return { editableCascadeResult: updatedDepartments };
  });
},


  updateDepartmentStrategy: (deptName, newStrategy) => {
    const updated = get().editableCascadeResult.map((dept) =>
      dept.name === deptName ? { ...dept, strategy: newStrategy } : dept
    );
    set({ editableCascadeResult: updated });
  },

  updateProject: (deptName, projIndex, newProj) => {
    const updated = get().editableCascadeResult.map((dept) => {
      if (dept.name === deptName) {
        const newProjects = [...dept.projects];
        newProjects[projIndex] = newProj;
        return { ...dept, projects: newProjects };
      }
      return dept;
    });
    set({ editableCascadeResult: updated });
  },

  addProject: (deptName, newProj) => {
    const updated = get().editableCascadeResult.map((dept) =>
      dept.name === deptName
        ? { ...dept, projects: [...dept.projects, newProj] }
        : dept
    );
    set({ editableCascadeResult: updated });
  },

  deleteProject: (deptName, projIndex) => {
    const updated = get().editableCascadeResult.map((dept) => {
      if (dept.name === deptName) {
        const newProjects = [...dept.projects];
        newProjects.splice(projIndex, 1);
        return { ...dept, projects: newProjects };
      }
      return dept;
    });
    set({ editableCascadeResult: updated });
  },

  saveToSupabase: async () => {
    const state = get();
    const userId = useUserStore.getState().user?.id;
    if (!userId) {
      set({ notification: '⚠️ ユーザーIDが存在しないため保存できません' });
      return;
    }

    const answers2WithQuestions = state.answers2.map((chapter) => ({
      chapterIndex: chapter.chapterIndex,
      chapterTitle: chapter.chapterTitle,
      steps: chapter.steps.map((step) => ({
        stepNumber: step.stepNumber,
        question: step.question ?? '',
        reason: step.reason ?? '',
        answer: step.answer ?? '',
      })),
    }));

    const dataToSave: StrategyData = {
      ...state,
      notification: '',
      answers2: answers2WithQuestions,
    };

    const { error } = await saveStrategyData(dataToSave, userId);
    if (error) {
      console.error('❌ Supabase保存エラー:', error);
      set({ notification: '❌ 保存に失敗しました' });
    } else {
      set({ notification: '✅ 保存に成功しました' });
    }
  },

  loadFromSupabase: async () => {
    const userId = useUserStore.getState().user?.id;
    if (!userId) return;

    const { data, error } = await loadStrategyData(userId);
    if (error || !data) {
      console.error('❌ Supabase読み込み失敗:', error);
      return;
    }

    set({
      ...data,
      notification: '',
    });
  },

  clearAllData: async () => {
    const userId = useUserStore.getState().user?.id;
    if (!userId) return;

    const { error } = await deleteStrategyData(userId);
    if (error) {
      console.error('❌ Supabase削除エラー:', error);
      set({ notification: '❌ データ削除に失敗しました' });
    } else {
      set({
        companyName: '',
        foundationYear: '',
        location: '',
        industry: '',
        revenue: '',
        employees: '',
        role: 'member',
        businessContent: '',
        customerSegment: '',
        thought: '',
        strength: '',
        weakness: '',
        opportunity: '',
        threat: '',
        mission: '',
        vision: '',
        value: '',
        story: [],
        finalStory: [],
        strategySummary: '',
        editableCascadeResult: [],
        csvFinanceData: [],
        answers: [],
        questions: [],
        reasons: [],
        answers2: [],
        questions2: [],
        reasons2: [],
        notification: '🧹 データを初期化しました',
      });
    }
  },
}));