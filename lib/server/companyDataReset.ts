import 'server-only';

/**
 * 会社の経営データ（STAGE1〜6）削除の対象定義。
 * 列は本番 Supabase の実スキーマ（PostgREST の OpenAPI、読み取りのみで取得）と突き合わせて定めている。
 * 検証テストは本番の列一覧（lib/server/companyDataReset.test.ts）と照合する。
 */

/** 削除後の strategy_data の経営データ列の値（スキーマの既定値・アプリの空状態に合わせる） */
export const STRATEGY_DATA_RESET_VALUES: Readonly<Record<string, unknown>> = {
  // STAGE1: 基本情報・財務入力（会社名は保持する）
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
  // STAGE3〜5: 戦略展開・部門・目標
  stage3_strategy_bridge: null,
  departments: [],
  company_targets: [],
  project_target_impacts: [],
  project_issue_links: [],
  okr_target_scores: {},
  editable_cascade: null,
  editable_cascade_result: [],
  // STAGE6: シミュレーション
  simulation_result: null,
  simulation_results: [],
};

/** 削除しても残す strategy_data の列（会社・戦略の識別子、会社名、所有者、監査、楽観ロック用） */
export const STRATEGY_DATA_PRESERVED_COLUMNS: readonly string[] = [
  'id',
  'company_id',
  'company_name',
  'user_id',
  'created_at',
  'updated_at',
  'updated_by',
  'email',
  'role',
  'revision',
];

export type CompanyScope = 'company' | 'strategy';

export type CompanyScopedTable = {
  table: string;
  /**
   * 絞り込み方。company: company_id で絞る。strategy: 会社の戦略行（strategy_data.id）の strategy_id で絞る。
   * 会社IDが空の行でも戦略行に紐づくものを消すため、両方指定する場合がある。
   */
  scopes: readonly CompanyScope[];
  /** 環境に存在しない場合にスキップしてよいか（機能追加中のテーブル） */
  optional: boolean;
};

/**
 * strategy_data の初期化より前に削除するテーブル。
 * 子テーブルを先に消し、strategy_data を最後に初期化する。途中で失敗しても strategy_data が残るため、
 * 全削除は同じ操作の再実行で完了できる。
 *
 * 対象外（会社・戦略を特定する列がない、または経営データではない）:
 * story_histories（user_id のみ）、agent_logs（AIとの会話ログ）、departments（組織マスタ）、
 * org_alignment_*（組織整合）、companies / company_members / company_invites / profiles / users / audit_logs。
 */
export const COMPANY_SCOPED_TABLES_BEFORE_STRATEGY: readonly CompanyScopedTable[] = [
  { table: 'story_answers2', scopes: ['company'], optional: false },
  { table: 'final_stories', scopes: ['company'], optional: false },
  { table: 'story_versions', scopes: ['company', 'strategy'], optional: false },
  { table: 'strategy_sessions', scopes: ['strategy'], optional: false },
  { table: 'progress_logs', scopes: ['company'], optional: false },
  { table: 'okrs', scopes: ['company'], optional: false },
  { table: 'stage4_plan_document_events', scopes: ['company'], optional: true },
  { table: 'stage4_plan_documents', scopes: ['company'], optional: true },
  { table: 'stage3_strategy_books', scopes: ['company'], optional: true },
  { table: 'generated_plans', scopes: ['company'], optional: true },
];
