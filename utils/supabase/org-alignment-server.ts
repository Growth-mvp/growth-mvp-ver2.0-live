// /utils/supabase/org-alignment-server.ts
import 'server-only';

import type { SupabaseClient } from '@supabase/supabase-js';
import type {
  OrgAlignmentInsightDashboard,
  OrgAlignmentInsightRow,
  OrgAlignmentInsight,
  VisibilityCounts,
  InsightSourceCase,
  VisibilityMode,
} from '@/types/org-alignment';

/**
 * 会社の org_alignment_cases を取得（AI集計用）
 *
 * 重要：投稿者個人を特定できる情報は含めない
 * - created_by は除外
 * - visibility_mode が 'anonymous' のケースも含む
 * - ai_result の内容のみを取得
 *
 * @param admin - Supabase admin client
 * @param companyId - 会社ID
 * @returns ケースのリスト（個人情報を除外）
 */
export async function getOrgAlignmentCasesForInsight(
  admin: SupabaseClient,
  companyId: string
) {
  const { data, error } = await admin
    .from('org_alignment_cases')
    .select(`
      id,
      status,
      situation_text,
      my_recognition_text,
      ideal_text,
      expectation_text,
      counterparty_type,
      counterparty_detail,
      visibility_mode,
      ai_result,
      created_at
    `)
    .eq('company_id', companyId)
    .in('status', ['generated', 'alignment_requested', 'in_alignment', 'closed'])
    .order('created_at', { ascending: false });

  if (error) {
    throw new Error(`Failed to fetch org_alignment_cases: ${error.message}`);
  }

  return data ?? [];
}

/**
 * 最新の集計結果を1件取得
 *
 * @param admin - Supabase admin client
 * @param companyId - 会社ID
 * @returns 最新の集計結果 or null
 */
export async function getLatestOrgAlignmentInsight(
  admin: SupabaseClient,
  companyId: string
): Promise<OrgAlignmentInsightRow | null> {
  const { data, error } = await admin
    .from('org_alignment_insights')
    .select('*')
    .eq('company_id', companyId)
    .order('generated_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    throw new Error(`Failed to fetch latest insight: ${error.message}`);
  }

  return data;
}

/**
 * AI集計結果を保存
 *
 * @param admin - Supabase admin client
 * @param input - 保存するデータ
 * @returns 保存されたレコード
 */
export async function saveOrgAlignmentInsight(
  admin: SupabaseClient,
  input: {
    companyId: string;
    generatedBy: string;
    dashboard: OrgAlignmentInsightDashboard;
  }
) {
  const { data, error } = await admin
    .from('org_alignment_insights')
    .insert({
      company_id: input.companyId,
      summary: input.dashboard.summary,
      insights: input.dashboard.insights,
      category_counts: input.dashboard.categoryCounts,
      priority_counts: input.dashboard.priorityCounts,
      department_trends: input.dashboard.departmentTrends,
      source_case_count: input.dashboard.sourceCaseCount,
      generated_by: input.generatedBy,
      generated_at: input.dashboard.generatedAt,
      updated_at: new Date().toISOString(),
    })
    .select('id')
    .single();

  if (error) {
    throw new Error(`Failed to save insight: ${error.message}`);
  }

  return data;
}

/**
 * 論点のinsight_keyを生成する
 * タイトルやカテゴリーから安定したキーを生成する
 *
 * @param insight - 論点オブジェクト
 * @param index - 配列内のインデックス
 * @returns 生成されたinsight_key（例: "dept-coop-001"）
 */
export function generateInsightKey(
  insight: {
    title: string;
    relatedIssueTypes: string[];
  },
  index: number
): string {
  const categoryMap: Record<string, string> = {
    '部門間連携のズレ': 'dept-coop',
    '経営と現場の認識のズレ': 'exec-field',
    '戦略と実行計画のズレ': 'strategy-exec',
    '実行計画と評価制度のズレ': 'exec-eval',
    '役割責任のズレ': 'role-resp',
    '優先順位のズレ': 'priority',
    '意思決定基準のズレ': 'decision',
    '情報共有のズレ': 'info-share',
    '挑戦と失敗許容のズレ': 'challenge',
    'ツール・施策への不信感': 'tool-distrust',
    'その他': 'other',
  };

  const primaryCategory = insight.relatedIssueTypes[0] || 'その他';
  const slug = categoryMap[primaryCategory] || 'other';
  const seq = String(index + 1).padStart(3, '0');

  return `${slug}-${seq}`;
}

