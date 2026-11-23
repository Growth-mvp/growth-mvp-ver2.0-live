/* 全削除の対象列が本番 Supabase の strategy_data の列と一致することを確認する。 */
import { STRATEGY_DATA_PRESERVED_COLUMNS, STRATEGY_DATA_RESET_VALUES } from './companyDataReset';

jest.mock('server-only', () => ({}));

/** 本番 Supabase（PostgREST の OpenAPI）の strategy_data の列。2026-11-23 に読み取りのみで取得。 */
const PRODUCTION_STRATEGY_DATA_COLUMNS = [
  'user_id', 'created_at', 'updated_at', 'company_name', 'foundation_year', 'location', 'industry', 'revenue',
  'employees', 'business_content', 'customer_segment', 'strength', 'weakness', 'opportunity', 'threat', 'mission',
  'vision', 'value', 'departments', 'csv_finance_data', 'story', 'strategy_summary', 'editable_cascade', 'thought',
  'email', 'role', 'id', 'answers', 'answers2', 'final_story', 'editable_cascade_result', 'questions', 'reasons',
  'questions2', 'reasons2', 'notification', 'company_id', 'updated_by', 'business_portfolio', 'finance_summary',
  'simulation_result', 'simulation_results', 'fiscal_year_end', 'currency', 'period_start_year', 'period_end_year',
  'business_segments', 'is_listed', 'ticker', 'pbr_manual', 'finance_pl', 'revision', 'stage1_issues', 'ceo_intent',
  'swot_suggestions', 'story_draft', 'win_patterns_candidate', 'answers12', 'company_targets', 'final_story_draft',
  'final_story_edited', 'final_story_final', 'project_target_impacts', 'project_issue_links', 'stage1_benchmarks',
  'okr_target_scores', 'stage3_strategy_bridge', 'stage2_final_document_edits', 'final_story_conclusion',
];

const classified = new Set([...Object.keys(STRATEGY_DATA_RESET_VALUES), ...STRATEGY_DATA_PRESERVED_COLUMNS]);

describe('全削除の対象列（本番 strategy_data と照合）', () => {
  it('本番の列はすべて、初期化するか保持するかのどちらかに分類されている', () => {
    const unclassified = PRODUCTION_STRATEGY_DATA_COLUMNS.filter((c) => !classified.has(c));
    expect(unclassified).toEqual([]);
  });

  it('分類に書かれた列はすべて本番に存在する（存在しない列を更新に含めない）', () => {
    const production = new Set(PRODUCTION_STRATEGY_DATA_COLUMNS);
    const missingInProduction = [...classified].filter((c) => !production.has(c));
    expect(missingInProduction).toEqual([]);
  });

  it('初期化する列と保持する列が重ならない', () => {
    const overlap = STRATEGY_DATA_PRESERVED_COLUMNS.filter((c) => c in STRATEGY_DATA_RESET_VALUES);
    expect(overlap).toEqual([]);
  });

  it('会社ID・会社名・所有者・監査の列は保持し、経営データの列は初期化する', () => {
    for (const column of ['id', 'company_id', 'company_name', 'user_id', 'updated_by', 'email', 'role', 'revision']) {
      expect(STRATEGY_DATA_PRESERVED_COLUMNS).toContain(column);
      expect(column in STRATEGY_DATA_RESET_VALUES).toBe(false);
    }
    for (const column of ['final_story', 'answers2', 'stage3_strategy_bridge', 'simulation_results', 'editable_cascade']) {
      expect(column in STRATEGY_DATA_RESET_VALUES).toBe(true);
    }
  });
});
