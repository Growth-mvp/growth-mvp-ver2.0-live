import { COMMERCIAL_INPUT } from '@/eval/plan/fixtures/commercial';
import { COMMERCIAL_GOLDEN_DRAFT } from '@/eval/plan/fixtures/commercial.golden';
import { assemblePlan } from './assemble';
import { buildPlanContext } from './context';
import { buildBriefing } from './brief';
import { buildPlanSource } from './source';
import { PlanDraftSchema } from './types';

const { source, scope } = buildPlanSource(COMMERCIAL_INPUT);
const ctx = buildPlanContext(source, scope);
const plan = () =>
  assemblePlan(PlanDraftSchema.parse(JSON.parse(JSON.stringify(COMMERCIAL_GOLDEN_DRAFT))), {
    ...ctx,
    endYm: ctx.endYm as string,
    periodBasis: 'STAGE3_KPI_DUE',
  });

describe('buildBriefing（現場社員向けの要点）', () => {
  it('実行前の確認事項は最大3件に絞り、残りは詳細に回す（内容は削らない）', () => {
    const b = buildBriefing(plan());
    expect(b.beforeStart).toHaveLength(3);
    expect(b.detailConfirmations.map((v) => v.item)).toEqual(['過去の提案の受注率', '平均受注額', 'STAGE2の戦略文（店舗・商業施設の内装）との照合']);
  });

  it('確認事項の総数は、要点と詳細を合わせて元の数と一致する', () => {
    const p = plan();
    const b = buildBriefing(p);
    expect(b.beforeStart.length + b.detailConfirmations.length).toBe(p.verificationItems.length);
  });

  it('主要な行動は、順序・見出し・期限を残す', () => {
    const b = buildBriefing(plan());
    expect(b.mainActions[0]).toEqual({ order: 1, title: '見込み先がテナント売上データを提供できるかを確認する', dueYm: '2026-12' });
    expect(b.mainActions).toHaveLength(5);
  });
});
