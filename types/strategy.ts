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
  /** ★STAGE3拡張：価値指標への紐づけ（任意：OKR単位で持つ場合） */
  valueDriverLinks?: string[];
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
 * マイルストーン（KR達成への段階的タスク）
 * - KR単位での進行管理に必要な中間目標
 * - Stage5で使用予定
 */
export type Milestone = {
  /** マイルストーンID */
  id: string;

  /** マイルストーンタイトル（例：「顧客ヒアリング完了」） */
  title: string;

  /** 期限（YYYY-MM形式、任意） */
  dueYm?: Ym;

  /** 担当者（任意） */
  owner?: string;

  /** ステータス（任意、Stage5で使用） */
  status?: 'todo' | 'doing' | 'done';

  /** 完了定義（成功基準、任意） */
  dod?: string;
};

/**
 * エビデンス（根拠）：
 * - AIが生成した「もっともらしさ」を、現場の根拠で補強するための入れ物
 */
export type Evidence = {
  sources?: string[]; // URL/社内資料/ヒアリング等（文字列でOK）
  notes?: string;
};

/**
 * プロジェクト共通マイルストーン（STAGE4実行計画用）
 * - プロジェクト全体の進捗管理に必要な段階的タスク
 */
export type ProjectPlanMilestone = {
  /** マイルストーンID */
  id: UUID;

  /** マイルストーンタイトル */
  title: string;

  /** 期限（YYYY-MM形式、任意） */
  dueYm?: Ym;
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
   * 「セグメント/チャネル/プロダクト」など戦略の"当て先"
   * - Projectにもあるが、KR単位で異なるケースを許容
   */
  targetSegment?: string;
  targetChannel?: string;
  targetProduct?: string;

  /** ★Phase A：KR達成への段階的マイルストーン（任意） */
  milestones?: Milestone[];
};

/** 役割でOKRを束ねる場合（任意：将来拡張） */
export type ProjectRole = {
  role: string;
  okrs: KRStructured[];
  levers?: GrowthLever[];
  track?: StrategyTrack;
};

/* =========================================================
 * 人的投資関連の型定義（STAGE3拡張）
 * ========================================================= */

/**
 * 人的投資施策のカテゴリ
 */
export type HumanInvestmentCategory =
  | 'TRAINING_OJT'   // 研修・OJT
  | 'HIRING'         // 採用
  | 'ALLOCATION'     // 配置・異動
  | 'EXTERNAL'       // 外部活用（業務委託・パートナー）
  | 'TOOLS_PROCESS'; // ツール・仕組み

/**
 * 人的投資施策の実行時期
 */
export type HumanInvestmentHorizon =
  | '0_3M'   // 0〜3ヶ月
  | '3_6M'   // 3〜6ヶ月
  | '6_12M'  // 6〜12ヶ月
  | '';      // 未設定

/**
 * 人的投資施策（個別の施策項目）
 */
export type HumanInvestment = {
  /** カテゴリ */
  category: HumanInvestmentCategory;
  /** 施策タイトル（必須） */
  title: string;
  /** 詳細説明（任意） */
  detail?: string;
  /** 担当者（任意） */
  owner?: string;
  /** 実行時期（任意） */
  horizon?: HumanInvestmentHorizon;
};

/**
 * スキル要件
 */
export type SkillRequirements = {
  /** 職種スキル（例：営業、エンジニア、デザイナー等） */
  roleSkills?: string[];
  /** 実行スキル（例：PM、標準化、データ活用、改善運用等） */
  executionSkills?: string[];
};

/* =========================================================
 * STAGE4 実行計画：SkillPlan, PlanStatus拡張
 * ========================================================= */

/**
 * 計画ステータス (project単位)
 * - draft: 編集中
 * - review: レビュー待ち（manager/admin のみ遷移可）
 * - approved: 確定（admin のみ遷移可、編集ロック）
 */
export type PlanStatus = 'draft' | 'review' | 'approved';

/**
 * スキル育成方法
 */
