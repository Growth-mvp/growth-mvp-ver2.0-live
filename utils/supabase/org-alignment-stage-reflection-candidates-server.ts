// /utils/supabase/org-alignment-stage-reflection-candidates-server.ts
import 'server-only';

import type { SupabaseClient } from '@supabase/supabase-js';

export type StageReflectionCandidate = {
  id: string;
  company_id: string;
  shared_topic_id: string;
  target_stage: 'stage3' | 'stage4';
  target_department?: string;
  candidate_type: 'project' | 'okr';
  title: string;
  summary?: string;
  objective?: string;
  key_results?: string[];
  owner?: string;
  due_date?: string;
  status: 'pending' | 'accepted' | 'rejected';
  created_at: string;
  updated_at: string;
  accepted_at?: string;
};

/**
 * Create reflection candidates from strategy reflection data
 */
export async function createReflectionCandidates(
  admin: SupabaseClient,
  companyId: string,
  sharedTopicId: string,
  targetStage: 'stage3' | 'stage4',
  strategyReflection: {
    generatedProjects?: Array<{
      departmentName: string;
      projectTitle: string;
      projectSummary: string;
    }>;
    generatedOkrs?: Array<{
      objective: string;
      keyResults: string[];
      owner: string;
      dueDate: string;
    }>;
  }
): Promise<StageReflectionCandidate[]> {
  const candidates: any[] = [];

  if (targetStage === 'stage3' && strategyReflection.generatedProjects) {
    for (const project of strategyReflection.generatedProjects) {
      candidates.push({
        company_id: companyId,
        shared_topic_id: sharedTopicId,
        target_stage: 'stage3',
        target_department: project.departmentName,
        candidate_type: 'project',
        title: project.projectTitle,
        summary: project.projectSummary,
        status: 'pending',
      });
    }
  }

  if (targetStage === 'stage4' && strategyReflection.generatedOkrs) {
    for (const okr of strategyReflection.generatedOkrs) {
      candidates.push({
        company_id: companyId,
        shared_topic_id: sharedTopicId,
        target_stage: 'stage4',
        candidate_type: 'okr',
        title: okr.objective,
        objective: okr.objective,
        key_results: okr.keyResults,
        owner: okr.owner,
        due_date: okr.dueDate,
        status: 'pending',
      });
    }
  }

  if (candidates.length === 0) {
    return [];
  }

  const { data, error } = await admin
    .from('org_alignment_stage_reflection_candidates')
    .insert(candidates)
    .select();

  if (error) {
    throw new Error(`Failed to create reflection candidates: ${error.message}`);
  }

  return (data || []) as StageReflectionCandidate[];
}

/**
 * Get pending reflection candidates for a stage
 */
export async function getPendingReflectionCandidates(
  admin: SupabaseClient,
  companyId: string,
  targetStage: 'stage3' | 'stage4'
): Promise<StageReflectionCandidate[]> {
  const { data, error } = await admin
    .from('org_alignment_stage_reflection_candidates')
    .select('*')
    .eq('company_id', companyId)
    .eq('target_stage', targetStage)
    .eq('status', 'pending')
    .order('created_at', { ascending: false });

  if (error) {
    console.error('Failed to fetch pending reflection candidates:', error);
    return [];
  }

  return (data || []) as StageReflectionCandidate[];
}

/**
 * Get reflection candidates for a shared topic
 */
export async function getReflectionCandidatesForTopic(
  admin: SupabaseClient,
  companyId: string,
  sharedTopicId: string
): Promise<StageReflectionCandidate[]> {
  const { data, error } = await admin
    .from('org_alignment_stage_reflection_candidates')
    .select('*')
    .eq('company_id', companyId)
    .eq('shared_topic_id', sharedTopicId)
    .order('created_at', { ascending: false });

  if (error) {
    console.error('Failed to fetch reflection candidates for topic:', error);
    return [];
  }

  return (data || []) as StageReflectionCandidate[];
}

/**
 * Update reflection candidate status
 */
export async function updateReflectionCandidateStatus(
  admin: SupabaseClient,
  companyId: string,
  candidateId: string,
  status: 'pending' | 'accepted' | 'rejected'
): Promise<StageReflectionCandidate> {
  const updatePayload: any = {
    status,
    updated_at: new Date().toISOString(),
  };

  if (status === 'accepted') {
    updatePayload.accepted_at = new Date().toISOString();
  }

  console.log('[updateReflectionCandidateStatus] Updating:', { companyId, candidateId, status, payload: updatePayload });

  const { data, error } = await admin
    .from('org_alignment_stage_reflection_candidates')
    .update(updatePayload)
    .eq('company_id', companyId)
    .eq('id', candidateId)
    .select()
    .single();

  if (error) {
    console.error('[updateReflectionCandidateStatus] Error:', { error: error.message, code: error.code, details: error.details });
    throw new Error(`Failed to update reflection candidate: ${error.message}`);
  }

  console.log('[updateReflectionCandidateStatus] Success:', data);
  return data as StageReflectionCandidate;
}

/**
 * Get a single reflection candidate by ID
 */
export async function getReflectionCandidateById(
  admin: SupabaseClient,
  companyId: string,
  candidateId: string
): Promise<StageReflectionCandidate | null> {
  const { data, error } = await admin
    .from('org_alignment_stage_reflection_candidates')
    .select('*')
    .eq('company_id', companyId)
    .eq('id', candidateId)
    .single();

  if (error) {
    if (error.code === 'PGRST116') {
      return null;
    }
    throw new Error(`Failed to fetch reflection candidate: ${error.message}`);
  }

  return data as StageReflectionCandidate;
}
