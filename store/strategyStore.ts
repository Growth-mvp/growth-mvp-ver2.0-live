// /store/strategyStore.ts
'use client';

import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import {
  saveStrategyData as saveStrategyDataApi,
  getFullStrategyDataByCompany,
  deleteStrategyData as deleteStrategyDataApi,
  purgeLegacyTables as purgeLegacyTablesApi,
  saveStoryAnswers2,
  saveFinalStory,
} from '@/utils/supabase/strategy';
import { safeGetSession } from '@/utils/supabase/client';
import { useUserStore } from './userStore';
import type {
  ChapterStory,
  ChapterAnswers,
  Department,
  WinPattern,
  WinPatternId,
} from '@/types/strategy';
import type { BusinessPortfolio } from '@/types/portfolio';

/* ===== 型定義（ローカル用：旧互換） ===== */
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

export type SimulationResult =
  | {
      projection: {
        points: { year: string; sales: number; op: number; opMargin: number }[];
      };
      finalProb: number;
      krsSnapshot?: any[];
      meta?: { label?: string; note?: string } & Record<string, any>;
    }
  | null
  | undefined;

type BootState = { isHydrating: boolean; isHydrated: boolean };

type SafeDepartmentsArg =
  | Department[]
  | { departments?: Department[] | null }
  | null
  | undefined;

/* ===== StrategyState ===== */
export type StrategyState = {
  companyId: string | null;
  strategyId: string | null;

  /** スコープ切替の“仮”置き場（成功取得時のみ companyId に昇格） */
  pendingCompanyId?: string | null;

  /* 会社プロフィール（すべて文字列で持つ） */
  companyName?: string;
  foundationYear?: string;
  location?: string;
  industry?: string;
  revenue?: string;
  employees?: string;
  businessContent?: string;
  customerSegment?: string;

  /* MVV / SWOT */
  thought?: string;
  mission?: string;
  vision?: string;
  value?: string;
  strength?: string;
  weakness?: string;
  opportunity?: string;
  threat?: string;

  /* 物語 / 部門 */
  story: ChapterStory[];
  finalStory: ChapterStory[];
  answers2: ChapterAnswers[];
  departments: Department[];

  /* ★ 全社レベルの勝ち筋（受け皿） */
  winPatterns?: WinPattern[];
  winPatternPrimary?: WinPatternId;
  winPatternSecondary?: WinPatternId;

  /* 財務 */
  csvFinanceData?: unknown;
  financeSummary?: FinanceSummaryRow[];
  businessPortfolio?: BusinessPortfolio;
  simulationResult?: SimulationResult;

  /* ステータス */
  hydrated: boolean;
  loaded: boolean;
  dirty: boolean;

  boot: BootState;

  /** サーバ楽観ロック用 */
  revision?: number;

  /** サーバスナップショット（ハッシュ） */
  lastServerSnapshot?: string;

  /** 直近サーバ保存に用いた影（互換のため残置） */
  serverShadow?: any;

  /** サーバ再取得中（ガード用） */
  __isFetchingFromServer?: boolean;

  /** after-save フック（互換のため残置） */
  __afterSave?: (serverData: Partial<StrategyState> & { revision?: number }) => void;

  /** 章ごとのUIステップ */
  chapterCurrentStep: Record<number, number>;

  _loadingRefetch?: boolean;
  _loadingSave?: boolean;

  /** 直近保存のペイロードハッシュ（無駄保存抑止） */
  __lastSavedHash?: string;

  /* Actions */
  reset: () => void;
  resetAll: () => void;

  setHydrated: (revOrBool?: boolean | number, hash?: string) => void;
  setHydrating: (b: boolean) => void;
  setServerSnapshotHash: (hash?: string) => void;

  setStrategyId: (id: string | null) => void;
  setCompanyScope: (id: string | null) => void;

  setStory: (chs: ChapterStory[]) => void;
  setFinalStory: (chs: ChapterStory[]) => void;
  setAnswers2: (answers: ChapterAnswers[]) => void;
  setChapterCurrentStep: (chapterIndex: number, step: number) => void;

  setProfile: (patch: Partial<
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
  >) => void;

  setMVV: (patch: Partial<Pick<StrategyState, 'thought' | 'mission' | 'vision' | 'value'>>) => void;
  setSWOT: (patch: Partial<Pick<StrategyState, 'strength' | 'weakness' | 'opportunity' | 'threat'>>) => void;

  setDepartments: (deps: SafeDepartmentsArg) => void;
  updateDepartments: (updater: (prev: Department[]) => Department[]) => void;

  setBusinessPortfolio: (p: BusinessPortfolio) => void;

  markLoaded: () => void;
  markDirty: () => void;

  buildPayload: () => any;

  saveStrategyData: () => Promise<void>;
  refetchFromServer: () => Promise<void>;
  deleteAllOnServer: () => Promise<void>;
};

