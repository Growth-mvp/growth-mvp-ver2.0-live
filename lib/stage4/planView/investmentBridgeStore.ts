import { applyProjectImpactPatch } from '@/lib/okr/projectImpactPatch';
import { useStrategyStore } from '@/store/strategyStore';
import type { ExecutionHumanInvestment } from '@/types/strategy';
import { findProjectPositionById } from './financeBridgeStore';
import { upsertInvestmentRecords } from './investmentRows';
import { isPlanApproved } from '@/utils/stage6/investmentDemand';

export type InvestmentWriteResult = { ok: true } | { ok: false; message: string };

const CHANGED = '会社または戦略が切り替わったため、保存されませんでした。画面を読み込み直してから、もう一度お試しください。';

/**
 * 施策の投資・追加費用の明細を、既存の施策データ（executionHumanInvestments）へ既存の保存（saveStrategyData）で書く。
 * 明細は安定IDで置き換え、他の明細は変えない。保存に失敗したら、画面の状態を書き込み前に戻す。
 */
export async function writeInvestmentsToProject(args: {
  companyId: string;
  strategyId: string;
  projectId: string;
  records: ExecutionHumanInvestment[];
}): Promise<InvestmentWriteResult> {
  const before = useStrategyStore.getState() as any;
  if (before.pendingCompanyId || before.companyId !== args.companyId || before.strategyId !== args.strategyId) {
    return { ok: false, message: CHANGED };
  }
  const found = findProjectPositionById(before.departments, args.projectId);
  if (!found) return { ok: false, message: '対象の施策を特定できないため、保存しませんでした。一覧を読み直してください。' };
  if (isPlanApproved(found.project)) {
    return { ok: false, message: '承認済みの計画の投資・追加費用は変更できません。' };
  }

  const prevDepartments = before.departments;
  const executionHumanInvestments = upsertInvestmentRecords(found.project.executionHumanInvestments, args.records);
  useStrategyStore.setState((st: any) =>
    applyProjectImpactPatch(st, found.dIdx, found.pIdx, { executionHumanInvestments }),
  );
  const result: any = await (useStrategyStore.getState() as any).saveStrategyData({ reason: 'stage4_investment', force: true });

  if (result?.ok) return { ok: true };

  const now = useStrategyStore.getState() as any;
  if (!result?.skipped && now.companyId === args.companyId && now.strategyId === args.strategyId) {
    useStrategyStore.setState({ departments: prevDepartments } as never);
  }
  if (result?.skipped) {
    if (result.reason === 'scope_changed' || result.reason === 'company_switching' || result.reason === 'company_scope_missing') {
      return { ok: false, message: CHANGED };
    }
    return { ok: false, message: '保存されませんでした。もう一度お試しください。' };
  }
  return { ok: false, message: '投資・追加費用を保存できませんでした。もう一度お試しください。' };
}
