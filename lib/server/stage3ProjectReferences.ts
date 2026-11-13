import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';

export type ProjectReferences = Record<string, string[]>;

export type ProjectReferenceResult = { ok: true; references: ProjectReferences } | { ok: false; error: 'reference_check_failed' };

const MISSING_TABLE_CODES = new Set(['42P01', 'PGRST205']);

/**
 * 既存プロジェクトの ID を、実行計画書（STAGE4）と OKR が参照しているかを調べる。
 * 参照を確認できない時（照会に失敗した時）は、安全側に倒して失敗を返す。
 * 実行計画書の表が無い環境では、その表に行は無いものとして扱う。
 */
export async function findProjectReferences(
  admin: SupabaseClient,
  args: { companyId: string; strategyId: string; projectIds: string[] },
): Promise<ProjectReferenceResult> {
  const references: ProjectReferences = {};
  if (args.projectIds.length === 0) return { ok: true, references };
  const add = (projectId: string, reason: string) => {
    const list = references[projectId] ?? [];
    if (!list.includes(reason)) list.push(reason);
    references[projectId] = list;
  };

  const plans = await admin
    .from('stage4_plan_documents')
    .select('project_id')
    .eq('company_id', args.companyId)
    .eq('strategy_id', args.strategyId)
    .in('project_id', args.projectIds);
  if (plans.error && !MISSING_TABLE_CODES.has(String(plans.error.code ?? ''))) {
    return { ok: false, error: 'reference_check_failed' };
  }
  for (const row of plans.data ?? []) add(String(row.project_id), '実行計画書（STAGE4）で使われています');

  const okrs = await admin
    .from('okrs')
    .select('project_id')
    .eq('company_id', args.companyId)
    .eq('strategy_id', args.strategyId)
    .in('project_id', args.projectIds);
  if (okrs.error) return { ok: false, error: 'reference_check_failed' };
  for (const row of okrs.data ?? []) add(String(row.project_id), 'OKR（STAGE4〜5）で使われています');

  return { ok: true, references };
}
