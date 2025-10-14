// /types/strategy.ts

/* =========================
 * OKR（Objective & Key Results）
 * ========================= */

/** OKR（Objective/KeyResults/Owner）
 * - progress_logs との突き合わせ用に id を任意追加
 */
export type OKR = {
  id?: string;               // 任意ID（進捗ログ okrId と紐付ける場合に使用）
  objective: string;
  keyResults: string[];
  owner?: string;            // 担当者（例: メンバー名やメールアドレス）
};

/* =========================
 * プロジェクト
 * ========================= */
export type Project = {
  title: string;             // ✅ 一貫して title に統一
  reason?: string;           // プロジェクトの目的・背景
  okrs?: OKR[];              // proj.okrs?.[0]?.objective で参照想定
};

/* =========================
 * 掘り下げ質問（段階ステップ）
 * ========================= */
export type AnswerStep = {
  stepNumber: number;  // ステップ番号（1から順に）
  question: string;    // 問いの本文
  reason: string;      // なぜこの問いが重要か（AIによる説明）
  answer: string;      // ユーザーの回答（空文字で初期化可能）
};

/** 章ごとの掘り下げ質問構造（answers2 に格納） */
export type ChapterAnswers = {
  chapterIndex: number;    // 章インデックス（0開始）
  chapterTitle: string;    // 章タイトル（例: 現状の危機や背景）
  steps: AnswerStep[];     // 章に属する段階ステップ
};

/* =========================
 * ストーリー（章構造）
 * ========================= */
export type ChapterStory = {
  title: string;           // 章タイトル
  body: string;            // 本文
};

/* =========================
 * 部門
 * ========================= */
export type Department = {
  id?: number;
  name: string;
  mission: string;               // 必須：部門ミッション
  strategy?: string;             // 手動編集用の戦略メモ（任意）
  missionDraft?: string;         // AIが提案した部門ミッション
  discussionNotes?: string;      // 部門内の自由記述メモ
  projects: Project[];           // プロジェクト群（AI案または編集済）
  questions?: AnswerStep[];      // 掘り下げ質問（任意／旧構成）
  answers2?: ChapterAnswers[];   // ステップ形式の掘り下げ回答
  finalized: boolean;            // 部門戦略が確定済みかどうか
};

/* =========================
 * 進捗ログ（OKRModal 用）
 * ========================= */
export type ProgressLog = {
  userId: string;
  okrId: string;            // OKR.id と紐付け
  progressText?: string;
  rating?: number;
  ratingComment?: string;
  advice?: string;
  helpRequest?: string;
  department?: string;
  project?: string;
};

/* =========================
 * 財務データ（JSONB）
 * =========================
 * Supabase 側は jsonb で array/object を許容。
 * 取得/保存を非破壊にするため、UIは「配列」を基本とする。
 */
export type CsvFinanceData = any[];

/* =========================
 * Supabase保存・読み込み用（純粋データ）
 * =========================
 * - アプリ内部では camelCase を正とする
 * - DBメタは snake_case を優先（互換で camel も残す）
 * - ★重要：3カラム（businessPortfolio / financeSummary / csvFinanceData）は optional
 *            → 未定義時は保存しない（空上書き回避）
 */
export type StrategyData = {
  /** === メタ（DBの snake_case を優先） === */
  id?: string;
  user_id?: string;
  company_id?: string;
  created_at?: string;  // ISO
  updated_at?: string;  // ISO
  updated_by?: string;

  /** 互換: 一部コードが camel のメタを参照している可能性に配慮（将来削除推奨） */
  strategyId?: string;  // ↔ id
  userId?: string;      // ↔ user_id
  companyId?: string;   // ↔ company_id
  createdAt?: string;   // ↔ created_at
  updatedAt?: string;   // ↔ updated_at

  /** === 会社プロフィール（camel）=== */
  companyName: string;
  foundationYear: string;
  location: string;
  industry: string;
  revenue: string;
  employees: string;
  businessContent: string;
  customerSegment: string;

  /** === MVV / 思考など（camel）=== */
  thought: string;
  mission: string;
  vision: string;
  value: string;

  /** === SWOT（camel）=== */
  strength: string;
  weakness: string;
  opportunity: string;
  threat: string;

  /** === 事業ポートフォリオ（jsonb object）=== */
  businessPortfolio?: Record<string, any>; // ← optional（undefined は送らない）

  /** === 財務サマリ（保存は {items: []}、読みは配列）=== */
  financeSummary?: any[]; // ← optional（undefined は送らない）

  /** === 財務明細CSV（配列ベース）=== */
  csvFinanceData?: CsvFinanceData; // ← optional（undefined は送らない）

  /** === ストーリー（配列）=== */
  story: ChapterStory[];       // たたき台
  finalStory: ChapterStory[];  // 確定版

  /** 要約など（DBのCHECK都合で array/object/string 混在の可能性 → unknown で受ける） */
  strategySummary?: unknown;

  /** === 旧：一括生成の問い/理由（レガシー互換, 任意）=== */
  questions?: string[];
  reasons?: string[];
  questions2?: string[];
  reasons2?: string[];

  /** === 旧：一括回答（レガシー互換, 任意）=== */
  answers?: string[];

  /** === 新：章ごとの段階ステップ回答（正規）=== */
  answers2: ChapterAnswers[];

  /** === 部門（正規ルート）=== */
  departments: Department[];   // ✅ こちらを正とする

  /** 互換（将来廃止推奨） */
  editableCascadeResult?: Department[]; // 旧フィールド名の互換
  editableCascade?: unknown;            // 旧構造の互換用（参照のみ推奨）

  /** === 通知・権限（アプリ内で使用, DB非依存）=== */
  notification?: string;
  role?: 'admin' | 'manager' | 'member';
};

