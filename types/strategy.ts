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
 * ========================= */
export type CsvFinanceData = Record<string, unknown>; // ✅ DBは jsonb（{}）既定

/* =========================
 * Supabase保存・読み込み用（純粋データ）
 * =========================
 * - アプリ内部では camelCase を正とする
 * - DBメタは snake_case を優先（互換で camel も残す）
 * - JSONB は必ず [] / {}（NOT NULL運用）
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

  /** === 財務JSON（必ずオブジェクト）=== */
  csvFinanceData: CsvFinanceData;

  /** === ストーリー（必ず配列）=== */
  story: ChapterStory[];       // たたき台
  finalStory: ChapterStory[];  // 確定版
  strategySummary?: string;    // 要約（任意）

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

  setCsvFinanceData: (v: CsvFinanceData) => void;

  setStory: (v: ChapterStory[]) => void;
  setFinalStory: (v: ChapterStory[]) => void;

  setAnswers: (v: string[]) => void;             // 旧
  setAnswers2: (v: ChapterAnswers[]) => void;     // 新（推奨）

  setStrategySummary: (v: string) => void;

  // 部門：正→departments、互換→editableCascadeResult
  setDepartments: (v: Department[]) => void;      // ✅ 正規
  setEditableCascadeResult?: (v: Department[]) => void; // 互換

  setNotification: (v: string) => void;
  setRole: (v: 'admin' | 'manager' | 'member') => void;

  saveToSupabase: () => Promise<void>;
  loadFromSupabase: () => Promise<void>;
  clearAllData: () => void;
}
