import { normalizeFinanceEffect } from '@/lib/financeEffect';
import { estimateProjectImpact } from './impactEstimate';
import {
  applyFinanceAnswers,
  buildFinanceEffectDrafts,
  confirmBlockers,
  type ConfirmContext,
  type FinanceAnswers,
} from './financeBridge';
import { buildFinanceEffectTrial } from '@/utils/stage6/financeEffectPlan';
import type { FinanceEffect } from '@/types/strategy';

const CONFIRMED_AT = '2026-11-10T00:00:00.000Z';
const FY_END = '3';
const NO_CONTEXT: ConfirmContext = { overlapCount: 0, hasCostEffect: false, costConfirmed: false, revenueOpIncludesAddCost: false };

function costEstimate(edits: Record<string, number>) {
  return estimateProjectImpact({ role: 'COST', okrsV2: [] }, { edits: Object.fromEntries(Object.entries(edits).map(([k, v]) => [`impact:${k}`, v])) });
}

function costDraft(edits: Record<string, number>) {
  const draft = buildFinanceEffectDrafts({ estimate: costEstimate(edits), fiscalYearEnd: FY_END }).find((d) => d.kind === 'COST_REDUCTION');
  if (!draft) throw new Error('cost draft missing');
  return draft;
}

const ANSWERS: FinanceAnswers = { startYm: '2027-04', endYm: '2028-03', reductionConfirmed: true };

describe('コスト削減型の財務効果（年間削減額と確認）', () => {
  it('削減対象の年間費用と想定削減率から、年間削減額の下書きを作る（年額で固定）', () => {
    const draft = costDraft({ currentCostMJPY: 120, reductionRatePct: 10, startYear: 2028, endYear: 2028 });
    expect(draft.base.directAmountYen).toBe(12_000_000);
    expect(draft.base.amountBasis).toBe('ANNUAL');
    expect(draft.base.startYm).toBe('2027-04');
    expect(draft.base.endYm).toBe('2028-03');
  });

  it('金額が不明な場合は下書きを作らず、0とみなさない', () => {
    const drafts = buildFinanceEffectDrafts({ estimate: costEstimate({ currentCostMJPY: 120 }), fiscalYearEnd: FY_END });
    expect(drafts.find((d) => d.kind === 'COST_REDUCTION')).toBeUndefined();
  });

  it('発生頻度を月額にしても、年額で固定される（月額・年額の混同を防ぐ）', () => {
    const draft = costDraft({ currentCostMJPY: 120, reductionRatePct: 10, startYear: 2028, endYear: 2028 });
    const e = applyFinanceAnswers(draft, { ...ANSWERS, amountBasis: 'MONTHLY' });
    expect(e.amountBasis).toBe('ANNUAL');
    expect(e.directAmountYen).toBe(12_000_000);
  });

  it('実際に減らせる費用として確認していなければ、確認に進めない', () => {
    const draft = costDraft({ currentCostMJPY: 120, reductionRatePct: 10, startYear: 2028, endYear: 2028 });
    const blockers = confirmBlockers(applyFinanceAnswers(draft, { ...ANSWERS, reductionConfirmed: false }), NO_CONTEXT);
    expect(blockers.join('、')).toContain('実際に減らせる費用として確認できた');
    const ok = confirmBlockers(applyFinanceAnswers(draft, ANSWERS), NO_CONTEXT);
    expect(ok).toEqual([]);
  });

  it('同じ案件の売上増加で営業利益増分を計上していれば、重複の説明が無いと確認に進めない', () => {
    const draft = costDraft({ currentCostMJPY: 120, reductionRatePct: 10, startYear: 2028, endYear: 2028 });
    const ctx: ConfirmContext = { ...NO_CONTEXT, revenueHasOperatingEffect: true };
    expect(confirmBlockers(applyFinanceAnswers(draft, ANSWERS), ctx).join('、')).toContain('重複がないことの説明');
    expect(confirmBlockers(applyFinanceAnswers(draft, { ...ANSWERS, overlapNote: '売上の営業利益には含めていない' }), ctx)).toEqual([]);
  });

  it('売上増加の下書きは、試算の売上の前提があるときだけ作る（既存の動きを変えない）', () => {
    const drafts = buildFinanceEffectDrafts({
      estimate: estimateProjectImpact({ role: 'REVENUE', okrsV2: [] }, { edits: { 'impact:customers': 10, 'impact:rate': 10, 'impact:deal': 10 } }),
      fiscalYearEnd: FY_END,
    });
    expect(drafts.map((d) => d.kind)).toEqual(['REVENUE_UP']);
  });

  it('保存した内容は、再読込でも確認の状態と金額が変わらない', () => {
    const draft = costDraft({ currentCostMJPY: 120, reductionRatePct: 10, startYear: 2028, endYear: 2028 });
    const saved = normalizeFinanceEffect({ ...applyFinanceAnswers(draft, ANSWERS), confirmed: true, confirmedAt: CONFIRMED_AT });
    expect(saved).toMatchObject({ kind: 'COST_REDUCTION', directAmountYen: 12_000_000, amountBasis: 'ANNUAL', reductionConfirmed: true, confirmed: true });
  });
});

