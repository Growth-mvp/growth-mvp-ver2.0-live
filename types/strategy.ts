/* =========================================================
 * GROWTH Ver4 タイプ定義（/types/strategy.ts）
 * ---------------------------------------------------------
 * 目的：
 * - 「戦略的OKR（戦略仮説 → 実行設計 → 財務接続）」に必要なメタ情報を型で担保
 * - 旧OKR（文字列KR）と新OKR（構造化KR）を共存し、段階移行を可能にする
 * - Supabase JSONB 保存の互換・後方互換を重視（全追加は optional が基本）
 *
 * ★この版で「戦略OKR」に必要な追加（互換維持）：
 * - 進化/探索（StrategyTrack）… 既存改善か新規探索か
 * - OKR/Projectの仮説（Hypothesis）… 何を変えれば何が起きるか（因果）
 * - 期待インパクト / 成功確率 / 検証指標（Impact, Probability, Validation）
 * - KRの「先行/遅行」や「学習型（探索）」の扱いを明示（MetricRole, Evidence）
 * - 財務ブリッジで確実に参照できるよう bridgeToLever / baseKey / scope 等を整理
 * ========================================================= */

/* =========================================================
 * 共通ユーティリティ型
 * ========================================================= */

export type ISODateString = string; // 'YYYY-MM-DD' など
export type Ym = string; // 'YYYY-MM'
export type UUID = string;

/**
 * 追加フィールドが入っても壊れないための拡張用
 *
 * 重要:
 * - 以前の `string & {}`（交差型）は、型推論で `T & string` のような不必要な交差を作りやすく、
 *   UI側で string を扱う箇所と衝突しやすい。
 * - JSONB互換と後方互換を優先し、ここでは素直に string とする。
 */
export type ExtensibleString = string;

/* =========================================================
 * 勝ち筋（Win Pattern）定義
 * ========================================================= */

export type WinPatternId =
  | 'SHORT_REVENUE' // 短期で売上を伸ばす
  | 'FUTURE_INVEST' // 未来への投資・新規事業
  | 'INDIRECT_PEOPLE' // 人材・組織力を高める
  | 'INDIRECT_PROCESS' // プロセス・生産性を高める
  | 'COST_FOCUS' // コスト削減・効率化
  | 'QUALITY_STABILITY' // 品質・安定運行を高める
  | 'HR_DEVELOPMENT' // 人材育成・エンゲージメント
  | 'OPERATION_EFFICIENCY' // 業務プロセス効率化
  | ExtensibleString;

export type WinPatternTimeHorizon = 'short' | 'mid' | 'long';

export type WinPatternFocus =
  | 'revenue'
  | 'cost'
  | 'product'
  | 'people'
  | 'process';

export type WinPatternDirectness = 'direct' | 'indirect';

export type WinPattern = {
  id: WinPatternId;
  label: string;
  description: string;
  timeHorizon: WinPatternTimeHorizon;
  focus: WinPatternFocus;
  directness: WinPatternDirectness;
  tags?: string[];
};

/* =========================================================
 * 勝ち筋レバー（Growth Lever）
 * ========================================================= */

export type GrowthLever =
  | 'ACQ' // 新規獲得
  | 'ARPU' // 単価アップ
  | 'CHURN' // 解約・離脱の抑制
  | 'COST' // コスト構造
  | 'INVEST'; // 将来投資（成功率など含む）

/* =========================================================
 * 戦略の「進化 / 探索」トラック（戦略OKRの最重要メタ）
 * ========================================================= */

/**
 * EVOLVE（進化）:
 * - 既存の勝ち筋・顧客・プロダクトを前提に、レバー改善を狙う
 * EXPLORE（探索）:
 * - 新規事業/新市場/新オペレーションなど不確実性が高く、学習KPIが重要
 */
export type StrategyTrack = 'EVOLVE' | 'EXPLORE';

/**
 * 進化/探索の理由（AI生成・人間の追記どちらでも）
 * - UIで「なぜ探索なのか」を説明可能にするために型として用意
 */
export type TrackRationale = {
  track: StrategyTrack;
  reason?: string;
  evidence?: string[]; // 根拠メモ（任意）
};

/* =========================================================
 * 戦略仮説（因果の骨格）
 * ========================================================= */