export type SkillMethod = 'TRAINING' | 'OJT' | 'HIRE' | 'OUTSOURCE' | 'TOOL' | 'OTHER';

/**
 * スキルプラン（実行計画タブで入力される）
 */
export type SkillPlan = {
  id: UUID;
  /** スキル名（例：営業スキル、データ分析スキル） */
  skillName: string;
  /** 優先度（1-5、1=最高） */
  priority?: 1 | 2 | 3 | 4 | 5;
  /** 育成方法（TRAINING/OJT/HIRE/OUTSOURCE/TOOL/OTHER） */
  method?: SkillMethod;
  /** 期限（YYYY-MM） */
  dueYm?: Ym;
  /** 必要時間（時間） */
  hours?: number;
  /** 予想コスト（JPY） */
  cost?: number;
  /** 担当者（任意） */
  owner?: string;
  /** 備考（任意） */
  note?: string;
};

/**
 * 人的投資のタイプ（STAGE4 実行計画用）
 */
export type HumanInvestmentType = 'HIRE' | 'TRAINING' | 'OUTSOURCE' | 'SYSTEM' | 'TOOL' | 'OTHER';

/**
 * 人的投資計画（STAGE4 実行計画：人員・外部活用・システム等）
 * 注：既存 HumanInvestment（STAGE3）と区別するため、Project.executionHumanInvestments のキーで使用
 */
export type ExecutionHumanInvestment = {
  id: UUID;
  /** 投資タイプ */
  type: HumanInvestmentType;
  /** 金額（JPY） */
  amount?: number;
  /** 実行時期（YYYY-MM） */
  timingYm?: Ym;
  /** 人数 */
  headcount?: number;
  /** チーム/部署名 */
  team?: string;
  /** 備考 */
  note?: string;
};

/* =========================================================
 * プロジェクト（戦略OKRの主戦場）
 * ========================================================= */

export type Project = {
  id?: string | number;      // ★Phase 2A: stable id（okrs テーブル参照用）
  title: string; // ✅ 一貫して title に統一
  reason?: string;

  /** 旧OKR（互換） */
  okrs?: OKR[];

  /** OKR/KPIラベル（KPIリスト） */
  kpis?: string[];

  /** 新：構造化OKR（財務/説明責任） */
  okrsV2?: KRStructured[];

  /** 役割ごと束ね（任意） */
  roles?: ProjectRole[];

  /** ★STAGE4拡張：プロジェクトの財務レバー（REVENUE/COST/FUTURE） */
  role?: 'REVENUE' | 'COST' | 'FUTURE';

  /** ★STAGE4拡張：ロールの詳細サブカテゴリ（詳細設定） */
  roleDetail?: 'ACQ' | 'CHURN' | 'ARPU' | 'PERSONNEL' | 'FIXED' | 'VARIABLE';

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

  /** ★STAGE3拡張：スキル要件（職種スキル＋実行スキル） */
  skillRequirements?: SkillRequirements;

  /** ★STAGE3拡張：人的投資施策（カテゴリ別の施策リスト） */
  humanInvestments?: HumanInvestment[];

  /** ★STAGE3拡張：価値指標への紐づけ（STAGE2で定義された valueDriverKPIs の id or label） */
  valueDriverLinks?: string[];

  /** ★STAGE4 実行計画：計画ステータス（draft/review/approved） */
  planStatus?: PlanStatus;

  /** ★STAGE4 実行計画：承認日時（approved の場合） */
  approvedAt?: ISODateString;

  /** ★STAGE4 実行計画：承認者ID（approved の場合） */
  approvedBy?: string;

  /** ★Phase 1：プロジェクトオーナー（ユーザーID） */
  ownerUserId?: string | null;

  /** ★Phase 1：プロジェクトオーナー（表示名） */
  ownerName?: string | null;

  /** ★STAGE4 実行計画：スキルプラン（プロジェクト単位） */
  skillPlans?: SkillPlan[];

  /** ★STAGE4 実行計画：人的投資計画（採用・委託・配置・システム等） */
  executionHumanInvestments?: ExecutionHumanInvestment[];

  /** ★STAGE4拡張：北極星への売上寄与（百万円） */
  impactRevenueMJPY?: number;

  /** ★STAGE4拡張：北極星への営業利益寄与（百万円） */
  impactOpIncomeMJPY?: number;

  /** ★STAGE4拡張：必要投資額（百万円） */
  impactInvestmentMJPY?: number;

  /** ★STAGE4拡張：寄与確度（0-1の小数、またはパーセント） */
  impactConfidence?: number;

  /** ★STAGE4拡張：寄与の根拠・備考 */
  impactRationale?: string;

  /** ★STAGE5拡張：北極星売上寄与の達成率（%） */
  impactRevenueProgress?: number;

  /** ★STAGE5拡張：北極星営業利益寄与の達成率（%） */
  impactOpIncomeProgress?: number;

  /** ★STAGE4拡張：プロジェクト共通マイルストーン（0〜2推奨） */
  planMilestones?: ProjectPlanMilestone[];

  /** ★STAGE3 カスケード：AI生成管理用メタデータ（再生成の安全マージ用） */
  generatedBy?: 'ai' | 'user';
  generatedSlot?: 1 | 2 | 3; // AI枠番号（既存2＋新規1の中のスロット）
  generatedGroup?: string; // 'cascade_v1' で識別
  generatedAt?: string; // ISO datetime（生成日時）
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
  summary?: string; // 事業概要（1文：例）中堅製造業向けに設備保全の予兆検知をSaaSで提供
  keyCustomers?: string[]; // 主要顧客（最大3件）
};