/* =========================
 * Zustand ストア用（拡張）
 * =========================
 * - setter 群は UI から直接呼ばれる想定
 * - 3カラム用の setter を追加（optional前提）
 */
export interface StrategyState extends StrategyData {
  setCompanyName: (v: string) => void;
  setFoundationYear: (v: string) => void;
  setLocation: (v: string) => void;
  setIndustry: (v: string) => void;
  setRevenue: (v: string) => void;
  setEmployees: (v: string) => void;
  setBusinessContent: (v: string) => void;
  setCustomerSegment: (v: string) => void;

  setThought: (v: string) => void;
  setMission: (v: string) => void;
  setVision: (v: string) => void;
  setValue: (v: string) => void;

  setStrength: (v: string) => void;
  setWeakness: (v: string) => void;
  setOpportunity: (v: string) => void;
  setThreat: (v: string) => void;

  // ★3カラム（optional）
  setBusinessPortfolio: (v: Record<string, any> | undefined) => void;
  setFinanceSummary: (v: any[] | undefined) => void;
  setCsvFinanceData: (v: CsvFinanceData | undefined) => void;

  setStory: (v: ChapterStory[]) => void;
  setFinalStory: (v: ChapterStory[]) => void;

  setAnswers: (v: string[]) => void;             // 旧
  setAnswers2: (v: ChapterAnswers[]) => void;     // 新（推奨）

  setStrategySummary: (v: unknown) => void;

  // 部門：正→departments、互換→editableCascadeResult
  setDepartments: (v: Department[]) => void;      // ✅ 正規
  setEditableCascadeResult?: (v: Department[]) => void; // 互換

  setNotification: (v: string) => void;
  setRole: (v: 'admin' | 'manager' | 'member') => void;

  saveToSupabase: () => Promise<void>;
  loadFromSupabase: () => Promise<void>;
  clearAllData: () => void;
}

/* =========================================================
 * ここから追加：勝ちパターン（上位/下位）＆ V2 ストーリー型
 * ========================================================= */

/** 上位（経営）パターン：外資系コンサル系の経営テーマに相当 */
export type TopStrategyPattern = {
  id: string;          // 例: 't1'..'t10'
  title: string;       // 例: '選択と集中（Focus & Scale）'
  summary: string;     // 概要（短文）
  firstMove: string;   // 経営としての最初の一手
  kpiAxis: string;     // KPI軸（ROIC/海外売上比率 など）
  pitfalls: string[];  // 典型的な落とし穴
};

/** 下位（実行）パターン：部門・現場実装の型 */
export type ExecStrategyPattern = {
  id: string;          // 例: 'e1'..'e10'
  title: string;       // 例: 'フリクション撲滅ファネル'
  when: string[];      // 効く条件
  firstStep: string;   // 初手（1スプリントでやること）
  kpi: string;         // 先行指標（1軸）
  pitfalls: string[];  // ありがちな失敗
};

/** 上位→下位の推奨マッピング（最大3件程度が基本） */
export type PatternBridge = {
  topId: string;                // 't*'
  recommendedExecIds: string[]; // ['e1','e4','e5']
};

/** ストーリー下書き V2：上位/下位パターンの候補を両方持つ */
export type StoryDraftV2 = {
  outline: { title: string; summary: string }[];
  lead: string;
  options: string[];
  topPatternSuggestions: { id: string; reason: string }[]; // t*
  patternSuggestions: { id: string; reason: string }[];    // e*（互換名）
  kpiStarters: string[];
  nextActions: string[];
};

/** ストーリー完成 V2：パターンの根拠と橋渡しを明示 */
export type FinalStoryV2 = {
  finalStory: string; // Markdown
  patternTrace: { patternId: string; where: string }[]; // 段落→t*/e*
  kpiPack: string[];                                    // 章ごとのKPIまとめ
  riskNotes: string[];                                  // 落とし穴と回避策
  execPatternBridge: {                                   // 上位→下位の橋渡し説明
    fromTopId: string;          // t*
    toExecIds: string[];        // e*
    rationale: string;          // なぜその橋渡しなのか
  }[];
};
