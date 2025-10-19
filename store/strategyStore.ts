// /store/strategyStore.ts
'use client';

import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import {
  saveStrategyData as saveStrategyDataApi,
  getFullStrategyDataByCompany,
} from '@/utils/supabase/strategy';
import { useUserStore } from './userStore';
import type {
  ChapterStory,
  ChapterAnswers,
  Department,
} from '@/types/strategy';
import type { BusinessPortfolio } from '@/types/portfolio';

/* ==========================================================
 * 型定義
 * ========================================================== */
export type AnswerStep = {
  stepNumber: number;
  question: string;
  reason: string;
  answer: string;
  createdAt: string;
};

export type OKR = {
  objective?: string;
  keyResults?: string[];
  owner?: string;
};

export type Project = {
  title: string;
  okrs: OKR[];
};

export type FinanceSummaryRow = {
  year: number;
  business_unit: string;
  revenue: number;
  operating_income: number;
  operating_margin_pct: number;
  revenue_share_pct: number;
};

export type SimulationResult = {
  projection: { points: { year: string; sales: number; op: number; opMargin: number }[] };
  finalProb: number;
  krsSnapshot?: any[];
  meta?: { label?: string; note?: string } & Record<string, any>;
} | null | undefined;

/* ==========================================================
 * StrategyState定義
 * ========================================================== */
export type StrategyState = {
  companyId: string | null;
  strategyId: string | null;

  companyName?: string;
  foundationYear?: string;
  location?: string;
  industry?: string;
  revenue?: string;
  employees?: string;
  businessContent?: string;
  customerSegment?: string;

  thought?: string;
  mission?: string;
  vision?: string;
  value?: string;
  strength?: string;
  weakness?: string;
  opportunity?: string;
  threat?: string;

  story: ChapterStory[];
  finalStory: ChapterStory[];
  answers2: ChapterAnswers[];
  departments: Department[];

  csvFinanceData?: unknown;
  financeSummary?: FinanceSummaryRow[];
  businessPortfolio?: BusinessPortfolio;
  simulationResult?: SimulationResult;

  hydrated: boolean;
  chapterCurrentStep: Record<number, number>;

  /** 進行中フラグ（多重実行ガード用） */
  _loadingRefetch?: boolean;
  _loadingSave?: boolean;

  /* ===== Setter / Action ===== */
  reset: () => void;
  resetAll: () => void;
  setHydrated: (v?: boolean) => void;
  setStrategyId: (id: string | null) => void;

  /** companyId切替。★同一IDなら no-op（hydratedを落とさない） */
  setCompanyScope: (id: string | null) => void;

  setStory: (chs: ChapterStory[]) => void;
  setFinalStory: (chs: ChapterStory[]) => void;
  setAnswers2: (answers: ChapterAnswers[]) => void;
  setChapterCurrentStep: (chapterIndex: number, step: number) => void;

  setProfile: (patch: Partial<Pick<StrategyState,
    'companyName' | 'foundationYear' | 'location' | 'industry' | 'revenue' | 'employees' | 'businessContent' | 'customerSegment'
  >>) => void;

  setMVV: (patch: Partial<Pick<StrategyState,
    'thought' | 'mission' | 'vision' | 'value'
  >>) => void;

  setSWOT: (patch: Partial<Pick<StrategyState,
    'strength' | 'weakness' | 'opportunity' | 'threat'
  >>) => void;

  setDepartments: (deps: Department[]) => void;
  setBusinessPortfolio: (p: BusinessPortfolio) => void;

  /* ===== Supabase ===== */
  saveStrategyData: () => Promise<void>;
  refetchFromServer: () => Promise<void>;
};

/* ==========================================================
 * 初期状態
 * ========================================================== */