/* =========================================================
 * 財務PL（STAGE1 企業価値分析用）
 * ========================================================= */

/**
 * 年度別 PL（損益計算書）の最小項目
 * - ROIC/ROE/営業利益率/CAGR 計算に必要
 * - 過去5年のみを前提（計画値は扱わない）
 */
export type FinancePLRow = {
  year: number;
  revenue?: number;             // 売上高
  grossProfit?: number;         // 売上総利益（任意：cogs から逆算可能）
  cogs?: number;                // 売上原価（任意：grossProfit から逆算可能）
  sga?: number;                 // 販管費
  operatingIncome?: number;     // 営業利益
  depreciation?: number;        // 減価償却費（任意：EBITDA計算用）
  interest?: number;            // 支払利息（任意）
  tax?: number;                 // 法人税等（任意）
  netIncome?: number;           // 当期純利益（任意：ROE計算用）
};

/* =========================================================
 * 財務BS（STAGE1 指標⑤用）
 * ========================================================= */

/**
 * 年度別 BS（貸借対照表）+ 投下資本
 * - ROIC 計算に必要な最小項目
 * - 過去5年のみを前提（計画値は扱わない）
 *
 * ★ Ver4 拡張：投下資本計算用の詳細項目を追加
 * - 投下資本 = (AR + Inventory - AP) + FixedAssets（運転資本 + 固定資産）
 */
export type FinanceBSRow = {
  year: number;
  // --- 既存項目（互換維持） ---
  totalAssets?: number;          // 総資産
  netAssets?: number;            // 純資産（株主資本）
  interestBearingDebt?: number;  // 有利子負債
  investedCapital?: number;      // 投下資本（純資産 + 有利子負債）※自動計算可
  nopat?: number;                // NOPAT（税引後営業利益）※営業利益 × (1 - 税率) で算出

  // --- Ver4 拡張：投下資本詳細計算用 ---
  cash?: number;                 // 現金及び預金
  ar?: number;                   // 売掛金・受取手形（売上債権）
  inventory?: number;            // 棚卸資産
  ap?: number;                   // 買掛金・支払手形（仕入債務）
  fixedAssets?: number;          // 固定資産
  equity?: number;               // 株主資本（netAssets の代替/詳細）
};

/* =========================================================
 * 事業部別 PL/BS（STAGE1 セグメント分析用）
 * ========================================================= */

/**
 * 事業部別 PL
 * - 会社PLと同じ構造を持つ（セグメント売上・営業利益等）
 * - 事業部間調整は hqAdjustmentPL で保持
 */