/**
 * 戦略的OKRのコア：
 * 何を（Input）変えると、何が（Output/Outcome）どう変わり、
 * それが最終的に財務にどう効くのか、を明示する。
 *
 * 重要（後方互換）:
 * - 既存UI/既存データでは hypothesis を「自由入力の1行テキスト(string)」として扱っている箇所があり得る。
 * - そこで、仮説は「string（簡易）」または「object（構造化）」の両方を許容する。
 */
export type HypothesisObject = {
  /** 一文で言い切る仮説（例：◯◯を強化すれば、△△が改善し、売上が伸びる） */
  statement: string;

  /** 期待する因果チェーン（任意：説明可能性のため） */
  causalChain?: string[]; // 例: ['商談数↑', '受注率↑', '売上↑']

  /** 前提条件（例：採用が間に合う、製品の不具合が収束する等） */
  assumptions?: string[];

  /** リスク（例：競合追随、原価高騰、法規制など） */
  risks?: string[];

  /** 反証条件（これが起きたら撤退/ピボット等） */
  falsifiers?: string[];
};

/** 後方互換のため string を許容 */
export type Hypothesis = string | HypothesisObject;

/* =========================================================
 * インパクト（期待効果）・確率・検証設計
 * ========================================================= */

export type Probability = {
  /**
   * 0〜1 の小数（推奨）
   * - EXPLOREではここが効く（成功確率 × インパクト）
   */
  value: number;
  /** 根拠（任意） */
  rationale?: string;
};

/**
 * 後方互換（レガシー吸収）:
 * - 既存データ/既存UIでは `probability: number` の可能性があるため許容する
 * - 新規・保存は基本的に `Probability`（object）を推奨
 */
export type ProbabilityLike = number | Probability;

/**
 * 正規化ヘルパー（今回のエラー対応の本丸）
 * - unknown を受けて、{ value: 0..1 } に揃える
 * - 0..1 はそのまま
 * - 1..100 は「百分率」とみなして /100
 * - NaN/Infinity/null/undefined は fallback
 * - 範囲外は clamp
 */
export function toProbability(
  input: unknown,
  fallback: number = 0.5,
  rationale?: string
): Probability {
  const n = typeof input === 'number' ? input : Number(input);
  const fb = Number.isFinite(fallback) ? fallback : 0.5;

  if (!Number.isFinite(n)) return { value: clamp01(fb), rationale };

  const normalized = n > 1 ? n / 100 : n; // 70 -> 0.7 を吸収
  return { value: clamp01(normalized), rationale };
}

/**
 * 値だけ欲しい場合（UI/計算向け）
 * - ProbabilityLike から 0..1 の number を返す
 */
export function getProbabilityValue(
  p: ProbabilityLike | undefined,
  fallback: number = 0.5
): number {
  if (typeof p === 'number') return clamp01(p > 1 ? p / 100 : p);
  if (p && typeof p === 'object') return clamp01(p.value);
  return clamp01(fallback);
}

function clamp01(n: number): number {
  if (!Number.isFinite(n)) return 0.5;
  return Math.min(1, Math.max(0, n));
}

export type Money = {
  amount: number; // JPYの整数が基本（ただし小数も許容）
  currency?: 'JPY' | 'USD' | 'EUR' | ExtensibleString;
};

export type Impact = {
  /** 財務インパクト（想定増益/売上など） */
  expectedAnnual?: Money;
  expected3Year?: Money;

  /**
   * 指標インパクト（例：受注率+2pt、解約率-1pt）
   * - 財務に直結しない場合でも、因果の途中指標を残せる
   */
  metricDelta?: Array<{
    metric: string;
    delta: number;
    unit?: string;
    note?: string;
  }>;

  /** 補足 */
  notes?: string;
};

/**
 * EXPLORE（探索）で必須化しやすい「検証設計」。
 * - 学習KPI / 検証方法 / 次アクションが曖昧だと戦略にならないため。
 */
export type ValidationPlan = {
  /** 学習で見たい先行指標 */
  learningMetrics?: string[];

  /** 検証方法（例：PoC、A/Bテスト、パイロット運用など） */
  methods?: string[];

  /** 判定基準（Go/Kill/Iterate） */
  successCriteria?: string[];

  /** 次の意思決定の期限 */
  decisionBy?: ISODateString | Ym;

  /** 追加メモ */
  notes?: string;
};

/* =========================================================
 * 経営レベル・実行レベルの戦略パターン型
 * ========================================================= */

