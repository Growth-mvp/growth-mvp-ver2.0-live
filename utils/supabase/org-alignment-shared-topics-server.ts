// /utils/supabase/org-alignment-shared-topics-server.ts
import 'server-only';

import type { SupabaseClient } from '@supabase/supabase-js';
import type { OrgAlignmentInsight } from '@/types/org-alignment';

export type SharedTopicStatus = 'published' | 'in_alignment' | 'action_planned' | 'reflected' | 'closed' | 'on_hold' | 'hidden';

export type OrgAlignmentSharedTopic = {
  id: string;
  company_id: string;
  source_insight_id?: string;
  title: string;
  summary?: string;
  status: SharedTopicStatus;
  priority_score?: number;
  importance?: '高' | '中' | '低';
  urgency?: '高' | '中' | '低';
  impact_scope?: string;
  affected_departments?: string[];
  recognition_gap?: {
    fieldView: string;
    companyView: string;
    gapEssence: string;
  };
  company_axis?: string;
  session_type?: string;
  next_actions?: Array<{
    title: string;
    owner: string;
    dueDate: string;
    status: '未着手' | '対応中' | '完了';
  }>;
  strategy_reflection?: {
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
  related_case_count: number;
  published_by?: string;
  published_at?: string;
  announcement_text?: string;
  announcement_updated_at?: string;
  announcement_updated_by?: string;
  created_at: string;
  updated_at: string;
};

/**
 * Create a shared topic from an admin insight
 * Maps OrgAlignmentInsight to OrgAlignmentSharedTopic with published status
 * Called automatically when insights are AI-generated
 */
export async function createSharedTopicFromInsight(
  admin: SupabaseClient,
  companyId: string,
  insight: OrgAlignmentInsight,
  sourceInsightId?: string,
  publishedBy?: string,
  dashboardSourceCaseCount?: number,
  totalInsights?: number,
  insightIndex?: number,
  sourceAlignmentInsightId?: string
): Promise<OrgAlignmentSharedTopic> {
  // Calculate related_case_count: use insight-specific count if available, otherwise estimate
  let relatedCaseCount = 0;
  if (typeof insight.relatedCaseCount === 'number' && insight.relatedCaseCount > 0) {
    relatedCaseCount = insight.relatedCaseCount;
  } else if (dashboardSourceCaseCount && totalInsights && totalInsights > 0 && typeof insightIndex === 'number') {
    // Fallback: distribute cases evenly with remainder going to first indices
    // Example: 7 cases, 3 insights → [3, 2, 2]
    const base = Math.floor(dashboardSourceCaseCount / totalInsights);
    const remainder = dashboardSourceCaseCount % totalInsights;
    relatedCaseCount = base + (insightIndex < remainder ? 1 : 0);
  } else if (dashboardSourceCaseCount && totalInsights && totalInsights > 0) {
    // Fallback without index: just use base division
    relatedCaseCount = Math.floor(dashboardSourceCaseCount / totalInsights);
  } else {
    // Default to 0 if no information available
    relatedCaseCount = 0;
  }

  const { data, error } = await admin
    .from('org_alignment_shared_topics')
    .insert({
      company_id: companyId,
      source_insight_id: sourceInsightId || null,
      source_alignment_insight_id: sourceAlignmentInsightId || null,
      title: insight.title,
      summary: insight.description,
      status: 'published',
      priority_score: insight.priorityScore ?? null,
      importance: insight.importance ?? null,
      urgency: insight.urgency ?? null,
      impact_scope: insight.impactScope ?? null,
      affected_departments: insight.affectedDepartments ?? [],
      recognition_gap: insight.recognitionGap ?? null,
      company_axis: insight.companyAxis ?? null,
      session_type: insight.sessionType ?? null,
      next_actions: insight.nextActions ?? [],
      strategy_reflection: insight.strategyReflection ?? null,
      related_case_count: relatedCaseCount,
      published_by: publishedBy || null,
      published_at: new Date().toISOString(),
    })
    .select()
    .single();

  if (error) {
    throw new Error(`Failed to create shared topic: ${error.message}`);
  }

  return data as OrgAlignmentSharedTopic;
}

/**
 * Create a shared topic draft from an admin insight (for manual creation)
 * Legacy function - kept for backward compatibility
 */
export async function createSharedTopicDraft(
  admin: SupabaseClient,
  companyId: string,
  insight: OrgAlignmentInsight,
  sourceInsightId?: string
): Promise<OrgAlignmentSharedTopic> {
  return createSharedTopicFromInsight(admin, companyId, insight, sourceInsightId);
}

/**
 * Get all shared topics for a company visible to members
 * Returns public statuses: published, in_alignment, action_planned, reflected, closed
 * Only returns topics from the latest org_alignment_insights batch to prevent duplicate display
 */
export async function getPublishedSharedTopics(
  client: SupabaseClient,
  companyId: string
): Promise<OrgAlignmentSharedTopic[]> {
  const publicStatuses = ['published', 'in_alignment', 'action_planned', 'reflected', 'closed'];

  // First, get the latest org_alignment_insights for this company
  const { data: latestInsight, error: insightError } = await client
    .from('org_alignment_insights')
    .select('id')
    .eq('company_id', companyId)
    .order('generated_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (insightError) {
    console.error('Failed to fetch latest insight:', insightError);
    return [];
  }

  // If no insights exist yet, return empty array
  if (!latestInsight) {
    return [];
  }

  // Get shared topics only from the latest insight batch
  const { data, error } = await client
    .from('org_alignment_shared_topics')
    .select('*')
    .eq('company_id', companyId)
    .eq('source_alignment_insight_id', latestInsight.id)
    .in('status', publicStatuses)
    .order('published_at', { ascending: false });

  if (error) {
    console.error('Failed to fetch published shared topics:', error);
    return [];
  }

  return (data || []) as OrgAlignmentSharedTopic[];
}

/**
 * Get all shared topics for a company (draft and published)
 * Admin only - returns all statuses
 */
export async function getAllSharedTopicsForAdmin(
  admin: SupabaseClient,
  companyId: string
): Promise<OrgAlignmentSharedTopic[]> {
  const { data, error } = await admin
    .from('org_alignment_shared_topics')
    .select('*')
    .eq('company_id', companyId)
    .order('updated_at', { ascending: false });

  if (error) {
    console.error('Failed to fetch all shared topics:', error);
    return [];
  }

  return (data || []) as OrgAlignmentSharedTopic[];
}

/**
 * Get a single shared topic by ID (admin view - sees all statuses)
 */
export async function getSharedTopicById(
  admin: SupabaseClient,
  companyId: string,
  topicId: string
): Promise<OrgAlignmentSharedTopic | null> {
  const { data, error } = await admin
    .from('org_alignment_shared_topics')
    .select('*')
    .eq('company_id', companyId)
    .eq('id', topicId)
    .single();

  if (error) {
    if (error.code === 'PGRST116') {
      return null;
    }
    throw new Error(`Failed to fetch shared topic: ${error.message}`);
  }

  return data as OrgAlignmentSharedTopic;
}

/**
 * Update shared topic status and visibility
 * Admin only operation
 */
export async function updateSharedTopic(
  admin: SupabaseClient,
  companyId: string,
  topicId: string,
  updates: {
    status?: SharedTopicStatus;
    visibility?: 'company' | 'draft';
    published_by?: string;
    published_at?: string;
  }
): Promise<OrgAlignmentSharedTopic> {
  const { data, error } = await admin
    .from('org_alignment_shared_topics')
    .update({
      ...updates,
      updated_at: new Date().toISOString(),
    })
    .eq('company_id', companyId)
    .eq('id', topicId)
    .select()
    .single();

  if (error) {
    throw new Error(`Failed to update shared topic: ${error.message}`);
  }

  return data as OrgAlignmentSharedTopic;
}

/**
 * Check if a shared topic already exists for an insight
 */
export async function checkExistingTopic(
  admin: SupabaseClient,
  companyId: string,
  sourceInsightId: string
): Promise<OrgAlignmentSharedTopic | null> {
  const { data, error } = await admin
    .from('org_alignment_shared_topics')
    .select('*')
    .eq('company_id', companyId)
    .eq('source_insight_id', sourceInsightId)
    .single();

  if (error) {
    if (error.code === 'PGRST116') {
      return null;
    }
    console.error('Failed to check existing topic:', error);
    return null;
  }

  return data as OrgAlignmentSharedTopic;
}

/**
 * Check if a draft already exists for an insight (legacy function)
 */
export async function checkExistingDraft(
  admin: SupabaseClient,
  companyId: string,
  sourceInsightId: string
): Promise<OrgAlignmentSharedTopic | null> {
  return checkExistingTopic(admin, companyId, sourceInsightId);
}

/**
 * Find or create a shared topic for an insight
 *
 * 検索ロジック：
 * 1. source_insight_id + source_insight_key で検索
 * 2. 見つからない場合は title + 最新の created_at で検索（暫定対応）
 * 3. 見つからない場合は新規作成
 */
export async function findOrCreateSharedTopic(
  admin: SupabaseClient,
  companyId: string,
  insightId: string,
  insightKey: string,
  insight: OrgAlignmentInsight
): Promise<OrgAlignmentSharedTopic> {
  // 1. source_insight_id + source_insight_key で検索
  const { data: existingTopic, error: searchError } = await admin
    .from('org_alignment_shared_topics')
    .select('*')
    .eq('company_id', companyId)
    .eq('source_insight_id', insightId)
    .eq('source_insight_key', insightKey)
    .single();

  if (!searchError && existingTopic) {
    return existingTopic as OrgAlignmentSharedTopic;
  }

  // 2. 見つからない場合は title で検索（暫定対応：既存データとの互換性）
  // NOTE: これは暫定対応です。source_insight_id/key がない既存データを処理するため。
  // 新しいデータは source_insight_id/key を正しく設定されます。
  const { data: existingTopicByTitle } = await admin
    .from('org_alignment_shared_topics')
    .select('*')
    .eq('company_id', companyId)
    .eq('title', insight.title)
    .in('status', ['published', 'draft'])
    .order('created_at', { ascending: false })
    .limit(1)
    .single();

  if (existingTopicByTitle) {
    // 見つかったら source_insight_id/key を更新
    const { data: updatedTopic } = await admin
      .from('org_alignment_shared_topics')
      .update({
        source_insight_id: insightId,
        source_insight_key: insightKey,
        updated_at: new Date().toISOString(),
      })
      .eq('id', (existingTopicByTitle as any).id)
      .select()
      .single();

    if (updatedTopic) {
      return updatedTopic as OrgAlignmentSharedTopic;
    }
  }

  // 3. 見つからない場合は新規作成
  const { data: newTopic, error: insertError } = await admin
    .from('org_alignment_shared_topics')
    .insert({
      company_id: companyId,
      source_insight_id: insightId,
      source_insight_key: insightKey,
      title: insight.title,
      summary: insight.description,
      status: 'draft',
      priority_score: insight.priorityScore ?? null,
      importance: insight.importance ?? null,
      urgency: insight.urgency ?? null,
      impact_scope: insight.impactScope ?? null,
      affected_departments: insight.affectedDepartments ?? [],
      recognition_gap: insight.recognitionGap ?? null,
      company_axis: insight.companyAxis ?? null,
      session_type: insight.sessionType ?? null,
      next_actions: insight.nextActions ?? [],
      strategy_reflection: insight.strategyReflection ?? null,
      related_case_count: insight.relatedCaseCount ?? 0,
    })
    .select()
    .single();

  if (insertError) {
    throw new Error(`Failed to create shared topic: ${insertError.message}`);
  }

  return newTopic as OrgAlignmentSharedTopic;
}
