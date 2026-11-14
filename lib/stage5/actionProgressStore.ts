import { findProjectPositionById } from '@/lib/stage4/planView/financeBridgeStore';
import { applyActionProgressToDepartments, patchStrategyDepartments } from '@/lib/stage5/partialStrategyWrite';
import { strategyPartialIo } from '@/utils/supabase/strategyPartial';
import { useStrategyStore } from '@/store/strategyStore';
import {
  checkProgressPatch,
  nextRecord,
  progressOf,
  sameProgress,
  withActionProgress,
  type ActionProgressPatch,
} from './actionProgress';

export type ActionWriteResult = { ok: true; changed: boolean; revision?: number } | { ok: false; message: string };

const CHANGED = '会社または戦略が切り替わったため、保存されませんでした。画面を読み込み直してから、もう一度お試しください。';

/**
 * 実施事項の進捗・成果・課題・次の行動・紐づくKRを、対象の案件の項目だけを部分更新で書く（戦略全体は送らない）。
 * 会社・戦略・プロジェクトが一致し、実施事項が開始された計画にある場合だけ書く。保存に失敗したら画面を元に戻す。
 */
export async function writeActionProgress(args: {
  companyId: string;
  strategyId: string;
  projectId: string;
  /** 開始された計画の実施事項のキー（読み込み済みの計画から求めたもの） */
  allowedKeys: string[];
  actionKey: string;
  patch: ActionProgressPatch;
  userId: string;
}): Promise<ActionWriteResult> {
  const before = useStrategyStore.getState() as any;
  if (before.pendingCompanyId || before.companyId !== args.companyId || before.strategyId !== args.strategyId) {
    return { ok: false, message: CHANGED };
  }
  const found = findProjectPositionById(before.departments, args.projectId);
  if (!found) return { ok: false, message: '対象の施策を特定できないため、保存しませんでした。一覧を読み直してください。' };

  const okrs = (found.project as { okrsV2?: unknown }).okrsV2;
  const okrIds = (Array.isArray(okrs) ? (okrs as Array<{ id?: unknown }>) : [])
    .map((k) => (typeof k?.id === 'string' ? k.id : ''))
    .filter((id) => id !== '');
  const check = checkProgressPatch({ actionKey: args.actionKey, allowedKeys: args.allowedKeys, patch: args.patch, okrIds });
  if (!check.ok) return { ok: false, message: check.reason };

  const existing = progressOf(found.project)[args.actionKey];
  const record = nextRecord({ existing, patch: args.patch, nowIso: new Date().toISOString(), userId: args.userId });
  if (sameProgress(existing, record)) return { ok: true, changed: false };

  const prevDepartments = before.departments;
  const nextProject = withActionProgress(found.project as Record<string, unknown>, args.actionKey, record);
  const nextDepartments = (prevDepartments as any[]).map((d, dIdx) =>
    dIdx !== found.dIdx ? d : { ...d, projects: d.projects.map((p: unknown, pIdx: number) => (pIdx === found.pIdx ? nextProject : p)) },
  );
  useStrategyStore.setState({ departments: nextDepartments } as never);

  const saved = await patchStrategyDepartments(strategyPartialIo, {
    companyId: args.companyId,
    actorId: args.userId,
    apply: (departments) =>
      applyActionProgressToDepartments(departments, {
        projectId: args.projectId,
        actionKey: args.actionKey,
        patch: args.patch,
        nowIso: new Date().toISOString(),
        userId: args.userId,
      }),
  });
  if (saved.ok) {
    useStrategyStore.getState().syncPartialSave({ departments: saved.departments as unknown[], revision: saved.revision });
    return { ok: true, changed: true, revision: saved.revision };
  }

  const now = useStrategyStore.getState() as any;
  if (now.companyId === args.companyId && now.strategyId === args.strategyId) {
    useStrategyStore.setState({ departments: prevDepartments } as never);
  }
  if (saved.reason === 'revision_conflict') {
    return { ok: false, message: '他の更新と競合したため、保存されませんでした。画面を再読み込みしてから、もう一度お試しください。' };
  }
  return { ok: false, message: '進捗を保存できませんでした。もう一度お試しください。' };
}
