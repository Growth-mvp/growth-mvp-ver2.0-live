// /store/strategyStore.ts
'use client';

import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import { saveStrategyData as saveStrategyDataApi, getFullStrategyDataByCompany } from '@/utils/supabase/strategy';
import { useUserStore } from './userStore';
import type {
  UnitType,
  BusinessUnit,
  BusinessPortfolio,
  PortfolioThreshold,
} from '@/types/portfolio';

/* ==========================================================
 * 型定義
 * ========================================================== */
export type ChapterStory = { title: string; body: string };

export type AnswerStep = {
  stepNumber: number;
  question: string;
  reason: string;
  answer: string;
};

export type ChapterAnswers = {
  chapterIndex: number;
  chapterTitle: string;
  steps: AnswerStep[];
};

export type OKR = { objective: string; keyResults: string[]; owner?: string };
export type Project = { title: string; okrs: OKR[] };
export type Department = { id?: string; name?: string; projects: Project[] };

export type FinanceSummaryRow = {
  year: number;
  business_unit: string;
  revenue: number;
  operating_income: number;
  operating_margin_pct: number;
  revenue_share_pct: number;
};

export type SimulationResult = {
  projection: {
    points: { year: string; sales: number; op: number; opMargin: number }[];
  };
  finalProb: number;
  krsSnapshot?: any[];
  meta?: { label?: string; note?: string } & Record<string, any>;
} | null | undefined;

/* ==========================================================
 * Zustand状態
 * ========================================================== */
export type StrategyState = {
  /* 識別子 */
  strategyId: string | null;

  /* 会社プロファイル */
  companyName?: string;
  foundationYear?: string;
  location?: string;
  industry?: string;
  revenue?: string;
  employees?: string;
  businessContent?: string;
  customerSegment?: string;

  /* MVV・SWOT */
  thought?: string;
  mission?: string;
  vision?: string;
  value?: string;
  strength?: string;
  weakness?: string;
  opportunity?: string;
  threat?: string;

  /* ストーリー・質問・部門構造 */
  story: ChapterStory[];
  finalStory: ChapterStory[];
  answers2: ChapterAnswers[];
  departments: Department[];

  /* 財務・ポートフォリオ・シミュレーション */
  csvFinanceData?: unknown;
  financeSummary?: FinanceSummaryRow[];
  businessPortfolio?: BusinessPortfolio;
  simulationResult?: SimulationResult;

  /* 補助ステート */
  hydrated: boolean; // persist完了フラグ
  chapterCurrentStep: Record<number, number>; // 各章の現在ステップ

  /* --- actions --- */
  reset: () => void;
  setHydrated: () => void;
  setStrategyId: (id: string | null) => void;

  setStory: (chs: ChapterStory[]) => void;
  setFinalStory: (chs: ChapterStory[]) => void;
  setAnswers2: (answers: ChapterAnswers[]) => void;
  setChapterCurrentStep: (chapterIndex: number, step: number) => void;

  setProfile: (
    patch: Partial<
      Pick<
        StrategyState,
        | 'companyName'
        | 'foundationYear'
        | 'location'
        | 'industry'
        | 'revenue'
        | 'employees'
        | 'businessContent'
        | 'customerSegment'
      >
    >
  ) => void;

  setMVV: (patch: Partial<Pick<StrategyState, 'mission' | 'vision' | 'value' | 'thought'>>) => void;
  setSWOT: (patch: Partial<Pick<StrategyState, 'strength' | 'weakness' | 'opportunity' | 'threat'>>) => void;

  setDepartments: (deps: Department[]) => void;
  setBusinessPortfolio: (p: BusinessPortfolio) => void;

  saveStrategyData: () => Promise<void>;
  refetchFromServer: () => Promise<void>;
};

/* ==========================================================
 * 初期状態
 * ========================================================== */
const emptyData: StrategyState = {
  strategyId: null,

  companyName: '',
  foundationYear: '',
  location: '',
  industry: '',
  revenue: '',
  employees: '',
  businessContent: '',
  customerSegment: '',

  thought: '',
  mission: '',
  vision: '',
  value: '',
  strength: '',
  weakness: '',
  opportunity: '',
  threat: '',

  story: [],
  finalStory: [],
  answers2: [],
  departments: [],

  csvFinanceData: undefined,
  financeSummary: undefined,
  businessPortfolio: undefined,
  simulationResult: undefined,

  hydrated: false,
  chapterCurrentStep: {},
  
  reset: () => {},
  setHydrated: () => {},
  setStrategyId: () => {},
  setStory: () => {},
  setFinalStory: () => {},
  setAnswers2: () => {},
  setChapterCurrentStep: () => {},
  setProfile: () => {},
  setMVV: () => {},
  setSWOT: () => {},
  setDepartments: () => {},
  setBusinessPortfolio: () => {},
  saveStrategyData: async () => {},
  refetchFromServer: async () => {},
};

