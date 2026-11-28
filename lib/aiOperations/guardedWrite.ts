// AIによる入力の共通の確認：役割・企業/戦略/利用者の一致・サーバーの版・対象値の変化を、書き込みの前後で確かめる。
// 書き込みそのものは呼び出し側の処理（既存のストア更新）に任せる。
import { supabase } from '@/utils/supabase/client';
import { useStrategyStore, type StrategyState } from '@/store/strategyStore';
import { useUserStore } from '@/store/userStore';
import { OPERATION_ROLE_DENIED, roleMeetsRequirement } from './guard';

export const AUTH_FAILED = '権限の確認ができませんでした。所属と権限を確認して、もう一度お試しください。';
export const REVISION_CHANGED = 'ほかの画面で内容が更新されたため、反映しませんでした。画面を再読み込みして、もう一度指示してください。';
export const SCOPE_CHANGED = '企業または戦略が切り替わったため、反映しませんでした。';
export const VALUE_CHANGED = '権限の確認中に同じ項目が変わったため、反映しませんでした。内容を確かめて、もう一度指示してください。';

export type WriteOutcome = { ok: true; message: string; flash?: string; undo: unknown } | { ok: false; message: string };

export type GuardedWriteResult =
  | { ok: true; message: string; flash?: string; undo: unknown; userId: string }
  | { ok: false; message: string };

/** 書き込みの前後で確かめる。確認に通った時だけ write を実行する */
export async function runGuardedWrite(spec: {
  minRole: 'admin' | 'manager';
  operation: string;
  signature: (st: StrategyState) => string;
  write: () => WriteOutcome;
}): Promise<GuardedWriteResult> {
  if (!roleMeetsRequirement(useUserStore.getState().role ?? null, spec.minRole)) {
    return { ok: false, message: OPERATION_ROLE_DENIED };
  }
  const before = useStrategyStore.getState();
  const userId = useUserStore.getState().user?.id ?? null;
  if (!before.companyId || !before.strategyId || !userId) return { ok: false, message: SCOPE_CHANGED };
  const signatureBefore = spec.signature(before);

  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  const res = token
    ? await fetch('/api/ai-operations/authorize', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ companyId: before.companyId, strategyId: before.strategyId, operation: spec.operation }),
      })
    : null;
  if (!res || !res.ok) return { ok: false, message: AUTH_FAILED };
  const { revision } = (await res.json()) as { revision?: number };

  const after = useStrategyStore.getState();
  const sameScope =
    after.companyId === before.companyId &&
    after.strategyId === before.strategyId &&
    data.session?.user?.id === userId &&
    useUserStore.getState().user?.id === userId;
  if (!sameScope) return { ok: false, message: SCOPE_CHANGED };
  if (!roleMeetsRequirement(useUserStore.getState().role ?? null, spec.minRole)) {
    return { ok: false, message: OPERATION_ROLE_DENIED };
  }
  if (typeof revision !== 'number' || after.revision !== revision) return { ok: false, message: REVISION_CHANGED };
  if (spec.signature(after) !== signatureBefore) return { ok: false, message: VALUE_CHANGED };

  const written = spec.write();
  if (!written.ok) return written;
  return { ok: true, message: written.message, flash: written.flash, undo: written.undo, userId };
}