export type SegmentPLRow = FinancePLRow; // 構造は同一

/**
 * 事業部別 BS（投下資本算出用）
 * - 事業部への資産配賦は企業によって異なるため、投下資本に必要な項目のみ
 * - 完全なBSが無くても、推計値で計算できるようにする
 */
export type SegmentBSRow = {
  year: number;
  ar?: number;                   // 売掛金・受取手形
  inventory?: number;            // 棚卸資産
  ap?: number;                   // 買掛金・支払手形
  fixedAssets?: number;          // 固定資産（事業部配賦分）
  investedCapital?: number;      // 投下資本（計算済み or 直接入力）
  equity?: number;               // 株主資本配賦（任意）
  interestBearingDebt?: number;  // 有利子負債配賦（任意）
};

/* =========================================================
 * STAGE1 財務データ統合型
 * ========================================================= */

/**
 * Stage1Finance: STAGE1 の財務入力を一括保持
 * - companyPL/companyBS: 会社全体（必須入力）
 * - segmentPL/segmentBS: 事業部別（任意入力）
 * - hqAdjustmentPL/hqAdjustmentBS: 本社・共通費調整（事業部合計との差分）
 *
 * ★ キー構造:
 * - segmentPL/segmentBS の Record キーは BusinessSegment.name を使用
 */
export type Stage1Finance = {
  companyPL: FinancePLRow[];
  companyBS: FinanceBSRow[];
  segmentPL?: Record<string, FinancePLRow[]>;
  segmentBS?: Record<string, SegmentBSRow[]>;
  hqAdjustmentPL?: FinancePLRow[];
  hqAdjustmentBS?: Partial<SegmentBSRow>[];
};

/* =========================================================
 * STAGE1 論点ブロック拡張型
 * ========================================================= */

/**
 * Stage1IssueBlock: IssueBlockPanel で使用する拡張構造
 * - 既存の IssueBlock を継承しつつ、財務指標との紐付けを強化
 */
