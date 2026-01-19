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
import { computeValueAnalysis, computeValueAnalysisBundle } from '@/utils/valueAnalysis';
import { stage1DummyDataBundle } from '@/utils/stage1DummyData';
import type {
  ChapterStory,
  ChapterAnswers,
  Department,
  WinPattern,
  WinPatternId,
  WinPatternCandidate,
  BusinessSegment,
  FinanceBSRow,
  FinancePLRow,
  SegmentBSRow,
  ValueAnalysis,
  IssueBlock,
  MetricsSummary,
  Stage2State,
  Stage2Answer,
  StoryChapter,
} from '@/types/strategy';
import type { BusinessPortfolio } from '@/types/portfolio';
import {
  saveStage1SnapshotToLocalStorage,
  saveStage2SnapshotToLocalStorage,
  loadStage1SnapshotFromLocalStorage,
  loadStage2SnapshotFromLocalStorage,
  valueAnalysisToMetricsSummary,
  buildStage2StateFromStore,
} from '@/utils/stageSnapshot';

/* ===== 型定義（ローカル用：旧互換） ===== */
const DEBUG = process.env.NEXT_PUBLIC_DEBUG_HYDRATE === '1';
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

/* ===== STAGE1: 論点ブロック ===== */
export type Stage1IssueBlock = IssueBlock;

type BootState = { isHydrating: boolean; isHydrated: boolean };

type SafeDepartmentsArg =
  | Department[]
  | { departments?: Department[] | null }
  | null
  | undefined;

/* ============================================================
 * 保存直列化（最重要）
 * - 複数トリガ（Sidebar手動保存 / 部門即時保存 / スナップショット等）が同時に走ると
 *   revision がサーバで先に進み、REVISION_CONFLICT になりやすい。
 * - ここで「保存系」を必ず直列化する。
 * ========================================================== */
let __saveChain: Promise<void> = Promise.resolve();

function enqueueSave<T>(fn: () => Promise<T>): Promise<T> {
  const run = async () => fn();
  const p = __saveChain.then(run, run);
  __saveChain = p.then(
    () => undefined,
    () => undefined
  );
  return p;
}

/* ===== StrategyState ===== */
export type StrategyState = {
  companyId: string | null;
  strategyId: string | null;

  /** スコープ切替の"仮"置き場（成功取得時のみ companyId に昇格） */
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

  /* 会計・期間設定（STAGE1 拡張） */
  fiscalYearEnd?: string;
  currency?: string;
  periodStartYear?: string;
  periodEndYear?: string;

  /* 事業セグメント（STAGE1 拡張） */
  businessSegments?: BusinessSegment[];

  /* 上場情報・指標⑤準備（STAGE1 拡張） */
  isListed?: boolean;
  ticker?: string;
  pbrManual?: string;

  /* 財務BS（STAGE1 指標⑤用） */
  financeBS?: FinanceBSRow[];

  /* 財務PL（STAGE1 企業価値分析用） */
  financePL?: FinancePLRow[];

  /* 事業部別 PL/BS（STAGE1 セグメント分析用） */
  segmentPL?: Record<string, FinancePLRow[]>;
  segmentBS?: Record<string, SegmentBSRow[]>;

  /* 本社・共通費調整（事業部合計との差分） */
  hqAdjustmentPL?: FinancePLRow[];
  hqAdjustmentBS?: Partial<SegmentBSRow>[];

  /* 5指標分析（STAGE1 → STAGE2 接続） */
  valueAnalysis?: ValueAnalysis;

  /* 事業部別 ValueAnalysis（STAGE1 セグメント分析結果） */
  segmentValueAnalysis?: Record<string, ValueAnalysis>;

  /* STAGE1：論点整理（Issue Block） */
  stage1Issues?: Stage1IssueBlock[];

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

  /* ★ STAGE2：たたき台・12問 */
  storyDraft?: StoryChapter[];
  winPatternsCandidate?: WinPatternCandidate[];
  answers12?: Stage2Answer[];

  /* ★ 全社レベルの勝ち筋（受け皿） */
  winPatterns?: WinPattern[];
  winPatternPrimary?: WinPatternId;
  winPatternSecondary?: WinPatternId;

  /* ★ STAGE4：実行計画（部門ごとの編集状態・差分） */
  stage4Plans?: Array<{
    departmentId: string;
    status: 'Draft' | 'Review' | 'Approved';
    baseline: any;
    current: any;
    updatedAt?: string;
    updatedBy?: string;
  }>;

  /* ★ STAGE4：Baseline（hydrate後に1回のみ作成、変更なし） */
  executionPlanBaseline?: {
    companyId?: string;
    createdAt?: number;
    snapshot?: any[];
  };

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

  /** 直近サーバ取得エラー（RLS/404/不許可など永続エラーを格納、ネットワークエラーは retry のためここに置かない） */
  __lastServerError?: Error | null;

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
        | 'fiscalYearEnd'
        | 'currency'
        | 'periodStartYear'
        | 'periodEndYear'
        | 'businessSegments'
        | 'isListed'
        | 'ticker'
        | 'pbrManual'
        | 'financeBS'
        | 'financePL'
        | 'segmentPL'
        | 'segmentBS'
        | 'hqAdjustmentPL'
        | 'hqAdjustmentBS'
        | 'valueAnalysis'
        | 'segmentValueAnalysis'
        | 'stage1Issues'
      >
    >
  ) => void;

  /* ▼ 互換用ショートカット（CompanyScopePanel 等で使う） */
  setCompanyName: (name: string) => void;
  setIndustry: (industry: string) => void;
  setStage1Issues: (issues: Stage1IssueBlock[]) => void;

  /* ▼ STAGE2 setter */
  setStoryDraft: (draft: StoryChapter[]) => void;
  setWinPatternsCandidate: (candidates: WinPatternCandidate[]) => void;
  setAnswers12: (answers: Stage2Answer[]) => void;
  updateAnswer12: (id: string, patch: Partial<Stage2Answer>) => void;

  /* ▼ STAGE4 setter */
  setStage4Plans: (plans: Array<{
    departmentId: string;
    status: 'Draft' | 'Review' | 'Approved';
    baseline: any;
    current: any;
    updatedAt?: string;
    updatedBy?: string;
  }>) => void;

  setExecutionPlanBaseline: (baseline: {
    companyId?: string;
    createdAt?: number;
    snapshot?: any[];
  }) => void;

  /** ValueAnalysis 再計算（source: 変更元を示す） */
  recomputeValueAnalysis: (
    source?:
      | 'local'
      | 'refetchFromServer'
      | 'setFinanceSummary'
      | 'setProfile'
      | 'setFinancePL'
      | 'setFinanceBS'
      | 'setBusinessSegments'
      | 'setSegmentPL'
      | 'setSegmentBS'
  ) => void;

  /* STAGE1 財務データ setter */
  setFinancePL: (rows: FinancePLRow[]) => void;
  setFinanceBS: (rows: FinanceBSRow[]) => void;
  setSegmentPL: (data: Record<string, FinancePLRow[]>) => void;
  setSegmentBS: (data: Record<string, SegmentBSRow[]>) => void;
  setBusinessSegmentsWithSync: (segments: BusinessSegment[]) => void;

  setMVV: (patch: Partial<Pick<StrategyState, 'thought' | 'mission' | 'vision' | 'value'>>) => void;
  setSWOT: (patch: Partial<Pick<StrategyState, 'strength' | 'weakness' | 'opportunity' | 'threat'>>) => void;

  setDepartments: (deps: SafeDepartmentsArg) => void;
  updateDepartments: (updater: (prev: Department[]) => Department[]) => void;

  setBusinessPortfolio: (p: BusinessPortfolio) => void;
  setFinanceSummary: (rows: FinanceSummaryRow[]) => void;

  markLoaded: () => void;
  markDirty: () => void;

  buildPayload: () => any;

  saveStrategyData: () => Promise<void>;
  refetchFromServer: () => Promise<void>;
  deleteAllOnServer: () => Promise<void>;

  /** STAGE1 ダミーデータ投入（開発用） */
  loadStage1DummyData: () => void;

  /** STAGE1 スナップショットを localStorage に保存 */
  saveStage1Snapshot: () => boolean;

  /** STAGE2 スナップショットを localStorage に保存 */
  saveStage2Snapshot: () => boolean;

  /** STAGE1 スナップショットを localStorage から復元 */
  restoreStage1FromSnapshot: () => boolean;

  /** MetricsSummary を取得（valueAnalysis から生成） */
  getMetricsSummary: () => MetricsSummary;
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
      const drop = pv === undefined || pv === null || (typeof pv === 'string' && pv.trim() === '');
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
    emptyArr(payload.stage1Issues) &&
    (payload.businessPortfolio == null ||
      (Array.isArray(payload.businessPortfolio?.units) && payload.businessPortfolio.units.length === 0)) &&
    (payload.simulationResult == null ||
      (Array.isArray(payload.simulationResult?.projection?.points) &&
        payload.simulationResult.projection.points.length === 0));

  const metaAllEmpty = [payload.companyName, payload.mission, payload.vision, payload.value, payload.thought]
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

    fiscalYearEnd: s.fiscalYearEnd,
    currency: s.currency,
    periodStartYear: s.periodStartYear,
    periodEndYear: s.periodEndYear,
    businessSegments: s.businessSegments,

    isListed: s.isListed,
    ticker: s.ticker,
    pbrManual: s.pbrManual,
    financeBS: s.financeBS,
    financePL: s.financePL,
    segmentPL: s.segmentPL,
    segmentBS: s.segmentBS,
    hqAdjustmentPL: s.hqAdjustmentPL,
    hqAdjustmentBS: s.hqAdjustmentBS,
    valueAnalysis: s.valueAnalysis,
    segmentValueAnalysis: s.segmentValueAnalysis,

    stage1Issues: s.stage1Issues,

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

    stage4Plans: s.stage4Plans,
    executionPlanBaseline: s.executionPlanBaseline,
  };

  if (typeof s.businessPortfolio !== 'undefined') base.businessPortfolio = s.businessPortfolio;
  if (Array.isArray(s.csvFinanceData)) base.csvFinanceData = s.csvFinanceData;
  if (Array.isArray(s.financeSummary)) base.financeSummary = s.financeSummary;
  if (s.simulationResult !== undefined) base.simulationResult = s.simulationResult;

  return pruneUndefinedDeep(base);
}

