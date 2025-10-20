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

  /** 旧: hydrated。新: boot へ移行（互換のため残置） */
  hydrated: boolean;
  boot: BootState;

  /** サーバ側の世代（楽観ロック用） */
  revision?: number;

  /** 直近サーバスナップショットのハッシュ（空保存抑止/差分検知に使用） */
  lastServerSnapshot?: string;

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

  setDepartments: (deps: Department[]) => void;
  setBusinessPortfolio: (p: BusinessPortfolio) => void;

  /* ===== Supabase ===== */
  saveStrategyData: () => Promise<void>;
  refetchFromServer: () => Promise<void>;
};

/* ==========================================================
 * ユーティリティ
 * ========================================================== */

/** 深いundefined/null/空配列/空文字を可能な限り取り除く（JSONB上書きの安全性向上） */
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

/** “実質空”判定：重要領域がすべて未入力なら true */
function isEffectivelyEmpty(payload: any): boolean {
  if (!payload) return true;
  const emptyArr = (a: any) => !Array.isArray(a) || a.length === 0;
  const emptyStr = (v: any) => typeof v !== 'string' || v.trim() === '';

  // ストーリー/回答/部門/財務サマリー/ポートフォリオ/シミュレーションが全て空なら“空”
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

  // MVV/プロフィール類も全部空（ある場合）
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
    // メタ系（存在する時のみ送る）
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

  // 3) departments/projects/okrs/okrsV2 正規化（okrsV2 や mission/strategy を温存）
  const departmentsRaw = isArray(raw.departments) ? raw.departments : [];
  const departments: Department[] = departmentsRaw.map((d: any) => {
    const projectsRaw = isArray(d?.projects) ? d.projects : [];

    // 部門レベルの出力（任意フィールドは存在時のみ付与）
    const deptOut: any = {
      name: d?.name ?? d?.title ?? '',
      projects: [] as any[],
    };
    if (typeof d?.mission === 'string') deptOut.mission = d.mission;
    if (typeof d?.deptMission === 'string') deptOut.mission = d.deptMission;
    if (typeof d?.strategy === 'string') deptOut.strategy = d.strategy;
    if (typeof d?.deptStrategy === 'string') deptOut.strategy = d.deptStrategy;

    // プロジェクト配下
    deptOut.projects = projectsRaw.map((p: any) => {
      const projOut: any = {
        title: p?.title ?? p?.name ?? '',
        okrs: isArray(p?.okrs) ? p.okrs : [],
      };
      // 互換フィールドの温存（UI で参照する可能性あり）
      if (typeof p?.name === 'string') projOut.name = p.name;
      if (isArray(p?.okrsV2)) projOut.okrsV2 = p.okrsV2;
      return projOut;
    });

    return deptOut as Department;
  });

  // 4) answers2 正規化（空なら4章デフォルト）
  const answers2Raw = isArray(raw.answers2) ? raw.answers2 : isArray(raw.answers) ? raw.answers : [];
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

  // 7) strategyId / revision（あれば）
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

  hydrated: false, // 互換用
  boot: { isHydrating: false, isHydrated: false },

  revision: undefined,
  lastServerSnapshot: undefined,

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
  setBusinessPortfolio: () => {},
  saveStrategyData: async () => {},
  refetchFromServer: async () => {},
};

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
          // companyIdが変わる場合のみ全面初期化 + scope設定
          return {
            ...emptyData,
            companyId: id,
            hydrated: false,
            boot: { isHydrating: true, isHydrated: false }, // これからロードする想定
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
      setDepartments: (deps) => set({ departments: [...deps] }),
      setBusinessPortfolio: (p) => set({ businessPortfolio: { ...p } }),

      /* ====================================================
       * Supabase 保存（初期ハイドレーション完了まで保存禁止）
       *  - 空テンプレは保存しない
       *  - 楽観ロック（revision）を渡す
       *  - サーバスナップショットのハッシュを保持
       * ==================================================== */
      async saveStrategyData() {
        const state = get();

        // 初期ハイドレーションが完了するまで保存禁止（事故防止）
        if (!state.boot.isHydrated || state.boot.isHydrating) {
          // console.log('[strategyStore] save: blocked (boot not hydrated)');
          return;
        }

        const userId = useUserStore.getState().user?.id;
        const companyId = state.companyId || useUserStore.getState().companyId;
        if (!userId || !companyId) throw new Error('missing ids');

        if (state._loadingSave) return;
        set({ _loadingSave: true });
        try {
          const payload = buildSavePayload(get());

          // 空テンプレの保存は禁止（上書き事故を回避）
          if (isEffectivelyEmpty(payload)) {
            // console.warn('[strategyStore] save: skipped (effectively empty payload)');
            return;
          }

          const localHash = stableHash(payload);
          // 直近サーバスナップショットと同一なら保存スキップ
          if (state.lastServerSnapshot && state.lastServerSnapshot === localHash) {
            return;
          }

          // APIに revision を渡せる実装の場合（第四引数）を想定
          const res = await (async () => {
            try {
              // (payload, userId, companyId, revision) で実装している前提
              // 互換のため第4引数無し実装でも動作するようフォールバック
              return await (saveStrategyDataApi as any)(payload, userId, companyId, state.revision);
            } catch {
              return await (saveStrategyDataApi as any)(payload, userId, companyId);
            }
          })();

          // サーバ応答取り扱い
          // 期待：{ revision?: number, serverSnapshotHash?: string, data?: Partial<StrategyState> }
          const serverHash: string | undefined =
            res?.serverSnapshotHash ?? res?.snapshotHash ?? res?.hash ?? localHash;
          const nextRevision: number | undefined =
            typeof res?.revision === 'number'
              ? res.revision
              : typeof res?.data?.revision === 'number'
              ? res.data.revision
              : state.revision;

          // サーバ決定事項のみ反映（strategyId / revision）
          if (res?.data) {
            const minimal = extractServerDecidedPatch(res.data as Partial<StrategyState>, get());
            if (Object.keys(minimal).length > 0) {
              set(minimal);
            }
          }
          if (typeof nextRevision === 'number' || serverHash) {
            set((s) => ({
              revision: typeof nextRevision === 'number' ? nextRevision : s.revision,
              lastServerSnapshot: serverHash ?? s.lastServerSnapshot ?? localHash,
            }));
          }
        } finally {
          set({ _loadingSave: false });
        }
      },

      /* ====================================================
       * Supabase 再フェッチ（ロード順序を厳守）
       *  1) setHydrating(true)
       *  2) 取得→正規化→state反映
       *  3) サーバスナップショットhashを記録
       *  4) setHydrated(rev, hash)
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
            });
            console.log('[strategyStore] ⚠️ refetch: no data; hydrated=true');
            return;
          }

          // 正規化
          const patch = normalizeFromDbRow(data);

          // stateに反映（bootはこの後 setHydrated で更新）
          set((s) => ({ ...s, ...patch }));

          // サーバスナップショットのハッシュを設定
          const after = get();
          const snapshot = buildSavePayload(after);
          const hash = stableHash(snapshot);

          const rev = typeof patch.revision === 'number' ? patch.revision : after.revision ?? 0;
          set({
            lastServerSnapshot: hash,
          });

          // 最後に hydrated フラグON（互換のため hydrated も true）
          get().setHydrated(rev, hash);
          console.log('[strategyStore] ✅ refetchFromServer hydrated=true (rev=%s)', String(rev));
        } finally {
          set({ _loadingRefetch: false });
        }
      },
    }),
    {
      name: 'strategy-store',
      version: 24, // boot導入・revision/hash導入
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
        // 注意: boot / revision / lastServerSnapshot は永続化しない（起動毎に安全側へ）
      }),
      migrate: (persisted) => ({
        ...emptyData,
        ...(persisted ?? {}),
        boot: { isHydrating: false, isHydrated: true }, // 旧バージョンとの互換
        hydrated: true,
      }),
      storage: createJSONStorage(() => localStorage),
      onRehydrateStorage: () => (state, error) => {
        if (error) console.warn('rehydration error:', error);
        // 復元直後は最低限 spinner を外す（互換対応）
        state?.setHydrated?.(true);
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
