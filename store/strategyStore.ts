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
  strategyId: string; // ✅ 追加
  setStrategyId: (id: string) => void; // ✅ 追加
  
  // setter群
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
  setStory: (v: string | ChapterStory[]) => void;
  setFinalStory: (v: ChapterStory[]) => void;
  setStrategySummary: (v: string) => void;
  setEditableCascadeResult: (v: Department[]) => void;
  setCsvFinanceData: (data: any[]) => void;
  setFinanceData: (data: any[]) => void;
  setNotification: (v: string) => void;
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
  updateDepartmentAnswer: (
    deptIdx: number,
    chapterIdx: number,
    stepIdx: number,
    answer: string
  ) => void;
  updateDepartmentStrategy: (deptName: string, newStrategy: string) => void;
  updateProject: (deptName: string, projIndex: number, newProj: Project) => void;
  addProject: (deptName: string, newProj: Project) => void;
  deleteProject: (deptName: string, projIndex: number) => void;
  finalizeDepartment: (index: number) => void;
  regenerateDepartmentMission: (deptIdx: number, newMission: string) => void;
  confirmDepartmentStrategy: (deptIdx: number) => void;



  saveToSupabase: () => Promise<void>;
  loadFromSupabase: () => Promise<void>;
  clearAllData: () => Promise<void>;
}

export const useStrategyStore = create<StrategyState>((set, get) => ({
  strategyId: '', // ✅ 追加
  setStrategyId: (id) => set({ strategyId: id }), // ✅ 追加
  
  
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

  updateDepartmentAnswer: (
  deptIdx,
  chapterIdx,
  stepIdx,
  answer,
  question = '',
  reason = ''
) => {
  set((state) => {
    const departments = [...state.editableCascadeResult];
    const department = departments[deptIdx];
    if (!department) return state;

    const answers2 = department.answers2 ?? [];
    let chapter = answers2.find((ch) => ch.chapterIndex === chapterIdx);

    if (!chapter) {
      chapter = {
        chapterIndex: chapterIdx, // ← 正しく変数を使う
        chapterTitle: department.name,
        steps: [],
      };
      answers2.push(chapter);
    }

    const steps = [...chapter.steps];

    if (!steps[stepIdx]) {
      // ステップが存在しなければ初期化
      steps[stepIdx] = {
        stepNumber: stepIdx + 1,
        question,
        reason,
        answer,
      };
    } else {
      // ステップが既に存在すれば上書き
      steps[stepIdx] = {
        ...steps[stepIdx],
        answer,
        question: question || steps[stepIdx].question,
        reason: reason || steps[stepIdx].reason,
      };
    }

    chapter.steps = steps;

    departments[deptIdx] = {
      ...department,
      answers2,
    };

    return { editableCascadeResult: departments };
  });
},



  finalizeDepartment: (index) => {
    set((state) => {
      const updated = [...state.editableCascadeResult];
      if (updated[index]) updated[index].finalized = true;
      return { editableCascadeResult: updated };
    });
  },

    regenerateDepartmentMission: (deptIdx, newMission) => {
    set((state) => {
      const departments = [...state.editableCascadeResult];
      if (!departments[deptIdx]) return state;

      departments[deptIdx] = {
        ...departments[deptIdx],
        strategy: newMission, // mission ではなく strategy に保存されている想定
      };

      return { editableCascadeResult: departments };
    });
  },

  confirmDepartmentStrategy: (deptIdx) => {
    set((state) => {
      const departments = [...state.editableCascadeResult];
      if (!departments[deptIdx]) return state;

      departments[deptIdx] = {
        ...departments[deptIdx],
        finalized: true,
      };

      return { editableCascadeResult: departments };
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
  
  // OKRの追加
addOKRToProject(deptIdx: number, projIdx: number) {
  set((state) => {
    const departments = [...state.editableCascadeResult];
    const department = departments[deptIdx];
    if (!department) return state;

    const projects = [...department.projects];
    const project = projects[projIdx];
    if (!project) return state;

    const newOKRs = [...(project.okrs ?? [])];
    newOKRs.push({ objective: '', keyResults: [''], owner: '' });

    projects[projIdx] = { ...project, okrs: newOKRs };
    departments[deptIdx] = { ...department, projects };

    return { editableCascadeResult: departments };
  });
},

// OKRの更新（objective / keyResults / owner）
updateProjectOKR(
  deptIdx: number,
  projIdx: number,
  okrIdx: number,
  field: 'objective' | 'keyResults' | 'owner',
  value: string
) {
  set((state) => {
    const departments = [...state.editableCascadeResult];
    const department = departments[deptIdx];
    if (!department) return state;

    const projects = [...department.projects];
    const project = projects[projIdx];
    if (!project || !project.okrs) return state;

    const okrs = [...project.okrs];
    if (!okrs[okrIdx]) return state;

    okrs[okrIdx] = {
      ...okrs[okrIdx],
      [field]: value,
    };

    projects[projIdx] = { ...project, okrs };
    departments[deptIdx] = { ...department, projects };

    return { editableCascadeResult: departments };
  });
},

// OKRの削除
deleteOKRFromProject(deptIdx: number, projIdx: number, okrIdx: number) {
  set((state) => {
    const departments = [...state.editableCascadeResult];
    const department = departments[deptIdx];
    if (!department) return state;

    const projects = [...department.projects];
    const project = projects[projIdx];
    if (!project || !project.okrs) return state;

    const okrs = [...project.okrs];
    okrs.splice(okrIdx, 1);

    projects[projIdx] = { ...project, okrs };
    departments[deptIdx] = { ...department, projects };

    return { editableCascadeResult: departments };
  });
},

// OKRの上下移動
moveOKRInProject(
  deptIdx: number,
  projIdx: number,
  fromIdx: number,
  toIdx: number
) {
  set((state) => {
    const departments = [...state.editableCascadeResult];
    const department = departments[deptIdx];
    if (!department) return state;

    const projects = [...department.projects];
    const project = projects[projIdx];
    if (!project || !project.okrs) return state;

    const okrs = [...project.okrs];
    if (
      fromIdx < 0 ||
      toIdx < 0 ||
      fromIdx >= okrs.length ||
      toIdx >= okrs.length
    )
      return state;

    const [moved] = okrs.splice(fromIdx, 1);
    okrs.splice(toIdx, 0, moved);

    projects[projIdx] = { ...project, okrs };
    departments[deptIdx] = { ...department, projects };

    return { editableCascadeResult: departments };
  });
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

    set({ ...data, notification: '' });
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