export type TopStrategyPattern = {
  id: string;
  title: string;
  summary: string;
  firstMove: string;
  kpiAxis: string;
  pitfalls: string[];
};

export type ExecStrategyPattern = {
  id: string;
  title: string;
  when: string[];
  firstStep: string;
  kpi: string;
  pitfalls: string[];
};

/**
 * 上位戦略パターン → 下位実行パターンの推奨マッピング
 */
export type PatternBridge = {
  topId: string;
  recommendedExecIds: string[];
};

/* =========================================================
 * OKR（旧：互換維持）
 * ========================================================= */

export type OKR = {
  id?: string;
  objective: string;
  keyResults: string[];
  owner?: string;
  /**
   * ★戦略OKR追加（互換維持）
   * - 旧UIのままでも「進化/探索」と最低限の説明を保持できる
   */
  track?: StrategyTrack;
  levers?: GrowthLever[];
  hypothesis?: Hypothesis;
  probability?: ProbabilityLike;
  impact?: Impact;
  validation?: ValidationPlan;
};

/* =========================================================
 * 財務シミュレーション対応：構造化KR（新）
 * ========================================================= */

export type KRKind =
  | 'REVENUE'
  | 'ARPU'
  | 'ACQ'
  | 'CHURN'
  | 'COST_FIXED'
  | 'COST_VARIABLE'
  | 'PERSONNEL'
  | 'INVEST'
  | 'SUCCESS_RATE'
  | 'SYNERGY'
  | 'ACTIVITY';

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

export type KRUnit =
  | '%'
  | '¥'
  | '件'
  | '人'
  | '比率'
  | 'COUNT'
  | 'JPY'
  | 'RATIO'
  | 'OTHER';

/**
 * 指標の役割：
 * - LEADING（先行）… 行動/入力に近い
 * - LAGGING（遅行）… 成果/アウトカムに近い
 * - LEARNING（学習）… 探索の進捗（仮説検証）に近い
 */
export type MetricRole = 'LEADING' | 'LAGGING' | 'LEARNING';

/**
 * エビデンス（根拠）：
 * - AIが生成した「もっともらしさ」を、現場の根拠で補強するための入れ物
 */
export type Evidence = {
  sources?: string[]; // URL/社内資料/ヒアリング等（文字列でOK）
  notes?: string;
};

/**
 * KRStructured（戦略OKRの実務単位）
 * - 財務ブリッジで使うだけでなく、戦略的な説明責任を担保する
 */
export type KRStructured = {
  id: UUID;

  kind: KRKind;
  label: string;

  /** 目標値（% は 0.10 のように小数推奨） */
  target: number;

  unit: KRUnit;
  due?: ISODateString | Ym;
  owner?: string;

  scope: KRScope;
  baseKey: BaseKey;
  baseOverride?: number;

  /** 合成・変換・遅行 */
  weight?: number;
  elasticity?: number;
  lagMonths?: number;
  startYm?: Ym;
  notes?: string;

  /** 戦略メタ（★戦略OKR） */
  metricRole?: MetricRole; // 先行/遅行/学習
  track?: StrategyTrack; // 進化/探索（KR単位で持つと混在ケースに強い）
  bridgeToLever?: GrowthLever; // どのレバーに効くか
  mode?: 'direct' | 'indirect'; // 直接レバーか/間接支援か

  /** 仮説・根拠・期待効果（任意：プロジェクト側に集約しても良いが、KRにも持てる） */
  hypothesis?: Hypothesis;
  evidence?: Evidence;
  probability?: ProbabilityLike;
  impact?: Impact;

  /** 探索KPIの検証設計 */
  validation?: ValidationPlan;

  /**
   * 「セグメント/チャネル/プロダクト」など戦略の“当て先”
   * - Projectにもあるが、KR単位で異なるケースを許容
   */
  targetSegment?: string;
  targetChannel?: string;
  targetProduct?: string;
};

/** 役割でOKRを束ねる場合（任意：将来拡張） */
export type ProjectRole = {
  role: string;
  okrs: KRStructured[];
  levers?: GrowthLever[];
  track?: StrategyTrack;
};

/* =========================================================
 * プロジェクト（戦略OKRの主戦場）
 * ========================================================= */