export type Stage1IssueBlock = IssueBlock & {
  /** 紐付く事業セグメント名（company全体の場合は undefined） */
  segmentName?: string;
  /** 算出された指標値（参照用） */
  metricValues?: Record<string, number | undefined>;
  /** 優先度（任意） */
  priority?: 'high' | 'medium' | 'low';
  /** 生成元（manual / ai） */
  source?: 'manual' | 'ai';
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
 * STAGE2 会社の数値目標（North Star Metrics）
 * ========================================================= */

/**
 * CompanyTarget: 会社全体の数値目標（North Star Metrics）
 * - STAGE2で定義され、STAGE3・STAGE4に影響
 * - STAGE1の論点（IssueBlock）と紐付け（1〜3件）
 */
export type CompanyTarget = {
  /** 目標ID（uuid or nanoid） */
  id: string;

  /** 目標名（例：売上、営業利益率、ROIC） */
  label: string;

  /** 単位（例：億円、%、回） */
  unit: string;

  /** 目標期限（年度、任意） */
  dueYear?: number;

  /** 低位想定値（任意） */
  low?: number;

  /** 基準想定値（必須） */
  base: number;

  /** 高位想定値（任意） */
  high?: number;

  /** 優先度（1=最高, 4=最低、デフォルト1） */
  priority?: 1 | 2 | 3 | 4;

  /** 紐付く論点ID群（IssueBlock.title を key として1〜3件） */
  linkedIssueIds: string[];

  /** 理由（1行、必須） */
  rationale: string;
};

/* =========================================================
 * STAGE6 Phase E: プロジェクト → North Star 指標の影響量（手入力）
 */
export type ProjectTargetImpact = {
  /** プロジェクトキー（dept::proj::idx 形式） */
  projectId: string;

  /** CompanyTarget.id */
  targetId: string;

  /** North Star指標への寄与量（単位は target.unit に依存） */
  delta: number;

  /** 根拠メモ（任意） */
  notes?: string;

  /** ★STAGE6拡張：自動推定vs手動入力の識別 */
  source?: 'auto' | 'manual';

  /** ★STAGE6拡張：手動ロック（上書き禁止） */
  locked?: boolean;

  /** ★STAGE6拡張：推定の信頼度（0..1） */
  confidence?: number;
};

/* =========================================================
 * STAGE6 Phase E: プロジェクト → 論点（Issue）の紐付けと強度
 */
export type ProjectIssueLink = {
  /** プロジェクトキー（dept::proj::idx 形式） */
  projectId: string;

  /** IssueBlock.title（論点ID） */
  issueId: string;

  /** 寄与の強度（1=弱、2=中、3=強） */
  strength: 1 | 2 | 3;

  /** 根拠メモ（任意） */
  notes?: string;

  /** ★STAGE6拡張：自動推定vs手動入力の識別 */
  source?: 'auto' | 'manual';

  /** ★STAGE6拡張：手動ロック（上書き禁止） */
  locked?: boolean;

  /** ★STAGE6拡張：推定の信頼度（0..1） */
  confidence?: number;
};

/* =========================================================
 * STAGE1 外部ベンチマーク（任意入力）
 * ========================================================= */

/**
 * ベンチマーク対象の品質レベル
 */
export type BenchmarkQuality = 'primary' | 'secondary' | 'estimated' | 'reference';

/**
 * 単一のベンチマーク対象（業界中央値、競合A、競合B など）
 */
export type BenchmarkTarget = {
  /** 期間（例：'2023年度'、'TTM'） */
  period?: string;

  /** URL/メモ */
  sourceNote?: string;

  /** データ品質 */
  quality?: BenchmarkQuality;

  /** 指標値 */
  metrics?: {
    growthPct?: number;        // 成長率 (%)
    opMarginPct?: number;      // 営業利益率 (%)
    roicPct?: number;          // ROIC (%)
    capitalTurnover?: number;  // 資本回転率
    pbr?: number;              // PBR
  };
};

/**
 * STAGE1 全体のベンチマーク設定（最大3対象）
 */
export type Stage1Benchmarks = {
  /** 業界中央値 */
  industryMedian?: BenchmarkTarget;

  /** 競合A */
  competitorA?: BenchmarkTarget;

  /** 競合B */
  competitorB?: BenchmarkTarget;

  /** ★ WACC（加重平均資本コスト） */
  waccManual?: number; // %
  waccRationale?: string; // 計算根拠・備考
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
  missionDescription?: string; // ★STAGE3：部門ミッションの内容説明
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

  /** ★STAGE3拡張：部門の由来（'stage1' = STAGE1事業部から生成、'manual' = 手動追加） */
  source?: 'stage1' | 'manual';

  /** ★STAGE3拡張：2レーン構造（既存進化/新規探索の永続化） */
  lanes?: {
    existing?: { projects: Project[] };
    new?: { projects: Project[] };
  };

  /** ★STAGE3拡張：STAGE1事業セグメントへの紐づけ */
  segmentName?: string;

  /** ★STAGE3拡張：事業部内の機能横断連携（表示・保存用） */
  intraDeptCollab?: string[];

  /** ★STAGE3拡張：他事業部・全社機能との連携（表示・保存用） */
  interDeptCollab?: string[];

  /** ★STAGE3拡張：旧互換の連携配列（内部では事業部内/事業部間連携へ統合） */
  needsCollab?: string[];

  /** ★STAGE3拡張：やめる/諦める項目 */
  stopList?: string[];

  /** ★STAGE3拡張：最初の90日アクション */
  first90Days?: string[];

  /** ★STAGE3拡張：主要リスクと対処 */
  riskNotes?: string[];
};

/* =========================================================
 * STAGE4 実行計画（部門ごとの編集・差分・整合状態）
 * ========================================================= */

/**
 * Stage4Plan: STAGE4で編集される部門ごとの実行計画
 * - baseline: STAGE3完了時点のスナップショット（差分比較の基準）
 * - current: 現在の編集内容（STAGE4での変更を反映）
 * - status: 編集ステータス（Draft/Review/Approved）
 */
export type Stage4Plan = {
  /** 部門ID（Department.id または Department.name） */
  departmentId: string;

  /** 編集ステータス */
  status: 'Draft' | 'Review' | 'Approved';

  /** STAGE3完了時点のベースライン（差分比較用・軽量版） */
  baseline: Stage4Baseline;

  /** 現在の編集内容（STAGE4での変更を反映） */
  current: Stage4Current;

  /** 最終更新日時 */
  updatedAt?: string;

  /** 編集者（任意） */
  updatedBy?: string;

  /** ★ 修正2: baseline 作成時の department 構成 hash（STAGE3再生成検知用） */
  deptHashAtCreation?: string;
};

/**
 * Stage4Baseline: STAGE3完了時点のスナップショット（差分表示用）
 * - プロジェクト単位で最小限のデータを保持
 */
export type Stage4Baseline = {
  /** プロジェクト一覧（タイトル、KPI、スキル、人的投資のみ） */
  projects: Array<{
    title: string;
    /** KPIターゲット（差分対象） */
    kpiTargets?: Record<string, number>;
    /** スキル要件（差分対象） */
    skillRequirements?: SkillRequirements;
    /** 人的投資（差分対象） */
    humanInvestments?: HumanInvestment[];
    /** 価値指標リンク（差分対象） */
    valueDriverLinks?: string[];
  }>;
};

/**
 * Stage4Current: STAGE4での編集内容
 * - baseline と同じ構造で、編集後の値を保持
 */
export type Stage4Current = Stage4Baseline;

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
 * 財務データ（JSONB）- DB csv_finance_data 列に集約
 * =========================================================
 * DB構造上、finance_bs / segment_pl / segment_bs 列がないため、
 * csv_finance_data（JSONB）にこれらすべてを格納する。
 * ========================================================= */

export type CsvFinanceData = {
  /** 全社BS（STAGE1指標⑤用） */
  financeBS?: FinanceBSRow[];

  /** 事業部別PL */
  segmentPL?: Record<string, FinancePLRow[]>;

  /** 事業部別BS */
  segmentBS?: Record<string, SegmentBSRow[]>;

  /** 本社・共通費調整PL */
  hqAdjustmentPL?: FinancePLRow[];

  /** 本社・共通費調整BS */
  hqAdjustmentBS?: Partial<SegmentBSRow>[];

  /** その他（後方互換・拡張用） */
  [k: string]: any;
};

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

  /** === 財務PL（STAGE1 企業価値分析用） === */
  financePL?: FinancePLRow[];

  /** === 事業部別 PL/BS（STAGE1 セグメント分析用） === */
  segmentPL?: Record<string, FinancePLRow[]>;
  segmentBS?: Record<string, SegmentBSRow[]>;

  /** === 本社・共通費調整（事業部合計との差分） === */
  hqAdjustmentPL?: FinancePLRow[];
  hqAdjustmentBS?: Partial<SegmentBSRow>[];

  /** === 5指標分析（STAGE1 → STAGE2 接続） === */
  valueAnalysis?: ValueAnalysis;

  /** === 事業部別 ValueAnalysis（STAGE1 セグメント分析結果） === */
  segmentValueAnalysis?: Record<string, ValueAnalysis>;

  /** === STAGE1 論点ブロック === */
  stage1Issues?: IssueBlock[];

  /** === STAGE1 外部ベンチマーク（任意入力） === */
  stage1Benchmarks?: Stage1Benchmarks;

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

  /** === STAGE2 価値指標（Value Driver KPIs）=== */
  valueDriverKPIs?: Array<{
    id: string;
    label: string;
    description?: string;
    category?: 'growth' | 'profitability' | 'efficiency' | 'market' | 'other';
  }>;

  /** === STAGE2 目標レンジ（Target Ranges）=== */
  targetRanges?: {
    low?: Record<string, number>;   // 低位シナリオ（id → 数値）
    base?: Record<string, number>;  // 基準シナリオ
    high?: Record<string, number>;  // 高位シナリオ
  };

  /** === 楽観ロック（revision：保存時の衝突検知用） === */
  revision?: number;

  /** === STAGE4 実行計画（部門ごとの編集状態・差分・整合チェック） === */
  stage4Plans?: Stage4Plan[];

  /** === STAGE4 実行計画：Baseline（hydrate後に1回のみ作成、変更なし）=== */
  executionPlanBaseline?: {
    /** 会社ID（baseline の valid check用） */
    companyId?: string;
    /** baseline 作成日時（Unix timestamp ms） */
    createdAt?: number;
    /** departments 全体の deep copy */
    snapshot?: Department[];
  };

  /** === 通知・権限（UI専用）=== */
  notification?: string;
  role?: 'admin' | 'manager' | 'member';
};

