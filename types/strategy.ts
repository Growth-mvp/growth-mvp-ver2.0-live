/* =========================================================
 * GROWTH Ver4 タイプ定義（strategy.ts）
 * ---------------------------------------------------------
 * - 旧OKR（文字列KR）と新OKR（構造化KR）を共存
 * - OKR→財務シミュレーション連携のため KRStructured を拡張
 * - Supabase JSONB保存の互換・後方互換を重視
 * ========================================================= */

/* =========================================================
 * OKR（Objective & Key Results）【旧：互換維持】
 * ========================================================= */

/** OKR（Objective/KeyResults/Owner）
 * - 既存互換：文字列KRの配列を維持
 * - progress_logs 突き合わせ用に id を任意追加
 */
export type OKR = {
  id?: string;               // 任意ID（進捗ログ okrId と紐付ける場合に使用）
  objective: string;
  keyResults: string[];
  owner?: string;            // 担当者（例: メンバー名やメールアドレス）
};

/* =========================================================
 * 財務シミュレーション対応：構造化OKR（新）
 *   - 段階移行のため旧OKRと共存させる
 *   - 売上=数量×単価×継続率 などの演算に使う
 * ========================================================= */

export type KRKind =
  | 'REVENUE'        // 売上（増減額を直接加算）
  | 'ARPU'           // 顧客単価（+円）
  | 'ACQ'            // 新規獲得数（+件）
  | 'CHURN'          // 解約率（+率、改善は負値で表現）
  | 'COST_FIXED'     // 固定費（+円）
  | 'COST_VARIABLE'  // 変動費（+円）
  | 'PERSONNEL'      // 人件費（+円）
  | 'INVEST'         // 投資（+円, 効果はfinance側で扱う）
  | 'SUCCESS_RATE'   // 成功率（+率, 投資効果などに乗算予定）
  | 'SYNERGY'        // 相乗効果（+率, 収益/費用へ係数）
  | 'ACTIVITY';      // 活動系（訪問件数・情報取得など→主要KPIに変換）

export type KRScope = 'company' | 'department' | 'project';

export type BaseKey =
  | 'revenue'
  | 'arpu'
  | 'acq'
  | 'churn'
  | 'fixed_cost'
  | 'variable_cost'
  | 'personnel_cost'
  | 'invest'
  | 'success_rate'
  | 'synergy';

export type KRUnit = '%' | '¥' | '件' | '人' | '比率' | 'COUNT' | 'JPY' | 'RATIO' | 'OTHER';

/** OKR構造化（財務ブリッジで使用）
 * - target: 目標値（%は 0.10 のように小数で統一推奨。COUNT/JPYは実数）
 * - elasticity?: 活動系→主要KPIへ変換する感度（弾性）
 * - weight?: 同Kind内での合成ウェイト（未設定は均等）
 * - baseKey/baseOverride: ベース母数参照／上書き
 * - lagMonths?: 活動→成果までの遅行（0=即時）
 * - startYm?: 'YYYY-MM' 形式の個別開始
 */
export type KRStructured = {
  id: string;                      // 一意ID（将来の差分更新・履歴用）
  kind: KRKind;                    // どの係数に効くか
  label: string;                   // 表示名
  target: number;                  // 目標値（数値化）
  unit: KRUnit;                    // 単位（%は 0.10 等の小数推奨）
  due?: string;                    // 期限（'YYYY-MM' or 'YYYY-MM-DD'）
  owner?: string;                  // 担当者
  scope: KRScope;                  // 適用スコープ
  baseKey: BaseKey;                // 紐づくベース指標
  baseOverride?: number;           // ベース上書き（母数を直接指定）

  // 合成・変換・遅行
  weight?: number;                 // 同Kind合成の重み（未指定は均等）
  elasticity?: number;             // ACTIVITY→主要KPIの感度
  lagMonths?: number;              // 遅行（月数）
  startYm?: string;                // 個別開始 'YYYY-MM'
  notes?: string;                  // 任意メモ
};

/** 役割でOKRを束ねる場合（任意：将来拡張） */
export type ProjectRole = {
  role: string;           // 例: '営業','CS','生産'
  okrs: KRStructured[];   // 構造化OKRの束
};

/* =========================================================
 * プロジェクト
 * ========================================================= */
export type Project = {
  title: string;             // ✅ 一貫して title に統一
  reason?: string;           // プロジェクトの目的・背景

  /** 旧：文字列型OKR（既存UI互換用）
   *  - 参照例: proj.okrs?.[0]?.objective
   */
  okrs?: OKR[];

  /** 新：構造化OKR（財務シミュレーション用）
   *  - 段階移行のため optional とし、既存UIと共存
   *  - 参照例: proj.okrsV2?.[0]?.kind
   */
  okrsV2?: KRStructured[];

  /** 役割ごとにOKRを束ねる場合（任意） */
  roles?: ProjectRole[];
};

