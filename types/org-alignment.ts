export type CounterpartyType =
  | 'executive'
  | 'manager'
  | 'own_department'
  | 'other_department'
  | 'backoffice'
  | 'field_member'
  | 'customer'
  | 'unknown'
  | 'other';

export type VisibilityMode = 'anonymous' | 'manager_only' | 'named';

export type OrgAlignmentStatus =
  | 'draft'
  | 'generated'
  | 'alignment_requested'
  | 'in_alignment'
  | 'closed';

export type OrgAlignmentIssueType =
  | '部門間連携のズレ'
  | '経営と現場の認識のズレ'
  | '戦略と実行計画のズレ'
  | '実行計画と評価制度のズレ'
  | '役割責任のズレ'
  | '優先順位のズレ'
  | '意思決定基準のズレ'
  | '情報共有のズレ'
  | '挑戦と失敗許容のズレ'
  | 'ツール・施策への不信感'
  | 'その他';

export type CompanyRecognitionMode = 'strategy_based' | 'needs_confirmation';

export type OrgAlignmentResult = {
  title: string;
  inputSummary: string;
  issueType: OrgAlignmentIssueType;
  participantRecognitionHypothesis: string;
  companyRecognitionMode: CompanyRecognitionMode;
  companyRecognitionTitle: string;
  companyRecognition: string;
  alignmentPoints: string[];
  recommendedNextAction: {
    title: string;
    detail: string;
  };
  riskLevel: 'low' | 'medium' | 'high';
  riskReason: string;
};

// ===== 管理者ダッシュボード用の型定義 =====

/**
 * 共有範囲別の件数
 */
export type VisibilityCounts = {
  anonymous: number;
  manager_only: number;
  named: number;
};

/**
 * 論点に紐づく投稿者情報（管理画面専用）
 */
export type InsightSourceCase = {
  caseId: string;
  visibilityMode: VisibilityMode;
  createdBy: string | null;
  createdAt: string;
  userName?: string | null;  // visibility_mode に応じて設定
  userEmail?: string | null; // visibility_mode に応じて設定
};

/**
 * 次アクション（拡張版）
 */
export type OrgInsightNextAction = {
  title: string;
  owner: string;
  dueDate: string;
  status: '未着手' | '準備中' | '実施予定' | '実施済み' | '反映済み';
  description?: string;
};

/**
 * 告知情報
 */
export type OrgInsightAnnouncement = {
  text: string;
  updatedAt: string;
  updatedBy: string;
};

/**
 * カテゴリー別の件数
 */
export type OrgAlignmentCategoryCounts = {
  [issueType: string]: number;
};

/**
 * 優先度別の件数
 */
export type OrgAlignmentPriorityCounts = {
  low: number;
  medium: number;
  high: number;
};

/**
 * 部門別の傾向データ
 */
export type OrgAlignmentDepartmentTrend = {
  departmentName: string;
  caseCount: number;
  topIssueTypes: Array<{
    issueType: string;
    count: number;
  }>;
  avgRiskLevel: 'low' | 'medium' | 'high';
};

/**
 * 集計された論点・インサイト（拡張版：管理者向けの詳細情報を含む）
 */
export type OrgAlignmentInsight = {
  title: string;
  description: string;
  relatedIssueTypes: string[];
  affectedDepartments: string[];
  recommendedActions: string[];
  stage3Stage4Relevance: string;
  relatedCaseCount: number; // この論点に関連する投稿件数（合計が sourceCaseCount と一致）

  // === 論点管理用フィールド ===
  insightKey?: string;  // 各論点の安定したキー
  sharedTopicId?: string;  // 対応する org_alignment_shared_topics.id
  visibilityCounts?: VisibilityCounts;  // 共有範囲別の投稿件数
  sourceCases?: InsightSourceCase[];  // 関連する投稿情報（管理画面専用）
  announcement?: OrgInsightAnnouncement;  // 告知情報

  // === 優先度・重要度情報 ===
  priorityScore?: number; // 0-100のスコア
  importance?: '高' | '中' | '低';
  urgency?: '高' | '中' | '低';

  // === 影響範囲・認識のズレ ===
  impactScope?: string; // 論点が影響する範囲の説明
  recognitionGap?: {
    fieldView: string; // 現場の認識
    companyView: string; // 会社としての認識
    gapEssence: string; // ズレの本質
  };

  // === 会社としての判断軸 ===
  companyAxis?: string; // 会社がこの論点をどの軸で考えるべきか

  // === すり合わせ ===
  sessionType?: string; // 推奨するすり合わせ形式（全体会議、部門別会議など）

  // === 次アクション ===
  nextActions?: OrgInsightNextAction[];

  // === STAGE3/4への還流 ===
  strategyReflection?: {
    stage3Status: '未反映' | '反映候補' | '反映済み';
    stage4Status: '未反映' | 'OKR化候補' | 'OKR化済み';
    relatedDepartments: string[];
    generatedProjects: Array<{
      departmentName: string;
      projectTitle: string;
      projectSummary: string;
    }>;
    generatedOkrs: Array<{
      objective: string;
      keyResults: string[];
      owner: string;
      dueDate: string;
    }>;
  };
};

/**
 * AI集計結果全体
 */
export type OrgAlignmentInsightDashboard = {
  companyId: string;
  summary: string;
  insights: OrgAlignmentInsight[];
  categoryCounts: OrgAlignmentCategoryCounts;
  priorityCounts: OrgAlignmentPriorityCounts;
  departmentTrends: OrgAlignmentDepartmentTrend[];
  sourceCaseCount: number;
  generatedAt: string;
};

/**
 * DB保存用の型（org_alignment_insights テーブル）
 */
export type OrgAlignmentInsightRow = {
  id: string;
  company_id: string;
  summary: string;
  insights: OrgAlignmentInsight[];
  category_counts: OrgAlignmentCategoryCounts;
  priority_counts: OrgAlignmentPriorityCounts;
  department_trends: OrgAlignmentDepartmentTrend[];
  source_case_count: number;
  generated_by: string;
  generated_at: string;
  created_at: string;
  updated_at: string;
};
