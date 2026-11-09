/* PlanGateway の Supabase 実装。利用者のトークンを付けたクライアントで読み書きするので、行単位の権限は DB 側で強制される。
 * ここはこの環境では実DBに接続して検証していない（未検証）。動作は検証用のDB（eval/db）の同じ契約で確かめている。 */
import type { SupabaseClient } from '@supabase/supabase-js';

import type { PlanDocRecord } from './planDocumentStore';
import type { GatewayFailure, GatewayResult, IdentityRpcResult, PlanGateway } from './planService';

type DbError = { code?: string };

const failure = (err: DbError): GatewayFailure => {
  if (err.code === '23505') return 'DUPLICATE';
  if (err.code === '42501') return 'FORBIDDEN';
  if (err.code === '40001') return 'CONFLICT';
  return 'ERROR';
};

const toRecord = (row: Record<string, unknown>): PlanDocRecord => ({
  key: {
    companyId: String(row.company_id),
    strategyId: String(row.strategy_id),
    projectId: String(row.project_id),
  },
  version: Number(row.version),
  aiDraft: row.ai_draft as Record<string, unknown>,
  userEdits: (row.user_edits ?? {}) as PlanDocRecord['userEdits'],
  adopted: row.adopted === true,
  updatedAt: String(row.updated_at),
  updatedBy: String(row.updated_by),
});

export function createSupabasePlanGateway(client: SupabaseClient): PlanGateway {
  const table = () => client.from('stage4_plan_documents');
  return {
    async membershipRole(userId, companyId): Promise<GatewayResult<string | null>> {
      const { data, error } = await client
        .from('company_members')
        .select('role')
        .eq('company_id', companyId)
        .eq('user_id', userId)
        .maybeSingle();
      if (error) return { ok: false, code: failure(error) };
      return { ok: true, value: data ? String((data as { role: unknown }).role) : null };
    },

    async findPlan(key): Promise<GatewayResult<PlanDocRecord | null>> {
      const { data, error } = await table()
        .select('*')
        .eq('company_id', key.companyId)
        .eq('strategy_id', key.strategyId)
        .eq('project_id', key.projectId)
        .maybeSingle();
      if (error) return { ok: false, code: failure(error) };
      return { ok: true, value: data ? toRecord(data as Record<string, unknown>) : null };
    },

    async insertPlan(key, input, userId): Promise<GatewayResult<PlanDocRecord>> {
      const { data, error } = await table()
        .insert({
          company_id: key.companyId,
          strategy_id: key.strategyId,
          project_id: key.projectId,
          ai_draft: input.aiDraft,
          user_edits: input.userEdits,
          adopted: input.adopted,
          created_by: userId,
          updated_by: userId,
        })
        .select('*')
        .single();
      if (error || !data) return { ok: false, code: error ? failure(error) : 'ERROR' };
      return { ok: true, value: toRecord(data as Record<string, unknown>) };
    },

    async updatePlan(key, expectedVersion, input, userId): Promise<GatewayResult<PlanDocRecord | null>> {
      const { data, error } = await table()
        .update({ version: expectedVersion + 1, user_edits: input.userEdits, adopted: input.adopted, updated_by: userId })
        .eq('company_id', key.companyId)
        .eq('strategy_id', key.strategyId)
        .eq('project_id', key.projectId)
        .eq('version', expectedVersion)
        .select('*')
        .maybeSingle();
      if (error) return { ok: false, code: failure(error) };
      return { ok: true, value: data ? toRecord(data as Record<string, unknown>) : null };
    },

    async readStrategy(companyId, strategyId) {
      const { data, error } = await client
        .from('strategy_data')
        .select('id, company_id, departments, revision')
        .eq('id', strategyId)
        .eq('company_id', companyId)
        .maybeSingle();
      if (error) return { ok: false, code: failure(error) };
      if (!data) return { ok: true, value: null };
      const row = data as { departments: unknown; revision: number };
      return { ok: true, value: { revision: Number(row.revision), departments: row.departments } };
    },

    async assignIdentity(args): Promise<GatewayResult<IdentityRpcResult>> {
      const { data, error } = await client.rpc('stage4_assign_project_identity', {
        p_company_id: args.companyId,
        p_strategy_id: args.strategyId,
        p_department_index: args.departmentIndex,
        p_project_index: args.projectIndex,
        p_expected_title: args.expectedTitle,
        p_expected_revision: args.expectedRevision,
        p_new_id: args.newId,
      });
      if (error || !data) return { ok: false, code: error ? failure(error) : 'ERROR' };
      return { ok: true, value: data as IdentityRpcResult };
    },
  };
}