export type Project = {
  title: string; // ✅ 一貫して title に統一
  reason?: string;

  /** 旧OKR（互換） */
  okrs?: OKR[];

  /** 新：構造化OKR（財務/説明責任） */
  okrsV2?: KRStructured[];

  /** 役割ごと束ね（任意） */
  roles?: ProjectRole[];

  /** ★戦略OKR：進化/探索（プロジェクトの基本トラック） */
  track?: StrategyTrack;

  /** ★戦略OKR：勝ち筋レバー（複数可） */
  levers?: GrowthLever[];

  /** ★戦略OKR：仮説（プロジェクト単位の因果） */
  hypothesis?: Hypothesis;

  /** ★戦略OKR：期待インパクト（年次/3年など） */
  impact?: Impact;

  /** ★戦略OKR：成功確率（探索で特に重要） */
  probability?: ProbabilityLike;

  /** ★戦略OKR：検証設計（探索で特に重要） */
  validation?: ValidationPlan;

  /** 戦略の当て先（必ず意識させる） */
  targetSegment?: string;
  targetChannel?: string;
  targetProduct?: string;

  /** 追加説明（レビュー/監査向け） */
  rationale?: string; // なぜこのプロジェクトか（戦略整合）
};

/* =========================================================
 * 掘り下げ質問（段階ステップ）
 * ========================================================= */

export type AnswerStep = {
  stepNumber: number;
  question: string;
  reason: string;
  answer: string;
};

export type ChapterAnswers = {
  chapterIndex: number;
  chapterTitle: string;
  steps: AnswerStep[];
};

/* =========================================================
 * ストーリー（章構造）
 * ========================================================= */

export type ChapterStory = {
  title: string;
  body: string;
};

/* =========================================================
 * 事業セグメント（STAGE1 基本情報で定義）
 * ========================================================= */

export type BusinessSegment = {
  id: string;       // UUID
  name: string;     // セグメント名（例：製造事業、サービス事業）
  scope?: string;   // 対象範囲・備考（任意）
};

/* =========================================================
 * 財務BS（STAGE1 指標⑤用）
 * ========================================================= */

/**
 * 年度別 BS（貸借対照表）+ 投下資本
 * - ROIC 計算に必要な最小項目
 */
export type FinanceBSRow = {
  year: number;
  totalAssets?: number;          // 総資産
  netAssets?: number;            // 純資産（株主資本）
  interestBearingDebt?: number;  // 有利子負債
  investedCapital?: number;      // 投下資本（純資産 + 有利子負債）※自動計算可
  nopat?: number;                // NOPAT（税引後営業利益）※営業利益 × (1 - 税率) で算出
};

/* =========================================================
 * 5指標分析（STAGE1 → STAGE2 第1章への接続）
 * ========================================================= */

/**
 * 5指標の計算結果と経営者の論点
 * - 指標①〜⑤の値と、それぞれに対する所感・論点を保持
 * - STAGE2 第1章の自動生成インプットとして使用
 *
 * ★ Ver4 拡張：
 * - 旧形式（baseYear, revenueGrowthRate, ...Note 等）を維持しつつ、
 * - 新形式（operatingMarginPctLatest, revenueCagrPct, debtEquityRatio, roic, roe, roa, per, pbr）を追加
 * - 両形式を optional で共存させ、段階移行を可能にする
 */
export type ValueAnalysis = {
  // === 旧形式（互換維持） ===
  // 基準年度
  baseYear?: number;

  // ① 売上高成長率（CAGR %）
  revenueGrowthRate?: number;
  revenueGrowthNote?: string;

  // ② 営業利益率（%）
  operatingMarginRate?: number;
  operatingMarginNote?: string;

  // ③ ROIC（%）= NOPAT / 投下資本
  roic?: number;
  roicNote?: string;

  // ④ WACC（%）※簡易入力 or 業界平均
  wacc?: number;
  waccNote?: string;

  // ⑤ PBR（倍）= 時価総額 / 純資産
  pbr?: number;
  pbrNote?: string;

  // 総合所感（経営者が記入）
  overallNote?: string;

  // 計算日時
  calculatedAt?: string;

  // === 新形式（Ver4 拡張） ===
  /** 最新年の営業利益率（%） */
  operatingMarginPctLatest?: number;

  /** 期間の売上CAGR（%） */
  revenueCagrPct?: number;

  /** D/E レシオ（倍率） */
  debtEquityRatio?: number;

  /** ROE（%） */
  roe?: number;

  /** ROA（%） */
  roa?: number;

  /** PER（倍） */
  per?: number;

  /** メタ情報（計算根拠・出所など） */
  meta?: {
    computedAt?: string;
    source?: 'local' | 'server';
    basis?: {
      years?: number[];
      latestYear?: number;
    };
    notes?: string[];
  };
};