/**
 * wasDirty=true の場合にもサーバから必ず反映すべきフィールドを抽出
 *
 * 目的：
 * - ユーザー入力中（dirty=true）の場合でも、重要なサーバ側決定項目は反映する
 * - Stage1の財務系・Stage2のストーリー系・Stage3の部門系など、
 *   「ユーザーが別操作で更新した」可能性が低いデータは常に最新化
 * - strategyId と revision は常に必須（オプティミスティックロック用）
 *
 * 反映対象フィールド（wasDirty=true でも上書き）：
 * ├─ Stage1（財務・セグメント分析）:
 * │  ├─ financeBS / financePL（会計データは完全データソース）
 * │  ├─ segmentPL / segmentBS / hqAdjustmentPL / hqAdjustmentBS
 * │  ├─ valueAnalysis / segmentValueAnalysis（計算結果）
 * │  ├─ financeSummary / businessPortfolio
 * │  └─ companyName / industry / revenue（会社情報は確実性重視）
 * ├─ Stage2（ストーリー・戦略）:
 * │  ├─ storyDraft / finalStory（生成結果）
 * │  ├─ winPatternsCandidate / answers12
 * │  └─ answers2
 * ├─ Stage3（部門・OKR）:
 * │  ├─ departments（部門構成は変動が多い）
 * │  └─ thought / mission / vision / value
 * └─ System: strategyId / revision / loaded / hydrated
 */
