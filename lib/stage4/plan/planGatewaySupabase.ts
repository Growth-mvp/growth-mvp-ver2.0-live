/* PlanGateway の Supabase 実装。利用者のトークンを付けたクライアントで読み書きするので、行単位の権限は DB 側で強制される。
 * ここはこの環境では実DBに接続して検証していない（未検証）。動作は検証用のDB（eval/db）の同じ契約で確かめている。 */
import type { SupabaseClient } from '@supabase/supabase-js';

import type { PlanDocEvent, PlanDocKey, PlanDocRecord } from './planDocumentStore';
import { patchColumns, rowToEvent, rowToRecord } from './planRecordMapping';
import type { ClaimResult, GatewayFailure, GatewayResult, IdentityRpcResult, PlanGateway, PlanPatch } from './planService';

type DbError = { code?: string };

const failure = (err: DbError): GatewayFailure => {
  if (err.code === '23505') return 'DUPLICATE';
  if (err.code === '42501') return 'FORBIDDEN';
  if (err.code === '40001') return 'CONFLICT';
  return 'ERROR';
};

export function createSupabasePlanGateway(client: SupabaseClient): PlanGateway {
  const table = () => client.from('stage4_plan_documents');
  const keyFilter = <T extends { eq: (c: string, v: string) => T }>(q: T, key: PlanDocKey): T =>
    q.eq('company_id', key.companyId).eq('strategy_id', key.strategyId).eq('project_id', key.projectId);

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
      return { ok: true, value: data ? rowToRecord(data as Record<string, unknown>) : null };
    },

    async listEvents(key): Promise<GatewayResult<PlanDocEvent[]>> {
      const { data, error } = await client
        .from('stage4_plan_document_events')
        .select('action, version, actor_user_id, created_at, payload')
        .eq('company_id', key.companyId)
        .eq('strategy_id', key.strategyId)
        .eq('project_id', key.projectId)
        .order('created_at', { ascending: true });
      if (error) return { ok: false, code: failure(error) };
      return { ok: true, value: (data ?? []).map((r) => rowToEvent(r as Record<string, unknown>)) };
    },

    async claimGeneration(key, userId): Promise<GatewayResult<ClaimResult>> {
      const inserted = await table()
        .insert({
          company_id: key.companyId,
          strategy_id: key.strategyId,
          project_id: key.projectId,
          status: 'GENERATING',
          created_by: userId,
          updated_by: userId,
        })
        .select('*')
        .single();
      if (!inserted.error && inserted.data) {
        return { ok: true, value: { claimed: true, record: rowToRecord(inserted.data as Record<string, unknown>) } };
      }
      if (inserted.error && failure(inserted.error) !== 'DUPLICATE') return { ok: false, code: failure(inserted.error) };

      const retry = await keyFilter(table().update({ status: 'GENERATING', updated_by: userId }), key)
        .eq('status', 'GENERATION_FAILED')
        .select('*')
        .maybeSingle();
      if (retry.error) return { ok: false, code: failure(retry.error) };
      if (retry.data) return { ok: true, value: { claimed: true, record: rowToRecord(retry.data as Record<string, unknown>) } };

      const existing = await table()
        .select('*')
        .eq('company_id', key.companyId)
        .eq('strategy_id', key.strategyId)
        .eq('project_id', key.projectId)
        .maybeSingle();
      if (existing.error || !existing.data) return { ok: false, code: 'ERROR' };
      return { ok: true, value: { claimed: false, existing: rowToRecord(existing.data as Record<string, unknown>) } };
    },

    async completeGeneration(key, userId, aiDraft): Promise<GatewayResult<PlanDocRecord | null>> {
      const { data, error } = await keyFilter(
        table().update({ status: 'DRAFT', ai_draft: aiDraft, updated_by: userId }),
        key
      )
        .eq('status', 'GENERATING')
        .select('*')
        .maybeSingle();
      if (error) return { ok: false, code: failure(error) };
      return { ok: true, value: data ? rowToRecord(data as Record<string, unknown>) : null };
    },

    async failGeneration(key, userId): Promise<GatewayResult<PlanDocRecord | null>> {
      const { data, error } = await keyFilter(table().update({ status: 'GENERATION_FAILED', updated_by: userId }), key)
        .eq('status', 'GENERATING')
        .select('*')
        .maybeSingle();
      if (error) return { ok: false, code: failure(error) };
      return { ok: true, value: data ? rowToRecord(data as Record<string, unknown>) : null };
    },

    async updatePlan(key, expectedVersion, patch: PlanPatch, userId): Promise<GatewayResult<PlanDocRecord | null>> {
      const cols = { ...patchColumns(patch, userId), version: expectedVersion + 1 };
      const { data, error } = await keyFilter(table().update(cols), key)
        .eq('version', expectedVersion)
        .eq('status', 'DRAFT')
        .select('*')
        .maybeSingle();
      if (error) return { ok: false, code: failure(error) };
      return { ok: true, value: data ? rowToRecord(data as Record<string, unknown>) : null };
    },

    async readStrategyRow(companyId, strategyId) {
      const { data, error } = await client
        .from('strategy_data')
        .select('*')
        .eq('id', strategyId)
        .eq('company_id', companyId)
        .maybeSingle();
      if (error) return { ok: false, code: failure(error) };
      return { ok: true, value: data ? (data as Record<string, unknown>) : null };
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