describe('STAGE6への反映（確認済みのコスト削減と追加費用は、既存の計算で年間利益改善額になる）', () => {
  it('確認済みの削減額から、追加費用を差し引いた年間利益改善額がSTAGE6の試算に入る', () => {
    const reduction = applyFinanceAnswers(costDraft({ currentCostMJPY: 120, reductionRatePct: 10, startYear: 2028, endYear: 2028 }), ANSWERS);
    const addCostDraft = buildFinanceEffectDrafts({
      estimate: estimateProjectImpact({ role: 'COST', okrsV2: [] }, { edits: { 'impact:currentCostMJPY': 120, 'impact:reductionRatePct': 10, 'impact:addCostMJPY': 2, 'impact:startYear': 2028, 'impact:endYear': 2028 } }),
      fiscalYearEnd: FY_END,
    }).find((d) => d.kind === 'COST_INCREASE');
    expect(addCostDraft).toBeDefined();
    const addCost = applyFinanceAnswers(addCostDraft!, { startYm: '2027-04', endYm: '2028-03', amountBasis: 'ANNUAL' });

    const trial = buildFinanceEffectTrial({
      departments: [
        {
          name: '新聞販売・配達事業',
          projects: [
            {
              title: '新聞配達ルート別の採算と配達品質を両立する維持・改善判断',
              financeEffect: { ...reduction, confirmed: true, confirmedAt: CONFIRMED_AT },
              financeEffects: [{ ...addCost, confirmed: true, confirmedAt: CONFIRMED_AT }],
            },
          ],
        },
      ] as never,
      fiscalYearEnd: FY_END,
      fiscalYears: [2028],
    });

    expect(trial.years[0].costReductionYen).toBe(12_000_000);
    expect(trial.years[0].costIncreaseYen).toBe(2_000_000);
    expect(trial.years[0].operatingEffectYen).toBe(10_000_000);
  });

  it('未確認のコスト削減は、STAGE6の試算に入らない', () => {
    const draft = applyFinanceAnswers(costDraft({ currentCostMJPY: 120, reductionRatePct: 10, startYear: 2028, endYear: 2028 }), ANSWERS);
    const trial = buildFinanceEffectTrial({
      departments: [{ name: '新聞', projects: [{ title: 'ルート改善', financeEffect: { ...draft, confirmed: false } }] }] as never,
      fiscalYearEnd: FY_END,
      fiscalYears: [2028],
    });
    expect(trial.years[0].costReductionYen).toBe(0);
    expect(trial.excluded.length).toBe(1);
  });
});

describe('保存の繰り返し（二重登録の防止）', () => {
  it('計画を保存すると草案の保存と確認が1回ずつ行われ、確認済みの効果は再保存で書き直さない', async () => {
    const { financeSaveSteps } = await import('./financeBridge');
    const draft = costDraft({ currentCostMJPY: 120, reductionRatePct: 10, startYear: 2028, endYear: 2028 });
    const first = financeSaveSteps({ drafts: [draft], answers: { COST_REDUCTION: ANSWERS }, saved: [], overlapCount: 0 });
    expect(first.map((s) => s.action)).toEqual(['SAVE_DRAFT', 'CONFIRM']);
    const saved = { ...applyFinanceAnswers(draft, ANSWERS), confirmed: true, confirmedAt: CONFIRMED_AT } as FinanceEffect;
    expect(financeSaveSteps({ drafts: [draft], answers: { COST_REDUCTION: ANSWERS }, saved: [saved], overlapCount: 0 })).toEqual([]);
  });
});