/* =========================================================
 * STAGE1 論点ブロック（IssueBlock）
 * ========================================================= */

/**
 * STAGE1 の論点整理で使う「論点ブロック」
 * - 財務指標を踏まえて、経営として向き合うべき論点を整理
 * - STAGE2 第1章への接続点として使用
 */
export type IssueBlock = {
  title: string;
  description: string;
  linkedMetrics: string[];
  scope: 'company' | 'business';
};

/* =========================================================
 * 部門
 * ========================================================= */

export type DepartmentType =
  | 'sales'
  | 'marketing'
  | 'cs'
  | 'hr'
  | 'corp'
  | 'it'
  | 'finance'
  | 'production'
  | 'other';

export type Department = {
  id?: number | string;
  name: string;
  mission: string;
  strategy?: string;
  missionDraft?: string;
  discussionNotes?: string;
  projects: Project[];
  questions?: AnswerStep[];
  answers2?: ChapterAnswers[];
  finalized: boolean;

  departmentType?: DepartmentType;

  /** ★戦略OKR：部門の主レバー（複数可） */
  focusLevers?: GrowthLever[];

  /** ★戦略OKR：部門の進化/探索の基本トーン */
  track?: StrategyTrack;

  /** ★勝ち筋（部門がどこに寄与するか） */
  winPatternPrimary?: WinPatternId;
  winPatternSecondary?: WinPatternId;

  /** 部門単位の仮説（任意：プロジェクトに集約でもOK） */
  hypothesis?: Hypothesis;

  /** 部門単位の補足（例：他部門との依存関係） */
  dependencies?: string[];
};

/* =========================================================
 * 進捗ログ（OKRModal 用）
 * ========================================================= */

export type ProgressLog = {
  userId: string;
  okrId: string;
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
 * ========================================================= */

export type CsvFinanceData = any[];

/* =========================================================
 * Supabase保存・読み込み用（純粋データ）
 * ========================================================= */

export type StrategyData = {
  /** === メタ（DBの snake_case を優先） === */
  id?: string;
  user_id?: string;
  company_id?: string;
  created_at?: string;
  updated_at?: string;
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

  /** === 会計・期間設定（STAGE1 拡張） === */
  fiscalYearEnd?: string;       // 決算期（例：'3' = 3月決算）
  currency?: string;            // 通貨（'JPY', 'USD' など）
  periodStartYear?: string;     // 計画開始年度
  periodEndYear?: string;       // 計画終了年度

  /** === 事業セグメント（STAGE1 拡張） === */
  businessSegments?: BusinessSegment[];

  /** === 上場情報・指標⑤準備（STAGE1 拡張） === */
  isListed?: boolean;           // 上場/非上場
  ticker?: string;              // 証券コード（任意）
  pbrManual?: string;           // PBR手入力（API未実装時のフォールバック）

  /** === 財務BS（STAGE1 指標⑤用） === */
  financeBS?: FinanceBSRow[];

  /** === 5指標分析（STAGE1 → STAGE2 接続） === */
  valueAnalysis?: ValueAnalysis;

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
  businessPortfolio?: Record<string, any>;

  /** === 財務サマリ（読みは配列、保存はjsonb）=== */
  financeSummary?: any[];

  /** === 財務明細CSV（配列ベース）=== */
  csvFinanceData?: CsvFinanceData;

  /** === ストーリー === */
  story: ChapterStory[];
  finalStory: ChapterStory[];

  /** 要約など（混在の可能性） */
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
  editableCascadeResult?: Department[];
  editableCascade?: unknown;

  /** === 勝ち筋（全社レベル）=== */
  winPatterns?: WinPattern[];
  winPatternPrimary?: WinPatternId;
  winPatternSecondary?: WinPatternId;

  /**
   * ★戦略OKR：会社としての「進化/探索」ミックス（任意）
   * - 会社全体で track を単一に決めない運用にも対応
   */
  trackRationales?: TrackRationale[];

  /** === 通知・権限（UI専用）=== */
  notification?: string;
  role?: 'admin' | 'manager' | 'member';
};

/* =========================================================
 * （任意）Zustand ストア用の拡張IF
 * ========================================================= */

export interface StrategyState extends StrategyData {
  // store側で setter を合成する場合に拡張
}
