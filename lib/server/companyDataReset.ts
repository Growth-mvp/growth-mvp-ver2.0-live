import 'server-only';

/**
 * 会社の業務データ削除（全削除API）の対象定義。
 * 列の一覧は utils/supabase/strategy.ts の FIELD_MAP（アプリが書く列）を基準にし、
 * 検証テストで「スキーマ・マイグレーション・FIELD_MAP のどの列も分類済み」であることを確認する。
 */

/** 削除後の strategy_data の業務列の値（スキーマの既定値・アプリの空状態に合わせる） */
export const STRATEGY_DATA_RESET_VALUES: Readonly<Record<string, unknown>> = {
  // STAGE0〜1: 会社の基本情報・財務入力
  company_name: '',
  foundation_year: '',
  location: '',
  industry: '',
  revenue: '',
  employees: '',
  business_content: '',
  customer_segment: '',
  fiscal_year_end: '',
  currency: 'JPY',
  period_start_year: '',
  period_end_year: '',
  business_segments: [],
  is_listed: false,
  ticker: '',
  pbr_manual: '',
  finance_pl: null,
  finance_summary: null,
  csv_finance_data: {},
  business_portfolio: null,
  stage1_issues: [],
  stage1_benchmarks: null,
  // STAGE2: 経営者の思い・SWOT・ストーリー
  ceo_intent: '',
  thought: '',
  mission: '',
  vision: '',
  value: '',
  strength: '',
  weakness: '',
  opportunity: '',
  threat: '',
  notification: '',
  swot_suggestions: null,
  strategy_summary: null,
  answers: null,
  questions: null,
  reasons: null,
  questions2: null,
  reasons2: null,
  story: [],
  story_draft: [],
  final_story: [],
  final_story_draft: [],
  final_story_edited: [],
  final_story_final: [],
  final_story_conclusion: null,
  stage2_final_document_edits: null,
  answers2: [],
  answers12: [],
  win_patterns_candidate: [],
  win_patterns: null,
  win_pattern_primary: null,
  win_pattern_secondary: null,
  // STAGE3〜5: 戦略展開・部門・目標・実行計画
  stage3_strategy_bridge: null,
  departments: [],
  company_targets: [],
  execution_plans: null,
  project_target_impacts: [],
  project_issue_links: [],
  okr_target_scores: {},
  editable_cascade: null,
  editable_cascade_result: [],
  // STAGE6: シミュレーション
  simulation_result: null,
  simulation_results: [],
};

/** 削除しても残す strategy_data の列（識別子・所有者・監査・楽観ロック用） */
export const STRATEGY_DATA_PRESERVED_COLUMNS: readonly string[] = [
  'id',
  'company_id',
  'user_id',
  'created_at',
  'updated_at',
  'updated_by',
  'email',
  'role',
  'revision',
];

export type CompanyScopedTable = {
  table: string;
  /** 環境に存在しない場合にスキップしてよいか（機能追加中のテーブル） */
  optional: boolean;
};

/**
 * strategy_data の初期化より前に、会社の行を削除するテーブル。
 * 子テーブルを先に消し、strategy_data を最後に初期化する。途中で失敗しても strategy_data が残るため、
 * 全削除は同じ操作の再実行で完了できる。
 */
export const COMPANY_SCOPED_TABLES_BEFORE_STRATEGY: readonly CompanyScopedTable[] = [
  { table: 'story_answers2', optional: false },
  { table: 'final_stories', optional: false },
  { table: 'story_versions', optional: false },
  { table: 'progress_logs', optional: false },
  { table: 'okrs', optional: false },
  { table: 'stage4_plan_document_events', optional: true },
  { table: 'stage4_plan_documents', optional: true },
  { table: 'stage3_strategy_books', optional: true },
  { table: 'generated_plans', optional: true },
];