/* ===== ユーティリティ群 ===== */
function pruneUndefinedDeep<T>(obj: T): T {
  if (Array.isArray(obj)) {
    return obj
      .map(pruneUndefinedDeep)
      .filter((v) => !(v === undefined || v === null)) as unknown as T;
  }
  if (obj && typeof obj === 'object') {
    const out: any = {};
    for (const [k, v] of Object.entries(obj as any)) {
      const pv = pruneUndefinedDeep(v);
      const drop =
        pv === undefined ||
        pv === null ||
        (typeof pv === 'string' && pv.trim() === '');
      // 空配列は残す（[]を保存したい）
      if (!drop) out[k] = pv;
    }
    return out;
  }
  return obj;
}

function stableHash(input: any): string {
  const s = typeof input === 'string' ? input : JSON.stringify(input);
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = (h * 33) ^ s.charCodeAt(i);
  return (h >>> 0).toString(16);
}

function isEffectivelyEmpty(payload: any): boolean {
  if (!payload) return true;
  const emptyArr = (a: any) => !Array.isArray(a) || a.length === 0;
  const emptyStr = (v: any) => typeof v !== 'string' || v.trim() === '';

  const allEmpty =
    emptyArr(payload.story) &&
    emptyArr(payload.finalStory) &&
    emptyArr(payload.answers2) &&
    emptyArr(payload.departments) &&
    emptyArr(payload.csvFinanceData) &&
    emptyArr(payload.financeSummary) &&
    (payload.businessPortfolio == null ||
      (Array.isArray(payload.businessPortfolio?.units) &&
        payload.businessPortfolio.units.length === 0)) &&
    (payload.simulationResult == null ||
      (Array.isArray(payload.simulationResult?.projection?.points) &&
        payload.simulationResult.projection.points.length === 0));

  const metaAllEmpty =
    [
      payload.companyName,
      payload.mission,
      payload.vision,
      payload.value,
      payload.thought,
    ]
      .filter((v) => v !== undefined)
      .every(emptyStr);

  return allEmpty && metaAllEmpty;
}

/** 保存用ペイロード組み立て（StrategyData相当） */
function buildSavePayload(s: StrategyState) {
  const base: any = {
    strategyId: s.strategyId ?? undefined,
    story: s.story,
    finalStory: s.finalStory,
    answers2: s.answers2,
    departments: s.departments,

    companyName: s.companyName,
    foundationYear: s.foundationYear,
    location: s.location,
    industry: s.industry,
    revenue: s.revenue,
    employees: s.employees,
    businessContent: s.businessContent,
    customerSegment: s.customerSegment,

    mission: s.mission,
    vision: s.vision,
    value: s.value,
    thought: s.thought,

    strength: s.strength,
    weakness: s.weakness,
    opportunity: s.opportunity,
    threat: s.threat,

    winPatterns: s.winPatterns,
    winPatternPrimary: s.winPatternPrimary,
    winPatternSecondary: s.winPatternSecondary,
  };

  if (typeof s.businessPortfolio !== 'undefined') base.businessPortfolio = s.businessPortfolio;
  if (Array.isArray(s.csvFinanceData)) base.csvFinanceData = s.csvFinanceData;
  if (Array.isArray(s.financeSummary)) base.financeSummary = s.financeSummary;
  if (s.simulationResult !== undefined) base.simulationResult = s.simulationResult;

  return pruneUndefinedDeep(base);
}

