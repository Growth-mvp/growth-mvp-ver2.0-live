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
import { saveWithAudit } from '@/utils/persist/saveWithAudit';
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
  Stage1Benchmarks,
  StrategyData,
  CompanyTarget,
  ProjectTargetImpact,
  ProjectIssueLink,
} from '@/types/strategy';
import type { BusinessPortfolio } from '@/types/portfolio';
import {
  saveStage1SnapshotToLocalStorage,
  saveStage2SnapshotToLocalStorage,
  loadStage1SnapshotFromLocalStorage,
  loadStage2SnapshotFromLocalStorage,
  valueAnalysisToMetricsSummary,
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

// ★ 止血対策：isSaving / isRestoring を追加してautosave競合を防止
type BootState = { isHydrating: boolean; isHydrated: boolean; isSaving?: boolean; isRestoring?: boolean };

type SafeDepartmentsArg =
  | Department[]
  | { departments?: Department[] | null }
  | null
  | undefined;

/** 保存結果（UI/ログで成功可視化するため） */
export type SaveResult =
  | {
      ok: true;
      revision?: number;
      updatedAt?: string;
      skipped?: false;
    }
  | {
      ok: false;
      skipped?: boolean;
      reason: string;
      error?: unknown;
      code?: string;
    };

/* ============================================================
 * 保存直列化（最重要）
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

  /* STAGE1：外部ベンチマーク（任意入力） */
  stage1Benchmarks?: Stage1Benchmarks;

  /* MVV / SWOT */
  thought?: string;
  mission?: string;
  vision?: string;
  value?: string;
  ceoIntent?: string;
  strength?: string;
  weakness?: string;
  opportunity?: string;
  threat?: string;
  swotSuggestions?: {
    opportunity?: string[];
    threat?: string[];
    generatedAt?: string;
  };

  /* 物語 / 部門 */
  story: ChapterStory[];
  finalStory: ChapterStory[];
  answers2: ChapterAnswers[];
  departments: Department[];

  /* ★ STAGE2：たたき台・12問 */
  storyDraft: StoryChapter[]; // ★ 修正：常に配列（undefined ではなく [] で統一）
  winPatternsCandidate: WinPatternCandidate[]; // ★ 修正：常に配列
  answers12: Stage2Answer[]; // ★ 修正：常に配列

  /* ★ STAGE2：最終ストーリー（3段階） */
  finalStoryDraft?: StoryChapter[];
  finalStoryEdited?: StoryChapter[];
  finalStoryFinal?: StoryChapter[];

  /* ★ STAGE2：会社の数値目標（North Star Metrics） */
  companyTargets?: CompanyTarget[];

  /* === STAGE6 Phase E：プロジェクト→North Star影響量（手入力） === */
  projectTargetImpacts?: ProjectTargetImpact[];

  /* === STAGE6 Phase E：プロジェクト→論点紐付け（手入力） === */
  projectIssueLinks?: ProjectIssueLink[];

  /* ★ 全社レベルの勝ち筋（受け皿） */
  winPatterns?: WinPattern[];
  winPatternPrimary?: WinPatternId;
  winPatternSecondary?: WinPatternId;

  /* ★ STAGE4：実行計画 */
  stage4Plans?: Array<{
    departmentId: string;
    status: 'Draft' | 'Review' | 'Approved';
    baseline: any;
    current: any;
    updatedAt?: string;
    updatedBy?: string;
  }>;

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

  /* ★ TASK 14: restore state フラグ（リロード時データ消失を防止） */
  restoreReady: boolean; // DB restore 完了フラグ
  isRestoring: boolean; // DB restore 中フラグ

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

  /** 直近サーバ取得エラー */
  __lastServerError?: Error | null;

  /* ===== UI State (session内のみ、永続化しない) ===== */
  /** 最新保存エラー（GlobalSaveStatusBar用） */
  saveError?: string | undefined;

  /** 最新保存完了時刻（UNIX timestamp、GlobalSaveStatusBar用） */
  lastSavedAt?: number | undefined;

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

  setRevision: (rev?: number) => void;
  setStrategyId: (id: string | null) => void;
  hydrateFromFullState: (fullState: Partial<StrategyData> & { revision?: number }) => void;
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
        | 'stage1Benchmarks'
      >
    >
  ) => void;

  /* ▼ 互換用ショートカット */
  setCompanyName: (name: string) => void;
  setIndustry: (industry: string) => void;
  setStage1Issues: (issues: Stage1IssueBlock[]) => void;
  setStage1Benchmarks: (benchmarks: Stage1Benchmarks | undefined) => void;

  /* ▼ STAGE2 setter */
  setStoryDraft: (draft: StoryChapter[]) => void;
  setWinPatternsCandidate: (candidates: WinPatternCandidate[]) => void;
  setAnswers12: (answers: Stage2Answer[]) => void;
  updateAnswer12: (id: string, patch: Partial<Stage2Answer>) => void;

  /* ▼ STAGE2 数値目標（North Star） setter */
  setCompanyTargets: (targets: CompanyTarget[]) => void;
  addCompanyTarget: (target: CompanyTarget) => void;
  updateCompanyTarget: (id: string, patch: Partial<CompanyTarget>) => void;
  removeCompanyTarget: (id: string) => void;

  /* === STAGE6 Phase E：プロジェクト→North Star影響量 === */
  setProjectTargetImpacts: (impacts: ProjectTargetImpact[]) => void;
  addProjectTargetImpact: (impact: ProjectTargetImpact) => void;
  updateProjectTargetImpact: (projectId: string, targetId: string, patch: Partial<ProjectTargetImpact>) => void;
  removeProjectTargetImpact: (projectId: string, targetId: string) => void;

  /* === STAGE6 Phase E：プロジェクト→論点紐付け === */
  setProjectIssueLinks: (links: ProjectIssueLink[]) => void;
  addProjectIssueLink: (link: ProjectIssueLink) => void;
  updateProjectIssueLink: (projectId: string, issueId: string, patch: Partial<ProjectIssueLink>) => void;
  removeProjectIssueLink: (projectId: string, issueId: string) => void;

  /* ▼ STAGE2 最終ストーリー setter */
  setFinalStoryDraft: (chapters: StoryChapter[]) => void;
  setFinalStoryEdited: (chapters: StoryChapter[]) => void;
  commitFinalStory: () => void;

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

  /** ValueAnalysis 再計算 */
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
  /** ★ セグメント単位マージ更新（必ずマージ、上書きしない） */
  upsertSegmentPL: (segName: string, rows: FinancePLRow[]) => void;
  upsertSegmentBS: (segName: string, rows: SegmentBSRow[]) => void;
  setBusinessSegmentsWithSync: (segments: BusinessSegment[]) => void;

  /* ★ 年度CRUD（全社） */
  addFinanceYear: (year?: number) => void;
  renameFinanceYear: (oldYear: number, newYear: number) => boolean; // 重複なら false
  removeFinanceYear: (year: number) => void;
  updateFinancePLCell: <K extends keyof FinancePLRow>(
    year: number,
    key: K,
    value: FinancePLRow[K]
  ) => void;
  updateFinanceBSCell: <K extends keyof FinanceBSRow>(
    year: number,
    key: K,
    value: FinanceBSRow[K]
  ) => void;

  /* ★ 年度CRUD（事業部別） */
  addSegmentFinanceYear: (segmentName: string, year?: number) => void;
  renameSegmentFinanceYear: (segmentName: string, oldYear: number, newYear: number) => boolean;
  removeSegmentFinanceYear: (segmentName: string, year: number) => void;
  updateSegmentPLCell: <K extends keyof FinancePLRow>(
    segmentName: string,
    year: number,
    key: K,
    value: FinancePLRow[K]
  ) => void;
  updateSegmentBSCell: <K extends keyof SegmentBSRow>(
    segmentName: string,
    year: number,
    key: K,
    value: SegmentBSRow[K]
  ) => void;

  setMVV: (patch: Partial<Pick<StrategyState, 'thought' | 'mission' | 'vision' | 'value' | 'ceoIntent'>>) => void;
  setSWOT: (patch: Partial<Pick<StrategyState, 'strength' | 'weakness' | 'opportunity' | 'threat'>>) => void;
  setCeoIntent: (text: string) => void;
  setSwotSuggestions: (suggestions?: { opportunity?: string[]; threat?: string[]; generatedAt?: string }) => void;
  addSwotOpportunity: (text: string) => void;
  addSwotThreat: (text: string) => void;
  removeSwotOpportunity: (textOrIndex: string | number) => void;
  removeSwotThreat: (textOrIndex: string | number) => void;

  setDepartments: (deps: SafeDepartmentsArg) => void;
  updateDepartments: (updater: (prev: Department[]) => Department[]) => void;

  setBusinessPortfolio: (p: BusinessPortfolio) => void;
  setFinanceSummary: (rows: FinanceSummaryRow[]) => void;

  markLoaded: () => void;
  markDirty: () => void;

  buildPayload: () => any;

  saveStrategyData: (opts?: { reason?: string; force?: boolean }) => Promise<SaveResult>;
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
      // 空配列は残す
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

function isNonEmptyObject(v: any): boolean {
  return !!v && typeof v === 'object' && !Array.isArray(v) && Object.keys(v).length > 0;
}

function isEffectivelyEmpty(payload: any): boolean {
  if (!payload) return true;
  const emptyArr = (a: any) => !Array.isArray(a) || a.length === 0;
  const emptyStr = (v: any) => typeof v !== 'string' || v.trim() === '';

  // csvFinanceData は object が主
  const csvFinanceEmpty = emptyArr(payload.csvFinanceData) && !isNonEmptyObject(payload.csvFinanceData);

  const allEmpty =
    emptyArr(payload.story) &&
    emptyArr(payload.finalStory) &&
    emptyArr(payload.answers2) &&
    emptyArr(payload.departments) &&
    csvFinanceEmpty &&
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

  const isEmpty = allEmpty && metaAllEmpty;

  // ★ 診断ログ：isEffectivelyEmpty チェック（特に stage1Issues）
  if (DEBUG && (Array.isArray(payload.stage1Issues) && payload.stage1Issues.length > 0)) {
    console.log('[isEffectivelyEmpty] stage1Issues is NOT empty but payload is marked empty:', {
      stage1Issues_len: payload.stage1Issues.length,
      isEmpty,
      allEmpty,
      metaAllEmpty,
    });
  }

  return isEmpty;
}

/**
 * J-1: Sanitize projectTargetImpacts before save
 * Remove NaN, undefined, or all-zero deltas
 */
function sanitizeProjectTargetImpacts(impacts: any): any[] {
  if (!Array.isArray(impacts)) return [];
  return impacts.filter((item) => {
    if (!item || typeof item !== 'object') return false;
    if (!item.projectId || !item.targetId) return false;
    if (typeof item.delta !== 'number' || !Number.isFinite(item.delta)) return false;
    return item.delta !== 0; // Only keep non-zero deltas
  });
}

/**
 * J-1: Sanitize projectIssueLinks before save
 * Remove invalid strength or missing required fields
 */
function sanitizeProjectIssueLinks(links: any): any[] {
  if (!Array.isArray(links)) return [];
  return links.filter((item) => {
    if (!item || typeof item !== 'object') return false;
    if (!item.projectId || !item.issueId) return false;
    const strength = item.strength;
    if (![1, 2, 3].includes(strength)) return false;
    return true;
  });
}

/* ===== 年度管理ユーティリティ ===== */

/** 年度配列をソート（昇順） */
function sortFinanceYears<T extends { year: number }>(rows: T[]): T[] {
  return [...rows].sort((a, b) => a.year - b.year);
}

/** 全社PL/BSに年度を追加（最大年+1またはデフォルト） */
function addYearToFinanceRows<T extends { year: number }>(
  plRows: T[],
  bsRows: T[],
  yearOverride?: number
): { pl: T[]; bs: T[] } {
  // yearOverride がなければ、現在の最大年+1、またはデフォルト値（e.g., 今年）
  let targetYear = yearOverride;
  if (!targetYear) {
    const allYears = [...plRows, ...bsRows].map((r) => r.year);
    const maxYear = allYears.length > 0 ? Math.max(...allYears) : new Date().getFullYear() - 1;
    targetYear = maxYear + 1;
  }

  // 重複チェック
  if (plRows.some((r) => r.year === targetYear) || bsRows.some((r) => r.year === targetYear)) {
    console.warn('[strategyStore] addYearToFinanceRows: year already exists', { targetYear });
    return { pl: plRows, bs: bsRows };
  }

  // 新規行を追加（全てのフィールドは undefined）
  const newRow: any = { year: targetYear };
  const newPL = sortFinanceYears([...plRows, newRow]);
  const newBS = sortFinanceYears([...bsRows, newRow]);

  return { pl: newPL, bs: newBS };
}

/** 全社PL/BSから年度を削除 */
function removeYearFromFinanceRows<T extends { year: number }>(
  plRows: T[],
  bsRows: T[],
  year: number
): { pl: T[]; bs: T[] } {
  return {
    pl: plRows.filter((r) => r.year !== year),
    bs: bsRows.filter((r) => r.year !== year),
  };
}

