// /utils/supabase/org-alignment-server.ts
import 'server-only';

import type { SupabaseClient } from '@supabase/supabase-js';
import type {
  OrgAlignmentInsightDashboard,
  OrgAlignmentInsightRow,
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
