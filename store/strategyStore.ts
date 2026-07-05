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
  MidtermStrategy,
  StrategicCore,
  Stage2FinalDocumentEdits,
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


function isStage4OkrRouteRuntime(): boolean {
  try {
    if (typeof window === 'undefined') return false;
    const path = window.location?.pathname ?? '';
    return path === '/okr' || path.startsWith('/okr/');
  } catch {
    return false;
  }
}

function shouldBlockStage4DepartmentsImmediateSave(reason: string): boolean {
  return isStage4OkrRouteRuntime() && (reason === 'setDepartments' || reason === 'updateDepartments');
}

// ★ FIX: jsonEq を定義（setDepartments / updateDepartments で使用）
function jsonEq(a: any, b: any): boolean {
  return JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
}

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

  /* ★ STAGE2：中計設計（全社戦略の中計対応・任意） */
  midtermStrategy?: MidtermStrategy;

  /* ★ STAGE2：最終ストーリー補助セクション編集データ（表示上書き用） */
  stage2FinalDocumentEdits?: Stage2FinalDocumentEdits;

  /* ★ STAGE3：STAGE2からの戦略展開ブリッジ */
  stage3_strategy_bridge?: {
    keyThemes: string[];
    departmentIssues: string[];
    kpiCriteria: string[];
    commonBehaviorChanges: string[];
    strategicCore?: StrategicCore;
    departmentTranslationRules?: string[];
    generatedAt: string;
  } | null;

  /* === STAGE6 Phase E：プロジェクト→North Star影響量（手入力） === */
  projectTargetImpacts?: ProjectTargetImpact[];

  /* === STAGE5/6：OKR→進捗インパクトスコア（0-5） === */
  okrTargetScores?: Record<string, number>; // okrId -> score

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

  /* ★ TASK 1: Conflict recovery tracking */
  lastLocalEditAt?: number; // Timestamp of last local edit
  pendingConflictRecovery?: boolean; // Currently in conflict recovery flow
  lastSaveAttemptRevision?: number; // Revision we tried to save
  lastConflictInfo?: {
    // Details of last conflict
    expectedRevision: number | undefined;
    currentRevision: number | undefined;
    occurredAt: number;
    attempt: number;
  };
  conflictCooldownUntil?: number; // Timestamp when conflict cooldown expires
  lastServerSyncAt?: number; // Track when server sync completed

  /** サーバ楽観ロック用 */
  revision?: number;

  /** ローカル更新カウンタ（dirty 検出用） */
  version?: number;

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

  /* ★ pending 再保存機構 */
  _pendingSave?: boolean;
  _pendingSaveReason?: string;

  /** 直近保存のペイロードハッシュ（無駄保存抑止） */
  __lastSavedHash?: string;

  /* Actions */
  reset: () => void;
  resetAll: () => void;

  setHydrated: (revOrBool?: boolean | number, hash?: string | undefined) => void;
  setHydrating: (b: boolean) => void;
  setHydratingFlag: (isHydrating: boolean, reason: string) => void;
  setServerSnapshotHash: (hash?: string) => void;

  setRevision: (rev?: number) => void;
  setStrategyId: (id: string | null) => void;
  hydrateFromFullState: (fullState: Partial<StrategyData> & { revision?: number }) => void;
  setCompanyScope: (id: string | null) => void;

  setStory: (chs: ChapterStory[]) => void;
  setFinalStory: (chs: ChapterStory[]) => void;
  setMidtermStrategy: (m: MidtermStrategy | undefined) => void;
  setStage2FinalDocumentEdits: (edits: Stage2FinalDocumentEdits | undefined) => void;
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

  /* === STAGE5/6：OKR進捗インパクトスコア === */
  setOKRTargetScore: (okrId: string, score: number) => void;
  getOKRTargetScore: (okrId: string) => number;

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

/** ★ 再発防止：版+ダーティの一括適用ヘルパ */
function bump(s: any) {
  return { dirty: true, version: (s.version ?? 0) + 1 };
}