/* =========================================================
 * （任意）Zustand ストア用の拡張IF
 * ========================================================= */

export interface StrategyState extends StrategyData {
  // store側で setter を合成する場合に拡張
  stage1Benchmarks?: Stage1Benchmarks;
}

/* =========================================================
 * STAGE1 PDF/Excel インポート候補型
 * ========================================================= */

/**
 * インポート候補の種別
 */
export type ImportCandidateKind =
  | 'companyPL'
  | 'companyBS'
  | 'segmentPL'
  | 'segmentBS'
  | 'pbr';

/**
 * 抽出候補（サーバから返す）
 * - 画面でプレビュー表示し、ユーザーが「適用」で store に反映
 */
export type Stage1ImportCandidate = {
  /** 候補の種別 */
  kind: ImportCandidateKind;
  /** 年度（PLやBSの場合） */
  year?: number;
  /** セグメント名（segmentPL/segmentBS の場合） */
  segmentName?: string;
  /** 抽出した項目→値のマップ */
  fields: Record<string, number | string | undefined>;
  /** 信頼度（0〜1） */
  confidence: number;
  /** 抽出元の参照（ページ番号、セル範囲など） */
  sourceRef?: string;
};

/**
 * インポート解析結果（APIレスポンス）
 */
export type Stage1ImportResult = {
  /** 成功/失敗 */
  success: boolean;
  /** エラーメッセージ（失敗時） */
  error?: string;
  /** 抽出候補リスト */
  candidates: Stage1ImportCandidate[];
  /** プレビュー用テキスト（任意） */
  previewText?: string;
  /** テーブルヒント（任意） */
  tableHints?: string[];
  /** キャッシュキー（再アップロード抑止用） */
  cacheKey?: string;
};

