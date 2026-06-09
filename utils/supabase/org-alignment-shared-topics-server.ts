// /utils/supabase/org-alignment-shared-topics-server.ts
import 'server-only';

import type { SupabaseClient } from '@supabase/supabase-js';
import type { OrgAlignmentInsight } from '@/types/org-alignment';

export type SharedTopicStatus = 'draft' | 'published' | 'in_alignment' | 'action_planned' | 'reflected_to_strategy' | 'closed';

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
  visibility: 'company' | 'draft';
  published_by?: string;
  published_at?: string;
  created_at: string;
  updated_at: string;
};

/**
 * Create a draft shared topic from an admin insight
 * Maps OrgAlignmentInsight to OrgAlignmentSharedTopic in draft status
 */
export async function createSharedTopicDraft(
  admin: SupabaseClient,
  companyId: string,
  insight: OrgAlignmentInsight,
  sourceInsightId?: string
): Promise<OrgAlignmentSharedTopic> {
  const { data, error } = await admin
    .from('org_alignment_shared_topics')
    .insert({
      company_id: companyId,
      source_insight_id: sourceInsightId || null,
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
      visibility: 'draft',
      published_by: null,
      published_at: null,
    })
    .select()
    .single();

  if (error) {
    throw new Error(`Failed to create shared topic draft: ${error.message}`);
  }

  return data as OrgAlignmentSharedTopic;
}

/**
 * Get all shared topics for a company visible to members
 * Only returns published topics
 */
export async function getPublishedSharedTopics(
  client: SupabaseClient,
  companyId: string
): Promise<OrgAlignmentSharedTopic[]> {
  const { data, error } = await client
    .from('org_alignment_shared_topics')
    .select('*')
    .eq('company_id', companyId)
    .eq('status', 'published')
    .eq('visibility', 'company')
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
 * Check if a draft already exists for an insight
 */
export async function checkExistingDraft(
  admin: SupabaseClient,
  companyId: string,
  sourceInsightId: string
): Promise<OrgAlignmentSharedTopic | null> {
  const { data, error } = await admin
    .from('org_alignment_shared_topics')
    .select('*')
    .eq('company_id', companyId)
    .eq('source_insight_id', sourceInsightId)
    .eq('status', 'draft')
    .single();

  if (error) {
    if (error.code === 'PGRST116') {
      return null;
    }
    console.error('Failed to check existing draft:', error);
    return null;
  }

  return data as OrgAlignmentSharedTopic;
}
