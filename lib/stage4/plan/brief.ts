import type { AssembledPlan, VerificationItem } from './types';

export const BRIEF_CONFIRMATION_LIMIT = 3;

/**
 * 現場社員向けの要点と、詳細表示に回すものを分ける。内容は削らない。
 * - beforeStart：実行前に確認する重要事項（最大3件）
 * - detailConfirmations：それ以外の確認事項（詳細表示）
 * - mainActions：主要な行動の一覧（見出し用）
 */
export function buildBriefing(plan: AssembledPlan): {
  beforeStart: VerificationItem[];
  detailConfirmations: VerificationItem[];
  mainActions: Array<{ order: number; title: string; dueYm: string }>;
} {
  const beforeStart = plan.verificationItems.filter((v) => v.priority === 'BEFORE_START').slice(0, BRIEF_CONFIRMATION_LIMIT);
  const shown = new Set(beforeStart.map((v) => v.item));
  const detailConfirmations = plan.verificationItems.filter((v) => !shown.has(v.item));
  return {
    beforeStart,
    detailConfirmations,
    mainActions: plan.section2.actions.map((a) => ({ order: a.order, title: a.title, dueYm: a.dueYm })),
  };
}