/** 全社PL/BSの年度を変更（重複チェック） */
function renameYearInFinanceRows<T extends { year: number }>(
  plRows: T[],
  bsRows: T[],
  oldYear: number,
  newYear: number
): { pl: T[] | null; bs: T[] | null } {
  // oldYear と newYear が同じ or newYear が既に存在 → 拒否
  if (oldYear === newYear ||
      plRows.some((r) => r.year === newYear) ||
      bsRows.some((r) => r.year === newYear)) {
    return { pl: null, bs: null };
  }

  const newPL = sortFinanceYears(
    plRows.map((r) => (r.year === oldYear ? { ...r, year: newYear } : r))
  );
  const newBS = sortFinanceYears(
    bsRows.map((r) => (r.year === oldYear ? { ...r, year: newYear } : r))
  );

  return { pl: newPL, bs: newBS };
}

/** セグメントの年度配列に行を追加 */
function addYearToSegmentRows<T extends { year: number }>(rows: T[], yearOverride?: number): T[] {
  let targetYear = yearOverride;
  if (!targetYear) {
    const maxYear = rows.length > 0 ? Math.max(...rows.map((r) => r.year)) : new Date().getFullYear() - 1;
    targetYear = maxYear + 1;
  }

  if (rows.some((r) => r.year === targetYear)) {
    console.warn('[strategyStore] addYearToSegmentRows: year already exists', { targetYear });
    return rows;
  }

  const newRow: any = { year: targetYear };
  return sortFinanceYears([...rows, newRow]);
}

/** セグメントの年度配列から行を削除 */
function removeYearFromSegmentRows<T extends { year: number }>(rows: T[], year: number): T[] {
  return rows.filter((r) => r.year !== year);
}

/** セグメントの年度配列で年度を変更（重複チェック） */
function renameYearInSegmentRows<T extends { year: number }>(
  rows: T[],
  oldYear: number,
  newYear: number
): T[] | null {
  if (oldYear === newYear || rows.some((r) => r.year === newYear)) {
    return null;
  }

  return sortFinanceYears(rows.map((r) => (r.year === oldYear ? { ...r, year: newYear } : r)));
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
    stage1Benchmarks: (s as any).stage1Benchmarks,

    mission: s.mission,
    vision: s.vision,
    value: s.value,
    thought: s.thought,
    ceoIntent: s.ceoIntent,

    strength: s.strength,
    weakness: s.weakness,
    opportunity: s.opportunity,
    threat: s.threat,
    swotSuggestions: s.swotSuggestions,

    storyDraft: s.storyDraft,
    winPatternsCandidate: s.winPatternsCandidate,
    answers12: s.answers12,

    // ★ 追加：companyTargets / finalStory 3-state（北星・最終ストーリー編集用）
    companyTargets: (s as any).companyTargets,
    finalStoryDraft: (s as any).finalStoryDraft,
    finalStoryEdited: (s as any).finalStoryEdited,
    finalStoryFinal: (s as any).finalStoryFinal,

    // === STAGE6 Phase E データ (J-1: Sanitize before save) ===
    projectTargetImpacts: sanitizeProjectTargetImpacts((s as any).projectTargetImpacts),
    projectIssueLinks: sanitizeProjectIssueLinks((s as any).projectIssueLinks),

    winPatterns: s.winPatterns,
    winPatternPrimary: s.winPatternPrimary,
    winPatternSecondary: s.winPatternSecondary,

    stage4Plans: s.stage4Plans,
    executionPlanBaseline: s.executionPlanBaseline,
  };

  if (typeof s.businessPortfolio !== 'undefined') base.businessPortfolio = s.businessPortfolio;

  // csvFinanceData は object 前提
  if (s.csvFinanceData && typeof s.csvFinanceData === 'object') base.csvFinanceData = s.csvFinanceData;

  if (Array.isArray(s.financeSummary)) base.financeSummary = s.financeSummary;
  if (s.simulationResult !== undefined) base.simulationResult = s.simulationResult;

  if (DEBUG) {
    const busSegLen = Array.isArray(s.businessSegments) ? s.businessSegments.length : 0;
    const financeBSLen = Array.isArray(s.financeBS) ? s.financeBS.length : 0;
    const financePLLen = Array.isArray(s.financePL) ? s.financePL.length : 0;

    // ★ segmentPL 詳細ログ
    const segmentPLDetails: Record<string, number> = {};
    if (s.segmentPL && typeof s.segmentPL === 'object') {
      for (const [k, v] of Object.entries(s.segmentPL as any)) {
        segmentPLDetails[k] = Array.isArray(v) ? v.length : 0;
      }
    }

    // ★ segmentBS 詳細ログ
    const segmentBSDetails: Record<string, number> = {};
    if (s.segmentBS && typeof s.segmentBS === 'object') {
      for (const [k, v] of Object.entries(s.segmentBS as any)) {
        segmentBSDetails[k] = Array.isArray(v) ? v.length : 0;
      }
    }

    // ★ financeBS プレビュー
    const financeBSPreview =
      Array.isArray(s.financeBS) && s.financeBS.length > 0
        ? {
            totalAssets: (s.financeBS[0] as any)?.totalAssets,
            interestBearingDebt: (s.financeBS[0] as any)?.interestBearingDebt,
          }
        : null;

    console.log('[buildSavePayload] ★ payload内容確認', {
      businessSegments_len: busSegLen,
      businessSegments_names: Array.isArray(s.businessSegments) ? s.businessSegments.map((b) => b.name) : [],
      financeBS_len: financeBSLen,
      financeBS_preview: financeBSPreview,
      financePL_len: financePLLen,
      segmentPL_keys: Object.keys(segmentPLDetails),
      segmentPL_rowCountsByKey: segmentPLDetails,
      segmentBS_keys: Object.keys(segmentBSDetails),
      segmentBS_rowCountsByKey: segmentBSDetails,
      stage1Benchmarks: (s as any).stage1Benchmarks ? Object.keys((s as any).stage1Benchmarks) : 'undefined',
      waccManual: (s as any).stage1Benchmarks?.waccManual,
    });
  }

  return pruneUndefinedDeep(base);
}

/**
 * wasDirty=true の場合にもサーバから必ず反映すべきフィールドを抽出
 */
function extractServerDecidedPatch(
  resData: Partial<StrategyState> & { revision?: number },
  current: StrategyState
): Partial<StrategyState> {
  const patch: Partial<StrategyState> = {};

  /* ========== 常に反映（System） ========== */
  if (resData.strategyId && resData.strategyId !== current.strategyId) patch.strategyId = resData.strategyId;
  if (typeof resData.revision === 'number') patch.revision = resData.revision;

  /* ========== STAGE1: 財務・会社情報・セグメント分析 ========== */
  if (Array.isArray(resData.financeBS)) patch.financeBS = resData.financeBS;
  if (Array.isArray(resData.financePL)) patch.financePL = resData.financePL;

  if (resData.segmentPL && typeof resData.segmentPL === 'object') patch.segmentPL = resData.segmentPL;
  if (resData.segmentBS && typeof resData.segmentBS === 'object') patch.segmentBS = resData.segmentBS;

  if (Array.isArray(resData.hqAdjustmentPL)) patch.hqAdjustmentPL = resData.hqAdjustmentPL;
  if (Array.isArray(resData.hqAdjustmentBS)) patch.hqAdjustmentBS = resData.hqAdjustmentBS;

  if (resData.valueAnalysis && typeof resData.valueAnalysis === 'object') patch.valueAnalysis = resData.valueAnalysis;
  if (resData.segmentValueAnalysis && typeof resData.segmentValueAnalysis === 'object')
    patch.segmentValueAnalysis = resData.segmentValueAnalysis;

  if (Array.isArray(resData.financeSummary)) patch.financeSummary = resData.financeSummary;
  if (resData.businessPortfolio && typeof resData.businessPortfolio === 'object')
    patch.businessPortfolio = resData.businessPortfolio;

  if (Array.isArray(resData.stage1Issues)) patch.stage1Issues = resData.stage1Issues;

  if (typeof resData.companyName === 'string' && resData.companyName.trim() !== '') patch.companyName = resData.companyName;
  if (typeof resData.industry === 'string' && resData.industry.trim() !== '') patch.industry = resData.industry;
  if (typeof resData.revenue === 'string' && resData.revenue.trim() !== '') patch.revenue = resData.revenue;

  /* ========== STAGE2: ストーリー・戦略候補 ========== */
  if (Array.isArray(resData.storyDraft)) patch.storyDraft = resData.storyDraft;
  if (Array.isArray(resData.finalStory)) patch.finalStory = resData.finalStory;
  if (Array.isArray(resData.answers2)) patch.answers2 = resData.answers2;

  if (Array.isArray(resData.winPatternsCandidate)) patch.winPatternsCandidate = resData.winPatternsCandidate;
  if (Array.isArray(resData.answers12)) patch.answers12 = resData.answers12;

  /* ========== STAGE3: 部門・戦略方針 ========== */
  if (Array.isArray(resData.departments)) patch.departments = resData.departments;

  if (typeof resData.thought === 'string') patch.thought = resData.thought;
  if (typeof resData.mission === 'string') patch.mission = resData.mission;
  if (typeof resData.vision === 'string') patch.vision = resData.vision;
  if (typeof resData.value === 'string') patch.value = resData.value;
  if (typeof resData.ceoIntent === 'string') patch.ceoIntent = resData.ceoIntent;

  if (resData.swotSuggestions && typeof resData.swotSuggestions === 'object') patch.swotSuggestions = resData.swotSuggestions;

  return patch;
}