function extractServerDecidedPatch(
  resData: Partial<StrategyState> & { revision?: number },
  current: StrategyState
): Partial<StrategyState> {
  const patch: Partial<StrategyState> = {};
  if (resData.strategyId && resData.strategyId !== current.strategyId) patch.strategyId = resData.strategyId;
  if (typeof resData.revision === 'number') patch.revision = resData.revision;
  return patch;
}

/* ===== Department 正規化 ===== */
function normalizeDepartmentsInput(input: any, fallback: Department[]): Department[] {
  // ★重要：null / {departments:null} は「空にしたい」意図として扱う（削除復活防止）
  if (input === null) return [];
  if (typeof input === 'object' && input && 'departments' in input && (input as any).departments == null) {
    return [];
  }

  const fromArg = Array.isArray(input)
    ? input
    : Array.isArray(input?.departments)
    ? (input.departments as Department[])
    : undefined;

  const base = Array.isArray(fromArg) ? fromArg : Array.isArray(fallback) ? fallback : [];

  return base
    .filter(Boolean)
    .map((d: any, di: number) => {
      const out: any = { ...d };
      if (!out.name) out.name = d?.title ?? `Department ${di + 1}`;
      const projects = Array.isArray(d?.projects) ? d.projects : [];
      out.projects = projects.map((p: any) => {
        const po: any = { ...p };
        po.title = p?.title ?? p?.name ?? '';
        if (!Array.isArray(po.okrs)) po.okrs = Array.isArray(p?.okrs) ? p.okrs : [];
        if (p?.okrsV2 && !Array.isArray(p.okrsV2)) po.okrsV2 = [];
        return po;
      });
      return out as Department;
    });
}

/* ===== 認証軽量チェック ===== */
async function isSessionUsable(): Promise<boolean> {
  try {
    const { error, data } = await safeGetSession();
    if (error) return false;
    return !!data?.session?.user?.id;
  } catch {
    return false;
  }
}

/* ============================================================
 * 親(strategy_data)の存在を“できる限り”保証
 * - store保存制御を迂回するが、in-flight を1本化して競合を抑止
 * ========================================================== */
let __ensureParentInflight: Promise<void> | null = null;

async function ensureParentExists(): Promise<void> {
  if (__ensureParentInflight) return __ensureParentInflight;

  __ensureParentInflight = (async () => {
    const s = useStrategyStore.getState();
    const userId = useUserStore.getState().user?.id;
    const companyId =
      s.companyId || s.pendingCompanyId || useUserStore.getState().companyId;

    console.log('[strategyStore] ensureParentExists()', { userId, companyId });

    if (!userId || !companyId) {
      console.warn('[strategyStore] ensureParentExists skipped: missing ids');
      return;
    }

    const payload = buildSavePayload(s);
    if (isEffectivelyEmpty(payload)) {
      console.log('[strategyStore] ensureParentExists: payload effectively empty, skip');
      return;
    }

    try {
      await (saveStrategyDataApi as any)(payload, userId, companyId, s.revision, { mode: 'upsert' });
    } catch (e) {
      console.warn('[strategyStore] ensureParentExists primary call failed, fallback legacy:', e);
      try {
        await (saveStrategyDataApi as any)(payload, userId, companyId);
      } catch (e2) {
        console.warn('[strategyStore] ensureParentExists legacy failed:', e2);
      }
    }
  })().finally(() => {
    __ensureParentInflight = null;
  });

  return __ensureParentInflight;
}

/* ===== refetch再試行タイマー ===== */
let __refetchRetryTimer: ReturnType<typeof setTimeout> | null = null;
function scheduleRefetchRetry(delayMs = 1500): void {
  if (__refetchRetryTimer) return;
  __refetchRetryTimer = setTimeout(() => {
    __refetchRetryTimer = null;
    useStrategyStore.getState().refetchFromServer();
  }, delayMs);
}