/* =========================================================
 * 掘り下げ質問（段階ステップ）
 * ========================================================= */
export type AnswerStep = {
  stepNumber: number;        // ステップ番号（1から順に）
  question: string;          // 問いの本文
  reason: string;            // なぜこの問いが重要か（AIによる説明）
  answer: string;            // ユーザーの回答（空文字で初期化可能）
};

/** 章ごとの掘り下げ質問構造（answers2 に格納） */
export type ChapterAnswers = {
  chapterIndex: number;      // 章インデックス（0開始）
  chapterTitle: string;      // 章タイトル（例: 現状の危機や背景）
  steps: AnswerStep[];       // 章に属する段階ステップ
};

/* =========================================================
 * ストーリー（章構造）
 * ========================================================= */
export type ChapterStory = {
  title: string;             // 章タイトル
  body: string;              // 本文
};

/* =========================================================
 * 部門
 * ========================================================= */
export type Department = {
  id?: number | string;           // Supabase側で bigint / uuid 対応可能
  name: string;
  mission: string;                // 必須：部門ミッション
  strategy?: string;              // 手動編集用の戦略メモ（任意）
  missionDraft?: string;          // AIが提案した部門ミッション
  discussionNotes?: string;       // 部門内の自由記述メモ
  projects: Project[];            // プロジェクト群（AI案または編集済）
  questions?: AnswerStep[];       // 掘り下げ質問（旧構成互換）
  answers2?: ChapterAnswers[];    // ステップ形式の掘り下げ回答
  finalized: boolean;             // 部門戦略が確定済みかどうか
};

/* =========================================================
 * 進捗ログ（OKRModal 用）
 * ========================================================= */
export type ProgressLog = {
  userId: string;
  okrId: string;                  // OKR.id と紐付け
  progressText?: string;
  rating?: number;
  ratingComment?: string;
  advice?: string;
  helpRequest?: string;
  department?: string;
  project?: string;
};

/* =========================================================
 * 財務データ（JSONB）
 * =========================================================
 * Supabase 側は jsonb で array/object を許容。
 * 取得/保存を非破壊にするため、UIは「配列」を基本とする。
 */
export type CsvFinanceData = any[];

/* =========================================================
 * Supabase保存・読み込み用（純粋データ）
 * =========================================================
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
  created_at?: string;        // ISO
  updated_at?: string;        // ISO
  updated_by?: string;

  /** 互換（camel） */
  strategyId?: string;
  userId?: string;
  companyId?: string;
  createdAt?: string;
  updatedAt?: string;

  /** === 会社プロフィール === */
  companyName: string;
  foundationYear: string;
  location: string;
  industry: string;
  revenue: string;
  employees: string;
  businessContent: string;
  customerSegment: string;

  /** === MVV / 思考など === */
  thought: string;
  mission: string;
  vision: string;
  value: string;

  /** === SWOT === */
  strength: string;
  weakness: string;
  opportunity: string;
  threat: string;

  /** === 事業ポートフォリオ（jsonb object）=== */
  businessPortfolio?: Record<string, any>; // optional（undefinedは送らない）

  /** === 財務サマリ（保存は {rows: []} 互換、読みは配列）=== */
  financeSummary?: any[];                  // optional

  /** === 財務明細CSV（配列ベース）=== */
  csvFinanceData?: CsvFinanceData;         // optional

  /** === ストーリー === */
  story: ChapterStory[];                   // たたき台（配列）
  finalStory: ChapterStory[];              // 確定版（配列）

  /** 要約など（DBのCHECK都合で array/object/string 混在の可能性） */
  strategySummary?: unknown;

  /** === 旧：一括生成の問い/理由 === */
  questions?: string[];
  reasons?: string[];
  questions2?: string[];
  reasons2?: string[];

  /** === 旧：一括回答 === */
  answers?: string[];

  /** === 新：章ごとの段階ステップ回答 === */
  answers2: ChapterAnswers[];

  /** === 部門（正規ルート）=== */
  departments: Department[];

  /** === 互換（旧Cascade構造）=== */
  editableCascadeResult?: Department[];    // 旧フィールド互換
  editableCascade?: unknown;               // 旧構造の互換用

  /** === 通知・権限（UI専用）=== */
  notification?: string;
  role?: 'admin' | 'manager' | 'member';
};

/* =========================================================
 * （任意）Zustand ストア用の拡張IF
 *   - 実際の store 実装に依存するので、アプリ側で必要に応じて定義/使用
 * ========================================================= */
export interface StrategyState extends StrategyData {
  // 任意：アプリ側でsetter群を定義して使う場合に拡張
}