function extractServerDecidedPatch(
  resData: Partial<StrategyState> & { revision?: number },
  current: StrategyState
): Partial<StrategyState> {
  const patch: Partial<StrategyState> = {};

  /* ========== 常に反映（System） ========== */
  if (resData.strategyId && resData.strategyId !== current.strategyId)
    patch.strategyId = resData.strategyId;
  if (typeof resData.revision === 'number')
    patch.revision = resData.revision;

  /* ========== STAGE1: 財務・会社情報・セグメント分析 ========== */
  // 財務BS/PLはサーバが唯一の真実源 → 常に反映
  if (Array.isArray(resData.financeBS))
    patch.financeBS = resData.financeBS;
  if (Array.isArray(resData.financePL))
    patch.financePL = resData.financePL;

  // セグメント別財務も常に最新化（ユーザー編集の対象外）
  if (resData.segmentPL && typeof resData.segmentPL === 'object')
    patch.segmentPL = resData.segmentPL;
  if (resData.segmentBS && typeof resData.segmentBS === 'object')
    patch.segmentBS = resData.segmentBS;

  // 本社調整額
  if (Array.isArray(resData.hqAdjustmentPL))
    patch.hqAdjustmentPL = resData.hqAdjustmentPL;
  if (Array.isArray(resData.hqAdjustmentBS))
    patch.hqAdjustmentBS = resData.hqAdjustmentBS;

  // 計算結果（5指標・セグメント分析）
  if (resData.valueAnalysis && typeof resData.valueAnalysis === 'object')
    patch.valueAnalysis = resData.valueAnalysis;
  if (resData.segmentValueAnalysis && typeof resData.segmentValueAnalysis === 'object')
    patch.segmentValueAnalysis = resData.segmentValueAnalysis;

  // その他財務サマリ
  if (Array.isArray(resData.financeSummary))
    patch.financeSummary = resData.financeSummary;
  if (resData.businessPortfolio && typeof resData.businessPortfolio === 'object')
    patch.businessPortfolio = resData.businessPortfolio;

  // 会社基本情報も確実性重視で常に反映
  if (typeof resData.companyName === 'string')
    patch.companyName = resData.companyName;
  if (typeof resData.industry === 'string')
    patch.industry = resData.industry;
  if (typeof resData.revenue === 'string')
    patch.revenue = resData.revenue;

  /* ========== STAGE2: ストーリー・戦略候補 ========== */
  // 生成結果は常に最新化
  if (Array.isArray(resData.storyDraft))
    patch.storyDraft = resData.storyDraft;
  if (Array.isArray(resData.finalStory))
    patch.finalStory = resData.finalStory;
  if (Array.isArray(resData.answers2))
    patch.answers2 = resData.answers2;

  // 戦略候補
  if (Array.isArray(resData.winPatternsCandidate))
    patch.winPatternsCandidate = resData.winPatternsCandidate;
  if (Array.isArray(resData.answers12))
    patch.answers12 = resData.answers12;

  /* ========== STAGE3: 部門・戦略方針 ========== */
  // 部門構成は会社構造の基本情報 → 常に最新化（削除復活防止と同様の重要性）
  if (Array.isArray(resData.departments))
    patch.departments = resData.departments;

  // MVV/SWOT も会社の指針なので常に反映
  if (typeof resData.thought === 'string')
    patch.thought = resData.thought;
  if (typeof resData.mission === 'string')
    patch.mission = resData.mission;
  if (typeof resData.vision === 'string')
    patch.vision = resData.vision;
  if (typeof resData.value === 'string')
    patch.value = resData.value;

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
 * 親(strategy_data)の存在を"できる限り"保証
 * - 重要: 既に親が存在していそうな場合は「何もしない」。
 * - 保存直列化キューに乗せて、revision の前後不一致を減らす。
 * ========================================================== */
let __ensureParentInflight: Promise<void> | null = null;

async function ensureParentExists(): Promise<void> {
  if (__ensureParentInflight) return __ensureParentInflight;

  __ensureParentInflight = enqueueSave(async () => {
    const s = useStrategyStore.getState();
    const userId = useUserStore.getState().user?.id;
    const companyId = s.companyId || s.pendingCompanyId || useUserStore.getState().companyId;

    if (DEBUG) console.log('[strategyStore] ensureParentExists()', { userId, companyId });

    if (!userId || !companyId) {
      console.warn('[strategyStore] ensureParentExists skipped: missing ids');
      return;
    }

    // ★最重要：revision が取れている／loaded の場合は親が存在している可能性が極めて高いので何もしない
    if (typeof s.revision === 'number' || s.loaded || s.hydrated) {
      if (DEBUG) console.log('[strategyStore] ensureParentExists: parent likely exists (revision/loaded/hydrated), skip');
      return;
    }

    const payload = buildSavePayload(s);
    if (isEffectivelyEmpty(payload)) {
      if (DEBUG) console.log('[strategyStore] ensureParentExists: payload effectively empty, skip');
      return;
    }

    try {
      // revision が未知の段階なので undefined で upsert（存在すれば更新してしまうが、ここは「初回のみ」に絞っている）
      await (saveStrategyDataApi as any)(payload, userId, companyId, undefined, { mode: 'upsert' });
    } catch (e) {
      console.warn('[strategyStore] ensureParentExists primary call failed, fallback legacy:', e);
      try {
        await (saveStrategyDataApi as any)(payload, userId, companyId);
      } catch (e2) {
        console.warn('[strategyStore] ensureParentExists legacy failed:', e2);
      }
    }
  }).finally(() => {
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

  fiscalYearEnd: '',
  currency: 'JPY',
  periodStartYear: '',
  periodEndYear: '',
  businessSegments: [],
  isListed: false,
  ticker: '',
  pbrManual: '',
  financeBS: [],
  financePL: [],
  segmentPL: {},
  segmentBS: {},
  hqAdjustmentPL: undefined,
  hqAdjustmentBS: undefined,
  valueAnalysis: undefined,
  segmentValueAnalysis: undefined,

  stage1Issues: [],

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
  storyDraft: undefined,
  winPatternsCandidate: undefined,
  answers12: undefined,
  winPatterns: undefined,
  winPatternPrimary: undefined,
  winPatternSecondary: undefined,
  stage4Plans: undefined,
  executionPlanBaseline: undefined,
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
  __lastServerError: undefined,

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

  setCompanyName: () => {},
  setIndustry: () => {},
  setStage1Issues: () => {},
  setStoryDraft: () => {},
  setWinPatternsCandidate: () => {},
  setAnswers12: () => {},
  updateAnswer12: () => {},
  setStage4Plans: () => {},
  setExecutionPlanBaseline: () => {},
  recomputeValueAnalysis: () => {},

  setFinancePL: () => {},
  setFinanceBS: () => {},
  setSegmentPL: () => {},
  setSegmentBS: () => {},
  setBusinessSegmentsWithSync: () => {},

  setMVV: () => {},
  setSWOT: () => {},
  setDepartments: () => {},
  updateDepartments: () => {},
  setBusinessPortfolio: () => {},
  setFinanceSummary: () => {},
  markLoaded: () => {},
  markDirty: () => {},
  buildPayload: () => ({}),
  saveStrategyData: async () => {},
  refetchFromServer: async () => {},
  deleteAllOnServer: async () => {},
  loadStage1DummyData: () => {},
  saveStage1Snapshot: () => false,
  saveStage2Snapshot: () => false,
  restoreStage1FromSnapshot: () => false,
  getMetricsSummary: () => ({} as any),
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

  const fiscalYearEnd = raw.fiscalYearEnd ?? raw.fiscal_year_end ?? '';
  const currency = raw.currency ?? 'JPY';
  const periodStartYear = raw.periodStartYear ?? raw.period_start_year ?? '';
  const periodEndYear = raw.periodEndYear ?? raw.period_end_year ?? '';
  const businessSegments = isArray(raw.businessSegments)
    ? raw.businessSegments
    : isArray(raw.business_segments)
      ? raw.business_segments
      : [];

  const isListed =
    typeof raw.isListed === 'boolean'
      ? raw.isListed
      : typeof raw.is_listed === 'boolean'
        ? raw.is_listed
        : false;
  const ticker = raw.ticker ?? raw.ticker_text ?? '';
  const pbrManual = raw.pbrManual ?? raw.pbr_manual ?? '';
  const financeBS = isArray(raw.financeBS)
    ? raw.financeBS
    : isArray(raw.finance_bs)
      ? raw.finance_bs
      : [];
  const financePL = isArray(raw.financePL)
    ? raw.financePL
    : isArray(raw.finance_pl)
      ? raw.finance_pl
      : [];
  const segmentPL =
    raw.segmentPL && typeof raw.segmentPL === 'object'
      ? raw.segmentPL
      : raw.segment_pl && typeof raw.segment_pl === 'object'
        ? raw.segment_pl
        : undefined;
  const segmentBS =
    raw.segmentBS && typeof raw.segmentBS === 'object'
      ? raw.segmentBS
      : raw.segment_bs && typeof raw.segment_bs === 'object'
        ? raw.segment_bs
        : undefined;
  const hqAdjustmentPL = isArray(raw.hqAdjustmentPL)
    ? raw.hqAdjustmentPL
    : isArray(raw.hq_adjustment_pl)
      ? raw.hq_adjustment_pl
      : undefined;
  const hqAdjustmentBS = isArray(raw.hqAdjustmentBS)
    ? raw.hqAdjustmentBS
    : isArray(raw.hq_adjustment_bs)
      ? raw.hq_adjustment_bs
      : undefined;
  const valueAnalysis = raw.valueAnalysis ?? raw.value_analysis ?? undefined;
  const segmentValueAnalysis =
    raw.segmentValueAnalysis && typeof raw.segmentValueAnalysis === 'object'
      ? raw.segmentValueAnalysis
      : raw.segment_value_analysis && typeof raw.segment_value_analysis === 'object'
        ? raw.segment_value_analysis
        : undefined;

  const stage1Issues = isArray(raw.stage1Issues)
    ? raw.stage1Issues
    : isArray(raw.stage1_issues)
      ? raw.stage1_issues
      : [];

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

  // ★ 修正：csvFinanceData は Record<string, ...> のオブジェクトであり、配列ではない
  // raw から直接取得し、オブジェクト型チェックを行う
  const csvFinanceData =
    raw.csvFinanceData && typeof raw.csvFinanceData === 'object'
      ? raw.csvFinanceData
      : raw.csv_finance_data && typeof raw.csv_finance_data === 'object'
        ? raw.csv_finance_data
        : undefined;

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
        chapterTitle: typeof c?.chapterTitle === 'string' ? c.chapterTitle : d?.name ?? `Chapter ${idx + 1}`,
        steps: isArray(c?.steps)
          ? [...c.steps].sort((a: any, b: any) => Number(a?.stepNumber ?? 0) - Number(b?.stepNumber ?? 0))
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

  const winPatternPrimary: WinPatternId | undefined = raw.winPatternPrimary ?? raw.win_pattern_primary ?? undefined;
  const winPatternSecondary: WinPatternId | undefined =
    raw.winPatternSecondary ?? raw.win_pattern_secondary ?? undefined;

  const executionPlanBaseline = (() => {
    const base = raw.executionPlanBaseline ?? raw.execution_plan_baseline;
    if (!base || typeof base !== 'object') return undefined;
    return {
      companyId: base.companyId ?? base.company_id,
      createdAt: typeof base.createdAt === 'number' ? base.createdAt : undefined,
      snapshot: Array.isArray(base.snapshot) ? base.snapshot : undefined,
    };
  })();

  // ★ 修正：undefined のフィールドを除去する
  // merge で ...(patch as any) をするので、undefined が含まれると既存データが上書きされる
  // undefined のフィールドは含めず、既存データを保護する
  const patch: any = {
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

    fiscalYearEnd,
    currency,
    periodStartYear,
    periodEndYear,
    businessSegments,
    isListed,
    ticker,
    pbrManual,
    financeBS,
    financePL,
    segmentPL,
    segmentBS,
    hqAdjustmentPL,
    hqAdjustmentBS,
    valueAnalysis,
    segmentValueAnalysis,

    stage1Issues,

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
    executionPlanBaseline,
  };

  // ★ DEBUG：patch生成直後のログ（プリミティブ値のみ）
  const patchFinancePLLen = Array.isArray(patch.financePL) ? patch.financePL.length : 0;
  const patchStage1IssuesLen = Array.isArray(patch.stage1Issues) ? patch.stage1Issues.length : 0;
  if (DEBUG) console.log('[normalizeFromDbRow] patch生成 financePL_len:' + patchFinancePLLen + ' stage1Issues_len:' + patchStage1IssuesLen);

  // undefined のフィールドを削除（merge で既存データを保護）
  let pruned = 0;
  for (const [key, value] of Object.entries(patch)) {
    if (value === undefined) {
      delete patch[key];
      pruned++;
    }
  }

  if (pruned > 0) {
    if (DEBUG) console.log('[normalizeFromDbRow] pruned_fields:' + pruned);
  }

  // ★ DEBUG：pruning後のログ
  const finalPatchFinancePLLen = Array.isArray(patch.financePL) ? patch.financePL.length : 0;
  if (DEBUG) console.log('[normalizeFromDbRow] patch最終 financePL_len:' + finalPatchFinancePLLen + ' financePL_exists:' + ('financePL' in patch));

  return patch as Partial<StrategyState>;
}

/* ===== Zustand Store ===== */
export const useStrategyStore = create<StrategyState>()(
  persist(
    (set, get) => ({
      ...emptyData,

      reset: () => set({ ...emptyData }),
      resetAll: () => {
        if (DEBUG) console.log('[strategyStore] resetAll() called');
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
          const companyId = s.companyId || s.pendingCompanyId || useUserStore.getState().companyId;
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
          const companyId = s.companyId || s.pendingCompanyId || useUserStore.getState().companyId;
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

      setProfile: (patch) => {
        // businessSegments が変更された場合、segmentPL/segmentBS のキー整合を保つ
        if (patch.businessSegments !== undefined) {
          const currentState = get();
          const newSegmentNames = new Set(patch.businessSegments.map((seg) => seg.name));

          // 既存の segmentPL/segmentBS から不要なキーを削除し、新規キーを空配列で初期化
          let newSegmentPL = currentState.segmentPL ? { ...currentState.segmentPL } : {};
          let newSegmentBS = currentState.segmentBS ? { ...currentState.segmentBS } : {};

          // 削除されたセグメントのデータを削除
          for (const key of Object.keys(newSegmentPL)) {
            if (!newSegmentNames.has(key)) delete newSegmentPL[key];
          }
          for (const key of Object.keys(newSegmentBS)) {
            if (!newSegmentNames.has(key)) delete newSegmentBS[key];
          }

          // 新規セグメントは空配列で初期化
          for (const segName of newSegmentNames) {
            if (!(segName in newSegmentPL)) newSegmentPL[segName] = [];
            if (!(segName in newSegmentBS)) newSegmentBS[segName] = [];
          }

          set((s) => ({
            ...s,
            ...patch,
            segmentPL: Object.keys(newSegmentPL).length > 0 ? newSegmentPL : undefined,
            segmentBS: Object.keys(newSegmentBS).length > 0 ? newSegmentBS : undefined,
            dirty: true,
          }));
        } else {
          set((s) => ({ ...s, ...patch, dirty: true }));
        }

        // pbrManual, financePL, financeBS, segmentPL, segmentBS の変更を含む場合は valueAnalysis を再計算
        const needsRecompute =
          patch.pbrManual !== undefined ||
          patch.financeBS !== undefined ||
          patch.financePL !== undefined ||
          patch.segmentPL !== undefined ||
          patch.segmentBS !== undefined ||
          patch.businessSegments !== undefined;
        if (needsRecompute) {
          // 次の tick で recompute（set の反映後）
          setTimeout(() => {
            get().recomputeValueAnalysis('setProfile');
          }, 0);
        }
      },

      /* ▼ 互換用ショートカット */
      setCompanyName: (name) => set((s) => ({ ...s, companyName: name, dirty: true })),
      setIndustry: (industry) => set((s) => ({ ...s, industry, dirty: true })),
      setStage1Issues: (issues) => {
        set((s) => ({ ...s, stage1Issues: issues, dirty: true }));
        // ★ localStorage にも即座に保存（デモ安定のため）
        setTimeout(() => {
          get().saveStage1Snapshot();
        }, 0);
      },

      /* ▼ STAGE2 setter */
      setStoryDraft: (draft) => {
        set((s) => ({ ...s, storyDraft: draft, dirty: true }));
        setTimeout(() => {
          get().saveStage2Snapshot();
        }, 0);
      },
      setWinPatternsCandidate: (candidates) => {
        set((s) => ({ ...s, winPatternsCandidate: candidates, dirty: true }));
        setTimeout(() => {
          get().saveStage2Snapshot();
        }, 0);
      },
      setAnswers12: (answers) => {
        set((s) => ({ ...s, answers12: answers, dirty: true }));
        setTimeout(() => {
          get().saveStage2Snapshot();
        }, 0);
      },
      updateAnswer12: (id, patch) => {
        set((s) => {
          const prev = s.answers12 ?? [];
          const idx = prev.findIndex((a) => a.id === id);
          if (idx < 0) return s;
          const next = [...prev];
          next[idx] = { ...next[idx], ...patch };
          return { ...s, answers12: next, dirty: true };
        });
        setTimeout(() => {
          get().saveStage2Snapshot();
        }, 0);
      },

      /* ▼ STAGE4 setter */
      setStage4Plans: (plans) => {
        set((s) => ({ ...s, stage4Plans: plans, dirty: true }));
      },

      setExecutionPlanBaseline: (baseline) => {
        set((s) => ({ ...s, executionPlanBaseline: baseline, dirty: true }));
      },

      /** ValueAnalysis 再計算 */
      recomputeValueAnalysis: (source = 'local') => {
        const s = get();
        // refetch/hydrating 中は dirty 保護のため計算しない
        if (s.__isFetchingFromServer || s.boot?.isHydrating) {
          if (DEBUG) console.log('[strategyStore] recomputeValueAnalysis: skip while fetching/hydrating');
          return;
        }

        // financePL が存在する場合は新形式を優先
        const hasNewFormat = Array.isArray(s.financePL) && s.financePL.length > 0;

        let newValueAnalysis: ValueAnalysis;
        let newSegmentValueAnalysis: Record<string, ValueAnalysis> | undefined;

        if (hasNewFormat) {
          // 新形式：computeValueAnalysisBundle を使用
          const result = computeValueAnalysisBundle({
            companyPL: s.financePL!,
            companyBS: s.financeBS ?? [],
            segmentPL: s.segmentPL,
            segmentBS: s.segmentBS,
            pbrManual: s.pbrManual,
          });
          newValueAnalysis = result.company;
          newSegmentValueAnalysis = Object.keys(result.segments).length > 0 ? result.segments : undefined;
        } else {
          // 旧形式：computeValueAnalysis を使用（financeSummary ベース）
          newValueAnalysis = computeValueAnalysis({
            financeSummary: s.financeSummary,
            financeBS: s.financeBS,
            pbrManual: s.pbrManual,
          });
          newSegmentValueAnalysis = undefined;
        }

        // source 情報をメタに反映
        newValueAnalysis.meta = {
          ...newValueAnalysis.meta,
          source: source === 'refetchFromServer' ? 'server' : 'local',
        };

        if (DEBUG) console.log('[strategyStore] recomputeValueAnalysis:', {
          source,
          hasNewFormat,
          newValueAnalysis,
          newSegmentValueAnalysis,
        });

        set((prev) => ({
          ...prev,
          valueAnalysis: newValueAnalysis,
          segmentValueAnalysis: newSegmentValueAnalysis,
          // refetchFromServer 以外は dirty=true
          dirty: source === 'refetchFromServer' ? prev.dirty : true,
        }));
      },

      /* STAGE1 財務データ setter */
      setFinancePL: (rows: FinancePLRow[]) => {
        set((s) => ({ ...s, financePL: rows, dirty: true }));
        setTimeout(() => {
          get().recomputeValueAnalysis('setFinancePL');
        }, 0);
      },

      setFinanceBS: (rows: FinanceBSRow[]) => {
        set((s) => ({ ...s, financeBS: rows, dirty: true }));
        setTimeout(() => {
          get().recomputeValueAnalysis('setFinanceBS');
        }, 0);
      },

      setSegmentPL: (data: Record<string, FinancePLRow[]>) => {
        set((s) => ({ ...s, segmentPL: data, dirty: true }));
        setTimeout(() => {
          get().recomputeValueAnalysis('setSegmentPL');
        }, 0);
      },

      setSegmentBS: (data: Record<string, SegmentBSRow[]>) => {
        set((s) => ({ ...s, segmentBS: data, dirty: true }));
        setTimeout(() => {
          get().recomputeValueAnalysis('setSegmentBS');
        }, 0);
      },

      setBusinessSegmentsWithSync: (segments: BusinessSegment[]) => {
        const currentState = get();
        const newSegmentNames = new Set(segments.map((seg) => seg.name));

        // 既存の segmentPL/segmentBS から不要なキーを削除し、新規キーを空配列で初期化
        let newSegmentPL = currentState.segmentPL ? { ...currentState.segmentPL } : {};
        let newSegmentBS = currentState.segmentBS ? { ...currentState.segmentBS } : {};

        // 削除されたセグメントのデータを削除
        for (const key of Object.keys(newSegmentPL)) {
          if (!newSegmentNames.has(key)) delete newSegmentPL[key];
        }
        for (const key of Object.keys(newSegmentBS)) {
          if (!newSegmentNames.has(key)) delete newSegmentBS[key];
        }

        // 新規セグメントは空配列で初期化
        for (const segName of newSegmentNames) {
          if (!(segName in newSegmentPL)) newSegmentPL[segName] = [];
          if (!(segName in newSegmentBS)) newSegmentBS[segName] = [];
        }

        set((s) => ({
          ...s,
          businessSegments: segments,
          segmentPL: Object.keys(newSegmentPL).length > 0 ? newSegmentPL : undefined,
          segmentBS: Object.keys(newSegmentBS).length > 0 ? newSegmentBS : undefined,
          dirty: true,
        }));

        setTimeout(() => {
          get().recomputeValueAnalysis('setBusinessSegments');
        }, 0);
      },

      setMVV: (patch) => set((s) => ({ ...s, ...patch, dirty: true })),
      setSWOT: (patch) => set((s) => ({ ...s, ...patch, dirty: true })),

      // ▼ 部門セット後に即座に保存（※ ensureParentExists は呼ばない：二重保存を防ぐ）
      setDepartments: (deps: SafeDepartmentsArg) => {
        if (DEBUG) console.log('[strategyStore] setDepartments() called', deps);
        set((s) => ({
          departments: normalizeDepartmentsInput(deps, s.departments),
          dirty: true,
        }));

        (async () => {
          if (DEBUG) console.log('[strategyStore] setDepartments() immediate-save start');
          try {
            await get().saveStrategyData();
            if (DEBUG) console.log('[strategyStore] setDepartments() immediate-save done');
          } catch (e) {
            console.warn('[strategyStore] setDepartments immediate save failed:', e);
          }
        })();
      },

      // ▼ updateDepartments も同様
      updateDepartments: (updater) => {
        if (DEBUG) console.log('[strategyStore] updateDepartments() called');
        set((s) => {
          const prev = Array.isArray(s.departments) ? s.departments : [];
          const next = updater([...prev]);
          return { departments: normalizeDepartmentsInput(next, prev), dirty: true };
        });

        (async () => {
          if (DEBUG) console.log('[strategyStore] updateDepartments() immediate-save start');
          try {
            await get().saveStrategyData();
            if (DEBUG) console.log('[strategyStore] updateDepartments() immediate-save done');
          } catch (e) {
            console.warn('[strategyStore] updateDepartments immediate save failed:', e);
          }
        })();
      },

      setBusinessPortfolio: (p) => set({ businessPortfolio: { ...p }, dirty: true }),

      setFinanceSummary: (rows) => {
        set({ financeSummary: rows, dirty: true });
        // financeSummary 変更時に valueAnalysis を再計算
        setTimeout(() => {
          get().recomputeValueAnalysis('local');
        }, 0);
      },

      __afterSave(data) {
        const cur = get();
        const minimal = extractServerDecidedPatch(data ?? {}, cur);
        if (Object.keys(minimal).length > 0) set(minimal);
      },

      markLoaded: () => {
        if (DEBUG) console.log('[strategyStore] markLoaded 実行');
        set({ loaded: true, hydrated: true });
        if (DEBUG) console.log('[strategyStore] markLoaded 完了', { loaded: get().loaded, hydrated: get().hydrated });
      },
      markDirty: () => set({ dirty: true }),

      buildPayload: () => buildSavePayload(get() as StrategyState),

      async saveStrategyData() {
        // ★保存を必ず直列化（REVISION_CONFLICTの主因を除去）
        return enqueueSave(async () => {
          const state0 = get();

          // refetch/hydrating中の保存は競合の温床なので抑止
          if (state0.__isFetchingFromServer || state0.boot?.isHydrating) {
            if (DEBUG) console.log('[strategyStore] saveStrategyData: skip while fetching/hydrating');
            return;
          }

          const userId = useUserStore.getState().user?.id;
          const companyId = state0.companyId || state0.pendingCompanyId || useUserStore.getState().companyId;

          if (DEBUG) console.log('[strategyStore] saveStrategyData() start', {
            userId,
            companyId,
            revision: state0.revision,
            dirty: state0.dirty,
            _loadingSave: state0._loadingSave,
          });

          if (!userId || !companyId) {
            console.warn('[strategyStore] saveStrategyData skipped: missing ids');
            return;
          }

          // dirty=false なら何もしない
          if (!state0.dirty) {
            if (DEBUG) console.log('[strategyStore] saveStrategyData: dirty=false, skip');
            return;
          }

          // UI/他ロジック向けのガード（キュー化により“同時実行”は起きないが、見た目制御のため残す）
          if (state0._loadingSave) {
            if (DEBUG) console.log('[strategyStore] saveStrategyData: already saving, skip (queued)');
            return;
          }

          set({ _loadingSave: true });

          try {
            // ★最大2回：1回目で conflict なら refetch → 2回目で最新 revision で再保存
            for (let attempt = 1; attempt <= 2; attempt++) {
              const state = get(); // ★キュー実行時点の最新 state を必ず参照
              const payload = buildSavePayload(state as StrategyState);

              if (isEffectivelyEmpty(payload)) {
                if (DEBUG) console.log('[strategyStore] saveStrategyData: payload effectively empty, clear dirty');
                set({ dirty: false });
                return;
              }

              const currentHash = stableHash(payload);
              if (state.__lastSavedHash && state.__lastSavedHash === currentHash) {
                if (DEBUG) console.log('[strategyStore] saveStrategyData: same hash, skip');
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
                const err = (res as any)?.error;
                const errCode = (res as any)?.errorCode;

                // ★ 409 REVISION_CONFLICT: サーバ側で変更があった（または並列保存で revision が先に進んだ）
                if (errCode === 'REVISION_CONFLICT' || err?.code === 'REVISION_CONFLICT') {
                  console.warn(
                    `[strategyStore] ⚠ REVISION_CONFLICT detected (attempt ${attempt}/2). Refetching latest data...`
                  );

                  try {
                    await get().refetchFromServer();
                    if (DEBUG) console.log('[strategyStore] ✅ Refetch completed after conflict. User changes preserved in dirty state.');
                  } catch (refetchErr) {
                    console.error('[strategyStore] refetch after conflict failed:', refetchErr);
                    return;
                  }

                  // 2回目なら打ち切り（無限ループ防止）
                  if (attempt >= 2) {
                    console.warn('[strategyStore] REVISION_CONFLICT persists after retry. Keeping dirty state.');
                    return;
                  }

                  // 2回目ループへ（最新 revision で再保存）
                  continue;
                }

                console.error('[strategyStore] saveStrategyData API error:', err ?? 'unknown error');
                return;
              }

              // 成功
              const serverData = (res as any).data ?? {};
              const minimal = extractServerDecidedPatch(serverData, get() as StrategyState);

              const nextPatch: Partial<StrategyState> = { dirty: false, __lastSavedHash: currentHash };
              if (Object.keys(minimal).length > 0) Object.assign(nextPatch, minimal);
              set(nextPatch);

              return;
            }
          } finally {
            set({ _loadingSave: false });
          }
        });
      },

      async refetchFromServer() {
        const s0 = get();
        const companyId = s0.pendingCompanyId || s0.companyId || useUserStore.getState().companyId;

        const authed = await isSessionUsable();
        if (!companyId || !authed) {
          set((s) => ({
            ...s,
            boot: { ...s.boot, isHydrating: true, isHydrated: false },
            __isFetchingFromServer: false,
            loaded: false,
          }));
          scheduleRefetchRetry(1500);
          throw new Error('会社IDまたは認証情報が見つかりません');
        }

        if (get()._loadingRefetch) return;
        set({ _loadingRefetch: true, __isFetchingFromServer: true });
        set((s) => ({ ...s, boot: { ...s.boot, isHydrating: true } }));

        try {
          if (DEBUG) console.log('[strategyStore] 🔍 getFullStrategyDataByCompany 呼び出し前', {
            companyId,
            _loadingRefetch: get()._loadingRefetch,
          });

          const { data, error } = await getFullStrategyDataByCompany(companyId);

          // ★ DEBUG：レスポンス確認
          if (error) {
            console.error('[strategyStore] ❌ getFullStrategyDataByCompany エラー', {
              code: (error as any)?.code,
              status: (error as any)?.status,
              message: (error as any)?.message,
              details: (error as any)?.details,
            });
          } else if (data) {
            const csvFd = (data as any)?.csv_finance_data;
            const dbCompanyId = (data as any)?.company_id || companyId; // fallback to companyId parameter
            // プリミティブ値のみを計算
            const dbRevision = typeof (data as any)?.revision === 'number' ? (data as any).revision : 0;
            const hasFinancePL = Array.isArray((data as any)?.finance_pl) && (data as any).finance_pl.length > 0;
            const hasCsvFinanceData = !!csvFd && typeof csvFd === 'object';
            const csvFdFinanceBSLen = Array.isArray(csvFd?.financeBS) ? csvFd.financeBS.length : 0;
            const csvFdSegmentPLKeys = Object.keys(csvFd?.segmentPL || {}).length;
            const stage1IssuesLen = Array.isArray((data as any)?.stage1_issues) ? (data as any).stage1_issues.length : 0;
            if (DEBUG) console.log('[getFullStrategyDataByCompany] revision:' + dbRevision + ' hasFinancePL:' + hasFinancePL + ' hasCsvFinanceData:' + hasCsvFinanceData + ' financeBS_len:' + csvFdFinanceBSLen + ' segmentPL_keys:' + csvFdSegmentPLKeys + ' stage1Issues_len:' + stage1IssuesLen);
          } else {
            console.warn('[strategyStore] ⚠️ getFullStrategyDataByCompany: data と error 両方 null/undefined');
          }

          // ★ D) 選別的リトライロジック：RLS/403/0行は永続エラー、ネットワークエラーのみリトライ
          if (error) {
            const errorCode = (error as any)?.code;
            const errorStatus = (error as any)?.status;
            const isTransientError =
              errorCode === 'FETCH_FAILED' ||
              errorCode === 'NETWORK_ERROR' ||
              errorStatus === 502 ||
              errorStatus === 503 ||
              errorStatus === 504;

            console.warn('[strategyStore] refetch error - selective retry', {
              errorCode,
              errorStatus,
              isTransientError,
              message: (error as any)?.message,
            });

            set((s) => ({
              ...s,
              boot: { isHydrating: true, isHydrated: false },
              __isFetchingFromServer: false,
              loaded: false,
              __lastServerError: isTransientError ? undefined : error, // 永続エラーは保存
            }));

            if (isTransientError) {
              scheduleRefetchRetry(2000);
            } else {
              // RLS/403/permission エラー：リトライなし、ユーザー通知へ
              console.error('[strategyStore] 🚫 permanent error, no retry scheduled:', errorCode, errorStatus);
            }
            const errMsg = (error as any)?.message || (error as any)?.code || 'データ取得に失敗しました';
            throw new Error(errMsg);
          }

          if (!data) {
            if (DEBUG) console.log('[strategyStore] refetch returned 0 rows (RLS/not found) - no retry');
            set((s) => ({
              ...s,
              boot: { isHydrating: true, isHydrated: false },
              __isFetchingFromServer: false,
              loaded: false,
              __lastServerError: new Error('データが見つかりません'), // 0行は永続エラー扱い
            }));
            // 0行 = RLS制限またはデータなし → リトライなし
            throw new Error('データが見つかりません');
          }

          const patch = normalizeFromDbRow(data);

          // ★ デバッグ：refetchFromServer での normalize 結果確認
          if (DEBUG) console.log('[strategyStore refetch] 📦 normalized patch', {
            financeBS_len: Array.isArray((patch as any).financeBS) ? (patch as any).financeBS.length : 0,
            segmentBS_keys: Object.keys((patch as any).segmentBS || {}).length,
            segmentPL_keys: Object.keys((patch as any).segmentPL || {}).length,
            csvFinanceData_exists: !!((patch as any).csvFinanceData),
            financePL_len: Array.isArray((patch as any).financePL) ? (patch as any).financePL.length : 0,
            stage1Issues_len: Array.isArray((patch as any).stage1Issues) ? (patch as any).stage1Issues.length : 0,
          });

          const cur = get();

          const isSwitchingCompany = cur.pendingCompanyId !== undefined && cur.pendingCompanyId !== cur.companyId;

          // dirtyでも会社切替中は「ローカル保護」しない（混線防止）
          const wasDirty = cur.dirty && !isSwitchingCompany;

          const curRev = typeof cur.revision === 'number' ? cur.revision : undefined;
          const patchRev = typeof patch.revision === 'number' ? patch.revision : undefined;
          const isStale = typeof patchRev === 'number' && typeof curRev === 'number' && patchRev < curRev;

          if (wasDirty) {
            // ★ユーザー入力中（dirty=true）でも、サーバの重要データを反映する
            // 戦略：extractServerDecidedPatch() で以下を常に反映
            // ├─ Stage1: 財務系（financeBS/PL）・セグメント・会社情報（ユーザー編集対象外）
            // ├─ Stage2: ストーリー・戦略候補（生成結果は常に最新化）
            // └─ Stage3: 部門・MVV（会社構造・方針の基本情報）
            // 効果：
            // ① BS/事業別 0化の原因を排除（サーバ最新値が常に反映される）
            // ② Draft/Finalの揺れを軽減（生成結果が確実に反映される）
            // ③ ユーザーの個別入力は draft フィールド等で保護される
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
            const rev = typeof patch.revision === 'number' ? patch.revision : after.revision ?? 0;

            // ★ デバッグ：dirty=true でも extractServerDecidedPatch で反映されたデータ確認
            if (DEBUG) console.log('[strategyStore refetch] ✅ after extractServerDecidedPatch (wasDirty=true)', {
              financeBS_len: Array.isArray((after as any).financeBS) ? (after as any).financeBS.length : 0,
              segmentBS_keys: Object.keys((after as any).segmentBS || {}).length,
              segmentPL_keys: Object.keys((after as any).segmentPL || {}).length,
              csvFinanceData_exists: !!((after as any).csvFinanceData),
              financePL_len: Array.isArray((after as any).financePL) ? (after as any).financePL.length : 0,
              stage1Issues_len: Array.isArray((after as any).stage1Issues) ? (after as any).stage1Issues.length : 0,
            });

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

            // ★ デバッグ：dirty=false で full merge されたデータ確認
            if (DEBUG) console.log('[strategyStore refetch] ✅ after full merge (wasDirty=false)', {
              financeBS_len: Array.isArray((after as any).financeBS) ? (after as any).financeBS.length : 0,
              segmentBS_keys: Object.keys((after as any).segmentBS || {}).length,
              segmentPL_keys: Object.keys((after as any).segmentPL || {}).length,
              csvFinanceData_exists: !!((after as any).csvFinanceData),
              financePL_len: Array.isArray((after as any).financePL) ? (after as any).financePL.length : 0,
              stage1Issues_len: Array.isArray((after as any).stage1Issues) ? (after as any).stage1Issues.length : 0,
            });

            const snapshot = buildSavePayload(after as StrategyState);
            const hash = stableHash(snapshot);
            const rev = typeof patch.revision === 'number' ? patch.revision : after.revision ?? 0;

            set({
              serverShadow: snapshot,
              lastServerSnapshot: hash,
              __isFetchingFromServer: false,
              loaded: true,
              __lastSavedHash: hash,
              dirty: false,
            });

            get().setHydrated(rev, hash);

            // ★ refetch 完了後に valueAnalysis を再計算（dirty保護なしルート）
            setTimeout(() => {
              get().recomputeValueAnalysis('refetchFromServer');
            }, 0);
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

        if ((delRes as any)?.error) throw (delRes as any).error;

        try {
          await (purgeLegacyTablesApi as any)?.(userId, companyId);
        } catch (e) {
          console.warn('[strategyStore] purgeLegacyTables warn:', e);
        }

        set(() => ({
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

      /** STAGE1 ダミーデータ投入（開発用） */
      loadStage1DummyData: () => {
        if (DEBUG) console.log('[strategyStore] loadStage1DummyData() called');

        const { businessSegments, financePL, financeBS, segmentPL, segmentBS, pbrManual, stage1Issues } =
          stage1DummyDataBundle;

        // setProfile で businessSegments, pbrManual, stage1Issues を設定
        set((s) => ({
          ...s,
          businessSegments,
          pbrManual,
          stage1Issues,
          financePL,
          financeBS,
          segmentPL,
          segmentBS,
          dirty: true,
        }));

        // 次の tick で recomputeValueAnalysis を呼ぶ
        setTimeout(() => {
          get().recomputeValueAnalysis('local');
          if (DEBUG) console.log('[strategyStore] loadStage1DummyData() recompute done');
          // ダミーデータ投入後もスナップショット保存
          get().saveStage1Snapshot();
        }, 0);
      },

      /** STAGE1 スナップショットを localStorage に保存 */
      saveStage1Snapshot: () => {
        const s = get();
        const issueBlocks = s.stage1Issues ?? [];
        const valueAnalysis = s.valueAnalysis;
        const companyName = s.companyName;
        const companyId = s.companyId ?? s.pendingCompanyId ?? undefined;

        const result = saveStage1SnapshotToLocalStorage(issueBlocks, valueAnalysis, companyName, companyId ?? undefined);
        if (DEBUG) console.log('[strategyStore] saveStage1Snapshot:', { result, issueBlocksCount: issueBlocks.length });
        return result;
      },

      /** STAGE2 スナップショットを localStorage から復元（現状は未使用だが読み込みログに出ていたため維持） */
      // ここではアクションは提供していないが、snapshot.ts 側で呼ぶことがあるため import は維持

      /** STAGE2 スナップショットを localStorage に保存 */
      saveStage2Snapshot: () => {
        const s = get();
        // ストア直接のキー（storyDraft, winPatternsCandidate, answers12）を優先
        const state: Stage2State = {
          mvv: {
            thought: s.thought,
            mission: s.mission,
            vision: s.vision,
            value: s.value,
          },
          swot: {
            strength: s.strength,
            weakness: s.weakness,
            opportunity: s.opportunity,
            threat: s.threat,
          },
          storyDraft: s.storyDraft ?? (s.story?.length ? s.story.map((ch) => ({ title: ch.title, body: ch.body })) : undefined),
          winPatternsCandidate: s.winPatternsCandidate,
          answers12: s.answers12,
          finalStory: s.finalStory,
        };
        const companyId = s.companyId ?? s.pendingCompanyId ?? undefined;
        const result = saveStage2SnapshotToLocalStorage(state, companyId ?? undefined);
        if (DEBUG) console.log('[strategyStore] saveStage2Snapshot:', { result, answers12Count: s.answers12?.length ?? 0 });
        return result;
      },

      /** STAGE1 スナップショットを localStorage から復元 */
      restoreStage1FromSnapshot: () => {
        const snapshot = loadStage1SnapshotFromLocalStorage();
        if (!snapshot || snapshot.issueBlocks.length === 0) {
          if (DEBUG) console.log('[strategyStore] restoreStage1FromSnapshot: no valid snapshot');
          return false;
        }

        set((s) => ({
          ...s,
          stage1Issues: snapshot.issueBlocks,
          // valueAnalysis は metricsSummary から完全復元できないため、
          // 既存の valueAnalysis があればそれを維持
          dirty: true,
        }));

        if (DEBUG) console.log('[strategyStore] restoreStage1FromSnapshot: restored', {
          issueBlocksCount: snapshot.issueBlocks.length,
        });
        return true;
      },

      /** MetricsSummary を取得（valueAnalysis から生成） */
      getMetricsSummary: () => {
        const s = get();
        return valueAnalysisToMetricsSummary(s.valueAnalysis, s.valueAnalysis?.overallNote);
      },
    }),
    {
      name: 'strategy-store',
      version: 36,
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

        fiscalYearEnd: s.fiscalYearEnd,
        currency: s.currency,
        periodStartYear: s.periodStartYear,
        periodEndYear: s.periodEndYear,
        businessSegments: s.businessSegments,
        isListed: s.isListed,
        ticker: s.ticker,
        pbrManual: s.pbrManual,
        financeBS: s.financeBS,
        financePL: s.financePL,
        segmentPL: s.segmentPL,
        segmentBS: s.segmentBS,
        hqAdjustmentPL: s.hqAdjustmentPL,
        hqAdjustmentBS: s.hqAdjustmentBS,
        valueAnalysis: s.valueAnalysis,
        segmentValueAnalysis: s.segmentValueAnalysis,

        stage1Issues: s.stage1Issues,

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

        stage4Plans: s.stage4Plans,
        executionPlanBaseline: s.executionPlanBaseline,

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
      onRehydrateStorage: () => (_state, error) => {
        if (error) console.warn('rehydration error:', error);
      },
    }
  )
);

export async function refetchFromServer() {
  return useStrategyStore.getState().refetchFromServer();
}
