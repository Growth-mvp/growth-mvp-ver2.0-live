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

// setDepartments への安全引数
type SafeDepartmentsArg =
  | Department[]
  | { departments?: Department[] | null }
  | null
  | undefined;

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

  /** 旧: hydrated。新: bootへ（互換のため残置） */
  hydrated: boolean;
  boot: BootState;

  /** サーバ側の世代（楽観ロック用） */
  revision?: number;

  /** 直近サーバスナップショットのハッシュ（空保存抑止/差分検知に使用） */
  lastServerSnapshot?: string;

  /** 直近サーバデータの“影”（保存時のディープマージ用 / 永続化しない） */
  serverShadow?: any;

  chapterCurrentStep: Record<number, number>;

  /** 進行中フラグ（多重実行ガード用） */
  _loadingRefetch?: boolean;
  _loadingSave?: boolean;

  /* ===== Setter / Action ===== */
  reset: () => void;
  resetAll: () => void;

  /** 互換API（内部では boot を更新） */
  setHydrated: (revOrBool?: boolean | number, hash?: string) => void;
  setHydrating: (b: boolean) => void;
  setServerSnapshotHash: (hash?: string) => void;

  setStrategyId: (id: string | null) => void;

  /** companyId切替。★同一IDなら no-op（bootを崩さない） */
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

  /** ★ ランタイム安全（undefined / {departments} / 配列 なんでもOK） */
  setDepartments: (deps: SafeDepartmentsArg) => void;

  /** ★ 差分更新用（推奨） */
  updateDepartments: (updater: (prev: Department[]) => Department[]) => void;

  setBusinessPortfolio: (p: BusinessPortfolio) => void;

  /* ===== Supabase ===== */
  saveStrategyData: () => Promise<void>;
  refetchFromServer: () => Promise<void>;
};

/* ==========================================================
 * ユーティリティ
 * ========================================================== */

const jsonEq = (a: any, b: any) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

function pruneUndefinedDeep<T>(obj: T): T {
  if (Array.isArray(obj)) {
    return obj.map(pruneUndefinedDeep).filter((v) => !(v === undefined || v === null)) as unknown as T;
  }
  if (obj && typeof obj === 'object') {
    const out: any = {};
    for (const [k, v] of Object.entries(obj as any)) {
      const pv = pruneUndefinedDeep(v);
      const drop =
        pv === undefined ||
        pv === null ||
        (typeof pv === 'string' && pv.trim() === '') ||
        (Array.isArray(pv) && pv.length === 0);
      if (!drop) out[k] = pv;
    }
    return out;
  }
  return obj;
}

/** シンプル安定ハッシュ（djb2） */
function stableHash(input: any): string {
  const s = typeof input === 'string' ? input : JSON.stringify(input);
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = (h * 33) ^ s.charCodeAt(i);
  return (h >>> 0).toString(16);
}

/** ディープマージ（右優先）。配列は右を採用（JSONB上書き対策） */
function deepMerge<T>(base: any, patch: any): T {
  if (Array.isArray(base) || Array.isArray(patch)) return (patch ?? base) as T;
  if (base && typeof base === 'object' && patch && typeof patch === 'object') {
    const keys = new Set([...Object.keys(base), ...Object.keys(patch)]);
    const out: any = {};
    keys.forEach((k) => {
      out[k] = deepMerge(base?.[k], patch?.[k]);
    });
    return out;
  }
  return (patch !== undefined ? patch : base) as T;
}

/** “実質空”判定：重要領域がすべて未入力なら true */
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
      (Array.isArray(payload.businessPortfolio?.units) && payload.businessPortfolio.units.length === 0)) &&
    (payload.simulationResult == null ||
      (Array.isArray(payload.simulationResult?.projection?.points) &&
        payload.simulationResult.projection.points.length === 0));

  const metaAllEmpty =
    [payload.companyName, payload.mission, payload.vision, payload.value, payload.thought]
      .filter((v) => v !== undefined)
      .every(emptyStr);

  return allEmpty && metaAllEmpty;
}