/**
 * 候補を適用する際のオプション
 */
export type ImportApplyOptions = {
  /** 既存データとマージするか、上書きするか */
  mode: 'merge' | 'overwrite';
  /** 適用対象の候補インデックス（空なら全て） */
  candidateIndices?: number[];
};

/* =========================================================
 * STAGE1 → STAGE2 接続用の型定義
 * ========================================================= */

/**
 * MetricsSummary: ValueAnalysis のエイリアス
 * - 既存 ValueAnalysis をそのまま流用できるようにする
 * - 将来拡張で独自プロパティを持つ場合は interface に変更可能
 */
export type MetricsSummary = ValueAnalysis;

/**
 * StoryChapter: ストーリー章データ型
 * - 既存 ChapterStory と同一構造（エイリアス）
 */
export type StoryChapter = ChapterStory;

/**
 * WinPatternCandidate: STAGE2で生成される勝ち筋候補
 * - AI/ユーザーが提案する「勝ち筋」の候補
 * - 最終決定前の検討段階で使用
 */
export type WinPatternCandidate = {
  /** ID（uuid or stable id） */
  id: string;
  /** 勝ち筋名称 */
  name: string;
  /** バリュードライバー（収益性/成長性/資本効率/安全性/市場評価など） */
  valueDrivers: string[];
  /** なぜこの勝ち筋か（論点との因果） */
  rationale: string;
  /** 捨てるもの/副作用 */
  tradeoffs: string;
  /** スコープ（全社/事業部）（optional） */
  scope?: 'company' | 'segment';
  /** 関連セグメント名（scopeがsegmentの場合） */
  segmentName?: string;
};

