import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import { WorkspaceStateSchema, emptyWorkspaceState, type WorkspaceState } from '@/lib/cascade/stage3StrategyBook';

export type LoadedWorkspace = { version: number; state: WorkspaceState };

type Failure = { ok: false; status: number; error: string };

/** 作業状態を読む。保存が無ければ版 0 の空の状態を返す。 */
export async function loadWorkspace(
  admin: SupabaseClient,
  strategyId: string,
): Promise<{ ok: true; workspace: LoadedWorkspace } | Failure> {
  const { data, error } = await admin
    .from('stage3_strategy_books')
    .select('version, state')
    .eq('strategy_id', strategyId)
    .maybeSingle();
  if (error) return { ok: false, status: 503, error: 'workspace_unavailable' };
  if (!data) return { ok: true, workspace: { version: 0, state: emptyWorkspaceState() } };
  const parsed = WorkspaceStateSchema.safeParse(data.state);
  if (!parsed.success) return { ok: false, status: 500, error: 'stored_state_invalid' };
  return { ok: true, workspace: { version: Number(data.version), state: parsed.data } };
}

/**
 * 作業状態を書く。読んだ版（expectedVersion）と保存済みの版が違えば書かない（409）。
 * 版 0 は新規作成。検証は呼び出し側で済ませておく。
 */
export async function saveWorkspace(
  admin: SupabaseClient,
  args: { companyId: string; strategyId: string; userId: string; expectedVersion: number; state: WorkspaceState },
): Promise<{ ok: true; version: number } | Failure> {
  const now = new Date().toISOString();
  if (args.expectedVersion === 0) {
    const { error } = await admin.from('stage3_strategy_books').insert({
      strategy_id: args.strategyId,
      company_id: args.companyId,
      version: 1,
      state: args.state,
      updated_by: args.userId,
      created_at: now,
      updated_at: now,
    });
    if (error) {
      if (error.code === '23505') return { ok: false, status: 409, error: 'version_conflict' };
      return { ok: false, status: 503, error: 'workspace_unavailable' };
    }
    return { ok: true, version: 1 };
  }

  const { data, error } = await admin
    .from('stage3_strategy_books')
    .update({
      state: args.state,
      version: args.expectedVersion + 1,
      updated_by: args.userId,
      updated_at: now,
    })
    .eq('strategy_id', args.strategyId)
    .eq('company_id', args.companyId)
    .eq('version', args.expectedVersion)
    .select('version');
  if (error) return { ok: false, status: 503, error: 'workspace_unavailable' };
  if (!data || data.length === 0) return { ok: false, status: 409, error: 'version_conflict' };
  return { ok: true, version: args.expectedVersion + 1 };
}
