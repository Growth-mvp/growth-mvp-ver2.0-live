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
  if (error) {
    const missing = error.code === '42P01' || error.code === 'PGRST205';
    return { ok: false, status: 503, error: missing ? 'workspace_table_missing' : 'workspace_unavailable' };
  }
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

const CONFIRM_ERRORS: Array<[string, number, string]> = [
  ['insufficient_role', 403, 'insufficient_role'],
  ['strategy_mismatch', 403, 'strategy_mismatch'],
  ['revision_changed', 409, 'revision_changed'],
  ['version_conflict', 409, 'version_conflict'],
  ['invalid_state', 400, 'invalid_state'],
  ['invalid_departments', 400, 'invalid_departments'],
];

/**
 * 確定を、DBの1つのトランザクション（stage3_confirm_strategy_book）で書く。
 * 途中で失敗した場合、関数の中で行われた書き込みはすべて取り消される（正式データも作業状態も変わらない）。
 */
export async function confirmAtomically(
  admin: SupabaseClient,
  args: {
    companyId: string;
    strategyId: string;
    actorUserId: string;
    expectedRevision: number;
    expectedVersion: number;
    departments: unknown[];
    state: WorkspaceState;
  },
): Promise<{ ok: true; revision: number; version: number } | Failure> {
  const { data, error } = await admin.rpc('stage3_confirm_strategy_book', {
    p_company_id: args.companyId,
    p_strategy_id: args.strategyId,
    p_actor_user_id: args.actorUserId,
    p_expected_revision: args.expectedRevision,
    p_expected_version: args.expectedVersion,
    p_departments: args.departments,
    p_state: args.state,
  });
  if (error) {
    const message = String(error.message ?? '');
    const known = CONFIRM_ERRORS.find(([needle]) => message.includes(needle));
    if (known) return { ok: false, status: known[1], error: known[2] };
    return { ok: false, status: 503, error: 'confirm_failed' };
  }
  const row = (Array.isArray(data) ? data[0] : data) as { revision?: unknown; version?: unknown } | null;
  return { ok: true, revision: Number(row?.revision), version: Number(row?.version) };
}