/* ===== 初期状態 ===== */
const emptyData: StrategyState = {
  companyId: null,
  strategyId: null,
  pendingCompanyId: undefined,

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
  winPatterns: undefined,
  winPatternPrimary: undefined,
  winPatternSecondary: undefined,
  csvFinanceData: undefined,
  financeSummary: undefined,
  businessPortfolio: undefined,
  simulationResult: undefined,

  hydrated: false,
  loaded: false,
  dirty: false,
  boot: { isHydrating: false, isHydrated: false },

  revision: undefined,
  lastServerSnapshot: undefined,
  serverShadow: undefined,

  __isFetchingFromServer: false,
  __afterSave: undefined,

  chapterCurrentStep: {},
  _loadingRefetch: false,
  _loadingSave: false,

  __lastSavedHash: undefined,

  reset: () => {},
  resetAll: () => {},
  setHydrated: () => {},
  setHydrating: () => {},
  setServerSnapshotHash: () => {},
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
  updateDepartments: () => {},
  setBusinessPortfolio: () => {},
  markLoaded: () => {},
  markDirty: () => {},
  buildPayload: () => ({}),
  saveStrategyData: async () => {},
  refetchFromServer: async () => {},
  deleteAllOnServer: async () => {},
};

/* ============================================================
 * DBから返ってきた行を StrategyState 向けに正規化
 * ========================================================== */
function normalizeFromDbRow(raw: any): Partial<StrategyState> {
  if (!raw || typeof raw !== 'object') return {};
  const isArray = Array.isArray;

  const companyName = raw.companyName ?? raw.company_name ?? '';
  const foundationYear = raw.foundationYear ?? raw.foundation_year ?? '';
  const location = raw.location ?? raw.location_text ?? '';
  const industry = raw.industry ?? raw.industry_text ?? '';
  const revenue = raw.revenue ?? raw.revenue_text ?? '';
  const employees = raw.employees ?? raw.employees_text ?? '';
  const businessContent = raw.businessContent ?? raw.business_content ?? '';
  const customerSegment = raw.customerSegment ?? raw.customer_segment ?? '';

  const thought = raw.thought ?? '';
  const mission = raw.mission ?? '';
  const vision = raw.vision ?? '';
  const value = raw.value ?? '';
  const strength = raw.strength ?? '';
  const weakness = raw.weakness ?? '';
  const opportunity = raw.opportunity ?? '';
  const threat = raw.threat ?? '';

  const story = isArray(raw.story) ? raw.story : [];
  const finalStory = isArray(raw.finalStory)
    ? raw.finalStory
    : isArray(raw.final_story)
    ? raw.final_story
    : [];

  const csvFinanceData = isArray(raw.csvFinanceData)
    ? raw.csvFinanceData
    : isArray(raw.csv_finance_data)
    ? raw.csv_finance_data
    : [];

  const financeSummary = isArray(raw.financeSummary)
    ? raw.financeSummary
    : isArray(raw.finance_summary)
    ? raw.finance_summary
    : [];

  const departmentsRaw = isArray(raw.departments) ? raw.departments : [];
  const departments: Department[] = departmentsRaw.map((d: any, di: number) => {
    const projectsRaw = isArray(d?.projects) ? d.projects : [];
    const deptOut: any = { ...d };
    if (!deptOut.name) deptOut.name = d?.title ?? `Department ${di + 1}`;

    if (isArray(d?.answers2)) {
      deptOut.answers2 = d.answers2.map((c: any, idx: number) => ({
        chapterIndex: typeof c?.chapterIndex === 'number' ? c.chapterIndex : idx,
        chapterTitle:
          typeof c?.chapterTitle === 'string'
            ? c.chapterTitle
            : (d?.name ?? `Chapter ${idx + 1}`),
        steps: isArray(c?.steps)
          ? [...c.steps].sort(
              (a: any, b: any) => Number(a?.stepNumber ?? 0) - Number(b?.stepNumber ?? 0)
            )
          : [],
      }));
    }

    deptOut.projects = projectsRaw.map((p: any) => {
      const projOut: any = { ...p };
      projOut.title = p?.title ?? p?.name ?? '';
      if (!Array.isArray(projOut.okrs)) projOut.okrs = Array.isArray(p?.okrs) ? p.okrs : [];
      if (p?.okrsV2 && !Array.isArray(p.okrsV2)) projOut.okrsV2 = [];
      return projOut;
    });

    return deptOut as Department;
  });

  const answers2Raw = isArray(raw.answers2)
    ? raw.answers2
    : isArray(raw.answers)
    ? raw.answers
    : [];

  const answers2: ChapterAnswers[] =
    isArray(answers2Raw) && answers2Raw.length > 0
      ? answers2Raw.map((c: any, idx: number) => ({
          chapterIndex: typeof c?.chapterIndex === 'number' ? c.chapterIndex : idx,
          chapterTitle: typeof c?.chapterTitle === 'string' ? c.chapterTitle : `Chapter ${idx + 1}`,
          steps: Array.isArray(c?.steps)
            ? [...c.steps].sort(
                (a: any, b: any) => Number(a?.stepNumber ?? 0) - Number(b?.stepNumber ?? 0)
              )
            : [],
        }))
      : [
          { chapterIndex: 0, chapterTitle: '第1章：なぜ今（現状）', steps: [] },
          { chapterIndex: 1, chapterTitle: '第2章：どう戦う（戦略）', steps: [] },
          { chapterIndex: 2, chapterTitle: '第3章：どんな未来像（会社の未来像）', steps: [] },
          { chapterIndex: 3, chapterTitle: '第4章：どう行動する（行動）', steps: [] },
        ];

  const rawBP = raw.businessPortfolio ?? raw.business_portfolio;
  let businessPortfolio: BusinessPortfolio | undefined = undefined;
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

  const simulationResult = raw.simulationResult ?? raw.simulation_result ?? undefined;
  const strategyId = raw.strategyId ?? raw.strategy_id ?? undefined;
  const revision = typeof raw.revision === 'number' ? raw.revision : undefined;

  const winPatterns: WinPattern[] | undefined = Array.isArray(raw.winPatterns)
    ? raw.winPatterns
    : Array.isArray(raw.win_patterns)
    ? raw.win_patterns
    : undefined;

  const winPatternPrimary: WinPatternId | undefined =
    raw.winPatternPrimary ?? raw.win_pattern_primary ?? undefined;
  const winPatternSecondary: WinPatternId | undefined =
    raw.winPatternSecondary ?? raw.win_pattern_secondary ?? undefined;

  return {
    strategyId,
    revision,
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
    winPatterns,
    winPatternPrimary,
    winPatternSecondary,
  };
}