/** 保存用ペイロード組み立て（StrategyData相当） */
function buildSavePayload(s: StrategyState) {
  // okrsV2 サニタイズ（空labelを除外）
  const sanitizeOkrsV2 = (list: any[]) =>
    (Array.isArray(list) ? list : []).filter(kr =>
      typeof kr?.label === 'string' && kr.label.trim() !== ''
    );

  // ★ CRITICAL EMERGENCY FIX: Department ID 暫定復元（STAGE5 保存失敗対策）
  // departments を保存や store 反映に使う前に、department.id を補完する
  // 優先順位: d.id > d.departmentId > `dept_${idx}`
  const normalizedDepts = (Array.isArray(s.departments) ? s.departments : []).map((d: any, dIdx: number) => ({
    ...d,
    id: d?.id ?? d?.departmentId ?? `dept_${dIdx}`,
    projects: (Array.isArray(d?.projects) ? d.projects : []).map((p: any, pIdx: number) => ({
      ...p,
      id: p?.id ?? p?.projectId ?? `proj_${dIdx}_${pIdx}`,
    })),
  }));

  // ★ 診断ログ：ID 補完後の departments 状態確認
  if (process.env.NEXT_PUBLIC_DEBUG_CASCADE === '1' || process.env.NEXT_PUBLIC_DEBUG_HYDRATE === '1') {
    const deptIdStatus = normalizedDepts.map((d: any, idx: number) => ({
      index: idx,
      name: d?.name ?? '[no-name]',
      deptId_before: (s.departments?.[idx] as any)?.id,
      deptId_after: d?.id,
      hasDepartmentIdField: !!(s.departments?.[idx] as any)?.departmentId,
      projectCount: Array.isArray(d?.projects) ? d.projects.length : 0,
      projectIds: d?.projects?.map((p: any) => ({ title: p?.title, id: p?.id })) ?? [],
    }));
    console.log('[diag][buildSavePayload] department id normalization', {
      timestamp: new Date().toISOString(),
      normalizedCount: deptIdStatus.length,
      departments: deptIdStatus,
    });
  }

  // departments をサニタイズ
  // ★ Phase 1: { ...p } で ownerUserId / ownerName を保存ペイロードに含める
  // ★ NOTE: normalizedDepts から id を引き継ぐ
  const sanitizedDepts = normalizedDepts.map((d: any) => {
    const result: any = {
      ...d,
      id: d?.id, // ★ normalized id を使用（必ず値がある）
      projects: (Array.isArray(d.projects) ? d.projects : []).map((p: any) => ({
        ...p,
        id: p?.id, // ★ normalized project id を使用（必ず値がある）
        okrsV2: sanitizeOkrsV2(p.okrsV2),
      })),
    };
    return result;
  });

  const base: any = {
    strategyId: s.strategyId ?? undefined,
    story: s.story,
    finalStory: s.finalStory,
    answers2: s.answers2,
    departments: sanitizedDepts,

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

    // ★ STAGE2 中計設計（swot_suggestions 内へのパックは buildDbRowFromState が行う）
    midtermStrategy: s.midtermStrategy,

    // ★ 追加：companyTargets / finalStory 3-state（北星・最終ストーリー編集用）
    companyTargets: (s as any).companyTargets,
    finalStoryDraft: (s as any).finalStoryDraft,
    finalStoryEdited: (s as any).finalStoryEdited,
    finalStoryFinal: (s as any).finalStoryFinal,

    // === STAGE6 Phase E データ (J-1: Sanitize before save) ===
    projectTargetImpacts: sanitizeProjectTargetImpacts((s as any).projectTargetImpacts),
    okrTargetScores: (s as any).okrTargetScores ?? {},
    projectIssueLinks: sanitizeProjectIssueLinks((s as any).projectIssueLinks),

    winPatterns: s.winPatterns,
    winPatternPrimary: s.winPatternPrimary,
    winPatternSecondary: s.winPatternSecondary,

    stage4Plans: s.stage4Plans,
    executionPlanBaseline: s.executionPlanBaseline,

    // STAGE3 strategy bridge
    stage3_strategy_bridge: (s as any).stage3_strategy_bridge,
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

    // ★ DEBUG: missionDescription のペイロード確認
    const dept0 = Array.isArray(base.departments) ? base.departments[0] : null;

    // ★ 修正：swotSuggestions をログに追加（保存時の確認用）
    const swotSuggestionsOpp = Array.isArray(base.swotSuggestions?.opportunity) ? base.swotSuggestions.opportunity.length : 0;
    const swotSuggestionsThr = Array.isArray(base.swotSuggestions?.threat) ? base.swotSuggestions.threat.length : 0;

    // STAGE3 strategy bridge check
    const stage3BridgeIncluded = !!(base as any).stage3_strategy_bridge;
    const stage3BridgeKeys = stage3BridgeIncluded ? Object.keys((base as any).stage3_strategy_bridge) : [];
    const stage3BridgeKeyThemesLen = Array.isArray((base as any).stage3_strategy_bridge?.keyThemes) ? (base as any).stage3_strategy_bridge.keyThemes.length : 0;

    if (DEBUG) console.log('[buildSavePayload] ★ payload内容確認', {
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
      // ★ 修正3: STAGE4データをpayloadで確認
      stage4Plans_included: base.stage4Plans ? base.stage4Plans.length : 'undefined',
      executionPlanBaseline_included: base.executionPlanBaseline ? 'exists' : 'undefined',
      // ★ 修正：swotSuggestions をログに追加
      swotSuggestions_included: !!base.swotSuggestions,
      swotSuggestions_opp_len: swotSuggestionsOpp,
      swotSuggestions_thr_len: swotSuggestionsThr,
      // STAGE3 bridge log
      stage3_strategy_bridge_included: stage3BridgeIncluded,
      stage3_strategy_bridge_keys: stage3BridgeKeys,
      stage3_strategy_bridge_keyThemesLen: stage3BridgeKeyThemesLen,
      // ★ DEBUG LOG B: save直前のpayload確認
      dept0_keys: Object.keys(dept0 ?? {}),
      dept0_name: dept0?.name,
      dept0_mission: dept0?.mission,
      dept0_missionDescription: dept0?.missionDescription,
    });

    // ★ DIAG: 削除操作が反映されているか確認（10回に1回のみ出力・verbose log削減）
    if (Math.random() < 0.1) {
      console.log('[diag][delete:save:payload]', {
        departmentsCount: sanitizedDepts.length,
        departmentNames: sanitizedDepts.map((d: any) => d.name),
        stage4PlansCount: base.stage4Plans ? base.stage4Plans.length : 0,
        departmentProjectCounts: sanitizedDepts.map((d: any) => ({
          name: d.name,
          projectCount: (d.projects || []).length,
        })),
        timestamp: new Date().toISOString(),
      });
    }

    // ★ TASK: 監査地点3「saveStrategyData に渡す直前（buildSavePayload返却時）」
    const { summarizeDepartmentProjects, countTotalProjects } = require('@/utils/supabase/strategy');
    const auditSummary = summarizeDepartmentProjects(sanitizedDepts);
    const totalProjects = countTotalProjects(sanitizedDepts);
    console.log('[diag][departments-projects]', {
      point: 'before-save',
      strategyId: s.strategyId,
      timestamp: new Date().toISOString(),
      departmentCount: sanitizedDepts.length,
      totalProjectsCount: totalProjects,
      departments: auditSummary,
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
  if (resData.stage2FinalDocumentEdits && typeof resData.stage2FinalDocumentEdits === 'object') patch.stage2FinalDocumentEdits = resData.stage2FinalDocumentEdits;
  if (Array.isArray(resData.answers2)) patch.answers2 = resData.answers2;

  if (Array.isArray(resData.winPatternsCandidate)) patch.winPatternsCandidate = resData.winPatternsCandidate;
  if (Array.isArray(resData.answers12)) patch.answers12 = resData.answers12;

  /* ========== STAGE3: 部門・戦略方針・ブリッジ ========== */
  if (Array.isArray(resData.departments)) patch.departments = resData.departments;

  if (typeof resData.thought === 'string') patch.thought = resData.thought;
  if (typeof resData.mission === 'string') patch.mission = resData.mission;
  if (typeof resData.vision === 'string') patch.vision = resData.vision;
  if (typeof resData.value === 'string') patch.value = resData.value;
  if (typeof resData.ceoIntent === 'string') patch.ceoIntent = resData.ceoIntent;

  if (resData.swotSuggestions && typeof resData.swotSuggestions === 'object') patch.swotSuggestions = resData.swotSuggestions;

  // ★ CRITICAL: STAGE3 strategy bridge を保存後のレスポンスから復元（strategicCore を含める）
  if ((resData as any).stage3_strategy_bridge && typeof (resData as any).stage3_strategy_bridge === 'object') {
    const bridge = (resData as any).stage3_strategy_bridge;
    (patch as any).stage3_strategy_bridge = {
      keyThemes: Array.isArray(bridge.keyThemes) ? bridge.keyThemes : [],
      departmentIssues: Array.isArray(bridge.departmentIssues) ? bridge.departmentIssues : [],
      kpiCriteria: Array.isArray(bridge.kpiCriteria) ? bridge.kpiCriteria : [],
      commonBehaviorChanges: Array.isArray(bridge.commonBehaviorChanges) ? bridge.commonBehaviorChanges : [],
      generatedAt: typeof bridge.generatedAt === 'string' ? bridge.generatedAt : new Date().toISOString(),
      ...(bridge.strategicCore && { strategicCore: bridge.strategicCore }),
      ...(Array.isArray(bridge.departmentTranslationRules) && { departmentTranslationRules: bridge.departmentTranslationRules }),
    };
  }

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
        const po: any = { ...p }; // ★ Phase 1: { ...p } で ownerUserId / ownerName を保持
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
  finalStoryDraft: [], // ★ 修正：undefined から [] に統一（delete時にクリア確認）
  finalStoryEdited: [], // ★ 修正：undefined から [] に統一（delete時にクリア確認）
  finalStoryFinal: [], // ★ 修正：undefined から [] に統一（delete時にクリア確認）
  stage3_strategy_bridge: null, // ★ 修正：削除時にnullクリアするため明示化
  companyTargets: [],
  stage2FinalDocumentEdits: undefined,
  projectTargetImpacts: [],
  okrTargetScores: {},
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
  lastServerSyncAt: undefined,
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
  _pendingSave: false,
  _pendingSaveReason: undefined,

  __lastSavedHash: undefined,

  reset: () => {},
  resetAll: () => {},
  setHydrated: () => {},
  setHydrating: () => {},
  setHydratingFlag: () => {},
  setServerSnapshotHash: () => {},
  setRevision: () => {},
  setStrategyId: () => {},
  hydrateFromFullState: () => {},
  setCompanyScope: () => {},
  setStory: () => {},
  setFinalStory: () => {},
  setMidtermStrategy: () => {},
  setStage2FinalDocumentEdits: () => {},
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
  setOKRTargetScore: () => {},
  getOKRTargetScore: () => 0,
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

  const stage2FinalDocumentEdits = raw.stage2FinalDocumentEdits && typeof raw.stage2FinalDocumentEdits === 'object'
    ? raw.stage2FinalDocumentEdits
    : raw.stage2_final_document_edits && typeof raw.stage2_final_document_edits === 'object'
      ? raw.stage2_final_document_edits
      : undefined;

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
  if (rawBP && typeof rawBP === 'object' && Array.isArray(rawBP.units)) {
    const growthBaseline =
      typeof rawBP.threshold?.growthBaseline === 'number' ? rawBP.threshold.growthBaseline : 0;
    const profitBaseline =
      typeof rawBP.threshold?.profitBaseline === 'number' ? rawBP.threshold.profitBaseline : 0;

    businessPortfolio = {
      ...rawBP,
      units: rawBP.units,
      threshold: {
        ...(rawBP.threshold && typeof rawBP.threshold === 'object' ? rawBP.threshold : {}),
        growthBaseline,
        profitBaseline,
      },
      currency: typeof rawBP.currency === 'string' ? rawBP.currency : 'JPY',
      periodLabel: typeof rawBP.periodLabel === 'string' ? rawBP.periodLabel : '',
      unitType: typeof rawBP.unitType === 'string' ? rawBP.unitType : 'department',
    } as BusinessPortfolio;
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

  const okrTargetScores = typeof raw.okrTargetScores === 'object' && raw.okrTargetScores !== null
    ? raw.okrTargetScores
    : typeof raw.okr_target_scores === 'object' && raw.okr_target_scores !== null
      ? raw.okr_target_scores
      : {};

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

  // ★ STAGE3 bridge 復元（strategicCore を含める）
  const stage3Bridge = (() => {
    const rawBridge = raw.stage3_strategy_bridge ?? raw.stage3_bridge;
    if (!rawBridge || typeof rawBridge !== 'object') return undefined;

    // strategicCore は新しいフィールド、必ず保持する
    const result: any = {
      keyThemes: Array.isArray(rawBridge.keyThemes) ? rawBridge.keyThemes : [],
      departmentIssues: Array.isArray(rawBridge.departmentIssues) ? rawBridge.departmentIssues : [],
      kpiCriteria: Array.isArray(rawBridge.kpiCriteria) ? rawBridge.kpiCriteria : [],
      commonBehaviorChanges: Array.isArray(rawBridge.commonBehaviorChanges) ? rawBridge.commonBehaviorChanges : [],
      generatedAt: typeof rawBridge.generatedAt === 'string' ? rawBridge.generatedAt : new Date().toISOString(),
    };

    // strategicCore がある場合は必ず保持（旧形式への回帰を防ぐ）
    if (rawBridge.strategicCore && typeof rawBridge.strategicCore === 'object') {
      result.strategicCore = rawBridge.strategicCore;
    }

    // departmentTranslationRules も保持
    if (Array.isArray(rawBridge.departmentTranslationRules)) {
      result.departmentTranslationRules = rawBridge.departmentTranslationRules;
    }

    return result;
  })();

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
    stage2FinalDocumentEdits,

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
    okrTargetScores,
    projectIssueLinks,

    // === STAGE3 bridge（strategicCore を含める） ===
    stage3_strategy_bridge: stage3Bridge,
  };

  if (DEBUG) {
    const patchFinancePLLen = Array.isArray(patch.financePL) ? patch.financePL.length : 0;
    const patchStage1IssuesLen = Array.isArray(patch.stage1Issues) ? patch.stage1Issues.length : 0;
    console.log('[normalizeFromDbRow] patch生成 financePL_len:' + patchFinancePLLen + ' stage1Issues_len:' + patchStage1IssuesLen);
  }

  // ★ STAGE3 bridge hydrate ログ
  if (DEBUG || stage3Bridge) {
    console.log('[STAGE3 bridge hydrate] loaded from DB', {
      hasBridge: !!stage3Bridge,
      hasStrategicCore: !!stage3Bridge?.strategicCore,
      concreteDomains: stage3Bridge?.strategicCore?.concreteDomains,
      nonNegotiableThemes: stage3Bridge?.strategicCore?.nonNegotiableThemes,
      keys: stage3Bridge ? Object.keys(stage3Bridge) : [],
      keyThemesCount: Array.isArray(stage3Bridge?.keyThemes) ? stage3Bridge.keyThemes.length : 0,
      departmentIssuesCount: Array.isArray(stage3Bridge?.departmentIssues) ? stage3Bridge.departmentIssues.length : 0,
      timestamp: new Date().toISOString(),
    });
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

          // ★ Phase 1: { ...proj } で ownerUserId / ownerName を保持
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

      setHydrated: (revOrBool?: boolean | number, hash?: string) =>
        set((s) => {
          const isBool = revOrBool === undefined || typeof revOrBool === 'boolean';
          return {
            hydrated: isBool ? (revOrBool !== false ? true : false) : true,
            boot: { isHydrating: false, isHydrated: true },
            revision: isBool ? s.revision : (revOrBool as number),
            lastServerSnapshot: hash ?? s.lastServerSnapshot,
            __isFetchingFromServer: false,
          };
        }),

      setHydrating: (b) => set((s) => ({ ...s, boot: { ...s.boot, isHydrating: b } })),

      /** ★ CRITICAL: isHydrating フラグ更新専用（isHydrated は維持） */
      setHydratingFlag: (isHydrating: boolean, reason: string) => {
        set((s) => {
          const before = s.boot?.isHydrating;
          const after = isHydrating;
          if (before === after) {
            if (DEBUG) console.log('[flags:set] boot.isHydrating (no change)', { before, after, reason });
            return s;
          }
          console.log('[flags:set] boot.isHydrating', {
            before,
            after,
            reason,
            isHydrated: s.boot?.isHydrated,
            timestamp: new Date().toISOString(),
          });
          return {
            boot: {
              ...s.boot,
              isHydrating,
            },
          };
        });
      },

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
        set((s) => {
          console.log('[strategyStore][setCompanyScope] __isFetchingFromServer: true に設定', {
            id,
            timestamp: new Date().toISOString(),
            previousId: s.companyId,
            previousStrategyId: s.strategyId,
            previousIsFetching: s.__isFetchingFromServer,
          });
          return {
            ...s,
            pendingCompanyId: id,
            strategyId: undefined, // ★ 会社切替時に古い strategyId をリセット（新会社で新しい strategyId をハイドレート）
            boot: { isHydrating: true, isHydrated: false },
            __isFetchingFromServer: true,
            _loadingRefetch: false,
            __lastServerError: undefined,
            /* ★ TASK 14: restore フラグをリセット（新会社スコープでリフェッチ開始） */
            restoreReady: false,
            isRestoring: true,
          };
        }),

      setStory: (chs) => {
        set((s) => ({ story: [...chs], dirty: true, version: (s.version ?? 0) + 1 }));
      },

      // ★ STAGE2：中計設計（生成成功時のみ呼ばれる。undefined でクリアも可能）
      setMidtermStrategy: (m) => {
        set((s) => ({ midtermStrategy: m, dirty: true, version: (s.version ?? 0) + 1 }));
      },

      // ★ STAGE2：最終ストーリー補助セクション編集データ
      setStage2FinalDocumentEdits: (edits) => {
        set((s) => ({
          stage2FinalDocumentEdits: edits ? { ...edits, editedAt: new Date().toISOString() } : undefined,
          dirty: true,
          version: (s.version ?? 0) + 1,
        }));
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
            version: (s.version ?? 0) + 1,
          }));
        } else {
          set((s) => ({ ...s, ...patch, dirty: true, version: (s.version ?? 0) + 1 }));
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
          const newState = { ...s, stage1Benchmarks: benchmarks, dirty: true, version: (s.version ?? 0) + 1 };
          if (DEBUG) {
            console.log('[strategyStore] setStage1Benchmarks state updated:', {
              stateHasBenchmarks: !!newState.stage1Benchmarks,
              isDirty: newState.dirty,
              version: newState.version,
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

      // === STAGE5/6：OKR進捗インパクトスコア アクション ===
      setOKRTargetScore: (okrId: string, score: number) => {
        set((s) => {
          const prev = s.okrTargetScores ?? {};
          return {
            ...s,
            okrTargetScores: { ...prev, [okrId]: score },
            dirty: true,
            version: (s.version ?? 0) + 1,
          };
        });
      },

      getOKRTargetScore: (okrId: string): number => {
        return (useStrategyStore.getState().okrTargetScores ?? {})[okrId] ?? 0;
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
        set((s) => {
          const prevBaseline = s.executionPlanBaseline;

          // 初回の自動ベースライン作成は UI 初期化扱いにし、未保存表示を立てない。
          const isInitialAutoBaseline =
            (prevBaseline == null || prevBaseline.snapshot == null) &&
            baseline != null &&
            Array.isArray(baseline.snapshot) &&
            baseline.snapshot.length > 0;

          // 完全同値なら no-op
          const sameBaseline = JSON.stringify(prevBaseline ?? null) === JSON.stringify(baseline ?? null);
          if (sameBaseline) return s;

          if (isInitialAutoBaseline) {
            return {
              ...s,
              executionPlanBaseline: baseline,
            };
          }

          return {
            ...s,
            executionPlanBaseline: baseline,
            dirty: true,
            version: (s.version ?? 0) + 1,
          };
        });
      },

      /**
       * ★ STEP 3: Invalidate STAGE4 artifacts after successful STAGE3 regeneration
       *
       * Purpose: After STAGE3 cascade regeneration succeeds, clear stale STAGE4 plans
       * that reference old/deleted projects.
       *
       * Flow:
       * 1. Filter out old projects from stage4Plans and executionPlanBaseline
       * 2. Filter projectTargetImpacts and projectIssueLinks by projectId
       * 3. Full clear: stage4Plans=[], executionPlanBaseline={}
       *
       * Only called on SUCCESSFUL regeneration (not on failure).
       */
      invalidateStage4ArtifactsAfterCascadeRegeneration: (
        departmentId: string,
        allOldProjectIds: string[]
      ) => {
        const s = get();

        // Helper: Resolve project ID (from cascade pattern)
        const resolveProjectId = (p: any, deptName?: string): string | undefined => {
          if (p?.id) return String(p.id);
          if (!deptName || !p?.title) return undefined;
          // Generate stable ID from title if no explicit ID
          const normalized = `${deptName}::${p.title}`.trim().toLowerCase();
          let hash = 0;
          for (let i = 0; i < normalized.length; i++) {
            const char = normalized.charCodeAt(i);
            hash = ((hash << 5) - hash) + char;
            hash = hash & hash;
          }
          return `proj-${Math.abs(hash).toString(36)}`;
        };

        // PHASE 1: Filter old projects from STAGE4 artifacts
        console.log('[strategyStore] invalidateStage4ArtifactsAfterCascadeRegeneration: START', {
          departmentId,
          oldProjectIdCount: allOldProjectIds.length,
          timestamp: new Date().toISOString(),
        });

        // 1a. Filter stage4Plans
        const oldStage4Plans = s.stage4Plans ?? [];
        const newStage4Plans = oldStage4Plans.filter((plan: any) => {
          if (plan.departmentId !== departmentId) return true; // Keep other depts

          // baseline/current の projects を ID に変換
          const planProjectIds = new Set(
            [
              ...(plan.baseline?.projects ?? []),
              ...(plan.current?.projects ?? []),
            ]
              .map((p: any) => resolveProjectId(p, departmentId))
              .filter((projId): projId is string => typeof projId === 'string' && projId.length > 0)
          );

          // allOldProjectIds に含まれるプロジェクトがあれば削除対象
          for (const projId of planProjectIds) {
            if (allOldProjectIds.includes(projId)) return false;
          }
          return true;
        });

        if (newStage4Plans.length < oldStage4Plans.length) {
          console.log('[strategyStore] stage4Plans filtered', {
            before: oldStage4Plans.length,
            after: newStage4Plans.length,
            removed: oldStage4Plans.length - newStage4Plans.length,
          });
        }

        // 1b. Filter executionPlanBaseline.snapshot
        const oldBaseline = s.executionPlanBaseline;
        let newBaseline = oldBaseline;
        if (oldBaseline?.snapshot) {
          const newSnapshot = oldBaseline.snapshot.map((d: any) => {
            if (d.name !== departmentId) return d; // Keep other depts

            // projects を ID でフィルタ
            const filteredProjects = (d.projects ?? []).filter((p: any) => {
              const projId = resolveProjectId(p, departmentId);
              return projId && !allOldProjectIds.includes(projId);
            });

            return { ...d, projects: filteredProjects };
          });

          const oldDeptProjects = oldBaseline.snapshot?.find(
            (d: any) => d.name === departmentId
          )?.projects ?? [];
          const newDeptProjects = newSnapshot?.find(
            (d: any) => d.name === departmentId
          )?.projects ?? [];

          if (newDeptProjects.length < oldDeptProjects.length) {
            newBaseline = { ...oldBaseline, snapshot: newSnapshot };
            console.log('[strategyStore] executionPlanBaseline.snapshot filtered', {
              before: oldDeptProjects.length,
              after: newDeptProjects.length,
              removed: oldDeptProjects.length - newDeptProjects.length,
            });
          }
        }

        // 1c. Filter projectTargetImpacts
        const oldTargetImpacts = s.projectTargetImpacts ?? [];
        const newTargetImpacts = oldTargetImpacts.filter(
          (impact: any) => !allOldProjectIds.includes(impact.projectId)
        );

        if (newTargetImpacts.length < oldTargetImpacts.length) {
          console.log('[strategyStore] projectTargetImpacts filtered', {
            before: oldTargetImpacts.length,
            after: newTargetImpacts.length,
            removed: oldTargetImpacts.length - newTargetImpacts.length,
          });
        }

        // 1d. Filter projectIssueLinks
        const oldIssueLinks = (s as any).projectIssueLinks ?? [];
        const newIssueLinks = oldIssueLinks.filter(
          (link: any) => !allOldProjectIds.includes(link.projectId)
        );

        if (newIssueLinks.length < oldIssueLinks.length) {
          console.log('[strategyStore] projectIssueLinks filtered', {
            before: oldIssueLinks.length,
            after: newIssueLinks.length,
            removed: oldIssueLinks.length - newIssueLinks.length,
          });
        }

        // PHASE 2: Full clear of stage4Plans and executionPlanBaseline
        const stage4PlansCountBefore = s.stage4Plans?.length ?? 0;
        const hasExecutionPlanBaseline = s.executionPlanBaseline != null;

        if (stage4PlansCountBefore > 0 || hasExecutionPlanBaseline) {
          console.log('[strategyStore] invalidateStage4ArtifactsAfterCascadeRegeneration: FULL CLEAR', {
            departmentId,
            stage4PlansCountBefore,
            hasExecutionPlanBaseline,
          });

          set((s) => ({
            ...s,
            stage4Plans: [],  // ← Full clear
            executionPlanBaseline: {},  // ← Full clear
            projectTargetImpacts: newTargetImpacts,
            projectIssueLinks: newIssueLinks,
            dirty: true,
            version: (s.version ?? 0) + 1,
          }));
        } else {
          // No stage4 data to clear, but still apply filtered targets/issues
          set((s) => ({
            ...s,
            projectTargetImpacts: newTargetImpacts,
            projectIssueLinks: newIssueLinks,
            dirty: true,
            version: (s.version ?? 0) + 1,
          }));
        }

        console.log('[strategyStore] invalidateStage4ArtifactsAfterCascadeRegeneration: COMPLETE', {
          departmentId,
          timestamp: new Date().toISOString(),
        });
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
      setFinancePL: (rows: FinancePLRow[]) => {
        // ★ TASK-A: financePL を yen に統一（Stage1入力は百万円、保存は yen）
        const yenRows = Array.isArray(rows)
          ? rows.map((row: FinancePLRow) => {
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
        if (DEBUG) console.log('[strategyStore] setFinancePL input', {
          len: Array.isArray(rows) ? rows.length : 'not-array',
          sample: Array.isArray(rows) && rows.length > 0 ? rows[0] : null,
          sample_after_conversion: Array.isArray(yenRows) && yenRows.length > 0 ? yenRows[0] : null,
        });

        set((s) => {
          const newVersion = (s.version ?? 0) + 1;
          if (DEBUG) console.log('[strategyStore] setFinancePL version bump', {
            from: s.version,
            to: newVersion,
            dirty: true,
          });
          return { ...s, financePL: yenRows, dirty: true, version: newVersion };
        });

        // ★ DEBUG：set直後の確認
        setTimeout(() => {
          const after = get();
          if (DEBUG) console.log('[strategyStore] setFinancePL accepted', {
            len: after.financePL?.length ?? 0,
            sample: after.financePL?.[0] ?? null,
            version: after.version,
            dirty: after.dirty,
          });
        }, 0);

        setTimeout(() => get().recomputeValueAnalysis('setFinancePL'), 0);
      },

      setFinanceBS: (rows: FinanceBSRow[]) => {
        // ★ DEBUG：入力ログ（弾き判定用）
        if (DEBUG) console.log('[strategyStore] setFinanceBS input', {
          len: Array.isArray(rows) ? rows.length : 'not-array',
          sample: Array.isArray(rows) && rows.length > 0 ? rows[0] : null,
          allYears: Array.isArray(rows) ? rows.map((r: FinanceBSRow) => ({ year: r.year, yearType: typeof r.year })) : null,
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
        set((s) => {
          const newVersion = (s.version ?? 0) + 1;
          if (DEBUG) console.log('[strategyStore] setFinanceBS version bump', {
            from: s.version,
            to: newVersion,
            dirty: true,
          });
          return {
            ...s,
            financeBS: rows,
            csvFinanceData: {
              ...(s.csvFinanceData || {}),
              financeBS: rows,
            },
            dirty: true,
            version: newVersion,
          };
        });

        // ★ DEBUG：set直後の確認
        setTimeout(() => {
          const after = get();
          if (DEBUG) console.log('[strategyStore] setFinanceBS accepted', {
            len: after.financeBS?.length ?? 0,
            sample: after.financeBS?.[0] ?? null,
            version: after.version,
            dirty: after.dirty,
          });
        }, 0);

        setTimeout(() => get().recomputeValueAnalysis('setFinanceBS'), 0);
      },

      setSegmentPL: (data: Record<string, FinancePLRow[]>) => {
        // ★ DEBUG：入力ログ（弾き判定用）
        const keys = Object.keys(data ?? {});
        const distribution = Object.fromEntries(
          keys.map((k: string) => [k, Array.isArray(data[k]) ? data[k].length : '?'])
        );
        if (DEBUG) console.log('[strategyStore] setSegmentPL input', {
          keys,
          distribution,
          sample: keys.length > 0 ? { [keys[0]]: data[keys[0]]?.[0] } : null,
        });

        // ★ 修正：csvFinanceData と同期
        set((s) => {
          const newVersion = (s.version ?? 0) + 1;
          if (DEBUG) console.log('[strategyStore] setSegmentPL version bump', {
            from: s.version,
            to: newVersion,
            dirty: true,
          });
          return {
            ...s,
            segmentPL: data,
            csvFinanceData: {
              ...(s.csvFinanceData || {}),
              segmentPL: data,
            },
            dirty: true,
            version: newVersion,
          };
        });

        // ★ DEBUG：set直後の確認
        setTimeout(() => {
          const after = get().segmentPL;
          const afterKeys = Object.keys(after ?? {});
          const afterDist = Object.fromEntries(
            afterKeys.map((k) => [k, Array.isArray((after as any)?.[k]) ? (after as any)[k].length : '?'])
          );
          if (DEBUG) console.log('[strategyStore] setSegmentPL accepted', {
            keys: afterKeys,
            distribution: afterDist,
          });
        }, 0);

        setTimeout(() => get().recomputeValueAnalysis('setSegmentPL'), 0);
      },

      setSegmentBS: (data: Record<string, SegmentBSRow[]>) => {
        // ★ DEBUG：入力ログ（弾き判定用）
        const keys = Object.keys(data ?? {});
        const distribution = Object.fromEntries(
          keys.map((k: string) => [k, Array.isArray(data[k]) ? data[k].length : '?'])
        );
        if (DEBUG) console.log('[strategyStore] setSegmentBS input', {
          keys,
          distribution,
          sample: keys.length > 0 ? { [keys[0]]: data[keys[0]]?.[0] } : null,
        });

        // ★ 修正：csvFinanceData と同期
        set((s) => {
          const newVersion = (s.version ?? 0) + 1;
          if (DEBUG) console.log('[strategyStore] setSegmentBS version bump', {
            from: s.version,
            to: newVersion,
            dirty: true,
          });
          return {
            ...s,
            segmentBS: data,
            csvFinanceData: {
              ...(s.csvFinanceData || {}),
              segmentBS: data,
            },
            dirty: true,
            version: newVersion,
          };
        });

        // ★ DEBUG：set直後の確認
        setTimeout(() => {
          const after = get().segmentBS;
          const afterKeys = Object.keys(after ?? {});
          const afterDist = Object.fromEntries(
            afterKeys.map((k) => [k, Array.isArray((after as any)?.[k]) ? (after as any)[k].length : '?'])
          );
          if (DEBUG) console.log('[strategyStore] setSegmentBS accepted', {
            keys: afterKeys,
            distribution: afterDist,
          });
        }, 0);

        setTimeout(() => get().recomputeValueAnalysis('setSegmentBS'), 0);
      },

      /** ★ セグメント単位マージ更新（必ずマージ） */
      upsertSegmentPL: (segName: string, rows: FinancePLRow[]) => {
        if (DEBUG) {
          console.log('[strategyStore] upsertSegmentPL', {
            segName,
            rowsLen: Array.isArray(rows) ? rows.length : 0,
            currentKeys: Object.keys((get().segmentPL || {})),
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

      upsertSegmentBS: (segName: string, rows: SegmentBSRow[]) => {
        if (DEBUG) {
          console.log('[strategyStore] upsertSegmentBS', {
            segName,
            rowsLen: Array.isArray(rows) ? rows.length : 0,
            currentKeys: Object.keys((get().segmentBS || {})),
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

      setBusinessSegmentsWithSync: (segments: BusinessSegment[]) => {
        const currentState = get();
        const newSegmentNames = new Set(segments.map((seg: BusinessSegment) => seg.name));

        let newSegmentPL = currentState.segmentPL ? { ...currentState.segmentPL } : {};
        let newSegmentBS = currentState.segmentBS ? { ...currentState.segmentBS } : {};

        for (const key of Object.keys(newSegmentPL)) {
          if (!newSegmentNames.has(key)) delete newSegmentPL[key];
        }
        for (const key of Object.keys(newSegmentBS)) {
          if (!newSegmentNames.has(key)) delete newSegmentBS[key];
        }

        for (const segName of newSegmentNames) {
          if (!(segName in newSegmentPL)) (newSegmentPL as Record<string, FinancePLRow[]>)[segName] = [];
          if (!(segName in newSegmentBS)) (newSegmentBS as Record<string, SegmentBSRow[]>)[segName] = [];
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

      updateFinancePLCell: <K extends keyof FinancePLRow>(year: number, key: K, value: FinancePLRow[K]) => {
        set((s) => {
          const rows = s.financePL ?? [];
          const idx = rows.findIndex((r: FinancePLRow) => r.year === year);
          if (idx < 0) {
            console.warn('[strategyStore] updateFinancePLCell: year not found', { year });
            return s;
          }
          const newRows = [...rows];
          newRows[idx] = { ...newRows[idx], [key]: value };
          return { ...s, financePL: newRows, dirty: true, version: (s.version ?? 0) + 1 };
        });
        setTimeout(() => get().recomputeValueAnalysis('setFinancePL'), 0);
      },

      updateFinanceBSCell: <K extends keyof FinanceBSRow>(year: number, key: K, value: FinanceBSRow[K]) => {
        set((s) => {
          const rows = s.financeBS ?? [];
          const idx = rows.findIndex((r: FinanceBSRow) => r.year === year);
          if (idx < 0) {
            console.warn('[strategyStore] updateFinanceBSCell: year not found', { year });
            return s;
          }
          const newRows = [...rows];
          newRows[idx] = { ...newRows[idx], [key]: value };
          return { ...s, financeBS: newRows, dirty: true, version: (s.version ?? 0) + 1 };
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

      updateSegmentPLCell: <K extends keyof FinancePLRow>(segmentName: string, year: number, key: K, value: FinancePLRow[K]) => {
        set((s) => {
          const rows = (s.segmentPL ?? {})[segmentName] ?? [];
          const idx = rows.findIndex((r: FinancePLRow) => r.year === year);
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

      updateSegmentBSCell: <K extends keyof SegmentBSRow>(segmentName: string, year: number, key: K, value: SegmentBSRow[K]) => {
        set((s) => {
          const rows = (s.segmentBS ?? {})[segmentName] ?? [];
          const idx = rows.findIndex((r: SegmentBSRow) => r.year === year);
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

      setMVV: (patch: Partial<Pick<StrategyState, 'thought' | 'mission' | 'vision' | 'value' | 'ceoIntent'>>) =>
        set((s) => ({
          ...s,
          ...patch,
          dirty: true,
          version: (s.version ?? 0) + 1,
        })),
      setSWOT: (patch: Partial<Pick<StrategyState, 'strength' | 'weakness' | 'opportunity' | 'threat'>>) => set((s) => ({ ...s, ...patch, dirty: true, version: (s.version ?? 0) + 1 })),

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

      setSwotSuggestions: (suggestions?: { opportunity?: string[]; threat?: string[]; generatedAt?: string }) =>
        set((s) => ({ ...s, swotSuggestions: suggestions, dirty: true, version: (s.version ?? 0) + 1 })),

      addSwotOpportunity: (text: string) => {
        const trimmed = text.trim();
        if (!trimmed) return;
        set((s) => {
          const current = s.opportunity ? s.opportunity.split('\n').filter(Boolean) : [];
          if (!current.includes(trimmed)) {
            current.push(trimmed);
          }
          return { ...s, opportunity: current.join('\n'), dirty: true, version: (s.version ?? 0) + 1 };
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
          return { ...s, threat: current.join('\n'), dirty: true, version: (s.version ?? 0) + 1 };
        });
      },

      removeSwotOpportunity: (textOrIndex: string | number) => {
        set((s) => {
          const current = s.opportunity ? s.opportunity.split('\n').filter(Boolean) : [];
          if (typeof textOrIndex === 'number') {
            current.splice(textOrIndex, 1);
          } else {
            const idx = current.indexOf(textOrIndex);
            if (idx >= 0) current.splice(idx, 1);
          }
          return { ...s, opportunity: current.join('\n'), dirty: true, version: (s.version ?? 0) + 1 };
        });
      },

      removeSwotThreat: (textOrIndex: string | number) => {
        set((s) => {
          const current = s.threat ? s.threat.split('\n').filter(Boolean) : [];
          if (typeof textOrIndex === 'number') {
            current.splice(textOrIndex, 1);
          } else {
            const idx = current.indexOf(textOrIndex);
            if (idx >= 0) current.splice(idx, 1);
          }
          return { ...s, threat: current.join('\n'), dirty: true, version: (s.version ?? 0) + 1 };
        });
      },

      // ▼ 部門セット後に即座に保存（※ ensureParentExists は呼ばない：二重保存を防ぐ）
      setDepartments: (deps: SafeDepartmentsArg) => {
        if (DEBUG) console.log('[strategyStore] setDepartments() called', deps);

        const current = get();
        const normalized = normalizeDepartmentsInput(deps, current.departments);
        const prev = Array.isArray(current.departments) ? current.departments : [];

        // ★ FIX C: department 単位の差分判定
        // 変わってない department は prev[i] をそのまま返す（参照保持で無限ループ防止）
        const optimized = normalized.map((dept, i) => {
          const prevDept = prev[i];
          if (prevDept && jsonEq(prevDept, dept)) {
            // 差分がない → 前の参照をそのまま返す
            if (DEBUG) console.log('[strategyStore][setDepartments] dept same', {
              index: i,
              deptName: dept.name,
            });
            return prevDept;
          }
          // 差分がある or 新規 → 新しい参照を使う
          if (DEBUG) console.log('[strategyStore][setDepartments] dept changed', {
            index: i,
            deptName: dept.name,
          });
          return dept;
        });

        // ★ FIX: 削除時は length が変わるため、件数も必ず比較する
        // 旧実装は optimized.every(...) だけだったため、
        // 末尾削除で「先頭N件が同じ参照」の場合に no-op 扱いされていた。
        const isSameDepartments =
          optimized.length === prev.length && optimized.every((dept, i) => dept === prev[i]);

        if (isSameDepartments) {
          console.log('[store:no-op-update-skipped]', {
            reason: 'setDepartments',
            allDeptsUnchanged: true,
            prevLen: prev.length,
            nextLen: optimized.length,
          });
          if (DEBUG) console.log('[strategyStore] setDepartments: all depts unchanged, skip set call');
          return;  // ★ 重要：set も async saveStrategyData も実行しない
        }

        if (DEBUG) console.log('[strategyStore] setDepartments: departments changed, updating state');
        set({
          departments: optimized,
          dirty: true,
          version: (current.version ?? 0) + 1,
        });

        // ★ FIX: immediate-save を削除（STAGE3 通常入力時は autosave のみを正本経路に）
        // 保存責務は autosave に一任する
        if (DEBUG) console.log('[strategyStore] setDepartments: dirty marked, autosave will handle save');
      },

      updateDepartments: (updater: (prev: Department[]) => Department[]) => {
        if (DEBUG) console.log('[strategyStore] updateDepartments() called');

        const current = get();
        const prev = Array.isArray(current.departments) ? current.departments : [];
        const next = updater([...prev]);
        const normalized = normalizeDepartmentsInput(next, prev);

        // ★ FIX C: department単位の差分判定（setDepartments と同じ）
        // 変わってない department は prev[i] をそのまま返す（参照保持で無限ループ防止）
        const optimized = normalized.map((dept, i) => {
          const prevDept = prev[i];
          if (prevDept && jsonEq(prevDept, dept)) {
            if (DEBUG) console.log('[strategyStore][updateDepartments] dept same', {
              index: i,
              deptName: dept.name,
            });
            return prevDept;
          }
          if (DEBUG) console.log('[strategyStore][updateDepartments] dept changed', {
            index: i,
            deptName: dept.name,
          });
          return dept;
        });

        // ★ FIX: 削除時は length が変わるため、件数も必ず比較する
        const isSameDepartments =
          optimized.length === prev.length && optimized.every((dept, i) => dept === prev[i]);

        if (isSameDepartments) {
          console.log('[store:no-op-update-skipped]', {
            reason: 'updateDepartments',
            allDeptsUnchanged: true,
            prevLen: prev.length,
            nextLen: optimized.length,
          });
          if (DEBUG) console.log('[strategyStore] updateDepartments: all depts unchanged, skip set call');
          return;  // ★ 重要：set も async saveStrategyData も実行しない
        }

        if (DEBUG) console.log('[strategyStore] updateDepartments: departments changed, updating state');
        set({
          departments: optimized,
          dirty: true,
          version: (current.version ?? 0) + 1,
        });

        // ★ FIX: immediate-save を削除（STAGE3 通常入力時は autosave のみを正本経路に）
        // 保存責務は autosave に一任する
        if (DEBUG) console.log('[strategyStore] updateDepartments: dirty marked, autosave will handle save');
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

      /**
       * saveStrategyData is not the source-of-truth path for STAGE4 OKR core fields.
       * STAGE4 core edits (objective, owner, add, delete, reorder) must be persisted
       * via okrService / okrs table first, then synchronized back to snapshot on demand.
       * This saveStrategyData is for strategy_data snapshot persistence only.
       */
      async saveStrategyData(opts) {
        return enqueueSave(async () => {
          const reason = opts?.reason ?? 'manual';
          const force = opts?.force ?? false;
          const state0 = get();

          // ★ FIX: source ログを記録（保存経路の一本化を確認）
          let source: 'autosave' | 'manual-save' | 'pending' | 'other' = 'other';
          if (reason === 'manual' || reason === 'manual-save-button') {
            source = 'manual-save';
          } else if (reason === 'pending') {
            source = 'pending';
          } else if (!reason || reason === '') {
            source = 'autosave';  // useAutoSave から呼ばれる場合
          }
          console.log('[saveStrategyData:path]', {
            source,
            reason,
            force,
            timestamp: new Date().toISOString(),
          });

          // ★ FIX: saveStrategyData 呼び出しスタックを記録
          console.log('[saveStrategyData:caller-stack]', {
            reason,
            force,
            timestamp: new Date().toISOString(),
            stack: new Error().stack?.split('\n').slice(0, 6).join('\n'),
          });

          if (shouldBlockStage4DepartmentsImmediateSave(reason)) {
            if (DEBUG) console.log('[strategyStore] saveStrategyData blocked for Stage4 department immediate-save reason', { reason });
            return { ok: false, skipped: true, reason: 'stage4_departments_immediate_save_blocked' };
          }

          // ★ force: true のときは hydrating をスキップ（無反応を防ぐ）
          // force: false のときはガード
          // ★ FIX: skip-flags をログ出力 + 詳細な理由
          const willSkip = !force && (state0.__isFetchingFromServer || state0.boot?.isHydrating);
          const skipReasons: string[] = [];
          if (state0.__isFetchingFromServer) skipReasons.push('isFetching=true');
          if (state0.boot?.isHydrating) skipReasons.push('hydrating=true');
          if (state0.isRestoring) skipReasons.push('isRestoring=true (但し restoreReady check前)');
          if (!state0.hydrated) skipReasons.push('hydrated=false (但し restoreReady check前)');
          if (!state0.restoreReady) skipReasons.push('restoreReady=false (2つ目のguard)');

          console.log('[saveStrategyData:skip-flags]', {
            boot: {
              isHydrating: state0.boot?.isHydrating,
              isHydrated: state0.boot?.isHydrated,
            },
            isFetching: state0.__isFetchingFromServer,
            restoring: state0.isRestoring,
            hydrated: state0.hydrated,
            restoreReady: state0.restoreReady,
            reason,
            force,
            willSkip,
            skipReasons,
            timestamp: new Date().toISOString(),
          });

          if (willSkip) {
            console.warn('[saveStrategyData:SKIPPED] skip while fetching/hydrating (not forced)', {
              reason,
              hydrating: state0.boot?.isHydrating,
              isFetching: state0.__isFetchingFromServer,
              skipReasons,
              timestamp: new Date().toISOString(),
            });
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
          // ★ 修正：複数の手動保存パターンをサポート（STAGE2確定・STAGE3→STAGE4遷移前）
          const isManual =
            reason === 'manual' ||
            reason === 'manual-save-button' ||
            reason === 'stage2:confirmAndBridge' ||
            reason?.startsWith('stage2:') ||
            reason?.startsWith('stage3:');

          if (!force && !isManual && !state0.dirty) {
            if (DEBUG) console.log('[strategyStore] saveStrategyData: dirty=false, skip (not forced, not manual)', { reason, isManual });
            return { ok: false, skipped: true, reason: 'dirty_false' };
          }

          // ★ 止血対策：boot.isSaving で二重実行を防ぐ
          if (get().boot?.isSaving || state0._loadingSave) {
            if (DEBUG) console.log('[strategyStore] saveStrategyData: already saving, set pending', { reason, isSaving: get().boot?.isSaving, isLoading: state0._loadingSave });
            set({ _pendingSave: true, _pendingSaveReason: reason ?? 'pending' });
            return { ok: false, skipped: true, reason: 'pending_queued' };
          }

          // ★ 止血対策：保存開始（autosave 抑止開始）
          set({ _loadingSave: true, boot: { ...state0.boot, isSaving: true } });

          try {
            for (let attempt = 1; attempt <= 3; attempt++) {
              const state = get();
              const payload = buildSavePayload(state as StrategyState);

              // ★ CRITICAL GUARD: autosave で旧形式 bridge に上書きされるのを防ぐ
              const existingBridge = get().stage3_strategy_bridge;
              const payloadBridge = payload.stage3_strategy_bridge;

              // Debug guard logic
              if (DEBUG || existingBridge || payloadBridge) {
                console.log('[STAGE3 bridge save guard check]', {
                  existingBridge_hasStrategicCore: !!existingBridge?.strategicCore,
                  payloadBridge_exists: !!payloadBridge,
                  payloadBridge_hasStrategicCore: !!payloadBridge?.strategicCore,
                  shouldGuard: !!(existingBridge?.strategicCore && payloadBridge && !payloadBridge.strategicCore),
                  reason,
                  attempt,
                });
              }

              if (
                existingBridge?.strategicCore &&
                payloadBridge &&
                !payloadBridge.strategicCore
              ) {
                console.warn('[STAGE3 bridge save guard] blocked downgrade of strategicCore', {
                  existingBridge_keys: Object.keys(existingBridge),
                  payloadBridge_keys: Object.keys(payloadBridge),
                  preserving: true,
                });
                payload.stage3_strategy_bridge = existingBridge;
              }

              // ★ 新しい診断ログ：departments/projects の ID 状態確認
              if (process.env.NEXT_PUBLIC_DEBUG_CASCADE === '1' || process.env.NEXT_PUBLIC_DEBUG_HYDRATE === '1') {
                const deptIdStatus = (state.departments ?? []).map((d: any, idx: number) => ({
                  index: idx,
                  name: d?.name ?? '[no-name]',
                  hasId: !!d?.id,
                  rawId: d?.id ?? 'missing',
                  projectCount: Array.isArray(d?.projects) ? d.projects.length : 0,
                  projectIds: (d?.projects ?? []).map((p: any) => ({
                    title: p?.title ?? '[no-title]',
                    hasId: !!p?.id,
                    rawId: p?.id ?? 'missing',
                    okrCount: Array.isArray(p?.okrs) ? p.okrs.length : 0,
                  })),
                }));
                console.log('[diag][savePayload-departments-projects-id-status]', {
                  timestamp: new Date().toISOString(),
                  totalDepts: deptIdStatus.length,
                  departments: deptIdStatus,
                });
              }

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

                // ★ 診断：STAGE5 okrTargetScores が payload に入ってるか（新規）
              console.log('[diag][stage5:okrTargetScores]', {
                state_okrTargetScores_keys: Object.keys((state as any).okrTargetScores ?? {}).length,
                state_okrTargetScores_sample: Object.entries((state as any).okrTargetScores ?? {}).slice(0, 3),
                payload_okrTargetScores_keys: Object.keys((payload as any).okrTargetScores ?? {}).length,
                payload_okrTargetScores_sample: Object.entries((payload as any).okrTargetScores ?? {}).slice(0, 3),
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
              if (DEBUG) console.log('[diag][save:payload:departments]', deptDiag);

              if (isEffectivelyEmpty(payload)) {
                if (DEBUG) console.log('[strategyStore] saveStrategyData: payload effectively empty, clear dirty');
                set({ dirty: false });
                return { ok: false, skipped: true, reason: 'payload_empty' };
              }

              // ★ CRITICAL GUARD: 保存時の projects 欠落検出（根本原因対策）
              // 【背景】
              // - 空の projects で保存される事故を防ぐ
              // - normalize や shallow overwrite で projects が消えていないか検証
              // 【実装】
              // - store の departments projects 件数と payload のそれを比較
              // - 大きく減少している場合は警告ログを出す
              const { countTotalProjects } = require('@/utils/supabase/strategy');
              const stateDeptCount = Array.isArray(state.departments) ? state.departments.length : 0;
              const stateProjectsCount = countTotalProjects(state.departments ?? []);
              const payloadDeptCount = Array.isArray((payload as any).departments) ? (payload as any).departments.length : 0;
              const payloadProjectsCount = countTotalProjects((payload as any).departments ?? []);

              if (stateProjectsCount > 0 && payloadProjectsCount === 0) {
                console.error('[SAVE_BLOCKED] CRITICAL: projects が消えている（根本原因：shallow overwrite或いは normalize の破壊）', {
                  reason: 'projects_lost_in_payload',
                  stateDeptCount,
                  stateProjectsCount,
                  payloadDeptCount,
                  payloadProjectsCount,
                  timestamp: new Date().toISOString(),
                });
                // projects が完全に消えている場合はスキップ（保存させない）
                return { ok: false, skipped: true, reason: 'projects_lost_in_payload' };
              }

              // projects が著しく減少している場合も警告（例: 5個 → 0個、10個 → 1個等）
              if (stateProjectsCount > payloadProjectsCount && payloadProjectsCount < stateProjectsCount * 0.5) {
                console.warn('[SAVE_WARN] projects が著しく減少している（確認推奨）', {
                  stateDeptCount,
                  stateProjectsCount,
                  payloadDeptCount,
                  payloadProjectsCount,
                  reduction_pct: Math.round((1 - payloadProjectsCount / stateProjectsCount) * 100),
                  reason: 'potential_projects_loss',
                  timestamp: new Date().toISOString(),
                });
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

              // STAGE3 bridge pre-save check
              console.log('[STAGE3 bridge save payload]', {
                hasBridge: !!(payload as any).stage3_strategy_bridge,
                bridgeKeys: (payload as any).stage3_strategy_bridge ? Object.keys((payload as any).stage3_strategy_bridge) : [],
                hasStrategicCore: !!(payload as any).stage3_strategy_bridge?.strategicCore,
                strategicCoreKeys: (payload as any).stage3_strategy_bridge?.strategicCore ? Object.keys((payload as any).stage3_strategy_bridge.strategicCore) : [],
                concreteDomains: (payload as any).stage3_strategy_bridge?.strategicCore?.concreteDomains,
                nonNegotiableThemes: (payload as any).stage3_strategy_bridge?.strategicCore?.nonNegotiableThemes,
                reason,
                attempt,
                timestamp: new Date().toISOString(),
              });

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
                  const conflictInfo = {
                    expectedRevision: state.revision,
                    currentRevision: (err as any)?.currentRevision,
                    occurredAt: Date.now(),
                    attempt,
                  };

                  console.warn(
                    `[strategyStore] ⚠ REVISION_CONFLICT (attempt ${attempt}/3). Preserving local edits and refetching...`,
                    conflictInfo,
                  );

                  set({
                    pendingConflictRecovery: true,
                    lastConflictInfo: conflictInfo,
                  });

                  try {
                    // refetchFromServer() will preserve local edits via extractServerDecidedPatch
                    // because dirty=true (we just attempted a save)
                    await get().refetchFromServer();
                  } catch (refetchErr) {
                    console.error('[strategyStore] refetch after conflict failed:', refetchErr);
                    set({
                      saveError: 'リビジョン競合が発生しました。あなたの変更は保持されています。画面を再読み込みしてください。',
                      pendingConflictRecovery: false,
                    });
                    return { ok: false, reason: 'refetch_failed_after_conflict', error: refetchErr, code: 'REFETCH_FAILED' };
                  }

                  // Exponential backoff: 0ms (1st), 250ms (2nd), 800ms (3rd)
                  if (attempt === 2) {
                    await new Promise((resolve) => setTimeout(resolve, 250));
                  } else if (attempt >= 3) {
                    await new Promise((resolve) => setTimeout(resolve, 800));
                  }

                  if (attempt >= 3) {
                    console.warn('[strategyStore] REVISION_CONFLICT persists after 3 retries. Entering cooldown.');
                    set({
                      saveError: '他のユーザーの更新と競合しました。あなたの変更は保持されています。内容を確認して再度保存してください。',
                      pendingConflictRecovery: false,
                      conflictCooldownUntil: Date.now() + 3000, // 3 second cooldown
                    });
                    return { ok: false, reason: 'revision_conflict_persist', error: err, code: 'REVISION_CONFLICT' };
                  }

                  continue;
                }

                console.error('[strategyStore] saveStrategyData API error:', err ?? 'unknown error');
                set({ saveError: `保存に失敗しました: ${(err as any)?.message || '不明なエラー'}` });
                return { ok: false, reason: 'api_error', error: err, code: errCode };
              }

              const serverData = (res as any).data ?? {};

              // STAGE3 bridge post-save check
              if (!!(payload as any).stage3_strategy_bridge) {
                console.log('[STAGE3] save stage3_strategy_bridge completed', {
                  payloadBridge_included: true,
                  payloadBridge_keyThemesLen: Array.isArray((payload as any).stage3_strategy_bridge?.keyThemes) ? (payload as any).stage3_strategy_bridge.keyThemes.length : 0,
                  payloadBridge_hasStrategicCore: !!(payload as any).stage3_strategy_bridge?.strategicCore,
                  serverData_has_bridge: !!(serverData as any).stage3_strategy_bridge,
                  serverData_bridge_keys: (serverData as any).stage3_strategy_bridge ? Object.keys((serverData as any).stage3_strategy_bridge) : [],
                  serverData_hasStrategicCore: !!(serverData as any).stage3_strategy_bridge?.strategicCore,
                  companyId: companyId?.substring(0, 8),
                  reason,
                  timestamp: new Date().toISOString(),
                });
              }

              // ★ 診断：保存成功後、DB から復元した okrTargetScores を確認
              console.log('[diag][stage5:after_save]', {
                success: true,
                serverData_okrTargetScores_keys: Object.keys((serverData as any).okrTargetScores ?? {}).length,
                serverData_okrTargetScores_sample: Object.entries((serverData as any).okrTargetScores ?? {}).slice(0, 3),
              });

              const minimal = extractServerDecidedPatch(serverData, get() as StrategyState);

              const updatedAt =
                (serverData as any)?.updatedAt ??
                (serverData as any)?.updated_at ??
                (res as any)?.updatedAt ??
                new Date().toISOString();

              // ★ 根治対策：保存返却では「サーバー決定値のみ」を state に反映
              // 禁止：departments/projects/okrs/kpis/finalStory*/companyTargets/answers12など
              // 許可：revision/updatedAt/id/strategyId のみ（autosave再発火を防ぐ）
              const returnedRevision = typeof (minimal as any).revision === 'number' ? (minimal as any).revision : undefined;
              const nowMs = Date.now();

              const safePatch: Partial<StrategyState> = {
                dirty: false,
                __lastSavedHash: currentHash,
                /* ★ DB is source of truth for revision */
                ...(returnedRevision !== undefined && { revision: returnedRevision }),
                /* UI state: 保存成功時に更新 */
                saveError: undefined,
                lastSavedAt: nowMs,
                lastServerSyncAt: nowMs, // ★ Track when server sync completed
                // ★ TASK 1: Clear conflict recovery state on success
                pendingConflictRecovery: false,
                conflictCooldownUntil: undefined,
                lastConflictInfo: undefined,
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

              // ★ CRITICAL: After safePatch is set, reflect extracted server data（including stage3_strategy_bridge）
              if (Object.keys(minimal).length > 0) {
                set(minimal);
              }

              // ★ CRITICAL: 保存後に完全版bridge を復元（payloadまたはserverDataから）
              // ログではserverData bridge keys: Array(7)なので、完全版がDBに保存されている
              // だがminimal で処理された後、旧形式に戻るケースがあるため、必ず完全版で上書き
              const payloadBridge = (payload as any).stage3_strategy_bridge;
              const serverBridge = (serverData as any).stage3_strategy_bridge;
              const currentStoreState = get();
              const currentStoreBridge = currentStoreState.stage3_strategy_bridge;

              let bridgeToRestore = null;
              if (payloadBridge?.strategicCore) {
                bridgeToRestore = payloadBridge;
              } else if (serverBridge?.strategicCore) {
                bridgeToRestore = serverBridge;
              } else if (currentStoreBridge?.strategicCore) {
                bridgeToRestore = currentStoreBridge;
              } else if (serverBridge) {
                bridgeToRestore = serverBridge;
              } else if (payloadBridge) {
                bridgeToRestore = payloadBridge;
              }

              if (bridgeToRestore?.strategicCore) {
                set({ stage3_strategy_bridge: bridgeToRestore });
                if (DEBUG) {
                  console.log('[STAGE3 bridge post-save restore] complete version restored', {
                    source: payloadBridge?.strategicCore ? 'payload' : serverBridge?.strategicCore ? 'server' : 'current',
                    hasStrategicCore: !!bridgeToRestore.strategicCore,
                    keys: Object.keys(bridgeToRestore),
                  });
                }
              }

              // ★ STAGE3 bridge post-patch check
              const storeAfterPatch = get();
              if (!!(payload as any).stage3_strategy_bridge) {
                console.log('[STAGE3] bridge restore after save', {
                  payloadBridge_hasStrategicCore: !!(payload as any).stage3_strategy_bridge?.strategicCore,
                  serverBridge_hasStrategicCore: !!(serverBridge)?.strategicCore,
                  storeNow_hasBridge: !!(storeAfterPatch as any).stage3_strategy_bridge,
                  storeNow_hasStrategicCore: !!(storeAfterPatch as any).stage3_strategy_bridge?.strategicCore,
                  storeNow_bridge_keys: (storeAfterPatch as any).stage3_strategy_bridge ? Object.keys((storeAfterPatch as any).stage3_strategy_bridge) : [],
                  restoredFrom: bridgeToRestore?.strategicCore ? 'complete_version' : 'minimal_patch',
                  timestamp: new Date().toISOString(),
                });
              }

              // ★ nextRev: Use returned revision if available, otherwise keep current
              const nextRev = returnedRevision ?? get().revision;

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

              /* ★ Stage6 検証ログ */
              if (Array.isArray((payload as any).projectTargetImpacts) || Array.isArray((payload as any).projectIssueLinks)) {
                console.log('[SAVE] ✅ Revision increment verified', {
                  revision: nextRev,
                  projectTargetImpacts_len: Array.isArray((payload as any).projectTargetImpacts) ? (payload as any).projectTargetImpacts.length : 0,
                  projectIssueLinks_len: Array.isArray((payload as any).projectIssueLinks) ? (payload as any).projectIssueLinks.length : 0,
                });
              }

              if (DEBUG) console.log('[strategyStore] saveStrategyData success', { reason, revision: nextRev, updatedAt });

              return { ok: true, revision: nextRev, updatedAt };
            }

            // ループを抜けることは基本ないが保険
            return { ok: false, reason: 'unknown_exit' };
          } finally {
            // ★ 根治対策：finally で確実に isSaving を戻す（例外時も実行）
            const s = get();
            const shouldRunAgain = !!s._pendingSave;

            set((st) => ({
              ...st,
              _loadingSave: false,
              boot: { ...(st.boot ?? {}), isSaving: false },
              _pendingSave: false,
            }));

            if (shouldRunAgain) {
              // 非同期で後追い保存（直列化）
              if (DEBUG) console.log('[strategyStore] pending detected, re-running saveStrategyData', { reason: s._pendingSaveReason });
              setTimeout(() => {
                void get().saveStrategyData({ force: true, reason: s._pendingSaveReason ?? 'pending' });
              }, 0);
            }
          }
        });
      },

      async refetchFromServer() {
        const timestamp = new Date().toISOString();
        const s0 = get();
        const companyId = s0.pendingCompanyId || s0.companyId || useUserStore.getState().companyId;

        const authed = await isSessionUsable();
        if (!companyId || !authed) {
          console.warn('[refetchFromServer:auth-failure] ❌ Authentication or companyId check failed', {
            timestamp,
            hasCompanyId: !!companyId,
            authed,
          });
          set((s) => ({
            ...s,
            __isFetchingFromServer: false,
            loaded: false,
            isRestoring: false,
            restoreReady: false,
          }));
          // ★ isHydrating だけを確実にリセット
          const authReason: string = !authed ? 'refetchFromServer:auth-failure' : 'refetchFromServer:no-companyId';
          get().setHydratingFlag(false, authReason);
          scheduleRefetchRetry(1500);
          throw new Error('会社IDまたは認証情報が見つかりません');
        }

        if (get()._loadingRefetch) {
          console.log('[refetchFromServer:early-return] already loading, skip', { timestamp });
          return;
        }

        console.log('[refetchFromServer:start] 🔄 Fetch started', {
          companyId,
          timestamp,
          currentHydrating: get().boot?.isHydrating,
        });
        /* ★ TASK 14: restore フラグを開始（DB restore 中を示す） */
        set({ _loadingRefetch: true, __isFetchingFromServer: true, isRestoring: true });
        set((s) => ({ ...s, boot: { ...s.boot, isHydrating: true } }));
        if (DEBUG) console.log('[flags:set] boot.isHydrating=true', { timestamp });

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

            console.warn('[refetchFromServer:error] ❌ Data fetch failed', {
              errorCode,
              errorStatus,
              isTransientError,
              message: (error as any)?.message,
              timestamp,
            });

            set((s) => ({
              ...s,
              __isFetchingFromServer: false,
              loaded: false,
              __lastServerError: isTransientError ? undefined : error,
              isRestoring: false,
              restoreReady: false,
            }));
            // ★ isHydrating だけを確実にリセット
            const errorReason = `refetchFromServer:error-${errorCode || 'unknown'}`;
            get().setHydratingFlag(false, errorReason);

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
              // ★ エラー時に isHydrating をリセット（finally で再度リセットされるが、念のため）
              const dbRowInitReason: string = 'refetchFromServer:dbrow-init-error';
              get().setHydratingFlag(false, dbRowInitReason);
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

          // ★ TRACE POINT 9: refetch - server response (patch) の departments/projects
          const patchDepts = Array.isArray((patch as any).departments) ? (patch as any).departments : [];
          const patchProjCount = patchDepts.reduce((s: number, d: any) => {
            return s + (Array.isArray(d?.projects) ? d.projects.length : 0);
          }, 0);
          const patchSummary = patchDepts.map((d: any, di: number) => ({
            index: di,
            name: d?.name,
            projectCount: Array.isArray(d?.projects) ? d.projects.length : 0,
            projectTitles: (d?.projects ?? []).map((p: any) => p?.title),
          }));
          if (process.env.NEXT_PUBLIC_DEBUG_CASCADE === '1') {
            console.log('[TRACE_PROJECTS][refetchFromServer][server-response]', {
              strategyId: (patch as any)?.strategyId,
              timestamp: new Date().toISOString(),
              totalDepartments: patchDepts.length,
              totalProjects: patchProjCount,
              departments: patchSummary,
              wasDirty,
            });
          }

          if (wasDirty) {
            // ★ TRACE POINT 10a: extractServerDecidedPatch 前 - base state
            const baseDepts = Array.isArray((get() as any).departments) ? (get() as any).departments : [];
            const baseProjCount = baseDepts.reduce((s: number, d: any) => {
              return s + (Array.isArray(d?.projects) ? d.projects.length : 0);
            }, 0);
            if (process.env.NEXT_PUBLIC_DEBUG_CASCADE === '1') {
              console.log('[TRACE_PROJECTS][refetchFromServer][before-patch-wasDirty]', {
                strategyId: (patch as any)?.strategyId,
                timestamp: new Date().toISOString(),
                totalDepartments: baseDepts.length,
                totalProjects: baseProjCount,
                source: 'local-base',
              });
            }

            set((s) => {
              const base = s as StrategyState;

              // ★ TRACE POINT 10a-detailed: base state の departments/projects
              const baseDepts_detailed = Array.isArray((base as any).departments) ? (base as any).departments : [];
              const baseProjCount_detailed = baseDepts_detailed.reduce((s: number, d: any) => {
                return s + (Array.isArray(d?.projects) ? d.projects.length : 0);
              }, 0);
              if (process.env.NEXT_PUBLIC_DEBUG_CASCADE === '1') {
                console.log('[TRACE_PROJECTS][refetchFromServer][set-wasDirty-base-before-merge]', {
                  strategyId: (patch as any)?.strategyId,
                  timestamp: new Date().toISOString(),
                  totalDepartments: baseDepts_detailed.length,
                  totalProjects: baseProjCount_detailed,
                });
              }

              // ★ 根本原因①修正：FULL REPLACEMENT に変更
              // minimal（条件付き）ではなく patch（全フィールド）を使用
              // 理由：minimal に departments がない場合、base が復帰する問題を根治

              console.log('[audit][refetchFromServer:merge-strategy]', {
                strategyId: (patch as any)?.strategyId,
                timestamp: new Date().toISOString(),
                mergeMode: 'FULL_REPLACEMENT (patch → state)',
                patchHasDepartments: Array.isArray((patch as any)?.departments),
                baseDeptCount: Array.isArray((base as any).departments) ? (base as any).departments.length : 0,
                patchDeptCount: Array.isArray((patch as any)?.departments) ? (patch as any).departments.length : 0,
              });

              // ★ STEP2 修正：dirty状態で危険な構造体だけ base 優先
              // 理由：unsaved changes（削除したdepartment など）を保護
              // 但し base が無効（undefined/null）なら patch を使う（復旧可能）
              const merged = {
                ...base,
                ...patch,

                // 危険な構造体だけ base 優先（有効値の時のみ）
                departments: Array.isArray(base.departments) ? base.departments : patch.departments,
                stage4Plans: Array.isArray(base.stage4Plans) ? base.stage4Plans : patch.stage4Plans,
                executionPlanBaseline: base.executionPlanBaseline != null ? base.executionPlanBaseline : patch.executionPlanBaseline,
                projectTargetImpacts: Array.isArray(base.projectTargetImpacts) ? base.projectTargetImpacts : patch.projectTargetImpacts,
                projectIssueLinks: Array.isArray(base.projectIssueLinks) ? base.projectIssueLinks : patch.projectIssueLinks,

                companyId: s.pendingCompanyId ?? s.companyId,
                pendingCompanyId: undefined,
              };

              // ★ TRACE POINT 10c-detailed: merged state の departments/projects
              const mergedDepts = Array.isArray((merged as any).departments) ? (merged as any).departments : [];
              const mergedProjCount = mergedDepts.reduce((s: number, d: any) => {
                return s + (Array.isArray(d?.projects) ? d.projects.length : 0);
              }, 0);
              if (process.env.NEXT_PUBLIC_DEBUG_CASCADE === '1') {
                console.log('[TRACE_PROJECTS][refetchFromServer][set-wasDirty-merged]', {
                  strategyId: (patch as any)?.strategyId,
                  timestamp: new Date().toISOString(),
                  totalDepartments: mergedDepts.length,
                  totalProjects: mergedProjCount,
                  delta: mergedProjCount - baseProjCount_detailed,
                });
              }

              return merged as any;
            });

            const after = get();
            const rev = typeof patch.revision === 'number' ? patch.revision : after.revision ?? 0;

            set({ loaded: true });
            get().setHydrated(rev);
            console.log('[refetchFromServer:done] ✅ Fetch and restore complete (wasDirty=true)', {
              timestamp,
              revision: rev,
            });
            /* ★ TASK 14: restore 完了フラグを設定（DB restore 完了） */
            set({
              restoreReady: true,
              isRestoring: false,
              /* ★ FIX: Enable grace period for wasDirty=true refetch path */
              lastServerSyncAt: Date.now(),
            });

            // ★ TRACE POINT 11: refetch final state after patch applied (wasDirty=true)
            if (process.env.NEXT_PUBLIC_DEBUG_CASCADE === '1') {
              const finalState = get();
              const finalDepts = Array.isArray(finalState.departments) ? finalState.departments : [];
              const finalProjCount = finalDepts.reduce((s: number, d: any) => {
                return s + (Array.isArray(d?.projects) ? d.projects.length : 0);
              }, 0);
              console.log('[TRACE_PROJECTS][refetchFromServer][final-state-wasDirty-true]', {
                strategyId: finalState.strategyId,
                timestamp: new Date().toISOString(),
                totalDepartments: finalDepts.length,
                totalProjects: finalProjCount,
                branch: 'wasDirty=true',
              });
            }

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
            // ★ 根本原因①修正：wasDirty=false パスでも FULL REPLACEMENT
            // DB fresh data (patch) が source of truth
            // isStale による localDeps 優先は廃止（削除復活の原因）
            set((s) => {
              const merged: any = {
                ...(s as any),   // ← base（補助用）
                ...(patch as any),  // ← DB fresh data で上書き（FULL REPLACEMENT）
                companyId: s.pendingCompanyId ?? s.companyId,
                pendingCompanyId: undefined,
              };

              console.log('[audit][refetchFromServer:wasDirty=false]', {
                strategyId: (patch as any)?.strategyId,
                timestamp: new Date().toISOString(),
                mergeMode: 'FULL_REPLACEMENT (patch → state)',
                patchDeptCount: Array.isArray((patch as any)?.departments) ? (patch as any).departments.length : 0,
                isStale,
                isSwitchingCompany,
              });

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
              /* ★ TASK 3: Track when server sync completed for post-restore cooldown */
              lastServerSyncAt: Date.now(),
            });
            console.log('[refetchFromServer:done] ✅ Fetch and restore complete (wasDirty=false)', {
              timestamp,
              revision: rev,
            });

            get().setHydrated(rev, hash);

            // ★ TRACE POINT 12: refetch final state after patch applied (wasDirty=false)
            if (process.env.NEXT_PUBLIC_DEBUG_CASCADE === '1') {
              const finalState = get();
              const finalDepts = Array.isArray(finalState.departments) ? finalState.departments : [];
              const finalProjCount = finalDepts.reduce((s: number, d: any) => {
                return s + (Array.isArray(d?.projects) ? d.projects.length : 0);
              }, 0);
              console.log('[TRACE_PROJECTS][refetchFromServer][final-state-wasDirty-false]', {
                strategyId: finalState.strategyId,
                timestamp: new Date().toISOString(),
                totalDepartments: finalDepts.length,
                totalProjects: finalProjCount,
                branch: 'wasDirty=false',
                isSwitchingCompany,
                isStale,
              });
            }

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
          /* ★ CRITICAL: 全経路で isHydrating を確実にリセット */
          console.log('[refetchFromServer:finally] cleanup all flags', { timestamp });
          set({
            _loadingRefetch: false,
            __isFetchingFromServer: false,
            isRestoring: false,
          });
          // ★ isHydrating だけを確実にリセット（isHydrated は維持）
          get().setHydratingFlag(false, 'refetchFromServer:finally');
        }
      },

      async deleteAllOnServer() {
        const operationId = `deleteAll_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
        console.log('[strategyStore.deleteAllOnServer] ===== START =====', { operationId });

        const userId = useUserStore.getState().user?.id;
        const companyId = get().companyId || useUserStore.getState().companyId;
        console.log('[strategyStore.deleteAllOnServer] userId:', userId, 'companyId:', companyId, { operationId });
        if (!userId || !companyId) throw new Error('missing ids');

        if (!(await isSessionUsable())) {
          console.warn('[strategyStore.deleteAllOnServer] session not usable', { operationId });
          return;
        }

        // ★ 修正：削除開始時に localStorage に削除フラグを設定（expiresAt 付き）
        const DELETION_FLAG_KEY = '__deleting_company__';
        const deletionFlagExpiresAt = Date.now() + 60000; // 60秒後に自動削除
        try {
          if (typeof localStorage !== 'undefined') {
            localStorage.setItem(
              DELETION_FLAG_KEY,
              JSON.stringify({
                companyId,
                operationId,
                expiresAt: deletionFlagExpiresAt,
              })
            );
            console.log('[strategyStore.deleteAllOnServer] Deletion flag set with expiry', {
              operationId,
              companyId,
              expiresAt: new Date(deletionFlagExpiresAt).toISOString(),
            });
          }
        } catch (e) {
          console.warn('[strategyStore.deleteAllOnServer] Failed to set deletion flag:', e);
        }

        try {
          // ★ 修正：Server route API を呼ぶ（RLS 回避、service role 使用）
          console.log('[strategyStore.deleteAllOnServer] Calling /api/admin/data-management/delete-all...', { operationId });

          // Supabase から access_token を取得
          let accessToken: string | null = null;
          try {
            const { getBrowserSupabase } = await import('@/utils/supabase/client');
            const supabase = getBrowserSupabase?.();
            if (supabase) {
              const { data: { session } } = await supabase.auth.getSession();
              accessToken = session?.access_token ?? null;
            }
          } catch (e) {
            console.warn('[strategyStore.deleteAllOnServer] Failed to get access token:', e);
          }

          const headers: Record<string, string> = {
            'Content-Type': 'application/json',
          };
          if (accessToken) {
            headers['Authorization'] = `Bearer ${accessToken}`;
            console.log('[strategyStore.deleteAllOnServer] Authorization header set', { operationId });
          } else {
            console.warn('[strategyStore.deleteAllOnServer] Warning: No access token available', { operationId });
          }

          const deleteRes = await fetch('/api/admin/data-management/delete-all', {
            method: 'POST',
            headers,
          });

          const deleteResult = await deleteRes.json();

          // API エラーチェック（detail を含める）
          if (!deleteRes.ok) {
            const errorMsg = (deleteResult as any)?.error || 'Unknown error';
            const errorDetail = (deleteResult as any)?.detail;
            console.error('[strategyStore.deleteAllOnServer] API error details:', {
              error: errorMsg,
              detail: errorDetail,
              operationId,
            });
            throw new Error(`Delete failed: ${errorMsg}${errorDetail?.message ? `: ${errorDetail.message}` : ''}`);
          }

          // API verify 失敗チェック
          const apiVerifySuccess = (deleteResult as any)?.verifySuccess ?? false;
          if (!apiVerifySuccess) {
            const remainingColumns = Object.entries((deleteResult as any)?.afterState || {})
              .filter(([_, v]) => v !== 0 && v !== false && v !== 'null')
              .map(([k]) => k);
            console.error('[strategyStore.deleteAllOnServer] API verification failed - remaining columns:', {
              operationId,
              remaining: remainingColumns,
            });
            throw new Error('API verification failed: Data not properly deleted');
          }

          // 削除成功確認
          const updatedCount = (deleteResult as any)?.updatedCount ?? 0;
          if (updatedCount === 0) {
            console.error('[strategyStore.deleteAllOnServer] No rows updated', { operationId });
            throw new Error('No rows were deleted');
          }

          // API 成功後に Supabase を再SELECT して最終確認（execution_plan_baseline, stage4_plans, final_story_edited 除外）
          try {
            const { getBrowserSupabase } = await import('@/utils/supabase/client');
            const supabase = getBrowserSupabase?.();
            if (supabase) {
              const { data: finalCheck, error: finalError } = await supabase
                .from('strategy_data')
                .select('final_story, story_draft, final_story_draft, final_story_final, stage3_strategy_bridge, departments')
                .eq('company_id', companyId)
                .maybeSingle();

              if (finalError) {
                throw finalError;
              }

              const finalVerifySuccess =
                (!finalCheck?.final_story || finalCheck.final_story.length === 0) &&
                (!finalCheck?.story_draft || finalCheck.story_draft.length === 0) &&
                (!finalCheck?.final_story_draft || finalCheck.final_story_draft.length === 0) &&
                (!finalCheck?.final_story_final || finalCheck.final_story_final.length === 0) &&
                !finalCheck?.stage3_strategy_bridge &&
                (!finalCheck?.departments || finalCheck.departments.length === 0);

              if (!finalVerifySuccess) {
                const remainingColumns = Object.entries(finalCheck || {})
                  .filter(([_, v]) => v && (Array.isArray(v) ? v.length > 0 : true))
                  .map(([k]) => k);
                console.error('[strategyStore.deleteAllOnServer] Final DB verification failed - remaining columns:', {
                  operationId,
                  remaining: remainingColumns,
                });
                throw new Error('Final DB verification failed: Data still present after deletion');
              }
            }
          } catch (e) {
            console.error('[strategyStore.deleteAllOnServer] Final DB verification error:', e, { operationId });
            throw e;
          }

          // clearStage2Snapshot helper を使用
          const { clearStage2Snapshot } = await import('@/utils/stageSnapshot');
          try {
            clearStage2Snapshot();
          } catch (e) {
            console.warn('[strategyStore.deleteAllOnServer] Failed to clear Stage2 snapshot:', e);
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
            finalStoryDraft: [],
            finalStoryEdited: [],
            finalStoryFinal: [],
            stage3_strategy_bridge: null,
          }));
        } catch (error) {
          console.error('[strategyStore.deleteAllOnServer] Error during deletion:', error, { operationId });
          // ★ エラー時も削除フラグをクリア（autosave を再開）
          const DELETION_FLAG_KEY = '__deleting_company__';
          try {
            if (typeof localStorage !== 'undefined') {
              localStorage.removeItem(DELETION_FLAG_KEY);
              console.log('[strategyStore.deleteAllOnServer] Deletion flag cleared due to error', { operationId });
            }
          } catch (e) {
            console.warn('[strategyStore.deleteAllOnServer] Failed to clear deletion flag:', e);
          }
          throw error;
        }
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
        // localStorage の rehydrate 完了と、DB restore 完了は別物。
        // ここで hydrated=true を立てると、古い local state が
        // server state より先に「利用可能」と判定される事故が起きやすい。
        // hydrated / restoreReady は refetchFromServer 完了時にのみ確定させる。
        if (!error && DEBUG) {
          console.log('[strategyStore] rehydrate complete (waiting for server restore)');
        }
      },
    }
  )
);

export async function refetchFromServer() {
  return useStrategyStore.getState().refetchFromServer();
}