/* ===== Department 正規化 ===== */
function normalizeDepartmentsInput(input: any, fallback: Department[]): Department[] {
  // null / {departments:null} は「空にしたい」
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

  // ★ TASK 2: 根治：store に入る瞬間に kpis/keyResults を完全に string[] に強制
  return sanitizeDepartments(base);
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

    // revision が取れている／loaded の場合は親が存在している可能性が高いので何もしない
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
  stage1Benchmarks: undefined,

  thought: '',
  mission: '',
  vision: '',
  value: '',
  ceoIntent: '',
  strength: '',
  weakness: '',
  opportunity: '',
  threat: '',
  swotSuggestions: undefined,
  story: [],
  finalStory: [],
  answers2: [],
  departments: [],
  storyDraft: [], // ★ 修正：undefined から [] に統一（infinite loop 防止）
  winPatternsCandidate: [], // ★ 修正：undefined から [] に統一
  answers12: [], // ★ 修正：undefined から [] に統一
  finalStoryDraft: undefined,
  finalStoryEdited: undefined,
  finalStoryFinal: undefined,
  companyTargets: [],
  projectTargetImpacts: [],
  projectIssueLinks: [],
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
  // ★ 止血対策：boot state に isSaving / isRestoring を追加
  boot: { isHydrating: false, isHydrated: false, isSaving: false, isRestoring: false },

  /* ★ TASK 14: restore state フラグ初期値 */
  restoreReady: false,
  isRestoring: false,

  revision: undefined,
  lastServerSnapshot: undefined,
  serverShadow: undefined,

  __isFetchingFromServer: false,
  __afterSave: undefined,
  __lastServerError: undefined,

  /* UI state (session内のみ、永続化されない) */
  saveError: undefined,
  lastSavedAt: undefined,

  chapterCurrentStep: {},
  _loadingRefetch: false,
  _loadingSave: false,

  __lastSavedHash: undefined,

  reset: () => {},
  resetAll: () => {},
  setHydrated: () => {},
  setHydrating: () => {},
  setServerSnapshotHash: () => {},
  setRevision: () => {},
  setStrategyId: () => {},
  hydrateFromFullState: () => {},
  setCompanyScope: () => {},
  setStory: () => {},
  setFinalStory: () => {},
  setAnswers2: () => {},
  setChapterCurrentStep: () => {},
  setProfile: () => {},

  setCompanyName: () => {},
  setIndustry: () => {},
  setStage1Issues: () => {},
  setStage1Benchmarks: () => {},
  setStoryDraft: () => {},
  setWinPatternsCandidate: () => {},
  setAnswers12: () => {},
  updateAnswer12: () => {},
  setCompanyTargets: () => {},
  addCompanyTarget: () => {},
  updateCompanyTarget: () => {},
  removeCompanyTarget: () => {},

  // Phase E
  setProjectTargetImpacts: () => {},
  addProjectTargetImpact: () => {},
  updateProjectTargetImpact: () => {},
  removeProjectTargetImpact: () => {},
  setProjectIssueLinks: () => {},
  addProjectIssueLink: () => {},
  updateProjectIssueLink: () => {},
  removeProjectIssueLink: () => {},

  setFinalStoryDraft: () => {},
  setFinalStoryEdited: () => {},
  commitFinalStory: () => {},
  setStage4Plans: () => {},
  setExecutionPlanBaseline: () => {},
  recomputeValueAnalysis: () => {},

  setFinancePL: () => {},
  setFinanceBS: () => {},
  setSegmentPL: () => {},
  setSegmentBS: () => {},
  upsertSegmentPL: () => {},
  upsertSegmentBS: () => {},
  setBusinessSegmentsWithSync: () => {},

  /* ★ 年度CRUD（全社） */
  addFinanceYear: () => {},
  renameFinanceYear: () => false,
  removeFinanceYear: () => {},
  updateFinancePLCell: () => {},
  updateFinanceBSCell: () => {},

  /* ★ 年度CRUD（事業部別） */
  addSegmentFinanceYear: () => {},
  renameSegmentFinanceYear: () => false,
  removeSegmentFinanceYear: () => {},
  updateSegmentPLCell: () => {},
  updateSegmentBSCell: () => {},

  setMVV: () => {},
  setSWOT: () => {},
  setCeoIntent: () => {},
  setSwotSuggestions: () => {},
  addSwotOpportunity: () => {},
  addSwotThreat: () => {},
  removeSwotOpportunity: () => {},
  removeSwotThreat: () => {},
  setDepartments: () => {},
  updateDepartments: () => {},
  setBusinessPortfolio: () => {},
  setFinanceSummary: () => {},
  markLoaded: () => {},
  markDirty: () => {},
  buildPayload: () => ({}),

  saveStrategyData: async () => ({ ok: false, reason: 'uninitialized', skipped: true }),
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

  // ★ DEBUG STAGE1: During normalize/load from DB
  if (process.env.NEXT_PUBLIC_DEBUG_STAGE1) {
    console.log('[DEBUG_STAGE1] normalizeFromDbRow LOAD:', {
      isListed: raw.isListed,
      ticker: raw.ticker,
      pbrManual: raw.pbrManual,
      stage1Benchmarks: raw.stage1Benchmarks ? {
        keys: Object.keys(raw.stage1Benchmarks),
        waccManual: raw.stage1Benchmarks.waccManual,
        waccRationale: raw.stage1Benchmarks.waccRationale ? '(present)' : undefined,
      } : undefined,
    });
  }

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
  let businessSegments = isArray(raw.businessSegments)
    ? raw.businessSegments
    : isArray(raw.business_segments)
      ? raw.business_segments
      : [];

  // ★ businessSegments の正規化：summary/keyCustomers を安全化
  businessSegments = businessSegments.map((seg: any) => {
    const normalized: any = { ...seg };
    // summary は string または undefined
    if (typeof normalized.summary !== 'string' && normalized.summary !== undefined) {
      normalized.summary = undefined;
    }
    // keyCustomers は string[] として正規化、最大3件
    if (normalized.keyCustomers !== undefined) {
      const kc = normalized.keyCustomers;
      if (Array.isArray(kc)) {
        normalized.keyCustomers = kc
          .filter(Boolean)
          .map((v: any) => String(v).trim())
          .filter(Boolean)
          .slice(0, 3);
      } else {
        normalized.keyCustomers = undefined;
      }
    }
    return normalized;
  });

  const isListed =
    typeof raw.isListed === 'boolean'
      ? raw.isListed
      : typeof raw.is_listed === 'boolean'
        ? raw.is_listed
        : false;

  const ticker = raw.ticker ?? raw.ticker_text ?? '';
  const pbrManual = raw.pbrManual ?? raw.pbr_manual ?? '';
  const financeBS = isArray(raw.financeBS) ? raw.financeBS : isArray(raw.finance_bs) ? raw.finance_bs : [];
  const financePL = isArray(raw.financePL) ? raw.financePL : isArray(raw.finance_pl) ? raw.finance_pl : [];

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

  const hqAdjustmentPL = isArray(raw.hqAdjustmentPL) ? raw.hqAdjustmentPL : isArray(raw.hq_adjustment_pl) ? raw.hq_adjustment_pl : undefined;
  const hqAdjustmentBS = isArray(raw.hqAdjustmentBS) ? raw.hqAdjustmentBS : isArray(raw.hq_adjustment_bs) ? raw.hq_adjustment_bs : undefined;

  const valueAnalysis = raw.valueAnalysis ?? raw.value_analysis ?? undefined;

  const segmentValueAnalysis =
    raw.segmentValueAnalysis && typeof raw.segmentValueAnalysis === 'object'
      ? raw.segmentValueAnalysis
      : raw.segment_value_analysis && typeof raw.segment_value_analysis === 'object'
        ? raw.segment_value_analysis
        : undefined;

  const stage1Issues = isArray(raw.stage1Issues) ? raw.stage1Issues : isArray(raw.stage1_issues) ? raw.stage1_issues : [];

  // ★ 診断ログ：DB行からの復元状況
  if (DEBUG && (raw.stage1Issues || raw.stage1_issues)) {
    console.log('[normalizeFromDbRow] stage1Issues 復元:', {
      raw_stage1Issues_len: isArray(raw.stage1Issues) ? (raw.stage1Issues as any[]).length : 0,
      raw_stage1_issues_len: isArray(raw.stage1_issues) ? (raw.stage1_issues as any[]).length : 0,
      final_len: Array.isArray(stage1Issues) ? stage1Issues.length : 0,
    });
  }

  const stage1Benchmarks =
    raw.stage1Benchmarks && typeof raw.stage1Benchmarks === 'object'
      ? raw.stage1Benchmarks
      : raw.stage1_benchmarks && typeof raw.stage1_benchmarks === 'object'
        ? raw.stage1_benchmarks
        : undefined;

  // ★ 診断ログ：stage1Benchmarks 復元状況
  if (DEBUG && (raw.stage1Benchmarks || raw.stage1_benchmarks)) {
    console.log('[normalizeFromDbRow] stage1Benchmarks 復元:', {
      has_raw_stage1Benchmarks: !!raw.stage1Benchmarks,
      has_raw_stage1_benchmarks: !!raw.stage1_benchmarks,
      final_benchmarkKeys: stage1Benchmarks ? Object.keys(stage1Benchmarks) : [],
      waccManual: (stage1Benchmarks as any)?.waccManual,
    });
  }

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

  const csvFinanceData =
    raw.csvFinanceData && typeof raw.csvFinanceData === 'object'
      ? raw.csvFinanceData
      : raw.csv_finance_data && typeof raw.csv_finance_data === 'object'
        ? raw.csv_finance_data
        : undefined;

  const financeSummary = isArray(raw.financeSummary) ? raw.financeSummary : isArray(raw.finance_summary) ? raw.finance_summary : [];

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
  const winPatternSecondary: WinPatternId | undefined = raw.winPatternSecondary ?? raw.win_pattern_secondary ?? undefined;

  const executionPlanBaseline = (() => {
    const base = raw.executionPlanBaseline ?? raw.execution_plan_baseline;
    if (!base || typeof base !== 'object') return undefined;
    return {
      companyId: base.companyId ?? base.company_id,
      createdAt: typeof base.createdAt === 'number' ? base.createdAt : undefined,
      snapshot: Array.isArray(base.snapshot) ? base.snapshot : undefined,
    };
  })();

  // === STAGE6 Phase E データの正規化 ===
  const companyTargets = Array.isArray(raw.companyTargets)
    ? raw.companyTargets
    : Array.isArray(raw.company_targets)
      ? raw.company_targets
      : [];

  const projectTargetImpacts = Array.isArray(raw.projectTargetImpacts)
    ? raw.projectTargetImpacts
    : Array.isArray(raw.project_target_impacts)
      ? raw.project_target_impacts
      : [];

  const projectIssueLinks = Array.isArray(raw.projectIssueLinks)
    ? raw.projectIssueLinks
    : Array.isArray(raw.project_issue_links)
      ? raw.project_issue_links
      : [];

  // ★ STAGE2 フィールド復元（常に配列に統一）
  const ceoIntent = raw.ceoIntent ?? raw.ceo_intent ?? '';

  const storyDraft =
    Array.isArray(raw.storyDraft) ? raw.storyDraft :
    Array.isArray(raw.story_draft) ? raw.story_draft :
    [];

  const winPatternsCandidate =
    Array.isArray(raw.winPatternsCandidate) ? raw.winPatternsCandidate :
    Array.isArray(raw.win_patterns_candidate) ? raw.win_patterns_candidate :
    [];

  const answers12 =
    Array.isArray(raw.answers12) ? raw.answers12 :
    Array.isArray(raw.answers_12) ? raw.answers_12 :
    [];

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
    stage1Benchmarks,

    thought,
    mission,
    vision,
    value,
    ceoIntent,
    strength,
    weakness,
    opportunity,
    threat,

    story,
    storyDraft,
    finalStory,

    answers2,
    answers12,
    departments,

    csvFinanceData,
    financeSummary,
    businessPortfolio,
    simulationResult,

    winPatternsCandidate,
    winPatterns,
    winPatternPrimary,
    winPatternSecondary,

    executionPlanBaseline,

    // === STAGE6 Phase E データ ===
    companyTargets,
    projectTargetImpacts,
    projectIssueLinks,
  };

  if (DEBUG) {
    const patchFinancePLLen = Array.isArray(patch.financePL) ? patch.financePL.length : 0;
    const patchStage1IssuesLen = Array.isArray(patch.stage1Issues) ? patch.stage1Issues.length : 0;
    console.log('[normalizeFromDbRow] patch生成 financePL_len:' + patchFinancePLLen + ' stage1Issues_len:' + patchStage1IssuesLen);
  }

  let pruned = 0;
  for (const [key, value] of Object.entries(patch)) {
    if (value === undefined) {
      delete patch[key];
      pruned++;
    }
  }
  if (DEBUG && pruned > 0) console.log('[normalizeFromDbRow] pruned_fields:' + pruned);

  if (DEBUG) {
    const finalPatchFinancePLLen = Array.isArray(patch.financePL) ? patch.financePL.length : 0;
    console.log(
      '[normalizeFromDbRow] patch最終 financePL_len:' +
        finalPatchFinancePLLen +
        ' financePL_exists:' +
        ('financePL' in patch)
    );
  }

  return patch as Partial<StrategyState>;
}

/* ===== TASK 2: 根治ヘルパー：全 kpis/keyResults を強制的に string[] に ===== */
/**
 * Store に入る瞬間に departments の全 kpis/keyResults を string[] に強制
 * 呼び出し元が object を混在させていても、ここで完全に文字列化される
 */
