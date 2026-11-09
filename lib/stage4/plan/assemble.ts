import type { PlanContext } from './context';
import type { AssembledPlan, PeriodBasis, PlanDraft, ProtectedKpi } from './types';

/** 確定KPIは入力の順に S1, S2 … を振る。AIはこのキーを参照するだけで、内容は変えられない */
export function protectedKpisOf(ctx: PlanContext): ProtectedKpi[] {
  return ctx.stage3Kpis.map((k, i) => ({
    key: `S${i + 1}`,
    origin: 'STAGE3',
    stage3KpiId: k.id,
    kind: 'UNCLASSIFIED',
    label: k.label,
    target: k.target,
    unit: k.unit,
    targetBasis: k.target === null ? null : 'STAGE_DATA',
    confirmation: k.basis === 'USER_CONFIRMED' ? 'USER_CONFIRMED' : 'UNCONFIRMED',
    due: k.due,
    owner: k.owner,
    measurement:
      k.basis === 'USER_CONFIRMED' ? '確定済みKPI（STAGE3）の測定方法に従う' : '入力済みKPIの測定方法は利用者が確認する',
    supportsActionOrders: [],
    judgeCandidateYm: k.due === null ? ctx.endYm : null,
  }));
}

/** AIの出力と確定情報を1つの計画にまとめる。確定KPIと期間はここで入力値から決まる */
export function assemblePlan(draft: PlanDraft, ctx: PlanContext & { endYm: string; periodBasis: PeriodBasis }): AssembledPlan {
  return {
    period: { startYm: ctx.startYm, endYm: ctx.endYm, basis: ctx.periodBasis },
    section1: draft.section1,
    section2: draft.section2,
    section3: {
      protectedKpis: protectedKpisOf(ctx),
      proposedKpis: draft.section3.kpis,
      stage3Review: draft.section3.stage3Review,
    },
    section4: draft.section4,
    section5: draft.section5,
    verificationItems: draft.verificationItems,
    responsibleSuggestion: draft.section5.responsible.name === null ? ctx.ownerCandidates[0] ?? null : null,
  };
}
