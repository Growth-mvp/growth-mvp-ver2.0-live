import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import { resolveManualImpacts, stage6ProjectKeyOf } from '@/lib/okr/impactRows';

export type ProjectReferences = Record<string, string[]>;

export type ProjectReferenceResult = { ok: true; references: ProjectReferences } | { ok: false; error: 'reference_check_failed' };

const MISSING_TABLE_CODES = new Set(['42P01', 'PGRST205']);

export type ExecutingProjectResult = { ok: true; ids: Set<string> } | { ok: false; error: 'reference_check_failed' };

/**
 * 実行中（採用済み・実行開始済み）の実行計画書がある施策のID。計画から外すのは止め、中止にしてもらう。
 * 下書きの計画書や業績影響だけの施策は、無効化しても参照を壊さないため対象にしない。
 */
export async function findExecutingProjectIds(
  admin: SupabaseClient,
  args: { companyId: string; strategyId: string; projectIds: string[] },
): Promise<ExecutingProjectResult> {
  const ids = new Set<string>();
  if (args.projectIds.length === 0) return { ok: true, ids };
  const plans = await admin
    .from('stage4_plan_documents')
    .select('project_id, adopted, started')
    .eq('company_id', args.companyId)
    .eq('strategy_id', args.strategyId)
    .in('project_id', args.projectIds);
  if (plans.error && !MISSING_TABLE_CODES.has(String(plans.error.code ?? ''))) {
    return { ok: false, error: 'reference_check_failed' };
  }
  for (const row of plans.data ?? []) {
    if (row.adopted === true || row.started === true) ids.add(String(row.project_id));
  }
  return { ok: true, ids };
}

/**
 * 既存プロジェクトの ID を、実行計画書（STAGE4）・OKR・業績影響（STAGE6）が参照しているかを調べる。
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

  const strategy = await admin
    .from('strategy_data')
    .select('departments, project_target_impacts')
    .eq('id', args.strategyId)
    .eq('company_id', args.companyId)
    .maybeSingle();
  if (strategy.error) return { ok: false, error: 'reference_check_failed' };
  const departments: any[] = Array.isArray(strategy.data?.departments) ? strategy.data.departments : [];
  const impactRows: any[] = Array.isArray(strategy.data?.project_target_impacts) ? strategy.data.project_target_impacts : [];
  const impactOwnerKeys = new Set(
    resolveManualImpacts({ rows: impactRows, departments, companyTargets: [] }).owners.map((o) => o.projectKey),
  );
  departments.forEach((dept) => {
    (Array.isArray(dept?.projects) ? dept.projects : []).forEach((project: any, pIdx: number) => {
      const projectId = String(project?.id ?? '');
      if (args.projectIds.includes(projectId) && impactOwnerKeys.has(stage6ProjectKeyOf(dept, project, pIdx))) {
        add(projectId, '業績影響（STAGE6）で使われています');
      }
    });
  });

  return { ok: true, references };
}
