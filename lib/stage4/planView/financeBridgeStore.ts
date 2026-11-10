import { applyProjectImpactPatch } from '@/lib/okr/projectImpactPatch';
import { useStrategyStore } from '@/store/strategyStore';
import type { FinanceEffect } from '@/types/strategy';
import { planFinanceEffectWrite, type FinanceWriteAction } from './financeBridge';

export type FinanceWriteResult =
  | { ok: true; outcome: string; revision?: number }
  | { ok: false; message: string };

type Found = { dIdx: number; pIdx: number; project: { financeEffect?: FinanceEffect; financeEffects?: FinanceEffect[] } };

/** 安定IDで施策の位置を探す。同じIDが複数ある場合は特定できないため null */
export function findProjectPositionById(departments: unknown, projectId: string): Found | null {
  if (!projectId || !Array.isArray(departments)) return null;
  let found: Found | null = null;
  let count = 0;
  departments.forEach((dept: any, dIdx: number) => {
    (Array.isArray(dept?.projects) ? dept.projects : []).forEach((project: any, pIdx: number) => {
      if (String(project?.id ?? '') !== projectId) return;
      count += 1;
      found = { dIdx, pIdx, project };
    });
  });
  return count === 1 ? found : null;
}

const CHANGED = '会社または戦略が切り替わったため、保存されませんでした。画面を読み込み直してから、もう一度お試しください。';

/**
 * 施策の財務効果を、既存の確認ロジック（ガード）と既存の保存（saveStrategyData）で書く。
 * 保存に失敗したら、画面の状態を書き込み前に戻す。STAGE3のKPI・業績前提には触れない。
 */
export async function writeFinanceEffectToProject(args: {
  companyId: string;
  strategyId: string;
  projectId: string;
  candidate: FinanceEffect;
  action: FinanceWriteAction;
}): Promise<FinanceWriteResult> {
  const before = useStrategyStore.getState() as any;
  if (before.pendingCompanyId || before.companyId !== args.companyId || before.strategyId !== args.strategyId) {
    return { ok: false, message: CHANGED };
  }
  const found = findProjectPositionById(before.departments, args.projectId);
  if (!found) return { ok: false, message: '対象の施策を特定できないため、保存しませんでした。一覧を読み直してください。' };

  const plan = planFinanceEffectWrite({
    primary: found.project.financeEffect,
    additional: found.project.financeEffects,
    candidate: args.candidate,
    action: args.action,
    nowIso: new Date().toISOString(),
  });
  if (!plan.ok) return { ok: false, message: plan.reason };
  if (Object.keys(plan.patch).length === 0) return { ok: true, outcome: plan.outcome };

  const prevDepartments = before.departments;
  useStrategyStore.setState((st: any) => applyProjectImpactPatch(st, found.dIdx, found.pIdx, plan.patch));
  const result: any = await (useStrategyStore.getState() as any).saveStrategyData({ reason: 'stage4_finance_effect', force: true });

  if (result?.ok) return { ok: true, outcome: plan.outcome, revision: result.revision };

  const now = useStrategyStore.getState() as any;
  if (!result?.skipped && now.companyId === args.companyId && now.strategyId === args.strategyId) {
    useStrategyStore.setState({ departments: prevDepartments } as never);
  }
  if (result?.skipped) return { ok: false, message: CHANGED };
  return { ok: false, message: '財務効果を保存できませんでした。もう一度お試しください。' };
}