const emptyData: StrategyState = {
  companyId: null,
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
  _loadingRefetch: false,
  _loadingSave: false,

  reset: () => {},
  resetAll: () => {},
  setHydrated: () => {},
  setStrategyId: () => {},
  setCompanyScope: () => {},
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
 * 保存ペイロード構築
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

/** サーバー応答から“サーバー決定事項のみ”を抽出して state へ反映 */
function extractServerDecidedPatch(resData: Partial<StrategyState>, current: StrategyState): Partial<StrategyState> {
  const patch: Partial<StrategyState> = {};
  // strategyId が新規採番・変更された場合だけ反映
  if (resData.strategyId && resData.strategyId !== current.strategyId) {
    patch.strategyId = resData.strategyId;
  }
  // それ以外（departments / story / answers2 / financeSummary など）は保存の副作用で上書きしない
  return patch;
}

/* ==========================================================
 * 正規化（getFullStrategyDataByCompany の data が snake_case でも state 形式でもOKにする）
 *  - finance_summary が {} の場合に [] 化
 *  - departments / projects / okrs を必ず配列化
 *  - answers2 のデフォルト4章
 * ========================================================== */
function normalizeFromDbRow(raw: any): Partial<StrategyState> {
  if (!raw || typeof raw !== 'object') return {};

  const toArray = (v: any) => (Array.isArray(v) ? v : []);
  const isArray = Array.isArray;

  // 1) プロファイル領域：snake_case と camelCase 両対応
  const companyName = raw.companyName ?? raw.company_name ?? '';
  const foundationYear = raw.foundationYear ?? raw.foundation_year ?? '';
  const location = raw.location ?? raw.location ?? '';
  const industry = raw.industry ?? raw.industry ?? '';
  const revenue = raw.revenue ?? raw.revenue ?? '';
  const employees = raw.employees ?? raw.employees ?? '';
  const businessContent = raw.businessContent ?? raw.business_content ?? '';
  const customerSegment = raw.customerSegment ?? raw.customer_segment ?? '';

  const thought = raw.thought ?? raw.thought ?? '';
  const mission = raw.mission ?? raw.mission ?? '';
  const vision = raw.vision ?? raw.vision ?? '';
  const value = raw.value ?? raw.value ?? '';
  const strength = raw.strength ?? raw.strength ?? '';
  const weakness = raw.weakness ?? raw.weakness ?? '';
  const opportunity = raw.opportunity ?? raw.opportunity ?? '';
  const threat = raw.threat ?? raw.threat ?? '';

  // 2) 配列領域
  const story = isArray(raw.story) ? raw.story : [];
  const finalStory = isArray(raw.finalStory) ? raw.finalStory : (isArray(raw.final_story) ? raw.final_story : []);
  const csvFinanceData = isArray(raw.csvFinanceData) ? raw.csvFinanceData : (isArray(raw.csv_finance_data) ? raw.csv_finance_data : []);
  const financeSummary = isArray(raw.financeSummary)
    ? raw.financeSummary
    : (isArray(raw.finance_summary) ? raw.finance_summary : []);

  // 3) departments/projects/okrs 正規化
  const departmentsRaw = isArray(raw.departments) ? raw.departments : [];
  const departments: Department[] = departmentsRaw.map((d: any) => {
    const projectsRaw = isArray(d?.projects) ? d.projects : [];
    return {
      name: d?.name ?? '',
      projects: projectsRaw.map((p: any) => ({
        title: p?.title ?? '',
        okrs: isArray(p?.okrs) ? p.okrs : [],
      })),
    };
  });

  // 4) answers2 正規化（空なら4章デフォルト）
  const answers2Raw = isArray(raw.answers2) ? raw.answers2 : (isArray(raw.answers) ? raw.answers : []);
  const answers2: ChapterAnswers[] =
    isArray(answers2Raw) && answers2Raw.length > 0
      ? answers2Raw.map((c: any) => ({
          chapterIndex: typeof c?.chapterIndex === 'number' ? c.chapterIndex : 0,
          chapterTitle: typeof c?.chapterTitle === 'string' ? c.chapterTitle : '',
          steps: isArray(c?.steps) ? c.steps : [],
        }))
      : [
          { chapterIndex: 0, chapterTitle: '第1章：なぜ今（現状）', steps: [] },
          { chapterIndex: 1, chapterTitle: '第2章：どう戦う（戦略）', steps: [] },
          { chapterIndex: 2, chapterTitle: '第3章：どんな未来像（会社の未来像）', steps: [] },
          { chapterIndex: 3, chapterTitle: '第4章：どう行動する（行動）', steps: [] },
        ];

  // 5) businessPortfolio 検証
  let businessPortfolio: BusinessPortfolio | undefined = undefined;
  const rawBP = raw.businessPortfolio ?? raw.business_portfolio;
  if (rawBP && typeof rawBP === 'object') {
    const valid =
      Array.isArray(rawBP.units) &&
      typeof rawBP.threshold?.growthBaseline === 'number' &&
      typeof rawBP.threshold?.profitBaseline === 'number' &&
      typeof rawBP.currency === 'string' &&
      typeof rawBP.periodLabel === 'string' &&
      typeof rawBP.unitType === 'string';
    if (valid) businessPortfolio = rawBP as BusinessPortfolio;
  }

  // 6) simulationResult
  const simulationResult = raw.simulationResult ?? raw.simulation_result ?? undefined;

  // 7) strategyId（あれば）
  const strategyId = raw.strategyId ?? raw.strategy_id ?? undefined;

  return {
    strategyId,
    companyName,
    foundationYear,
    location,
    industry,
    revenue,
    employees,
    businessContent,
    customerSegment,
    thought,
    mission,
    vision,
    value,
    strength,
    weakness,
    opportunity,
    threat,
    story,
    finalStory,
    answers2,
    departments,
    csvFinanceData,
    financeSummary,
    businessPortfolio,
    simulationResult,
  };
}

/* ==========================================================
 * Zustandストア
 * ========================================================== */
export const useStrategyStore = create<StrategyState>()(
  persist(
    (set, get) => ({
      ...emptyData,

      /* ===== 初期化 ===== */
      reset: () => set({ ...emptyData }),
      resetAll: () => {
        console.log('[strategyStore] resetAll() called');
        set({ ...emptyData });
      },
      setHydrated: (v = true) => set({ hydrated: v }),

      /* ===== Setter群 ===== */
      setStrategyId: (id) => set({ strategyId: id }),

      /** ★冪等化：同一IDなら no-op（hydrated を false に戻さない） */
      setCompanyScope: (id) =>
        set((s) => {
          if (s.companyId === id) return s; // no-op
          // companyIdが変わる場合のみ全面初期化 + scope設定
          return { ...emptyData, companyId: id, hydrated: false };
        }),

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

      setProfile: (patch) => set((s) => ({ ...s, ...patch })),
      setMVV: (patch) => set((s) => ({ ...s, ...patch })),
      setSWOT: (patch) => set((s) => ({ ...s, ...patch })),
      setDepartments: (deps) => set({ departments: [...deps] }),
      setBusinessPortfolio: (p) => set({ businessPortfolio: { ...p } }),

      /* ====================================================
       * Supabase 保存（多重実行ガード＋副作用の最小化）
       * ==================================================== */
      async saveStrategyData() {
        const userId = useUserStore.getState().user?.id;
        const companyId = get().companyId || useUserStore.getState().companyId;
        if (!userId || !companyId) throw new Error('missing ids');

        if (get()._loadingSave) return;
        set({ _loadingSave: true });
        try {
          const payload = buildSavePayload(get());
          const res = await saveStrategyDataApi(payload, userId, companyId);

          // ❗無限ループ対策：サーバー応答を丸ごとマージしない
          if (res?.data) {
            const minimal = extractServerDecidedPatch(res.data as Partial<StrategyState>, get());
            if (Object.keys(minimal).length > 0) {
              set(minimal);
            }
          }
        } finally {
          set({ _loadingSave: false });
        }
      },

      /* ====================================================
       * Supabase 再フェッチ（多重実行ガード + hydrate）
       * ==================================================== */
      async refetchFromServer() {
        const companyId = get().companyId || useUserStore.getState().companyId;
        if (!companyId) {
          // companyIdが無くても spinner が止まるように
          set({ hydrated: true });
          return;
        }

        if (get()._loadingRefetch) return; // guard
        set({ _loadingRefetch: true });

        try {
          console.log('[StrategyData] 📥 getFullStrategyDataByCompany start:', companyId);
          const { data, error } = await getFullStrategyDataByCompany(companyId);
          if (error) throw error;

          if (!data) {
            // データ無しでも少なくとも hydrated は立てる
            set({ hydrated: true });
            console.log('[strategyStore] ⚠️ refetch: no data; hydrated=true');
            return;
          }

          // data が snake_case（DB行）/ camelCase（既に正規化済み）のどちらでもOK
          const patch = normalizeFromDbRow(data);

          // --- Zustand state更新 ---
          set((s) => ({ ...s, ...patch, hydrated: true }));
          console.log('[strategyStore] ✅ refetchFromServer hydrated=true');
        } finally {
          set({ _loadingRefetch: false });
        }
      },
    }),
    {
      name: 'strategy-store',
      version: 23, // 正規化強化・hydrated管理の安定化
      partialize: (s) => ({
        companyId: s.companyId,
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
      migrate: (persisted) => ({ ...emptyData, ...(persisted ?? {}) }),
      storage: createJSONStorage(() => localStorage),
      onRehydrateStorage: () => (state, error) => {
        if (error) console.warn('rehydration error:', error);
        state?.setHydrated?.(true); // 復元直後は最低限 spinner を外す
      },
    }
  )
);

/* ==========================================================
 * 外部ユーティリティ
 * ========================================================== */
export async function refetchFromServer() {
  return useStrategyStore.getState().refetchFromServer();
}
