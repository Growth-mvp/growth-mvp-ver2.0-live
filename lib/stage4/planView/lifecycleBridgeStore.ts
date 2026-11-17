import { lifecycleActionRefusal, setProjectLifecycle, type LifecycleAction } from '@/lib/cascade/projectLifecycle';
import { useStrategyStore } from '@/store/strategyStore';
import { findProjectPositionById } from './financeBridgeStore';

export type LifecycleWriteResult = { ok: true } | { ok: false; message: string };

type SaveOutcome = { ok?: boolean; skipped?: boolean; reason?: string };
type StoreView = {
  pendingCompanyId?: unknown;
  companyId?: string | null;
  strategyId?: string | null;
  departments?: unknown[];
  saveStrategyData: (opts: { reason: string; force: boolean }) => Promise<SaveOutcome>;
};
const storeNow = () => useStrategyStore.getState() as unknown as StoreView;

const CHANGED = '会社または戦略が切り替わったため、保存されませんでした。画面を読み込み直してから、もう一度お試しください。';

const REFUSAL_MESSAGE: Record<string, string> = {
  ALREADY_OUT: 'この施策は、すでに計画から外れています。一覧を読み直してください。',
  APPROVED: '承認済みの計画は、計画から外せません。承認を解除してから操作してください。',
  EXECUTING: '採用済み・実行中の計画は、計画から外せません。「プロジェクトを中止する」を使ってください。',
  NOT_STARTED: '実行を開始していない計画は、中止できません。計画から外してください。',
};

/**
 * 施策を「計画から外す（EXCLUDE）」または「中止する（STOP）」。STAGE3の確定と同じ状態変更（setProjectLifecycle）を使い、
 * 既存の保存（saveStrategyData）で書く。物理削除はしない。保存に失敗したら、画面の状態を書き込み前に戻す。
 */
export async function writeProjectLifecycleToProject(args: {
  companyId: string;
  strategyId: string;
  projectId: string;
  action: LifecycleAction;
  facts: { executing: boolean; started: boolean };
  nowIso: string;
  actorUserId: string | null;
}): Promise<LifecycleWriteResult> {
  const before = storeNow();
  if (before.pendingCompanyId || before.companyId !== args.companyId || before.strategyId !== args.strategyId) {
    return { ok: false, message: CHANGED };
  }
  const found = findProjectPositionById(before.departments, args.projectId);
  if (!found) return { ok: false, message: '対象の施策を特定できないため、保存しませんでした。一覧を読み直してください。' };
  const refusal = lifecycleActionRefusal(found.project, args.action, args.facts);
  if (refusal) return { ok: false, message: REFUSAL_MESSAGE[refusal] };

  const next = setProjectLifecycle(before.departments ?? [], {
    projectId: args.projectId,
    status: args.action === 'EXCLUDE' ? 'EXCLUDED' : 'STOPPED',
    changedAt: args.nowIso,
    changedBy: args.actorUserId,
    stoppedAt: args.nowIso,
  });
  if (!next.ok) return { ok: false, message: '対象の施策を特定できないため、保存しませんでした。一覧を読み直してください。' };

  const prevDepartments = before.departments;
  useStrategyStore.setState({ departments: next.departments } as never);
  const result = await storeNow().saveStrategyData({ reason: 'stage4_project_lifecycle', force: true });

  if (result?.ok) return { ok: true };

  const now = storeNow();
  if (!result?.skipped && now.companyId === args.companyId && now.strategyId === args.strategyId) {
    useStrategyStore.setState({ departments: prevDepartments } as never);
  }
  if (result?.skipped) {
    if (result.reason === 'scope_changed' || result.reason === 'company_switching' || result.reason === 'company_scope_missing') {
      return { ok: false, message: CHANGED };
    }
    return { ok: false, message: '保存されませんでした。もう一度お試しください。' };
  }
  return { ok: false, message: '計画の変更を保存できませんでした。もう一度お試しください。' };
}