/**
 * 論点と投稿の紐付けを保存する
 * org_alignment_insight_sources テーブルに多対多の関係を記録
 *
 * @param admin - Supabase admin client
 * @param input - 保存するデータ
 * @returns 保存されたレコード
 */
export async function saveInsightSources(
  admin: SupabaseClient,
  input: {
    insightId: string;
    insightKey: string;
    caseIds: string[];
  }
) {
  const records = input.caseIds.map((caseId) => ({
    insight_id: input.insightId,
    insight_key: input.insightKey,
    case_id: caseId,
  }));

  const { data, error } = await admin
    .from('org_alignment_insight_sources')
    .insert(records)
    .select();

  if (error) {
    throw new Error(`Failed to save insight sources: ${error.message}`);
  }

  return data;
}

/**
 * 論点の共有範囲別（visibility_mode別）件数を取得
 * org_alignment_insight_sources テーブルを通じて関連投稿を集計
 *
 * @param admin - Supabase admin client
 * @param insightId - 論点ID
 * @param insightKey - 論点キー
 * @returns visibility_mode別の件数
 */
export async function getInsightVisibilityCounts(
  admin: SupabaseClient,
  insightId: string,
  insightKey: string
): Promise<VisibilityCounts> {
  const { data, error } = await admin
    .from('org_alignment_insight_sources')
    .select(
      `
      case_id,
      org_alignment_cases!inner(visibility_mode)
    `
    )
    .eq('insight_id', insightId)
    .eq('insight_key', insightKey);

  if (error) {
    throw new Error(
      `Failed to get insight visibility counts: ${error.message}`
    );
  }

  const counts: VisibilityCounts = { anonymous: 0, manager_only: 0, named: 0 };

  for (const row of data || []) {
    const mode = (row as any).org_alignment_cases.visibility_mode as VisibilityMode;
    if (mode in counts) {
      counts[mode]++;
    }
  }

  return counts;
}

/**
 * 論点に紐づく投稿情報を取得（管理画面専用）
 * visibility_mode に応じて投稿者情報を出し分け
 *
 * @param admin - Supabase admin client
 * @param insightId - 論点ID
 * @param insightKey - 論点キー
 * @returns visibility_modeに応じた投稿者情報を含むInsightSourceCaseの配列
 */
export async function getInsightSourceCases(
  admin: SupabaseClient,
  insightId: string,
  insightKey: string
): Promise<InsightSourceCase[]> {
  const { data, error } = await admin
    .from('org_alignment_insight_sources')
    .select(
      `
      case_id,
      org_alignment_cases!inner(
        created_by,
        visibility_mode,
        created_at
      )
    `
    )
    .eq('insight_id', insightId)
    .eq('insight_key', insightKey);

  if (error) {
    throw new Error(
      `Failed to get insight source cases: ${error.message}`
    );
  }

  const cases: InsightSourceCase[] = [];

  for (const row of data || []) {
    const caseData = (row as any).org_alignment_cases;
    const visibilityMode = caseData.visibility_mode as VisibilityMode;

    // visibility_mode に応じて投稿者情報を取得
    let userName: string | null = null;
    let userEmail: string | null = null;

    if (visibilityMode === 'manager_only' || visibilityMode === 'named') {
      if (caseData.created_by) {
        const { data: userData, error: userError } = await admin
          .from('profiles')
          .select('full_name, email')
          .eq('id', caseData.created_by)
          .single();

        if (!userError && userData) {
          userName = userData.full_name || null;
          userEmail = userData.email || null;
        }
      }
    }

    cases.push({
      caseId: row.case_id,
      visibilityMode,
      createdBy: caseData.created_by,
      createdAt: caseData.created_at,
      userName: visibilityMode === 'anonymous' ? null : userName,
      userEmail: visibilityMode === 'anonymous' ? null : userEmail,
    });
  }

  return cases;
}