/* ==========================================================
 * 保存ペイロード構築（undefined除去＋正規キーに限定）
 * ========================================================== */
function buildSavePayload(s: StrategyState) {
  const base: any = {
    strategyId: s.strategyId ?? undefined,
    story: s.story,
    finalStory: s.finalStory,
    answers2: s.answers2,
    departments: s.departments,
    companyName: s.companyName,
    mission: s.mission,
    vision: s.vision,
    value: s.value,
    thought: s.thought,
  };
  if (typeof s.businessPortfolio !== 'undefined') base.businessPortfolio = s.businessPortfolio;
  if (Array.isArray(s.csvFinanceData)) base.csvFinanceData = s.csvFinanceData;
  if (Array.isArray(s.financeSummary)) base.financeSummary = s.financeSummary;
  if (s.simulationResult !== undefined) base.simulationResult = s.simulationResult;

  return pruneUndefinedDeep(base);
}

/** サーバー応答から“サーバー決定事項のみ”を抽出して state へ反映 */
function extractServerDecidedPatch(
  resData: Partial<StrategyState> & { revision?: number },
  current: StrategyState
): Partial<StrategyState> {
  const patch: Partial<StrategyState> = {};
  if (resData.strategyId && resData.strategyId !== current.strategyId) {
    patch.strategyId = resData.strategyId;
  }
  if (typeof resData.revision === 'number') {
    patch.revision = resData.revision;
  }
  return patch;
}

/* ==========================================================
 * 正規化（getFullStrategyDataByCompany → state）
 * 重要：Department は“フル温存”。未知キーも落とさない。
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
  const finalStory = isArray(raw.finalStory) ? raw.finalStory : isArray(raw.final_story) ? raw.final_story : [];
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

  // departments：未知キーも温存しつつ最低限の補正のみ
  const departmentsRaw = isArray(raw.departments) ? raw.departments : [];
  const departments: Department[] = departmentsRaw.map((d: any, di: number) => {
    const projectsRaw = isArray(d?.projects) ? d.projects : [];

    // まず丸ごと展開して未知キーを温存
    const deptOut: any = { ...d };

    // name補正（titleのみの場合）
    if (!deptOut.name) deptOut.name = d?.title ?? `Department ${di + 1}`;

    // answers2正規化＋steps安定ソート
    if (isArray(d?.answers2)) {
      deptOut.answers2 = d.answers2.map((c: any, idx: number) => ({
        chapterIndex: typeof c?.chapterIndex === 'number' ? c.chapterIndex : idx,
        chapterTitle: typeof c?.chapterTitle === 'string' ? c.chapterTitle : (d?.name ?? `Chapter ${idx + 1}`),
        steps: isArray(c?.steps)
          ? [...c.steps].sort((a: any, b: any) => Number(a?.stepNumber ?? 0) - Number(b?.stepNumber ?? 0))
          : [],
      }));
    }

    // projects配下も未知キー温存＋最低の補正
    deptOut.projects = projectsRaw.map((p: any) => {
      const projOut: any = { ...p };
      projOut.title = p?.title ?? p?.name ?? '';
      if (!Array.isArray(projOut.okrs)) projOut.okrs = Array.isArray(p?.okrs) ? p.okrs : [];
      return projOut;
    });

    return deptOut as Department;
  });

  const answers2Raw = isArray(raw.answers2) ? raw.answers2 : isArray(raw.answers) ? raw.answers : [];
  const answers2: ChapterAnswers[] =
    isArray(answers2Raw) && answers2Raw.length > 0
      ? answers2Raw.map((c: any, idx: number) => ({
          chapterIndex: typeof c?.chapterIndex === 'number' ? c.chapterIndex : idx,
          chapterTitle: typeof c?.chapterTitle === 'string' ? c.chapterTitle : `Chapter ${idx + 1}`,
          steps: Array.isArray(c?.steps)
            ? [...c.steps].sort((a: any, b: any) => Number(a?.stepNumber ?? 0) - Number(b?.stepNumber ?? 0))
            : [],
        }))
      : [
          { chapterIndex: 0, chapterTitle: '第1章：なぜ今（現状）', steps: [] },
          { chapterIndex: 1, chapterTitle: '第2章：どう戦う（戦略）', steps: [] },
          { chapterIndex: 2, chapterTitle: 'どんな未来像（会社の未来像）', steps: [] },
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
  };
}

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
  boot: { isHydrating: false, isHydrated: false },

  revision: undefined,
  lastServerSnapshot: undefined,
  serverShadow: undefined,

  chapterCurrentStep: {},
  _loadingRefetch: false,
  _loadingSave: false,

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
  saveStrategyData: async () => {},
  refetchFromServer: async () => {},
};

/* ==========================================================
 * 内部ヘルパ：Department配列の軽い正規化
 * ========================================================== */