/* ==========================================================
 * Utility：保存用ペイロード構築
 * ========================================================== */
function buildSavePayload(s: StrategyState) {
  const base: any = {
    strategyId: s.strategyId,
    story: s.story,
    finalStory: s.finalStory,
    answers2: s.answers2,
    departments: s.departments,
  };

  if (typeof s.businessPortfolio !== 'undefined') base.businessPortfolio = s.businessPortfolio;
  if (Array.isArray(s.csvFinanceData)) base.csvFinanceData = s.csvFinanceData;
  if (Array.isArray(s.financeSummary)) base.financeSummary = s.financeSummary;
  if (s.simulationResult) base.simulationResult = s.simulationResult;

  return base;
}

/* ==========================================================
 * Store本体（TS2740完全対応版）
 * ========================================================== */
export const useStrategyStore = create<StrategyState>()(
  persist(
    (set, get): StrategyState =>
      ({
        ...emptyData, // ✅ 型安全に全プロパティを満たす

        /* ---------- 基本操作 ---------- */
        reset: () => set({ ...emptyData }),
        setHydrated: () => set({ hydrated: true }),
        setStrategyId: (id) => set({ strategyId: id }),

        /* ---------- ストーリー関連 ---------- */
        setStory: (chs) => set({ story: [...chs] }),
        setFinalStory: (chs) => set({ finalStory: [...chs] }),
        setAnswers2: (answers) =>
          set({
            answers2: answers.map((c) => ({
              ...c,
              steps: [...c.steps].sort((a, b) => a.stepNumber - b.stepNumber),
            })),
          }),
        setChapterCurrentStep: (chapterIndex, step) =>
          set((s) => ({
            chapterCurrentStep: { ...s.chapterCurrentStep, [chapterIndex]: step },
          })),

        /* ---------- プロフィール・SWOT ---------- */
        setProfile: (patch) => set((s) => ({ ...s, ...patch })),
        setMVV: (patch) => set((s) => ({ ...s, ...patch })),
        setSWOT: (patch) => set((s) => ({ ...s, ...patch })),

        /* ---------- 部門・ポートフォリオ ---------- */
        setDepartments: (deps) => set({ departments: [...deps] }),
        setBusinessPortfolio: (p) => set({ businessPortfolio: { ...p } }),

        /* ---------- 保存処理 ---------- */
        async saveStrategyData() {
          const userId = useUserStore.getState().user?.id;
          const companyId = useUserStore.getState().companyId;
          if (!userId) throw new Error('userId 未設定');

          try {
            const res = await saveStrategyDataApi(buildSavePayload(get()), userId, companyId);
            if (res?.error) console.error('saveStrategyData error:', res.error);
          } catch (e) {
            console.warn('saveStrategyData failed', e);
          }
        },

        /* ---------- 再取得 ---------- */
        async refetchFromServer() {
          try {
            const companyId = useUserStore.getState().companyId;
            if (!companyId) return;
            const { data, error } = await getFullStrategyDataByCompany(companyId);
            if (error) throw error;
            if (!data) return;

            const patch: Partial<StrategyState> = {};
            for (const [k, v] of Object.entries(data)) {
              if (v !== undefined && v !== null) (patch as any)[k] = v;
            }
            set((s) => ({ ...s, ...patch }));
          } catch (e) {
            console.warn('refetchFromServer failed', e);
          }
        },
      } as StrategyState),
    {
      name: 'strategy-store',
      version: 15,

      /* ---------- 永続対象 ---------- */
      partialize: (s) => ({
        strategyId: s.strategyId,
        story: s.story,
        finalStory: s.finalStory,
        answers2: s.answers2,
        departments: s.departments,
        csvFinanceData: s.csvFinanceData,
        financeSummary: s.financeSummary,
        businessPortfolio: s.businessPortfolio,
        simulationResult: s.simulationResult,
        chapterCurrentStep: s.chapterCurrentStep,
      }),

      /* ---------- migrate ---------- */
      migrate: (persisted) => ({ ...emptyData, ...(persisted ?? {}) }),

      /* ---------- storage ---------- */
      storage: createJSONStorage(() => localStorage),

      /* ---------- persist完了フラグ ---------- */
      onRehydrateStorage: () => (state, error) => {
        if (error) console.warn('rehydration error:', error);
        state?.setHydrated?.();
      },
    }
  )
);

/* ==========================================================
 * 外部ヘルパー
 * ========================================================== */
export async function refetchFromServer() {
  return useStrategyStore.getState().refetchFromServer();
}
