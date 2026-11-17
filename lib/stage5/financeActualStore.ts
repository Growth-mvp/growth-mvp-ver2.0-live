import { findProjectPositionById } from '@/lib/stage4/planView/financeBridgeStore';
import { applyFinanceActualToDepartments, patchStrategyDepartments } from '@/lib/stage5/partialStrategyWrite';
import { upsertFinanceActual } from '@/lib/stage5/financeActuals';
import { useStrategyStore } from '@/store/strategyStore';
import { strategyPartialIo } from '@/utils/supabase/strategyPartial';

export type FinanceActualWriteResult = { ok: true } | { ok: false; message: string };

const CHANGED = '会社または戦略が切り替わったため、保存されませんでした。画面を読み込み直してから、もう一度お試しください。';

/**
 * 財務項目の月次実績を、対象の案件の financeActuals だけを部分更新で書く（計画・KR・STAGE6の値は送らない）。
 * 会社・戦略・案件が一致し、対象の財務項目が画面の一覧にある場合だけ書く。保存に失敗したら画面を元に戻す。
 */
export async function writeFinanceActual(args: {
  companyId: string;
  strategyId: string;
  projectId: string;
  allowedItemKeys: string[];
  itemKey: string;
  ym: string;
  amountYen: number;
  note?: string;
  userId: string;
}): Promise<FinanceActualWriteResult> {
  const before = useStrategyStore.getState() as any;
  if (before.pendingCompanyId || before.companyId !== args.companyId || before.strategyId !== args.strategyId) {
    return { ok: false, message: CHANGED };
  }
  const found = findProjectPositionById(before.departments, args.projectId);
  if (!found) return { ok: false, message: '対象の施策を特定できないため、保存しませんでした。一覧を読み直してください。' };
  if (!args.allowedItemKeys.includes(args.itemKey)) {
    return { ok: false, message: '対象の財務項目を特定できないため、保存しませんでした。画面を読み直してください。' };
  }

  const nowIso = new Date().toISOString();
  const prevDepartments = before.departments;
  const nextProject = {
    ...found.project,
    financeActuals: upsertFinanceActual(
      (found.project as { financeActuals?: Parameters<typeof upsertFinanceActual>[0] }).financeActuals,
      { itemKey: args.itemKey, ym: args.ym, amountYen: args.amountYen, note: args.note, nowIso },
    ),
  };
  const nextDepartments = (prevDepartments as any[]).map((d, dIdx) =>
    dIdx !== found.dIdx ? d : { ...d, projects: d.projects.map((p: unknown, pIdx: number) => (pIdx === found.pIdx ? nextProject : p)) },
  );
  useStrategyStore.setState({ departments: nextDepartments } as never);

  const saved = await patchStrategyDepartments(strategyPartialIo, {
    companyId: args.companyId,
    actorId: args.userId,
    apply: (departments) =>
      applyFinanceActualToDepartments(departments, {
        projectId: args.projectId,
        itemKey: args.itemKey,
        ym: args.ym,
        amountYen: args.amountYen,
        note: args.note,
        nowIso,
      }),
  });
  if (saved.ok) {
    useStrategyStore.getState().syncPartialSave({ departments: saved.departments as unknown[], revision: saved.revision });
    return { ok: true };
  }

  const now = useStrategyStore.getState() as any;
  if (now.companyId === args.companyId && now.strategyId === args.strategyId) {
    useStrategyStore.setState({ departments: prevDepartments } as never);
  }
  if (saved.reason === 'revision_conflict') {
    return { ok: false, message: '他の更新と競合したため、保存されませんでした。画面を再読み込みしてから、もう一度お試しください。' };
  }
  return { ok: false, message: '実績を保存できませんでした。もう一度お試しください。' };
}