/**
 * Stage2DraftOutput: STAGE2 出力1（たたき台）
 * - 4章ストーリードラフト + 勝ち筋候補
 */
export type Stage2DraftOutput = {
  /** 4章ストーリードラフト（固定4章） */
  storyDraft: StoryChapter[];
  /** 勝ち筋候補（2〜3件） */
  winPatternsCandidate: WinPatternCandidate[];
};

/**
 * Stage2Answer: 12問（入力2）の回答型
 * - 第2フェーズで使用
 */
export type Stage2Answer = {
  /** 質問ID */
  id: string;
  /** 質問文（TEMPLATE12 が source of truth） */
  question?: string;
  /** 回答（未入力を許容） */
  answer?: string;
  /** 必須かどうか（骨格4問など） */
  required?: boolean;
};

/**
 * Stage2FinalOutput: 最終ストーリー（出力2）
 */
export type Stage2FinalOutput = {
  /** 最終ストーリー（4章） */
  finalStory: StoryChapter[];
  /** 要点3つ（任意） */
  keyMessages?: string[];
  /** 行動宣言（任意） */
  actionCommitments?: string[];
};

/**
 * Stage2State: STAGE2の全状態
 * - MVV, SWOT, ストーリードラフト, 勝ち筋候補を包括
 */
export type Stage2State = {
  ceoIntent?: string; // ✅ 追加：経営者の思い
  /** MVV */
  mvv: {
    thought?: string;
    mission?: string;
    vision?: string;
    value?: string;
  };
  /** SWOT */
  swot: {
    strength?: string;
    weakness?: string;
    opportunity?: string;
    threat?: string;
  };
  /** 4章ストーリードラフト */
  storyDraft?: StoryChapter[];
  /** 勝ち筋候補リスト */
  winPatternsCandidate?: WinPatternCandidate[];
  /** 12問回答（任意） */
  answers12?: Stage2Answer[];
  /** 最終ストーリー（任意、旧：互換） */
  finalStory?: StoryChapter[];
  /** 最終ストーリー：ドラフト版（3段階編集用） */
  finalStoryDraft?: StoryChapter[];
  /** 最終ストーリー：編集版（3段階編集用） */
  finalStoryEdited?: StoryChapter[];
  /** 最終ストーリー：確定版（3段階編集用） */
  finalStoryFinal?: StoryChapter[];
  /** North Star メトリクス */
  companyTargets?: CompanyTarget[];

  /** === STAGE6 Phase E: プロジェクト→North Star影響量（手入力） === */
  projectTargetImpacts?: ProjectTargetImpact[];

  /** === STAGE6 Phase E: プロジェクト→論点紐付け（手入力） === */
  projectIssueLinks?: ProjectIssueLink[];

  /** 要点（任意） */
  keyMessages?: string[];
  /** 行動宣言（任意） */
  actionCommitments?: string[];
};

/* =========================================================
 * localStorage Snapshot 型定義
 * ========================================================= */

/**
 * Stage1Snapshot: STAGE1のlocalStorageスナップショット
 * - STAGE2へ渡すための最小データセット
 * - Supabase保存とは独立して管理
 */
export type Stage1Snapshot = {
  /** 保存日時 */
  savedAt: string;
  /** 論点ブロック */
  issueBlocks: IssueBlock[];
  /** 指標要約（ValueAnalysisと同型） */
  metricsSummary: MetricsSummary;
  /** 会社名（識別用） */
  companyName?: string;
  /** 会社ID（識別用） */
  companyId?: string;
};

/**
 * Stage2Snapshot: STAGE2のlocalStorageスナップショット
 * - 作業中状態の復元用
 */
export type Stage2Snapshot = {
  /** 保存日時 */
  savedAt: string;
  /** Stage2の状態 */
  state: Stage2State;
  /** 会社ID（識別用） */
  companyId?: string;
};