function normalizeDepartmentsInput(input: any, fallback: Department[]): Department[] {
  const fromArg = Array.isArray(input)
    ? input
    : Array.isArray(input?.departments)
    ? (input.departments as Department[])
    : undefined;

  const base = Array.isArray(fromArg) ? fromArg : Array.isArray(fallback) ? fallback : [];

  // 未知キー温存、最低限の補正のみ（projects/okrs）
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
        // okrsV2 等は未知キーとして温存（配列ならそのまま）
        if (p?.okrsV2 && !Array.isArray(p.okrsV2)) po.okrsV2 = [];
        return po;
      });
      return out as Department;
    });
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

      /** 互換API: booleanなら従来通り、numberなら revision として扱う */
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

      /* ===== Setter群 ===== */
      setStrategyId: (id) => set({ strategyId: id }),

      /** ★冪等化：同一IDなら no-op（boot を崩さない） */
      setCompanyScope: (id) =>
        set((s) => {
          if (s.companyId === id) return s; // no-op
          return {
            ...emptyData,
            companyId: id,
            hydrated: false,
            boot: { isHydrating: true, isHydrated: false },
          };
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

      /** ★ ランタイム安全版：どんな引数でも落ちない */
      setDepartments: (deps: SafeDepartmentsArg) =>
        set((s) => ({
          departments: normalizeDepartmentsInput(deps, s.departments),
        })),

      /** ★ 差分更新：呼び出し側で配列を作らずに更新できる */
      updateDepartments: (updater) =>
        set((s) => {
          const prev = Array.isArray(s.departments) ? s.departments : [];
          const next = updater([...prev]);
          return { departments: normalizeDepartmentsInput(next, prev) };
        }),

      setBusinessPortfolio: (p) => set({ businessPortfolio: { ...p } }),

      /* ====================================================
       * Supabase 保存（超厳格ガード + ディープマージ）
       * ==================================================== */
      async saveStrategyData() {
        const state = get();

        // 1) 初期ハイドレーション完了前は絶対に保存しない
        if (!state.boot.isHydrated || state.boot.isHydrating) return;

        // 2) サーバ由来のスナップショット/リビジョンが未確定なら保存しない
        if (state.revision === undefined && !state.lastServerSnapshot) return;

        const userId = useUserStore.getState().user?.id;
        const companyId = state.companyId || useUserStore.getState().companyId;
        if (!userId || !companyId) throw new Error('missing ids');

        if (state._loadingSave) return;
        set({ _loadingSave: true });
        try {
          const localPayload = buildSavePayload(get());

          // 空テンプレの保存は禁止（上書き事故を回避）
          if (isEffectivelyEmpty(localPayload)) return;

          // 3) サーバ影とディープマージして欠落キーを保持
          const mergedPayload = state.serverShadow
            ? deepMerge<any>(state.serverShadow, localPayload)
            : localPayload;

          const localHash = stableHash(mergedPayload);
          // 直近サーバスナップショットと同一なら保存スキップ
          if (state.lastServerSnapshot && state.lastServerSnapshot === localHash) {
            return;
          }

          // APIに revision を渡す（互換フォールバックあり）
          const res = await (async () => {
            try {
              return await (saveStrategyDataApi as any)(mergedPayload, userId, companyId, state.revision);
            } catch {
              return await (saveStrategyDataApi as any)(mergedPayload, userId, companyId);
            }
          })();

          // 応答処理
          const serverHash: string | undefined =
            res?.serverSnapshotHash ?? res?.snapshotHash ?? res?.hash ?? localHash;
          const nextRevision: number | undefined =
            typeof res?.revision === 'number'
              ? res.revision
              : typeof res?.data?.revision === 'number'
              ? res.data.revision
              : state.revision;

          // サーバ決定事項のみ反映
          if (res?.data) {
            const minimal = extractServerDecidedPatch(res.data as Partial<StrategyState>, get());
            if (Object.keys(minimal).length > 0) set(minimal);
          }

          // サーバ影も更新（最新保存内容を影として保持）
          set((s) => ({
            serverShadow: mergedPayload,
            revision: typeof nextRevision === 'number' ? nextRevision : s.revision,
            lastServerSnapshot: serverHash ?? s.lastServerSnapshot ?? localHash,
          }));
        } finally {
          set({ _loadingSave: false });
        }
      },

      /* ====================================================
       * Supabase 再フェッチ（ロード順序厳守）
       * ==================================================== */
      async refetchFromServer() {
        const companyId = get().companyId || useUserStore.getState().companyId;
        if (!companyId) {
          // companyIdが無くても spinner が止まるように
          set({ hydrated: true, boot: { isHydrating: false, isHydrated: true } });
          return;
        }

        if (get()._loadingRefetch) return; // guard
        set({ _loadingRefetch: true });
        set((s) => ({ ...s, boot: { ...s.boot, isHydrating: true } }));

        try {
          console.log('[StrategyData] 📥 getFullStrategyDataByCompany start:', companyId);
          const { data, error } = await getFullStrategyDataByCompany(companyId);
          if (error) throw error;

          if (!data) {
            // データ無しでも少なくとも hydrated は立てる
            set({
              hydrated: true,
              boot: { isHydrating: false, isHydrated: true },
              lastServerSnapshot: undefined,
              revision: undefined,
              serverShadow: undefined,
            });
            console.log('[strategyStore] ⚠️ refetch: no data; hydrated=true');
            return;
          }

          // 正規化
          const patch = normalizeFromDbRow(data);

          // stateに反映（未知キーは normalize 内で温存済）
          set((s) => ({ ...s, ...patch }));

          // サーバスナップショット/影を設定
          const after = get();
          const snapshot = buildSavePayload(after);
          const hash = stableHash(snapshot);

          const rev = typeof patch.revision === 'number' ? patch.revision : after.revision ?? 0;

          set({
            serverShadow: snapshot, // ★最新サーバの影
            lastServerSnapshot: hash,
          });

          // hydrated ON
          get().setHydrated(rev, hash);
          console.log('[strategyStore] ✅ refetchFromServer hydrated=true (rev=%s)', String(rev));
        } finally {
          set({ _loadingRefetch: false });
        }
      },
    }),
    {
      name: 'strategy-store',
      version: 26, // ★ ディープマージ保存 & serverShadow 導入
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
        // 注意: boot / revision / lastServerSnapshot / serverShadow は永続化しない
      }),
      migrate: (persisted) => ({
        ...emptyData,
        ...(persisted ?? {}),
        boot: { isHydrating: false, isHydrated: true }, // 旧バージョン互換
        hydrated: true,
      }),
      storage: createJSONStorage(() => localStorage),
      onRehydrateStorage: () => (state, error) => {
        if (error) console.warn('rehydration error:', error);
        // 復元直後は setHydrated を呼ばず、refetch 完了で setHydrated する（保存暴発を防ぐ）
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