function sanitizeDepartments(departments: any): Department[] {
  if (!Array.isArray(departments)) return [];

  return departments.map((dept: any) => ({
    ...dept,
    projects: Array.isArray(dept?.projects)
      ? dept.projects.map((proj: any) => {
          // kpis を string[] に強制
          const sanitizedKpis = Array.isArray(proj?.kpis)
            ? proj.kpis
                .map((kpi: any) => {
                  if (typeof kpi === 'string') return kpi;
                  if (kpi == null) return '';
                  if (typeof kpi === 'object') {
                    const extracted = kpi.label ?? kpi.name ?? kpi.title ?? kpi.text;
                    return extracted ? String(extracted) : JSON.stringify(kpi);
                  }
                  return String(kpi);
                })
                .map((s: string) => s.trim())
                .filter((s: string) => s.length > 0)
            : [];

          // okrs[].keyResults を string[] に強制
          const sanitizedOkrs = Array.isArray(proj?.okrs)
            ? proj.okrs.map((okr: any) => ({
                ...okr,
                keyResults: Array.isArray(okr?.keyResults)
                  ? okr.keyResults
                      .map((kr: any) => {
                        if (typeof kr === 'string') return kr;
                        if (kr == null) return '';
                        if (typeof kr === 'object') {
                          const extracted = kr.label ?? kr.name ?? kr.title ?? kr.text;
                          return extracted ? String(extracted) : JSON.stringify(kr);
                        }
                        return String(kr);
                      })
                      .map((s: string) => s.trim())
                      .filter((s: string) => s.length > 0)
                  : [],
              }))
            : [];

          return {
            ...proj,
            kpis: sanitizedKpis,
            okrs: sanitizedOkrs,
          };
        })
      : [],
  }));
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
            __isFetchingFromServer: false,
          };
        }),

      setHydrating: (b) => set((s) => ({ ...s, boot: { ...s.boot, isHydrating: b } })),
      setServerSnapshotHash: (hash) => set({ lastServerSnapshot: hash }),

      setRevision: (rev) => set({ revision: rev }),
      setStrategyId: (id) => set({ strategyId: id }),

      hydrateFromFullState: (fullState) => {
        // ★ DEBUG STAGE1: During hydrate/normalize load
        if (process.env.NEXT_PUBLIC_DEBUG_STAGE1) {
          console.log('[DEBUG_STAGE1] hydrateFromFullState LOAD:', {
            isListed: fullState.isListed,
            ticker: fullState.ticker,
            pbrManual: fullState.pbrManual,
            stage1Benchmarks: fullState.stage1Benchmarks ? {
              keys: Object.keys(fullState.stage1Benchmarks),
              waccManual: fullState.stage1Benchmarks.waccManual,
              waccRationale: fullState.stage1Benchmarks.waccRationale ? '(present)' : undefined,
            } : undefined,
          });
        }

        // ★ Type guard for businessPortfolio to avoid unsafe spread
        const guardedBusinessPortfolio =
          fullState.businessPortfolio && typeof fullState.businessPortfolio === 'object'
            ? (fullState.businessPortfolio as BusinessPortfolio)
            : undefined;

        // ★ TASK 2: hydrate 時にも departments を完全に sanitize
        const sanitizedDepts = fullState.departments ? sanitizeDepartments(fullState.departments) : undefined;

        set((s) => ({
          ...s,
          ...fullState,
          departments: sanitizedDepts,
          businessPortfolio: guardedBusinessPortfolio,
          hydrated: true,
        }));
      },

      /* ▼破壊的リセット禁止：即消さず、仮スコープでハイドレート開始 */
      setCompanyScope: (id) =>
        set((s) => ({
          ...s,
          pendingCompanyId: id,
          boot: { isHydrating: true, isHydrated: false },
          __isFetchingFromServer: true,
          _loadingRefetch: false,
          __lastServerError: undefined,
          /* ★ TASK 14: restore フラグをリセット（新会社スコープでリフェッチ開始） */
          restoreReady: false,
          isRestoring: true,
        })),

      setStory: (chs) => {
        set((s) => ({ story: [...chs], dirty: true, version: (s.version ?? 0) + 1 }));
      },

      // finalStory は 分離API で即時保存（親保証→分離保存）
      setFinalStory: (chs) => {
        set((s) => ({ finalStory: [...chs], dirty: true, version: (s.version ?? 0) + 1 }));

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
        // ★ DEBUG STAGE1: Before save payload
        if (process.env.NEXT_PUBLIC_DEBUG_STAGE1) {
          const summary = {
            isListed: (patch as any).isListed,
            ticker: (patch as any).ticker,
            pbrManual: (patch as any).pbrManual,
            stage1Benchmarks: (patch as any).stage1Benchmarks ? {
              keys: Object.keys((patch as any).stage1Benchmarks),
              waccManual: (patch as any).stage1Benchmarks.waccManual,
              waccRationale: (patch as any).stage1Benchmarks.waccRationale,
            } : undefined,
          };
          console.log('[DEBUG_STAGE1] setProfile BEFORE save:', summary);
        }

        // ★ 診断ログ：setProfile に stage1Issues が含まれている場合を検知
        if (DEBUG && 'stage1Issues' in patch) {
          console.log('[strategyStore] setProfile contains stage1Issues:', {
            stage1Issues_len: Array.isArray((patch as any).stage1Issues) ? (patch as any).stage1Issues.length : 0,
            stage1Issues_titles: Array.isArray((patch as any).stage1Issues) ? (patch as any).stage1Issues.map((i: any) => i.title) : [],
          });
        }

        // businessSegments が変更された場合、segmentPL/segmentBS のキー整合を保つ
        if (patch.businessSegments !== undefined) {
          const currentState = get();
          const newSegmentNames = new Set((patch.businessSegments ?? []).map((seg) => seg.name));

          let newSegmentPL = currentState.segmentPL ? { ...currentState.segmentPL } : {};
          let newSegmentBS = currentState.segmentBS ? { ...currentState.segmentBS } : {};

          for (const key of Object.keys(newSegmentPL)) {
            if (!newSegmentNames.has(key)) delete newSegmentPL[key];
          }
          for (const key of Object.keys(newSegmentBS)) {
            if (!newSegmentNames.has(key)) delete newSegmentBS[key];
          }

          for (const segName of newSegmentNames) {
            if (!(segName in newSegmentPL)) newSegmentPL[segName] = [];
            if (!(segName in newSegmentBS)) newSegmentBS[segName] = [];
          }

          if (DEBUG) {
            const plKeys = Object.keys(newSegmentPL).length;
            const bsKeys = Object.keys(newSegmentBS).length;
            console.log('[strategyStore] setProfile: segment sync', {
              newSegmentNames: Array.from(newSegmentNames),
              plKeys,
              bsKeys,
            });
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

        // ★ DEBUG STAGE1: After state update in setProfile
        if (process.env.NEXT_PUBLIC_DEBUG_STAGE1) {
          const updated = get();
          console.log('[DEBUG_STAGE1] setProfile AFTER state update:', {
            isListed: updated.isListed,
            ticker: updated.ticker,
            pbrManual: updated.pbrManual,
            stage1Benchmarks: updated.stage1Benchmarks ? {
              keys: Object.keys(updated.stage1Benchmarks),
              waccManual: updated.stage1Benchmarks.waccManual,
            } : undefined,
          });
        }

        const needsRecompute =
          patch.pbrManual !== undefined ||
          patch.financeBS !== undefined ||
          patch.financePL !== undefined ||
          patch.segmentPL !== undefined ||
          patch.segmentBS !== undefined ||
          patch.businessSegments !== undefined;

        if (needsRecompute) {
          setTimeout(() => {
            get().recomputeValueAnalysis('setProfile');
          }, 0);
        }

        // ★ 注意：dirty: true は既にセットされたので、UI の自動保存メカニズムが
        // saveStrategyData() を呼び、ticker/benchmarks/WACC を Supabase に保存する
      },

      /* ▼ 互換用ショートカット */
      setCompanyName: (name) => set((s) => ({ ...s, companyName: name, dirty: true, version: (s.version ?? 0) + 1 })),
      setIndustry: (industry) => set((s) => ({ ...s, industry, dirty: true, version: (s.version ?? 0) + 1 })),
      setStage1Issues: (issues) => {
        // ★ 診断ログ：setStage1Issues 呼び出し確認
        if (DEBUG) {
          console.log('[strategyStore] setStage1Issues called:', {
            issuesCount: Array.isArray(issues) ? issues.length : 0,
            issue_titles: Array.isArray(issues) ? issues.map((i) => i.title) : [],
          });
        }

        set((s) => ({ ...s, stage1Issues: issues, dirty: true, version: (s.version ?? 0) + 1 }));

        // localStorage にも即座に保存（デモ安定）
        setTimeout(() => {
          const result = get().saveStage1Snapshot();
          if (DEBUG) {
            console.log('[strategyStore] setStage1Issues snapshot saved:', { result });
          }
        }, 0);
      },

      setStage1Benchmarks: (benchmarks) => {
        // ★ DEBUG STAGE1: Before save payload
        if (process.env.NEXT_PUBLIC_DEBUG_STAGE1) {
          console.log('[DEBUG_STAGE1] setStage1Benchmarks BEFORE save:', {
            hasBenchmarks: !!benchmarks,
            benchmarkKeys: benchmarks ? Object.keys(benchmarks) : [],
            waccManual: benchmarks?.waccManual,
            waccRationale: benchmarks?.waccRationale ? '(present)' : undefined,
          });
        }

        if (DEBUG) {
          console.log('[strategyStore] setStage1Benchmarks called:', {
            hasBenchmarks: !!benchmarks,
            benchmarkKeys: benchmarks ? Object.keys(benchmarks) : [],
            waccManual: benchmarks?.waccManual,
            waccRationale: benchmarks?.waccRationale ? benchmarks.waccRationale.substring(0, 50) + '...' : undefined,
          });
        }

        set((s) => {
          const newState = { ...s, stage1Benchmarks: benchmarks, dirty: true };
          if (DEBUG) {
            console.log('[strategyStore] setStage1Benchmarks state updated:', {
              stateHasBenchmarks: !!newState.stage1Benchmarks,
              isDirty: newState.dirty,
            });
          }
          return newState;
        });

        // ★ WACC変更で ValueAnalysis を再計算
        setTimeout(() => {
          get().recomputeValueAnalysis('local');

        }, 0);

        // ★ 注意：dirty: true は既にセットされたので、UI の自動保存メカニズムが
        // saveStrategyData() を呼び、benchmarks と WACC を Supabase に保存する
      },

      /* ▼ STAGE2 setter */
      setStoryDraft: (draft) => {
        set((s) => ({ ...s, storyDraft: draft, dirty: true, version: (s.version ?? 0) + 1 }));
        setTimeout(() => {
          get().saveStage2Snapshot();
        }, 0);
      },

      setWinPatternsCandidate: (candidates) => {
        set((s) => ({ ...s, winPatternsCandidate: candidates, dirty: true, version: (s.version ?? 0) + 1 }));
        setTimeout(() => {
          get().saveStage2Snapshot();
        }, 0);
      },

      /* ★ 修正：setAnswers12 を堅牢化（配列ガード + 関数updater禁止） */
      setAnswers12: (answers) => {
        if (!Array.isArray(answers)) {
          console.warn('[strategyStore][setAnswers12] received non-array, treating as empty', answers);
          // 配列でなければ空配列に矯正（関数 updater などが混入した場合の保険）
          set((s) => ({ ...s, answers12: [], dirty: true, version: (s.version ?? 0) + 1 }));
          return;
        }
        set((s) => ({ ...s, answers12: answers, dirty: true, version: (s.version ?? 0) + 1 }));
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
          return { ...s, answers12: next, dirty: true, version: (s.version ?? 0) + 1 };
        });
        setTimeout(() => {
          get().saveStage2Snapshot();
        }, 0);
      },

      setCompanyTargets: (targets: CompanyTarget[]) => {
        set((s) => ({ ...s, companyTargets: targets, dirty: true, version: (s.version ?? 0) + 1 }));
        setTimeout(() => {
          get().saveStage2Snapshot();
        }, 0);
      },

      addCompanyTarget: (target: CompanyTarget) => {
        set((s) => {
          const prev = s.companyTargets ?? [];
          return { ...s, companyTargets: [...prev, target], dirty: true, version: (s.version ?? 0) + 1 };
        });
        setTimeout(() => {
          get().saveStage2Snapshot();
        }, 0);
      },

      updateCompanyTarget: (id: string, patch: Partial<CompanyTarget>) => {
        set((s) => {
          const prev = s.companyTargets ?? [];
          const idx = prev.findIndex((t) => t.id === id);
          if (idx < 0) return s;
          const next = [...prev];
          next[idx] = { ...next[idx], ...patch };
          return { ...s, companyTargets: next, dirty: true, version: (s.version ?? 0) + 1 };
        });
        setTimeout(() => {
          get().saveStage2Snapshot();
        }, 0);
      },

      removeCompanyTarget: (id: string) => {
        set((s) => {
          const prev = s.companyTargets ?? [];
          return { ...s, companyTargets: prev.filter((t) => t.id !== id), dirty: true, version: (s.version ?? 0) + 1 };
        });
        setTimeout(() => {
          get().saveStage2Snapshot();
        }, 0);
      },

      // === STAGE6 Phase E：projectTargetImpacts アクション ===
      setProjectTargetImpacts: (impacts: ProjectTargetImpact[]) => {
        set((s) => ({ ...s, projectTargetImpacts: impacts, dirty: true, version: (s.version ?? 0) + 1 }));
      },

      addProjectTargetImpact: (impact: ProjectTargetImpact) => {
        set((s) => {
          const prev = s.projectTargetImpacts ?? [];
          return { ...s, projectTargetImpacts: [...prev, impact], dirty: true, version: (s.version ?? 0) + 1 };
        });
      },

      updateProjectTargetImpact: (projectId: string, targetId: string, patch: Partial<ProjectTargetImpact>) => {
        set((s) => {
          const prev = s.projectTargetImpacts ?? [];
          const idx = prev.findIndex((imp) => imp.projectId === projectId && imp.targetId === targetId);
          if (idx < 0) return s;
          const next = [...prev];
          next[idx] = { ...next[idx], ...patch };
          return { ...s, projectTargetImpacts: next, dirty: true, version: (s.version ?? 0) + 1 };
        });
      },

      removeProjectTargetImpact: (projectId: string, targetId: string) => {
        set((s) => {
          const prev = s.projectTargetImpacts ?? [];
          return {
            ...s,
            projectTargetImpacts: prev.filter((imp) => !(imp.projectId === projectId && imp.targetId === targetId)),
            dirty: true,
            version: (s.version ?? 0) + 1,
          };
        });
      },

      // === STAGE6 Phase E：projectIssueLinks アクション ===
      setProjectIssueLinks: (links: ProjectIssueLink[]) => {
        set((s) => ({ ...s, projectIssueLinks: links, dirty: true, version: (s.version ?? 0) + 1 }));
      },

      addProjectIssueLink: (link: ProjectIssueLink) => {
        set((s) => {
          const prev = s.projectIssueLinks ?? [];
          return { ...s, projectIssueLinks: [...prev, link], dirty: true, version: (s.version ?? 0) + 1 };
        });
      },

      updateProjectIssueLink: (projectId: string, issueId: string, patch: Partial<ProjectIssueLink>) => {
        set((s) => {
          const prev = s.projectIssueLinks ?? [];
          const idx = prev.findIndex((link) => link.projectId === projectId && link.issueId === issueId);
          if (idx < 0) return s;
          const next = [...prev];
          next[idx] = { ...next[idx], ...patch };
          return { ...s, projectIssueLinks: next, dirty: true, version: (s.version ?? 0) + 1 };
        });
      },

      removeProjectIssueLink: (projectId: string, issueId: string) => {
        set((s) => {
          const prev = s.projectIssueLinks ?? [];
          return {
            ...s,
            projectIssueLinks: prev.filter((link) => !(link.projectId === projectId && link.issueId === issueId)),
            dirty: true,
            version: (s.version ?? 0) + 1,
          };
        });
      },

      setFinalStoryDraft: (chapters: StoryChapter[]) => {
        set((s) => ({ ...s, finalStoryDraft: chapters, dirty: true, version: (s.version ?? 0) + 1 }));
        setTimeout(() => {
          get().saveStage2Snapshot();
        }, 0);
      },

      setFinalStoryEdited: (chapters: StoryChapter[]) => {
        set((s) => ({ ...s, finalStoryEdited: chapters, dirty: true, version: (s.version ?? 0) + 1 }));
        setTimeout(() => {
          get().saveStage2Snapshot();
        }, 0);
      },

      commitFinalStory: () => {
        const s = get();
        const toCommit = s.finalStoryEdited ?? s.finalStoryDraft ?? [];
        set((state) => ({ ...state, finalStoryFinal: toCommit, dirty: true, version: (state.version ?? 0) + 1 }));
        setTimeout(() => {
          get().saveStage2Snapshot();
        }, 0);
      },

      /* ▼ STAGE4 setter */
      setStage4Plans: (plans) => {
        set((s) => ({ ...s, stage4Plans: plans, dirty: true, version: (s.version ?? 0) + 1 }));
      },

      setExecutionPlanBaseline: (baseline) => {
        set((s) => ({ ...s, executionPlanBaseline: baseline, dirty: true, version: (s.version ?? 0) + 1 }));
      },

      /** ValueAnalysis 再計算 */
      recomputeValueAnalysis: (source = 'local') => {
        const s = get();
        // ★ source='local'（手動更新）の場合はhydrating をスキップ、無反応を防ぐ
        // source='refetchFromServer'の場合はhydratingを待つ
        if (source !== 'local' && (s.__isFetchingFromServer || s.boot?.isHydrating)) {
          if (DEBUG) console.log('[strategyStore] recomputeValueAnalysis: skip while fetching/hydrating (not local)');
          return;
        }

        if (DEBUG) console.log('[strategyStore] recomputeValueAnalysis called', { source });

        const hasNewFormat = Array.isArray(s.financePL) && s.financePL.length > 0;

        // ★ 診断ログ：入力データ確認（A-3）
        if (DEBUG) {
          const financePLPreview = Array.isArray(s.financePL) && s.financePL.length > 0
            ? {
                firstYear: (s.financePL[0] as any)?.year,
                lastYear: (s.financePL[s.financePL.length - 1] as any)?.year,
                firstRevenue: (s.financePL[0] as any)?.revenue,
                lastRevenue: (s.financePL[s.financePL.length - 1] as any)?.revenue,
              }
            : null;

          console.log('[strategyStore] recomputeValueAnalysis input data:', {
            source,
            hasNewFormat,
            financePL_len: Array.isArray(s.financePL) ? s.financePL.length : 0,
            financePL_preview: financePLPreview,
            financeBS_len: Array.isArray(s.financeBS) ? s.financeBS.length : 0,
            financeSummary_len: Array.isArray(s.financeSummary) ? s.financeSummary.length : 0,
            pbrManual: s.pbrManual,
          });
        }

        let newValueAnalysis: ValueAnalysis;
        let newSegmentValueAnalysis: Record<string, ValueAnalysis> | undefined;

        if (hasNewFormat) {
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
          newValueAnalysis = computeValueAnalysis({
            financeSummary: s.financeSummary,
            financeBS: s.financeBS,
            pbrManual: s.pbrManual,
          });
          newSegmentValueAnalysis = undefined;
        }

        newValueAnalysis.meta = {
          ...newValueAnalysis.meta,
          source: source === 'refetchFromServer' ? 'server' : 'local',
        };

        // ★ 診断ログ：計算結果確認
        if (DEBUG) {
          console.log('[strategyStore] recomputeValueAnalysis result:', {
            source,
            hasNewFormat,
            revenueCagrPct: (newValueAnalysis as any)?.revenueCagrPct,
            operatingMarginPctLatest: (newValueAnalysis as any)?.operatingMarginPctLatest,
            basis_years: (newValueAnalysis as any)?.meta?.basis?.years,
            basis_latestYear: (newValueAnalysis as any)?.meta?.basis?.latestYear,
            meta_source: (newValueAnalysis as any)?.meta?.source,
          });
        }

        set((prev) => ({
          ...prev,
          valueAnalysis: newValueAnalysis,
          segmentValueAnalysis: newSegmentValueAnalysis,
          dirty: source === 'refetchFromServer' ? prev.dirty : true,
        }));
      },

      /* STAGE1 財務データ setter */
      setFinancePL: (rows) => {
        // ★ TASK-A: financePL を yen に統一（Stage1入力は百万円、保存は yen）
        const yenRows = Array.isArray(rows)
          ? rows.map((row: any) => {
              // 数値が 100万未満なら百万円と判定して yen に変換
              const revenue = row.revenue ?? 0;
              const operatingIncome = row.operatingIncome ?? 0;

              const revenueYen = revenue > 0 && revenue < 1_000_000 ? revenue * 1_000_000 : revenue;
              const opIncomeYen = operatingIncome > 0 && operatingIncome < 1_000_000 ? operatingIncome * 1_000_000 : operatingIncome;

              return {
                ...row,
                revenue: revenueYen,
                operatingIncome: opIncomeYen,
                // 他の財務指標も同様に変換（cogs, sga, etc）
                cogs: (row.cogs ?? 0) > 0 && (row.cogs ?? 0) < 1_000_000 ? (row.cogs ?? 0) * 1_000_000 : (row.cogs ?? 0),
                sga: (row.sga ?? 0) > 0 && (row.sga ?? 0) < 1_000_000 ? (row.sga ?? 0) * 1_000_000 : (row.sga ?? 0),
                grossProfit: (row.grossProfit ?? 0) > 0 && (row.grossProfit ?? 0) < 1_000_000 ? (row.grossProfit ?? 0) * 1_000_000 : (row.grossProfit ?? 0),
              };
            })
          : rows;

        // ★ DEBUG：入力ログ（弾き判定用）
        console.log('[strategyStore] setFinancePL input', {
          len: Array.isArray(rows) ? rows.length : 'not-array',
          sample: Array.isArray(rows) && rows.length > 0 ? rows[0] : null,
          sample_after_conversion: Array.isArray(yenRows) && yenRows.length > 0 ? yenRows[0] : null,
        });

        set((s) => ({ ...s, financePL: yenRows, dirty: true, version: (s.version ?? 0) + 1 }));

        // ★ DEBUG：set直後の確認
        setTimeout(() => {
          const after = get().financePL;
          console.log('[strategyStore] setFinancePL accepted', {
            len: after?.length ?? 0,
            sample: after?.[0] ?? null,
          });
        }, 0);

        setTimeout(() => get().recomputeValueAnalysis('setFinancePL'), 0);
      },

      setFinanceBS: (rows) => {
        // ★ DEBUG：入力ログ（弾き判定用）
        console.log('[strategyStore] setFinanceBS input', {
          len: Array.isArray(rows) ? rows.length : 'not-array',
          sample: Array.isArray(rows) && rows.length > 0 ? rows[0] : null,
          allYears: Array.isArray(rows) ? rows.map((r: any) => ({ year: r.year, yearType: typeof r.year })) : null,
        });

        if (DEBUG) {
          console.log('[strategyStore] setFinanceBS called', {
            rowsLen: Array.isArray(rows) ? rows.length : '?',
            firstRow:
              Array.isArray(rows) && rows.length > 0
                ? {
                    year: (rows[0] as any).year,
                    totalAssets: (rows[0] as any).totalAssets,
                    interestBearingDebt: (rows[0] as any).interestBearingDebt,
                  }
                : null,
          });
        }
        // ★ 修正：csvFinanceData と同期
        set((s) => ({
          ...s,
          financeBS: rows,
          csvFinanceData: {
            ...(s.csvFinanceData || {}),
            financeBS: rows,
          },
          dirty: true,
          version: (s.version ?? 0) + 1,
        }));

        // ★ DEBUG：set直後の確認
        setTimeout(() => {
          const after = get().financeBS;
          console.log('[strategyStore] setFinanceBS accepted', {
            len: after?.length ?? 0,
            sample: after?.[0] ?? null,
          });
        }, 0);

        setTimeout(() => get().recomputeValueAnalysis('setFinanceBS'), 0);
      },

      setSegmentPL: (data) => {
        // ★ DEBUG：入力ログ（弾き判定用）
        const keys = Object.keys(data ?? {});
        const distribution = Object.fromEntries(
          keys.map((k) => [k, Array.isArray((data as any)?.[k]) ? (data as any)[k].length : '?'])
        );
        console.log('[strategyStore] setSegmentPL input', {
          keys,
          distribution,
          sample: keys.length > 0 ? { [keys[0]]: (data as any)?.[keys[0]]?.[0] } : null,
        });

        // ★ 修正：csvFinanceData と同期
        set((s) => ({
          ...s,
          segmentPL: data,
          csvFinanceData: {
            ...(s.csvFinanceData || {}),
            segmentPL: data,
          },
          dirty: true,
        }));

        // ★ DEBUG：set直後の確認
        setTimeout(() => {
          const after = get().segmentPL;
          const afterKeys = Object.keys(after ?? {});
          const afterDist = Object.fromEntries(
            afterKeys.map((k) => [k, Array.isArray((after as any)?.[k]) ? (after as any)[k].length : '?'])
          );
          console.log('[strategyStore] setSegmentPL accepted', {
            keys: afterKeys,
            distribution: afterDist,
          });
        }, 0);

        setTimeout(() => get().recomputeValueAnalysis('setSegmentPL'), 0);
      },

      setSegmentBS: (data) => {
        // ★ DEBUG：入力ログ（弾き判定用）
        const keys = Object.keys(data ?? {});
        const distribution = Object.fromEntries(
          keys.map((k) => [k, Array.isArray((data as any)?.[k]) ? (data as any)[k].length : '?'])
        );
        console.log('[strategyStore] setSegmentBS input', {
          keys,
          distribution,
          sample: keys.length > 0 ? { [keys[0]]: (data as any)?.[keys[0]]?.[0] } : null,
        });

        // ★ 修正：csvFinanceData と同期
        set((s) => ({
          ...s,
          segmentBS: data,
          csvFinanceData: {
            ...(s.csvFinanceData || {}),
            segmentBS: data,
          },
          dirty: true,
        }));

        // ★ DEBUG：set直後の確認
        setTimeout(() => {
          const after = get().segmentBS;
          const afterKeys = Object.keys(after ?? {});
          const afterDist = Object.fromEntries(
            afterKeys.map((k) => [k, Array.isArray((after as any)?.[k]) ? (after as any)[k].length : '?'])
          );
          console.log('[strategyStore] setSegmentBS accepted', {
            keys: afterKeys,
            distribution: afterDist,
          });
        }, 0);

        setTimeout(() => get().recomputeValueAnalysis('setSegmentBS'), 0);
      },

      /** ★ セグメント単位マージ更新（必ずマージ） */
      upsertSegmentPL: (segName, rows) => {
        if (DEBUG) {
          console.log('[strategyStore] upsertSegmentPL', {
            segName,
            rowsLen: Array.isArray(rows) ? rows.length : 0,
            currentKeys: Object.keys((get().segmentPL || {}) as any),
          });
        }
        set((s) => {
          const current = (s.segmentPL || {}) as Record<string, FinancePLRow[]>;
          const updated = { ...current, [segName]: rows };
          // ★ 修正：csvFinanceData と同期
          return {
            ...s,
            segmentPL: updated,
            csvFinanceData: {
              ...(s.csvFinanceData || {}),
              segmentPL: updated,
            },
            dirty: true,
          };
        });
        setTimeout(() => get().recomputeValueAnalysis('setSegmentPL'), 0);
      },

      upsertSegmentBS: (segName, rows) => {
        if (DEBUG) {
          console.log('[strategyStore] upsertSegmentBS', {
            segName,
            rowsLen: Array.isArray(rows) ? rows.length : 0,
            currentKeys: Object.keys((get().segmentBS || {}) as any),
          });
        }
        set((s) => {
          const current = (s.segmentBS || {}) as Record<string, SegmentBSRow[]>;
          const updated = { ...current, [segName]: rows };
          // ★ 修正：csvFinanceData と同期
          return {
            ...s,
            segmentBS: updated,
            csvFinanceData: {
              ...(s.csvFinanceData || {}),
              segmentBS: updated,
            },
            dirty: true,
          };
        });
        setTimeout(() => get().recomputeValueAnalysis('setSegmentBS'), 0);
      },

      setBusinessSegmentsWithSync: (segments) => {
        const currentState = get();
        const newSegmentNames = new Set(segments.map((seg) => seg.name));

        let newSegmentPL = currentState.segmentPL ? { ...currentState.segmentPL } : {};
        let newSegmentBS = currentState.segmentBS ? { ...currentState.segmentBS } : {};

        for (const key of Object.keys(newSegmentPL)) {
          if (!newSegmentNames.has(key)) delete newSegmentPL[key];
        }
        for (const key of Object.keys(newSegmentBS)) {
          if (!newSegmentNames.has(key)) delete newSegmentBS[key];
        }

        for (const segName of newSegmentNames) {
          if (!(segName in newSegmentPL)) newSegmentPL[segName] = [];
          if (!(segName in newSegmentBS)) newSegmentBS[segName] = [];
        }

        // ★ 修正：csvFinanceData も同期
        const nextSegmentPL = Object.keys(newSegmentPL).length > 0 ? newSegmentPL : undefined;
        const nextSegmentBS = Object.keys(newSegmentBS).length > 0 ? newSegmentBS : undefined;

        set((s) => ({
          ...s,
          businessSegments: segments,
          segmentPL: nextSegmentPL,
          segmentBS: nextSegmentBS,
          csvFinanceData: {
            ...(s.csvFinanceData || {}),
            segmentPL: nextSegmentPL,
            segmentBS: nextSegmentBS,
          },
          dirty: true,
        }));

        setTimeout(() => get().recomputeValueAnalysis('setBusinessSegments'), 0);
      },

      /* ★ 年度CRUD（全社） */
      addFinanceYear: (year?: number) => {
        set((s) => {
          const { pl, bs } = addYearToFinanceRows(s.financePL ?? [], s.financeBS ?? [], year);
          return {
            ...s,
            financePL: pl,
            financeBS: bs,
            dirty: true,
          };
        });
        setTimeout(() => get().recomputeValueAnalysis('setFinancePL'), 0);
      },

      renameFinanceYear: (oldYear: number, newYear: number) => {
        const s = get();
        const { pl, bs } = renameYearInFinanceRows(s.financePL ?? [], s.financeBS ?? [], oldYear, newYear);
        if (pl === null || bs === null) {
          console.warn('[strategyStore] renameFinanceYear failed: duplicate year or oldYear not found', { oldYear, newYear });
          return false;
        }
        set((state) => ({
          ...state,
          financePL: pl,
          financeBS: bs,
          dirty: true,
        }));
        setTimeout(() => get().recomputeValueAnalysis('setFinancePL'), 0);
        return true;
      },

      removeFinanceYear: (year: number) => {
        set((s) => {
          const { pl, bs } = removeYearFromFinanceRows(s.financePL ?? [], s.financeBS ?? [], year);
          return {
            ...s,
            financePL: pl,
            financeBS: bs,
            dirty: true,
          };
        });
        setTimeout(() => get().recomputeValueAnalysis('setFinancePL'), 0);
      },

      updateFinancePLCell: (year, key, value) => {
        set((s) => {
          const rows = s.financePL ?? [];
          const idx = rows.findIndex((r) => r.year === year);
          if (idx < 0) {
            console.warn('[strategyStore] updateFinancePLCell: year not found', { year });
            return s;
          }
          const newRows = [...rows];
          newRows[idx] = { ...newRows[idx], [key]: value };
          return { ...s, financePL: newRows, dirty: true };
        });
        setTimeout(() => get().recomputeValueAnalysis('setFinancePL'), 0);
      },

      updateFinanceBSCell: (year, key, value) => {
        set((s) => {
          const rows = s.financeBS ?? [];
          const idx = rows.findIndex((r) => r.year === year);
          if (idx < 0) {
            console.warn('[strategyStore] updateFinanceBSCell: year not found', { year });
            return s;
          }
          const newRows = [...rows];
          newRows[idx] = { ...newRows[idx], [key]: value };
          return { ...s, financeBS: newRows, dirty: true };
        });
        setTimeout(() => get().recomputeValueAnalysis('setFinanceBS'), 0);
      },

      /* ★ 年度CRUD（事業部別） */
      addSegmentFinanceYear: (segmentName: string, year?: number) => {
        set((s) => {
          const segPL = (s.segmentPL ?? {})[segmentName] ?? [];
          const segBS = (s.segmentBS ?? {})[segmentName] ?? [];

          const newSegPL = addYearToSegmentRows(segPL, year);
          const newSegBS = addYearToSegmentRows(segBS, year);

          return {
            ...s,
            segmentPL: { ...(s.segmentPL ?? {}), [segmentName]: newSegPL },
            segmentBS: { ...(s.segmentBS ?? {}), [segmentName]: newSegBS },
            dirty: true,
          };
        });
        setTimeout(() => get().recomputeValueAnalysis('setSegmentPL'), 0);
      },

      renameSegmentFinanceYear: (segmentName: string, oldYear: number, newYear: number) => {
        const s = get();
        const segPL = (s.segmentPL ?? {})[segmentName] ?? [];
        const segBS = (s.segmentBS ?? {})[segmentName] ?? [];

        const newSegPL = renameYearInSegmentRows(segPL, oldYear, newYear);
        const newSegBS = renameYearInSegmentRows(segBS, oldYear, newYear);

        if (newSegPL === null || newSegBS === null) {
          console.warn('[strategyStore] renameSegmentFinanceYear failed: duplicate year or oldYear not found', {
            segmentName,
            oldYear,
            newYear,
          });
          return false;
        }

        set((state) => ({
          ...state,
          segmentPL: { ...(state.segmentPL ?? {}), [segmentName]: newSegPL },
          segmentBS: { ...(state.segmentBS ?? {}), [segmentName]: newSegBS },
          dirty: true,
        }));
        setTimeout(() => get().recomputeValueAnalysis('setSegmentPL'), 0);
        return true;
      },

      removeSegmentFinanceYear: (segmentName: string, year: number) => {
        set((s) => {
          const segPL = (s.segmentPL ?? {})[segmentName] ?? [];
          const segBS = (s.segmentBS ?? {})[segmentName] ?? [];

          const newSegPL = removeYearFromSegmentRows(segPL, year);
          const newSegBS = removeYearFromSegmentRows(segBS, year);

          return {
            ...s,
            segmentPL: { ...(s.segmentPL ?? {}), [segmentName]: newSegPL },
            segmentBS: { ...(s.segmentBS ?? {}), [segmentName]: newSegBS },
            dirty: true,
          };
        });
        setTimeout(() => get().recomputeValueAnalysis('setSegmentPL'), 0);
      },

      updateSegmentPLCell: (segmentName: string, year: number, key, value) => {
        set((s) => {
          const rows = (s.segmentPL ?? {})[segmentName] ?? [];
          const idx = rows.findIndex((r) => r.year === year);
          if (idx < 0) {
            console.warn('[strategyStore] updateSegmentPLCell: year not found', { segmentName, year });
            return s;
          }
          const newRows = [...rows];
          newRows[idx] = { ...newRows[idx], [key]: value };
          return {
            ...s,
            segmentPL: { ...(s.segmentPL ?? {}), [segmentName]: newRows },
            dirty: true,
          };
        });
        setTimeout(() => get().recomputeValueAnalysis('setSegmentPL'), 0);
      },

      updateSegmentBSCell: (segmentName: string, year: number, key, value) => {
        set((s) => {
          const rows = (s.segmentBS ?? {})[segmentName] ?? [];
          const idx = rows.findIndex((r) => r.year === year);
          if (idx < 0) {
            console.warn('[strategyStore] updateSegmentBSCell: year not found', { segmentName, year });
            return s;
          }
          const newRows = [...rows];
          newRows[idx] = { ...newRows[idx], [key]: value };
          return {
            ...s,
            segmentBS: { ...(s.segmentBS ?? {}), [segmentName]: newRows },
            dirty: true,
          };
        });
        setTimeout(() => get().recomputeValueAnalysis('setSegmentBS'), 0);
      },

      setMVV: (patch) =>
        set((s) => ({
          ...s,
          ...patch,
          dirty: true,
          version: (s.version ?? 0) + 1,
        })),
      setSWOT: (patch) => set((s) => ({ ...s, ...patch, dirty: true, version: (s.version ?? 0) + 1 })),

      setCeoIntent: (text: string) => {
        const trimmed = text.trim();
        if (DEBUG) {
          console.log('[strategyStore] setCeoIntent called', {
            len: trimmed.length,
            head: trimmed.slice(0, 30),
          });
        }
        set((s) => ({ ...s, ceoIntent: trimmed, dirty: true, version: (s.version ?? 0) + 1 }));
      },

      setSwotSuggestions: (suggestions) =>
        set((s) => ({ ...s, swotSuggestions: suggestions, dirty: true, version: (s.version ?? 0) + 1 })),

      addSwotOpportunity: (text: string) => {
        const trimmed = text.trim();
        if (!trimmed) return;
        set((s) => {
          const current = s.opportunity ? s.opportunity.split('\n').filter(Boolean) : [];
          if (!current.includes(trimmed)) {
            current.push(trimmed);
          }
          return { ...s, opportunity: current.join('\n'), dirty: true };
        });
      },

      addSwotThreat: (text: string) => {
        const trimmed = text.trim();
        if (!trimmed) return;
        set((s) => {
          const current = s.threat ? s.threat.split('\n').filter(Boolean) : [];
          if (!current.includes(trimmed)) {
            current.push(trimmed);
          }
          return { ...s, threat: current.join('\n'), dirty: true };
        });
      },

      removeSwotOpportunity: (textOrIndex) => {
        set((s) => {
          const current = s.opportunity ? s.opportunity.split('\n').filter(Boolean) : [];
          if (typeof textOrIndex === 'number') {
            current.splice(textOrIndex, 1);
          } else {
            const idx = current.indexOf(textOrIndex);
            if (idx >= 0) current.splice(idx, 1);
          }
          return { ...s, opportunity: current.join('\n'), dirty: true };
        });
      },

      removeSwotThreat: (textOrIndex) => {
        set((s) => {
          const current = s.threat ? s.threat.split('\n').filter(Boolean) : [];
          if (typeof textOrIndex === 'number') {
            current.splice(textOrIndex, 1);
          } else {
            const idx = current.indexOf(textOrIndex);
            if (idx >= 0) current.splice(idx, 1);
          }
          return { ...s, threat: current.join('\n'), dirty: true };
        });
      },

      // ▼ 部門セット後に即座に保存（※ ensureParentExists は呼ばない：二重保存を防ぐ）
      setDepartments: (deps) => {
        if (DEBUG) console.log('[strategyStore] setDepartments() called', deps);

        set((s) => ({
          departments: normalizeDepartmentsInput(deps, s.departments),
          dirty: true,
          version: (s.version ?? 0) + 1,
        }));

        (async () => {
          if (DEBUG) console.log('[strategyStore] setDepartments() immediate-save start');
          try {
            await get().saveStrategyData({ reason: 'setDepartments' });
            if (DEBUG) console.log('[strategyStore] setDepartments() immediate-save done');
          } catch (e) {
            console.warn('[strategyStore] setDepartments immediate save failed:', e);
          }
        })();
      },

      updateDepartments: (updater) => {
        if (DEBUG) console.log('[strategyStore] updateDepartments() called');

        set((s) => {
          const prev = Array.isArray(s.departments) ? s.departments : [];
          const next = updater([...prev]);
          return { departments: normalizeDepartmentsInput(next, prev), dirty: true, version: (s.version ?? 0) + 1 };
        });

        (async () => {
          if (DEBUG) console.log('[strategyStore] updateDepartments() immediate-save start');
          try {
            await get().saveStrategyData({ reason: 'updateDepartments' });
            if (DEBUG) console.log('[strategyStore] updateDepartments() immediate-save done');
          } catch (e) {
            console.warn('[strategyStore] updateDepartments immediate save failed:', e);
          }
        })();
      },

      setBusinessPortfolio: (p) => set((s) => ({ ...s, businessPortfolio: { ...p }, dirty: true, version: (s.version ?? 0) + 1 })),

      setFinanceSummary: (rows) => {
        set((s) => ({ ...s, financeSummary: rows, dirty: true, version: (s.version ?? 0) + 1 }));
        setTimeout(() => get().recomputeValueAnalysis('setFinanceSummary'), 0);
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

      async saveStrategyData(opts) {
        return enqueueSave(async () => {
          const reason = opts?.reason ?? 'manual';
          const force = opts?.force ?? false;
          const state0 = get();

          // ★ force: true のときは hydrating をスキップ（無反応を防ぐ）
          // force: false のときはガード
          if (!force && (state0.__isFetchingFromServer || state0.boot?.isHydrating)) {
            if (DEBUG) console.log('[strategyStore] saveStrategyData: skip while fetching/hydrating (not forced)');
            return { ok: false, skipped: true, reason: 'fetching_or_hydrating' };
          }

          /* ★ TASK 14-4: canSave ゲート（リロード直後の保存を禁止） */
          const canSave = state0.hydrated && state0.restoreReady && !state0.isRestoring;
          if (!force && !canSave) {
            // ★ CRITICAL: Enhanced logging for unhydrated saves (TASK 2)
            console.warn('[SAVE_BLOCKED] unhydrated/unrestored state - preventing data loss', {
              reason: 'restore_not_ready',
              hydrated: state0.hydrated,
              restoreReady: state0.restoreReady,
              isRestoring: state0.isRestoring,
              revision: state0.revision,
              hasData: {
                departments: Array.isArray(state0.departments) ? state0.departments.length : 0,
                story: Array.isArray(state0.story) ? state0.story.length : 0,
                mvv: !!state0.mission || !!state0.vision || !!state0.value,
              },
              timestamp: new Date().toISOString(),
            });
            if (DEBUG) {
              console.log('[strategyStore] saveStrategyData: canSave=false, skip (not forced)', {
                hydrated: state0.hydrated,
                restoreReady: state0.restoreReady,
                isRestoring: state0.isRestoring,
              });
            }
            return { ok: false, skipped: true, reason: 'restore_not_ready' };
          }

          const userId = useUserStore.getState().user?.id;
          const companyId = state0.companyId || state0.pendingCompanyId || useUserStore.getState().companyId;

          /* ★ TASK 14-6: 監査ログを記録（常に出力） */
          console.log('[audit][saveStrategyData] called', {
            reason,
            force,
            userId: userId?.substring(0, 8),
            companyId: companyId?.substring(0, 8),
            revision: state0.revision,
            dirty: state0.dirty,
            canSave,
            hydrated: state0.hydrated,
            restoreReady: state0.restoreReady,
            isRestoring: state0.isRestoring,
            hydrating: state0.boot?.isHydrating,
            fetching: state0.__isFetchingFromServer,
          });

          /* ★ TASK 3: Check revision requirement (TASK 3) */
          if (!force && (state0.revision === undefined || state0.revision === null)) {
            console.warn('[SAVE_BLOCKED] missing revision - likely first load incomplete', {
              reason: 'no_revision',
              revision: state0.revision,
              hydrated: state0.hydrated,
              restoreReady: state0.restoreReady,
              timestamp: new Date().toISOString(),
            });
            return { ok: false, skipped: true, reason: 'no_revision' };
          }

          if (DEBUG) {
            console.log('[strategyStore] saveStrategyData() start', {
              reason,
              force,
              userId,
              companyId,
              revision: state0.revision,
              dirty: state0.dirty,
              hydrating: state0.boot?.isHydrating,
              fetching: state0.__isFetchingFromServer,
              _loadingSave: state0._loadingSave,
            });
          }

          if (!userId || !companyId) {
            // ここは "黙って成功扱い" にしない
            console.warn('[strategyStore] saveStrategyData skipped: missing ids', { userId, companyId });
            return { ok: false, skipped: true, reason: 'missing_ids' };
          }

          // ★ force: true または manual のときは dirty をスキップ（手動保存は常に走る）
          const isManual = reason === 'manual';
          if (!force && !isManual && !state0.dirty) {
            if (DEBUG) console.log('[strategyStore] saveStrategyData: dirty=false, skip (not forced, not manual)');
            return { ok: false, skipped: true, reason: 'dirty_false' };
          }

          // ★ 止血対策：boot.isSaving で二重実行を防ぐ
          if (get().boot?.isSaving) {
            if (DEBUG) console.log('[strategyStore] saveStrategyData: already saving (boot.isSaving), skip');
            return { ok: false, skipped: true, reason: 'already_saving_boot' };
          }

          if (state0._loadingSave) {
            if (DEBUG) console.log('[strategyStore] saveStrategyData: already saving, skip (queued)');
            return { ok: false, skipped: true, reason: 'already_saving' };
          }

          // ★ 止血対策：保存開始（autosave 抑止開始）
          set({ _loadingSave: true, boot: { ...state0.boot, isSaving: true } });

          try {
            for (let attempt = 1; attempt <= 2; attempt++) {
              const state = get();
              const payload = buildSavePayload(state as StrategyState);

              // ★ 診断ログ：保存ペイロードに stage1Issues が含まれているか確認
              if (DEBUG) {
                console.log('[strategyStore] saveStrategyData payload check:', {
                  reason,
                  attempt,
                  state_stage1Issues_len: Array.isArray(state.stage1Issues) ? state.stage1Issues.length : 0,
                  payload_stage1Issues_len: Array.isArray((payload as any).stage1Issues) ? (payload as any).stage1Issues.length : 0,
                  payload_has_stage1Issues: 'stage1Issues' in payload,
                  payload_keys: Object.keys(payload).slice(0, 10),
                });

                // ★ TASK 13-2: ceoIntent diagnostics
                const ceoIntentLen = typeof (payload as any).ceoIntent === 'string' ? (payload as any).ceoIntent.length : 0;
                const ceoIntentHead = typeof (payload as any).ceoIntent === 'string' ? (payload as any).ceoIntent.slice(0, 30) : '';
                console.log('[strategyStore] saveStrategyData ceoIntent check:', {
                  state_ceoIntent_len: typeof state.ceoIntent === 'string' ? state.ceoIntent.length : 0,
                  payload_ceoIntent_len: ceoIntentLen,
                  payload_ceoIntent_head: ceoIntentHead,
                  payload_has_ceoIntent: 'ceoIntent' in payload,
                });

                // ★ STEP 0: answers12 diagnostics
                const answers12_len = Array.isArray((payload as any).answers12) ? (payload as any).answers12.length : 'not_array';
                console.log('[strategyStore] saveStrategyData answers12 check', {
                  state_answers12_len: Array.isArray(state.answers12) ? state.answers12.length : 'not_array',
                  payload_answers12_len: answers12_len,
                  payload_has_answers12: 'answers12' in (payload as any),
                  payload_answers12_first: answers12_len !== 'not_array' && (payload as any).answers12.length > 0 ? (payload as any).answers12[0] : null,
                });

                // ★ 診断：companyTargets / finalStory* が payload に入ってるか
                console.log('[diag][store:before_save]', {
                  companyTargetsLen: Array.isArray((state as any).companyTargets) ? (state as any).companyTargets.length : null,
                  payload_companyTargetsLen: Array.isArray((payload as any).companyTargets) ? (payload as any).companyTargets.length : null,
                  finalStoryDraftLen: Array.isArray((state as any).finalStoryDraft) ? (state as any).finalStoryDraft.length : null,
                  payload_finalStoryDraftLen: Array.isArray((payload as any).finalStoryDraft) ? (payload as any).finalStoryDraft.length : null,
                  finalStoryEditedLen: Array.isArray((state as any).finalStoryEdited) ? (state as any).finalStoryEdited.length : null,
                  payload_finalStoryEditedLen: Array.isArray((payload as any).finalStoryEdited) ? (payload as any).finalStoryEdited.length : null,
                  finalStoryFinalLen: Array.isArray((state as any).finalStoryFinal) ? (state as any).finalStoryFinal.length : null,
                  payload_finalStoryFinalLen: Array.isArray((payload as any).finalStoryFinal) ? (payload as any).finalStoryFinal.length : null,
                });
              }

              // ★ TASK A: 保存時に departments の okrs/kpis を必ずログ出力
              const deptDiag = (Array.isArray((payload as any).departments) ? (payload as any).departments : []).map((d: any) => ({
                name: d?.name,
                proj: (Array.isArray(d?.projects) ? d.projects : []).map((p: any) => ({
                  title: p?.title,
                  okrs: Array.isArray(p?.okrs) ? p.okrs.length : 0,
                  kpis: Array.isArray(p?.kpis) ? p.kpis.length : 0,
                  okrsV2: Array.isArray(p?.okrsV2) ? p.okrsV2.length : 0,
                })),
              }));
              console.log('[diag][save:payload:departments]', deptDiag);

              if (isEffectivelyEmpty(payload)) {
                if (DEBUG) console.log('[strategyStore] saveStrategyData: payload effectively empty, clear dirty');
                set({ dirty: false });
                return { ok: false, skipped: true, reason: 'payload_empty' };
              }

              // ★ TASK B: Diagnostic log for answers12 in hash material
              if (DEBUG) console.log('[hash:material] answers12', {
                has: 'answers12' in (payload as any),
                len: Array.isArray((payload as any).answers12) ? (payload as any).answers12.length : 'not_array',
                first: Array.isArray((payload as any).answers12) ? (payload as any).answers12[0] : null,
              });

              const currentHash = stableHash(payload);

              // ★ TASK A: manual saves bypass same hash skip（手動保存は常にDBに書く）
              if (!force && !isManual && state.__lastSavedHash && state.__lastSavedHash === currentHash) {
                if (DEBUG) console.log('[strategyStore] saveStrategyData: same hash, skip (not forced, not manual)');
                set({ dirty: false });
                return { ok: false, skipped: true, reason: 'same_hash' };
              }

              // manual のときは同一hashでも続行ログ
              if (isManual && state.__lastSavedHash && state.__lastSavedHash === currentHash) {
                if (DEBUG) console.log('[strategyStore] saveStrategyData: same hash BUT manual => continue (forced write)');
              }

              const res = await (async () => {
                try {
                  return await saveWithAudit(payload, userId, companyId, state.revision, { mode: 'upsert' }, `store:saveStrategyData:${reason}`);
                } catch (e) {
                  console.warn('[strategyStore] saveWithAudit thrown, fallback legacy call:', e);
                  try {
                    return await saveWithAudit(payload, userId, companyId, undefined, {}, `store:saveStrategyData:${reason}:fallback`);
                  } catch (e2) {
                    console.error('[strategyStore] saveWithAudit legacy call failed:', e2);
                    return { error: e2 };
                  }
                }
              })();

              // ★ DEBUG STAGE1: After Supabase save returns
              if (process.env.NEXT_PUBLIC_DEBUG_STAGE1) {
                console.log('[DEBUG_STAGE1] AFTER Supabase save:', {
                  success: !!(res && !(res as any).error),
                  payloadIsListed: (payload as any).isListed,
                  payloadTicker: (payload as any).ticker,
                  payloadPbrManual: (payload as any).pbrManual,
                  payloadStage1Benchmarks: (payload as any).stage1Benchmarks ? {
                    keys: Object.keys((payload as any).stage1Benchmarks),
                    waccManual: (payload as any).stage1Benchmarks.waccManual,
                    waccRationale: (payload as any).stage1Benchmarks.waccRationale ? '(present)' : undefined,
                  } : undefined,
                });
              }

              if (!res || (res as any).error) {
                const err = (res as any)?.error;
                const errCode = (res as any)?.errorCode || (err as any)?.code;

                if (errCode === 'REVISION_CONFLICT') {
                  console.warn(`[strategyStore] ⚠ REVISION_CONFLICT (attempt ${attempt}/2). Refetching latest...`);

                  try {
                    await get().refetchFromServer();
                  } catch (refetchErr) {
                    console.error('[strategyStore] refetch after conflict failed:', refetchErr);
                    set({ saveError: 'リビジョン競合により保存に失敗しました。再読み込みしてください。' });
                    return { ok: false, reason: 'refetch_failed_after_conflict', error: refetchErr, code: 'REFETCH_FAILED' };
                  }

                  if (attempt >= 2) {
                    console.warn('[strategyStore] REVISION_CONFLICT persists after retry. Keeping dirty state.');
                    set({ saveError: 'リビジョン競合により保存に失敗しました。再試行してください。' });
                    return { ok: false, reason: 'revision_conflict_persist', error: err, code: 'REVISION_CONFLICT' };
                  }

                  continue;
                }

                console.error('[strategyStore] saveStrategyData API error:', err ?? 'unknown error');
                set({ saveError: `保存に失敗しました: ${(err as any)?.message || '不明なエラー'}` });
                return { ok: false, reason: 'api_error', error: err, code: errCode };
              }

              const serverData = (res as any).data ?? {};
              const minimal = extractServerDecidedPatch(serverData, get() as StrategyState);

              const updatedAt =
                (serverData as any)?.updatedAt ??
                (serverData as any)?.updated_at ??
                (res as any)?.updatedAt ??
                new Date().toISOString();

              // ★ 根治対策：保存返却では「サーバー決定値のみ」を state に反映
              // 禁止：departments/projects/okrs/kpis/finalStory*/companyTargets/answers12など
              // 許可：revision/updatedAt/id/strategyId のみ（autosave再発火を防ぐ）
              const safePatch: Partial<StrategyState> = {
                dirty: false,
                __lastSavedHash: currentHash,
                revision: typeof (minimal as any).revision === 'number' ? (minimal as any).revision : undefined,
                /* UI state: 保存成功時に更新 */
                saveError: undefined,
                lastSavedAt: Date.now(),
              };
              if (updatedAt) (safePatch as any).updatedAt = updatedAt;

              // ★ TASK 1: Extract strategyId from saved data if returned
              const returnedStrategyId = (serverData as any)?.strategyId ?? (serverData as any)?.id ?? (minimal as any)?.strategyId;
              if (returnedStrategyId && typeof returnedStrategyId === 'string') {
                (safePatch as any).strategyId = returnedStrategyId;
                if (DEBUG) console.log('[strategyStore] strategyId set from save result:', {
                  strategyId: returnedStrategyId.substring(0, 8),
                });
              }

              set(safePatch);

              const nextRev =
                typeof (minimal as any).revision === 'number'
                  ? (minimal as any).revision
                  : typeof (get().revision) === 'number'
                    ? get().revision
                    : undefined;

              /* ★ TASK 14-6: 成功時の監査ログ（payload サイズ情報を記録） */
              console.log('[audit][saveStrategyData] success', {
                reason,
                revision: nextRev,
                payload_size: Object.keys(payload).length,
                departments_len: Array.isArray((payload as any).departments) ? (payload as any).departments.length : 0,
                story_len: Array.isArray((payload as any).story) ? (payload as any).story.length : 0,
                finalStory_len: Array.isArray((payload as any).finalStory) ? (payload as any).finalStory.length : 0,
                answers2_len: Array.isArray((payload as any).answers2) ? (payload as any).answers2.length : 0,
                stage1Issues_len: Array.isArray((payload as any).stage1Issues) ? (payload as any).stage1Issues.length : 0,
                winPatterns_len: Array.isArray((payload as any).winPatterns) ? (payload as any).winPatterns.length : 0,
              });

              if (DEBUG) console.log('[strategyStore] saveStrategyData success', { reason, revision: nextRev, updatedAt });

              return { ok: true, revision: nextRev, updatedAt };
            }

            // ループを抜けることは基本ないが保険
            return { ok: false, reason: 'unknown_exit' };
          } finally {
            // ★ 根治対策：finally で確実に isSaving を戻す（例外時も実行）
            set((s) => ({
              ...s,
              _loadingSave: false,
              boot: { ...(s.boot ?? {}), isSaving: false }
            }));
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
            /* ★ TASK 14: restore フラグをクリア（認証失敗は回復不可） */
            isRestoring: false,
            restoreReady: false,
          }));
          scheduleRefetchRetry(1500);
          throw new Error('会社IDまたは認証情報が見つかりません');
        }

        if (get()._loadingRefetch) return;
        /* ★ TASK 14: restore フラグを開始（DB restore 中を示す） */
        set({ _loadingRefetch: true, __isFetchingFromServer: true, isRestoring: true });
        set((s) => ({ ...s, boot: { ...s.boot, isHydrating: true } }));

        try {
          if (DEBUG) {
            console.log('[strategyStore] 🔍 getFullStrategyDataByCompany 呼び出し前', {
              companyId,
              _loadingRefetch: get()._loadingRefetch,
            });
          }

          const { data, error } = await getFullStrategyDataByCompany(companyId);
          let dbRow = data;

          if (error) {
            console.error('[strategyStore] ❌ getFullStrategyDataByCompany エラー', {
              code: (error as any)?.code,
              status: (error as any)?.status,
              message: (error as any)?.message,
              details: (error as any)?.details,
            });
          } else if (data) {
            if (DEBUG) {
              const csvFd = (data as any)?.csv_finance_data;
              const dbRevision = typeof (data as any)?.revision === 'number' ? (data as any).revision : 0;
              const hasFinancePL = Array.isArray((data as any)?.finance_pl) && (data as any).finance_pl.length > 0;
              const hasCsvFinanceData = !!csvFd && typeof csvFd === 'object';
              const csvFdFinanceBSLen = Array.isArray(csvFd?.financeBS) ? csvFd.financeBS.length : 0;
              const csvFdSegmentPLKeys = Object.keys(csvFd?.segmentPL || {}).length;
              const stage1IssuesLen = Array.isArray((data as any)?.stage1_issues) ? (data as any).stage1_issues.length : 0;

              console.log(
                '[getFullStrategyDataByCompany] revision:' +
                  dbRevision +
                  ' hasFinancePL:' +
                  hasFinancePL +
                  ' hasCsvFinanceData:' +
                  hasCsvFinanceData +
                  ' financeBS_len:' +
                  csvFdFinanceBSLen +
                  ' segmentPL_keys:' +
                  csvFdSegmentPLKeys +
                  ' stage1Issues_len:' +
                  stage1IssuesLen
              );
            }
          } else {
            console.warn('[strategyStore] ⚠️ getFullStrategyDataByCompany: data と error 両方 null/undefined');
          }

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
              __lastServerError: isTransientError ? undefined : error,
              /* ★ TASK 14: restore フラグをクリア（エラーは回復待ち） */
              isRestoring: false,
              restoreReady: false,
            }));

            if (isTransientError) scheduleRefetchRetry(2000);
            const errMsg = (error as any)?.message || (error as any)?.code || 'データ取得に失敗しました';
            throw new Error(errMsg);
          }

          if (!dbRow) {
            // 初回の可能性：DBに strategy_data 行が無い
            // → 初期行を作ってから再取得する（画面は落とさない）
            try {
              const base = get();
              await saveStrategyDataApi(base as any);

              const retry = await getFullStrategyDataByCompany(companyId);
              dbRow = retry?.data ?? null;

              if (!dbRow) {
                const err = new Error('データ初期化後も取得できません（RLS/会社ID/デプロイ反映を確認）');
                set(() => ({ __lastServerError: err }));
                throw err;
              }
            } catch (e) {
              const err = e instanceof Error ? e : new Error(String(e));
              set(() => ({ __lastServerError: err }));
              throw err;
            }
          }

          /* ★ TASK 15-A: フル置換（normalizeFromDbRow の二重変換廃止）
             dbRow は getFullStrategyDataByCompany から返ってきた buildStateFromDbRow 済みの state
             → STAGE2 フィールド損失を防ぐため、normalizeFromDbRow を呼ばずに直接使用 */
          const patch = dbRow as Partial<StrategyState>;

          if (DEBUG) {
            /* ★ TASK 15-C: STAGE2 フィールド確認ログを追加 */
            console.log('[strategyStore refetch] 📦 full state from DB', {
              /* STAGE1 */
              financeBS_len: Array.isArray((patch as any).financeBS) ? (patch as any).financeBS.length : 0,
              segmentBS_keys: Object.keys((patch as any).segmentBS || {}).length,
              segmentPL_keys: Object.keys((patch as any).segmentPL || {}).length,
              csvFinanceData_exists: !!(patch as any).csvFinanceData,
              financePL_len: Array.isArray((patch as any).financePL) ? (patch as any).financePL.length : 0,
              stage1Issues_len: Array.isArray((patch as any).stage1Issues) ? (patch as any).stage1Issues.length : 0,
              /* STAGE2 */
              story_len: Array.isArray((patch as any).story) ? (patch as any).story.length : 0,
              finalStory_len: Array.isArray((patch as any).finalStory) ? (patch as any).finalStory.length : 0,
              storyDraft_len: Array.isArray((patch as any).storyDraft) ? (patch as any).storyDraft.length : 0,
              answers2_len: Array.isArray((patch as any).answers2) ? (patch as any).answers2.length : 0,
              answers12_len: Array.isArray((patch as any).answers12) ? (patch as any).answers12.length : 0,
              winPatterns_len: Array.isArray((patch as any).winPatterns) ? (patch as any).winPatterns.length : 0,
              winPatternsCandidate_len: Array.isArray((patch as any).winPatternsCandidate) ? (patch as any).winPatternsCandidate.length : 0,
              ceoIntent_len: typeof (patch as any).ceoIntent === 'string' ? (patch as any).ceoIntent.length : 0,
              swotSuggestions_exists: !!(patch as any).swotSuggestions,
            });
          }

          const cur = get();
          const isSwitchingCompany = cur.pendingCompanyId !== undefined && cur.pendingCompanyId !== cur.companyId;
          const wasDirty = cur.dirty && !isSwitchingCompany;

          const curRev = typeof cur.revision === 'number' ? cur.revision : undefined;
          const patchRev = typeof patch.revision === 'number' ? patch.revision : undefined;
          const isStale = typeof patchRev === 'number' && typeof curRev === 'number' && patchRev < curRev;

          if (wasDirty) {
            set((s) => {
              const base = s as StrategyState;
              const minimal = extractServerDecidedPatch(patch as any, base);
              return {
                ...base,
                ...minimal,
                companyId: s.pendingCompanyId ?? s.companyId,
                pendingCompanyId: undefined,
                // DB に無い値は既存の persist 値を保持
                stage1Benchmarks: (minimal as any).stage1Benchmarks ?? (base as any).stage1Benchmarks,
                stage1Issues: (minimal as any).stage1Issues ?? (base as any).stage1Issues,
                /* ★ TASK 3: STAGE2 フィールドを保護（空配列での上書き防止） */
                answers12: (minimal as any).answers12 ?? (base as any).answers12,
                winPatternsCandidate: (minimal as any).winPatternsCandidate ?? (base as any).winPatternsCandidate,
              };
            });

            const after = get();
            const rev = typeof patch.revision === 'number' ? patch.revision : after.revision ?? 0;

            set({ loaded: true });
            get().setHydrated(rev);
            /* ★ TASK 14: restore 完了フラグを設定（DB restore 完了） */
            set({ restoreReady: true, isRestoring: false });

            /* ★ TASK 15-C: restore 完了後の state を監査ログ出力（STAGE2 反映確認） */
            if (DEBUG || process.env.NEXT_PUBLIC_DEBUG_HYDRATE === '1') {
              const finalState = get();
              console.log('[audit][restore:stage2_check] wasDirty=true branch', {
                ceoIntent_len: typeof finalState.ceoIntent === 'string' ? finalState.ceoIntent.length : 0,
                storyDraft_len: Array.isArray(finalState.storyDraft) ? finalState.storyDraft.length : 0,
                answers12_len: Array.isArray((finalState as any).answers12) ? (finalState as any).answers12.length : 0,
                winPatternsCandidate_len: Array.isArray((finalState as any).winPatternsCandidate) ? (finalState as any).winPatternsCandidate.length : 0,
                finalStory_len: Array.isArray(finalState.finalStory) ? finalState.finalStory.length : 0,
              });
            }
          } else {
            set((s) => {
              const base = s as StrategyState;

              const localDeps = normalizeDepartmentsInput(base.departments, []);
              const serverDeps = normalizeDepartmentsInput((patch as any).departments, []);

              let nextDepartments: Department[] = serverDeps;

              if (!isSwitchingCompany) {
                if (isStale) nextDepartments = localDeps;
              } else {
                nextDepartments = serverDeps;
              }

              const merged: any = {
                ...(base as any),
                ...(patch as any),
                companyId: s.pendingCompanyId ?? s.companyId,
                pendingCompanyId: undefined,
                // DB に無い値は既存の persist 値を保持
                stage1Benchmarks: (patch as any).stage1Benchmarks ?? (base as any).stage1Benchmarks,
                stage1Issues: (patch as any).stage1Issues ?? (base as any).stage1Issues,
                /* ★ TASK 3: STAGE2 フィールドを保護（空配列での上書き防止） */
                answers12: (patch as any).answers12 ?? (base as any).answers12,
                winPatternsCandidate: (patch as any).winPatternsCandidate ?? (base as any).winPatternsCandidate,
              };

              merged.departments = nextDepartments;
              return merged as StrategyState;
            });

            const after = get();
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
              /* ★ TASK 14: restore 完了フラグを設定（DB restore 完了） */
              restoreReady: true,
              isRestoring: false,
            });

            get().setHydrated(rev, hash);

            /* ★ TASK 15-C: restore 完了後の state を監査ログ出力（STAGE2 反映確認） */
            if (DEBUG || process.env.NEXT_PUBLIC_DEBUG_HYDRATE === '1') {
              const finalState = get();
              console.log('[audit][restore:stage2_check] wasDirty=false branch', {
                ceoIntent_len: typeof finalState.ceoIntent === 'string' ? finalState.ceoIntent.length : 0,
                storyDraft_len: Array.isArray(finalState.storyDraft) ? finalState.storyDraft.length : 0,
                answers12_len: Array.isArray((finalState as any).answers12) ? (finalState as any).answers12.length : 0,
                winPatternsCandidate_len: Array.isArray((finalState as any).winPatternsCandidate) ? (finalState as any).winPatternsCandidate.length : 0,
                finalStory_len: Array.isArray(finalState.finalStory) ? finalState.finalStory.length : 0,
              });
            }

            setTimeout(() => {
              get().recomputeValueAnalysis('refetchFromServer');
            }, 0);
          }
        } finally {
          /* ★ TASK 14: 万が一例外が出た場合でも isRestoring をリセット */
          set({ _loadingRefetch: false, __isFetchingFromServer: false, isRestoring: false });
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

        const { businessSegments, financePL, financeBS, segmentPL, segmentBS, pbrManual, stage1Issues } = stage1DummyDataBundle;

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

        setTimeout(() => {
          get().recomputeValueAnalysis('local');
          if (DEBUG) console.log('[strategyStore] loadStage1DummyData() recompute done');
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

      /** STAGE2 スナップショットを localStorage に保存 */
      saveStage2Snapshot: () => {
        const s = get();
        const state: Stage2State = {
          ceoIntent: s.ceoIntent,
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
          storyDraft:
            s.storyDraft ??
            (s.story?.length ? s.story.map((ch) => ({ title: ch.title, body: ch.body })) : undefined),
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
          dirty: true,
        }));

        if (DEBUG) {
          console.log('[strategyStore] restoreStage1FromSnapshot: restored', {
            issueBlocksCount: snapshot.issueBlocks.length,
          });
        }

        return true;
      },

      /** MetricsSummary を取得（valueAnalysis から生成） */
      getMetricsSummary: () => {
        const s = get();
        return valueAnalysisToMetricsSummary(s.valueAnalysis, s.valueAnalysis?.overallNote);
      },
    }),
    {
      /* ★ TASK 14-3: persist ストレージキーをバージョンアップ（v4 → v5）旧 localStorage を無視 */
      name: 'strategy-store-v5',
      version: 37,
      partialize: (s) => ({
        companyId: s.companyId,
        strategyId: s.strategyId,
        pendingCompanyId: s.pendingCompanyId,

        story: s.story,
        finalStory: s.finalStory,
        finalStoryDraft: (s as any).finalStoryDraft, // ✅ 追加：最終ストーリー ドラフト版（3段階編集用）
        finalStoryEdited: (s as any).finalStoryEdited, // ✅ 追加：最終ストーリー 編集版（3段階編集用）
        finalStoryFinal: (s as any).finalStoryFinal, // ✅ 追加：最終ストーリー 確定版（3段階編集用）
        ceoIntent: s.ceoIntent, // ✅ 追加：経営者の思いを persist 対象に含める
        storyDraft: s.storyDraft, // ✅ 追加：STAGE2 ドラフトストーリーを persist 対象に
        answers2: s.answers2,
        answers12: (s as any).answers12, // ✅ 追加：STAGE2 12問回答を persist 対象に
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
        stage1Benchmarks: (s as any).stage1Benchmarks,

        mission: s.mission,
        vision: s.vision,
        value: s.value,
        thought: s.thought,
        strength: s.strength,
        weakness: s.weakness,
        opportunity: s.opportunity,
        threat: s.threat,

        winPatternsCandidate: (s as any).winPatternsCandidate, // ✅ 追加：STAGE2 勝ち筋候補を persist 対象に
        companyTargets: (s as any).companyTargets, // ✅ 追加：North Star メトリクスを persist 対象に
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
        /* ★ TASK 14: restore フラグをリセット（migrate 時は復旧待ち） */
        restoreReady: false,
        isRestoring: true,
      }),
      storage: createJSONStorage(() => localStorage),
      onRehydrateStorage: () => (state, error) => {
        if (error) console.warn('rehydration error:', error);
        /* ★ TASK 14: persist rehydrate 完了を通知（hydrated=true） */
        if (!error) {
          state?.setHydrated(true);
        }
      },
    }
  )
);

export async function refetchFromServer() {
  return useStrategyStore.getState().refetchFromServer();
}