/* ===== Zustand Store ===== */
export const useStrategyStore = create<StrategyState>()(
  persist(
    (set, get) => ({
      ...emptyData,

      reset: () => set({ ...emptyData }),
      resetAll: () => {
        console.log('[strategyStore] resetAll() called');
        set({ ...emptyData });
      },

      setHydrated: (revOrBool = true, hash) =>
        set((s) => {
          const isBool = typeof revOrBool === 'boolean';
          return {
            hydrated: isBool ? (revOrBool as boolean) : true,
            boot: { isHydrating: false, isHydrated: true },
            revision: isBool ? s.revision : (revOrBool as number),
            lastServerSnapshot: hash ?? s.lastServerSnapshot,
          };
        }),
      setHydrating: (b) => set((s) => ({ ...s, boot: { ...s.boot, isHydrating: b } })),
      setServerSnapshotHash: (hash) => set({ lastServerSnapshot: hash }),

      setStrategyId: (id) => set({ strategyId: id }),

      /* ▼破壊的リセット禁止：即消さず、仮スコープでハイドレート開始 */
      setCompanyScope: (id) =>
        set((s) => ({
          ...s,
          pendingCompanyId: id,
          boot: { isHydrating: true, isHydrated: false },
          __isFetchingFromServer: true,
        })),

      setStory: (chs) => {
        set({ story: [...chs], dirty: true });
      },

      // finalStory は 分離API で即時保存（親保証→分離保存）
      setFinalStory: (chs) => {
        set({ finalStory: [...chs], dirty: true });

        (async () => {
          const s = get();
          const userId = useUserStore.getState().user?.id;
          const companyId =
            s.companyId || s.pendingCompanyId || useUserStore.getState().companyId;
          if (!userId || !companyId) return;

          await ensureParentExists();
          try {
            await saveFinalStory(userId, get().finalStory, { companyId });
          } catch (e) {
            console.warn('[strategyStore] saveFinalStory warn:', e);
          }
        })();
      },

      // answers2 も 分離API で即時保存（親保証→分離保存）
      setAnswers2: (answers) => {
        set({
          answers2: answers.map((c) => ({
            ...c,
            steps: [...c.steps].sort((a, b) => Number(a.stepNumber) - Number(b.stepNumber)),
          })),
          dirty: true,
        });

        (async () => {
          const s = get();
          const userId = useUserStore.getState().user?.id;
          const companyId =
            s.companyId || s.pendingCompanyId || useUserStore.getState().companyId;
          if (!userId || !companyId) return;

          await ensureParentExists();
          try {
            await saveStoryAnswers2(userId, get().answers2 as any, { companyId });
          } catch (e) {
            console.warn('[strategyStore] saveStoryAnswers2 warn:', e);
          }
        })();
      },

      setChapterCurrentStep: (chapterIndex, step) =>
        set((s) => ({
          chapterCurrentStep: { ...s.chapterCurrentStep, [chapterIndex]: step },
        })),

      setProfile: (patch) => set((s) => ({ ...s, ...patch, dirty: true })),
      setMVV: (patch) => set((s) => ({ ...s, ...patch, dirty: true })),
      setSWOT: (patch) => set((s) => ({ ...s, ...patch, dirty: true })),

      // ▼ 部門セット後に即座に保存（※ ensureParentExists は呼ばない：二重保存を防ぐ）
      setDepartments: (deps: SafeDepartmentsArg) => {
        console.log('[strategyStore] setDepartments() called', deps);
        set((s) => ({
          departments: normalizeDepartmentsInput(deps, s.departments),
          dirty: true,
        }));

        (async () => {
          console.log('[strategyStore] setDepartments() immediate-save start');
          try {
            await get().saveStrategyData();
            console.log('[strategyStore] setDepartments() immediate-save done');
          } catch (e) {
            console.warn('[strategyStore] setDepartments immediate save failed:', e);
          }
        })();
      },

      // ▼ updateDepartments も同様
      updateDepartments: (updater) => {
        console.log('[strategyStore] updateDepartments() called');
        set((s) => {
          const prev = Array.isArray(s.departments) ? s.departments : [];
          const next = updater([...prev]);
          return { departments: normalizeDepartmentsInput(next, prev), dirty: true };
        });

        (async () => {
          console.log('[strategyStore] updateDepartments() immediate-save start');
          try {
            await get().saveStrategyData();
            console.log('[strategyStore] updateDepartments() immediate-save done');
          } catch (e) {
            console.warn('[strategyStore] updateDepartments immediate save failed:', e);
          }
        })();
      },

      setBusinessPortfolio: (p) => set({ businessPortfolio: { ...p }, dirty: true }),

      __afterSave(data) {
        const cur = get();
        const minimal = extractServerDecidedPatch(data ?? {}, cur);
        if (Object.keys(minimal).length > 0) set(minimal);
      },

      markLoaded: () => set({ loaded: true }),
      markDirty: () => set({ dirty: true }),

      buildPayload: () => buildSavePayload(get() as StrategyState),

      async saveStrategyData() {
        const state = get();

        // ★重要：refetch/hydrating中の保存は競合の温床（削除復活・無限ループ）なので抑止
        if (state.__isFetchingFromServer || state.boot?.isHydrating) {
          console.log('[strategyStore] saveStrategyData: skip while fetching/hydrating');
          return;
        }

        const userId = useUserStore.getState().user?.id;
        const companyId =
          state.companyId || state.pendingCompanyId || useUserStore.getState().companyId;

        console.log('[strategyStore] saveStrategyData() start', {
          userId,
          companyId,
          dirty: state.dirty,
          _loadingSave: state._loadingSave,
        });

        if (!userId || !companyId) {
          console.warn('[strategyStore] saveStrategyData skipped: missing ids');
          return;
        }

        if (!state.dirty) {
          console.log('[strategyStore] saveStrategyData: dirty=false, skip');
          return;
        }

        if (state._loadingSave) {
          console.log('[strategyStore] saveStrategyData: already saving, skip');
          return;
        }

        set({ _loadingSave: true });
        try {
          const payload = buildSavePayload(get() as StrategyState);

          if (isEffectivelyEmpty(payload)) {
            console.log('[strategyStore] saveStrategyData: payload effectively empty, clear dirty');
            set({ dirty: false });
            return;
          }

          const currentHash = stableHash(payload);
          if (state.__lastSavedHash && state.__lastSavedHash === currentHash) {
            console.log('[strategyStore] saveStrategyData: same hash, skip');
            set({ dirty: false });
            return;
          }

          const res = await (async () => {
            try {
              return await (saveStrategyDataApi as any)(
                payload,
                userId,
                companyId,
                state.revision,
                { mode: 'upsert' }
              );
            } catch (e) {
              console.warn('[strategyStore] saveStrategyData thrown, fallback legacy call:', e);
              try {
                return await (saveStrategyDataApi as any)(payload, userId, companyId);
              } catch (e2) {
                console.error('[strategyStore] saveStrategyData legacy call failed:', e2);
                return { error: e2 };
              }
            }
          })();

          if (!res || (res as any).error) {
            console.error(
              '[strategyStore] saveStrategyData API error:',
              (res as any)?.error ?? 'unknown error'
            );
            return;
          }

          const serverData = (res as any).data ?? {};
          const minimal = extractServerDecidedPatch(serverData, get() as StrategyState);

          const nextPatch: Partial<StrategyState> = {
            dirty: false,
            __lastSavedHash: currentHash,
          };
          if (Object.keys(minimal).length > 0) Object.assign(nextPatch, minimal);
          set(nextPatch);
        } finally {
          set({ _loadingSave: false });
        }
      },

      async refetchFromServer() {
        const s0 = get();
        const companyId =
          s0.pendingCompanyId || s0.companyId || useUserStore.getState().companyId;

        const authed = await isSessionUsable();
        if (!companyId || !authed) {
          set((s) => ({
            ...s,
            boot: { ...s.boot, isHydrating: true, isHydrated: false },
            __isFetchingFromServer: false,
            loaded: false,
          }));
          scheduleRefetchRetry(1500);
          return;
        }

        if (get()._loadingRefetch) return;
        set({ _loadingRefetch: true, __isFetchingFromServer: true });
        set((s) => ({ ...s, boot: { ...s.boot, isHydrating: true } }));

        try {
          const { data, error } = await getFullStrategyDataByCompany(companyId);
          if (error) {
            console.warn('[strategyStore] refetch error, will retry:', error);
            scheduleRefetchRetry(2000);
            return;
          }

          if (!data) {
            set((s) => ({
              ...s,
              boot: { isHydrating: true, isHydrated: false },
              __isFetchingFromServer: false,
              loaded: false,
            }));
            scheduleRefetchRetry(2000);
            return;
          }

          const patch = normalizeFromDbRow(data);
          const cur = get();

          const isSwitchingCompany =
            cur.pendingCompanyId !== undefined && cur.pendingCompanyId !== cur.companyId;

          // dirtyでも会社切替中は「ローカル保護」しない（混線防止）
          const wasDirty = cur.dirty && !isSwitchingCompany;

          const curRev = typeof cur.revision === 'number' ? cur.revision : undefined;
          const patchRev = typeof patch.revision === 'number' ? patch.revision : undefined;
          const isStale =
            typeof patchRev === 'number' &&
            typeof curRev === 'number' &&
            patchRev < curRev;

          if (wasDirty) {
            // dirtyを守る：サーバ決定項目のみ反映
            set((s) => {
              const base = s as StrategyState;
              const minimal = extractServerDecidedPatch(patch as any, base);
              return {
                ...base,
                ...minimal,
                companyId: s.pendingCompanyId ?? s.companyId,
                pendingCompanyId: undefined,
              };
            });

            const after = get();
            const rev =
              typeof patch.revision === 'number' ? patch.revision : after.revision ?? 0;

            set({ loaded: true });
            get().setHydrated(rev);
          } else {
            set((s) => {
              const base = s as StrategyState;

              const localDeps = normalizeDepartmentsInput(base.departments, []);
              const serverDeps = normalizeDepartmentsInput((patch as any).departments, []);

              // ★最重要：dirtyでなければ「サーバを正」として departments を上書き（削除復活を防ぐ）
              let nextDepartments: Department[] = serverDeps;

              if (!isSwitchingCompany) {
                // 通常時：サーバが古いと判断できるならローカル保護
                if (isStale) nextDepartments = localDeps;
              } else {
                // 会社切替：必ずサーバ優先（ローカル混ぜない）
                nextDepartments = serverDeps;
              }

              const merged: any = {
                ...(base as any),
                ...(patch as any),
                companyId: s.pendingCompanyId ?? s.companyId,
                pendingCompanyId: undefined,
              };

              merged.departments = nextDepartments;
              return merged as StrategyState;
            });

            const after = get();
            const snapshot = buildSavePayload(after as StrategyState);
            const hash = stableHash(snapshot);
            const rev =
              typeof patch.revision === 'number' ? patch.revision : after.revision ?? 0;

            set({
              serverShadow: snapshot,
              lastServerSnapshot: hash,
              __isFetchingFromServer: false,
              loaded: true,
              __lastSavedHash: hash,
              dirty: false,
            });

            get().setHydrated(rev, hash);
          }
        } finally {
          set({ _loadingRefetch: false, __isFetchingFromServer: false });
        }
      },

      async deleteAllOnServer() {
        const userId = useUserStore.getState().user?.id;
        const companyId = get().companyId || useUserStore.getState().companyId;
        if (!userId || !companyId) throw new Error('missing ids');

        if (!(await isSessionUsable())) return;

        const delRes = await (async () => {
          try {
            return await (deleteStrategyDataApi as any)(userId, companyId);
          } catch {
            return await (deleteStrategyDataApi as any)(userId);
          }
        })();

        if (delRes?.error) throw delRes.error;

        try {
          await (purgeLegacyTablesApi as any)?.(userId, companyId);
        } catch (e) {
          console.warn('[strategyStore] purgeLegacyTables warn:', e);
        }

        set((s) => ({
          ...emptyData,
          companyId: companyId,
          hydrated: true,
          loaded: true,
          boot: { isHydrating: false, isHydrated: true },
          revision: undefined,
          __isFetchingFromServer: false,
          __lastSavedHash: undefined,
          dirty: false,
        }));
      },
    }),
    {
      name: 'strategy-store',
      version: 34,
      partialize: (s) => ({
        companyId: s.companyId,
        strategyId: s.strategyId,
        pendingCompanyId: s.pendingCompanyId,

        story: s.story,
        finalStory: s.finalStory,
        answers2: s.answers2,
        departments: s.departments,
        csvFinanceData: s.csvFinanceData,
        financeSummary: s.financeSummary,
        businessPortfolio: s.businessPortfolio,
        simulationResult: s.simulationResult,
        chapterCurrentStep: s.chapterCurrentStep,

        companyName: s.companyName,
        foundationYear: s.foundationYear,
        location: s.location,
        industry: s.industry,
        revenue: s.revenue,
        employees: s.employees,
        businessContent: s.businessContent,
        customerSegment: s.customerSegment,

        mission: s.mission,
        vision: s.vision,
        value: s.value,
        thought: s.thought,
        strength: s.strength,
        weakness: s.weakness,
        opportunity: s.opportunity,
        threat: s.threat,

        winPatterns: s.winPatterns,
        winPatternPrimary: s.winPatternPrimary,
        winPatternSecondary: s.winPatternSecondary,

        revision: s.revision,
        __lastSavedHash: s.__lastSavedHash,
      }),
      migrate: (persisted) => ({
        ...emptyData,
        ...(persisted ?? {}),
        boot: { isHydrating: true, isHydrated: false },
        hydrated: false,
        loaded: false,
        dirty: false,
        __isFetchingFromServer: false,
      }),
      storage: createJSONStorage(() => localStorage),
      onRehydrateStorage: () => (state, error) => {
        if (error) console.warn('rehydration error:', error);
      },
    }
  )
);

export async function refetchFromServer() {
  return useStrategyStore.getState().refetchFromServer();
}
