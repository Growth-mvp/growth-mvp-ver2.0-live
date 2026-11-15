import { normalizeFinanceEffect } from '@/lib/financeEffect';
import { buildFinanceEffectTrial } from '@/utils/stage6/financeEffectPlan';
import type { FinanceEffect } from '@/types/strategy';
import { estimateProjectImpact } from './impactEstimate';
import {
  applyFinanceAnswers,
  buildFinanceEffectDrafts,
  confirmBlockers,
  financeConfirmContext,
  financeSaveSteps,
  type FinanceAnswers,
  type FinanceAnswersByKind,
  type FinanceEffectDraft,
} from './financeBridge';

const FY_END = '3';
const AT = '2026-11-10T00:00:00.000Z';
const FY2028_ANSWERS: FinanceAnswers = { startYm: '2027-04', endYm: '2028-03' };

const NEWS_EDITS = { currentCostMJPY: 10, reductionRatePct: 5, addCostMJPY: 0.1, startYear: 2028, endYear: 2028 };
const DELIVERY_EDITS = {
  serviceRevenue: 1,
  customers: 2,
  serviceCountPerCustomerMonthly: 12,
  serviceUnitPriceYen: 2500,
  grossMarginPct: 40,
  addCostMJPY: 0.1,
  startYear: 2028,
  endYear: 2028,
};

function draftsOf(role: 'COST' | 'REVENUE', edits: Record<string, number>): FinanceEffectDraft[] {
  const estimate = estimateProjectImpact(
    { role, okrsV2: [] },
    { edits: Object.fromEntries(Object.entries(edits).map(([k, v]) => [`impact:${k}`, v])) },
  );
  return buildFinanceEffectDrafts({ estimate, fiscalYearEnd: FY_END });
}

const draftOf = (drafts: FinanceEffectDraft[], kind: FinanceEffectDraft['kind']): FinanceEffectDraft => {
  const d = drafts.find((x) => x.kind === kind);
  if (!d) throw new Error(`draft ${kind} missing`);
  return d;
};

function confirmedOf(drafts: FinanceEffectDraft[], answers: FinanceAnswersByKind): FinanceEffect[] {
  return financeSaveSteps({ drafts, answers, saved: [], overlapCount: 0 })
    .filter((s) => s.action === 'CONFIRM')
    .map((s) => ({ ...s.candidate, confirmed: true, confirmedAt: AT }));
}

const pickKind = (effects: FinanceEffect[], kind: FinanceEffect['kind']): FinanceEffect => {
  const e = effects.find((x) => x.kind === kind);
  if (!e) throw new Error(`effect ${kind} missing`);
  return e;
};

const NEWS_ANSWERS: FinanceAnswersByKind = {
  COST_REDUCTION: { ...FY2028_ANSWERS, reductionConfirmed: true },
  COST_INCREASE: { ...FY2028_ANSWERS, amountBasis: 'ANNUAL' },
};
/** 宅配の営業利益増分は、件数×単価の売上と同じ月額で入力する（追加費用を差し引く前の値：月額 288,000円 ÷ 12 = 24,000円） */
const DELIVERY_ANSWERS: FinanceAnswersByKind = {
  REVENUE_UP: { ...FY2028_ANSWERS, operatingIncomeEffectYen: 24_000, opIncomeIncludesAddCost: false },
  COST_INCREASE: { ...FY2028_ANSWERS, amountBasis: 'ANNUAL' },
};

const trialOf = (departments: unknown[], fiscalYears = [2028]) =>
  buildFinanceEffectTrial({ departments: departments as never, fiscalYearEnd: FY_END, fiscalYears });

describe('宅配（サービス提供型：顧客数×件数×料金）の入力と売上の計算', () => {
  it('顧客2社・1社当たり月12件・1件2,500円から、年額72万円の売上を試算する', () => {
    const estimate = estimateProjectImpact({ role: 'REVENUE', okrsV2: [] }, { edits: Object.fromEntries(Object.entries(DELIVERY_EDITS).map(([k, v]) => [`impact:${k}`, v])) });
    expect(estimate.status).toBe('CALCULATED');
    if (estimate.status !== 'CALCULATED') return;
    const revenue = estimate.rows.find((r) => r.label === '売上（参考試算）');
    expect(revenue?.valueText).toBe('72万円');
    expect(revenue?.formula).toContain('2社 × 1社当たり月12件 × 2,500円 = 6万円');
    expect(revenue?.formula).toContain('6万円 × 12か月 = 72万円');
  });

  it('件数や単価が未入力なら未算定の理由を示し、0円にはしない', () => {
    const estimate = estimateProjectImpact({ role: 'REVENUE', okrsV2: [] }, { edits: { 'impact:serviceRevenue': 1, 'impact:customers': 2 } });
    expect(estimate.status).toBe('NOT_CALCULATED');
    if (estimate.status !== 'NOT_CALCULATED') return;
    expect(estimate.reason).toContain('1社当たり月間配送件数');
  });

  it('下書きは件数×単価（月額）として作り、売上の区分はサービス提供にする。通常の新規売上型は変えない', () => {
    const drafts = draftsOf('REVENUE', DELIVERY_EDITS);
    const revenue = draftOf(drafts, 'REVENUE_UP');
    expect(revenue.base).toMatchObject({ method: 'QUANTITY_UNIT_PRICE', quantity: 24, unitPriceYen: 2500, costRatePct: 60 });
    const saved = applyFinanceAnswers(revenue, { ...FY2028_ANSWERS, amountBasis: 'ANNUAL', revenueKind: 'MASS_PRODUCTION' });
    expect(saved).toMatchObject({ amountBasis: 'MONTHLY', revenueKind: 'SERVICE' });

    const funnel = draftsOf('REVENUE', { customers: 30, rate: 20, deal: 20, startYear: 2028, endYear: 2028 });
    expect(draftOf(funnel, 'REVENUE_UP').base.method).toBe('FUNNEL');
    expect(applyFinanceAnswers(draftOf(funnel, 'REVENUE_UP'), { ...FY2028_ANSWERS, amountBasis: 'ANNUAL', revenueKind: 'MASS_PRODUCTION' })).toMatchObject({
      amountBasis: 'ANNUAL',
      revenueKind: 'MASS_PRODUCTION',
    });
  });
});

describe('営業利益増分の単位と追加費用の二重控除の防止', () => {
  const costAnswers = (): FinanceAnswersByKind => ({ COST_INCREASE: { ...FY2028_ANSWERS, amountBasis: 'ANNUAL' } });

  it('売上の粗利（年額28.8万円）と追加費用（年額10万円）を差し引く前の値で入力すれば、確認できる', () => {
    const drafts = draftsOf('REVENUE', DELIVERY_EDITS);
    const answers = { ...DELIVERY_ANSWERS, ...costAnswers() };
    const ctx = financeConfirmContext(drafts, [], 0, answers);
    expect(ctx.addCostAnnualYen).toBe(100_000);
    expect(confirmBlockers(applyFinanceAnswers(draftOf(drafts, 'REVENUE_UP'), answers.REVENUE_UP!), ctx)).toEqual([]);
  });

  it('差し引いた後の値（18.8万円）を「含まない」で入れると、追加費用が二重に差し引かれるため確認できない', () => {
    const drafts = draftsOf('REVENUE', DELIVERY_EDITS);
    const answers: FinanceAnswersByKind = {
      REVENUE_UP: { ...FY2028_ANSWERS, operatingIncomeEffectYen: 188_000 / 12, opIncomeIncludesAddCost: false },
      ...costAnswers(),
    };
    const blockers = confirmBlockers(applyFinanceAnswers(draftOf(drafts, 'REVENUE_UP'), answers.REVENUE_UP!), financeConfirmContext(drafts, [], 0, answers));
    expect(blockers.join('、')).toContain('一致しません');
  });

  it('差し引いた後の値（18.8万円）を「含む」で入れれば、確認できる', () => {
    const drafts = draftsOf('REVENUE', DELIVERY_EDITS);
    const answers: FinanceAnswersByKind = {
      REVENUE_UP: { ...FY2028_ANSWERS, operatingIncomeEffectYen: 188_000 / 12, opIncomeIncludesAddCost: true },
      ...costAnswers(),
    };
    expect(confirmBlockers(applyFinanceAnswers(draftOf(drafts, 'REVENUE_UP'), answers.REVENUE_UP!), financeConfirmContext(drafts, [], 0, answers))).toEqual([]);
  });

  it('月額の売上に年額の営業利益増分を入れた（12倍になる）場合は、年額の売上を超えるため確認できない', () => {
    const drafts = draftsOf('REVENUE', DELIVERY_EDITS);
    const answers: FinanceAnswersByKind = {
      REVENUE_UP: { ...FY2028_ANSWERS, operatingIncomeEffectYen: 288_000, opIncomeIncludesAddCost: false },
      ...costAnswers(),
    };
    const blockers = confirmBlockers(applyFinanceAnswers(draftOf(drafts, 'REVENUE_UP'), answers.REVENUE_UP!), financeConfirmContext(drafts, [], 0, answers));
    expect(blockers.join('、')).toContain('年額の売上（');
  });
});

describe('検証シナリオ：新聞（費用削減）と宅配（売上・追加費用）', () => {
  const newsDrafts = () => draftsOf('COST', NEWS_EDITS);
  const deliveryDrafts = () => draftsOf('REVENUE', DELIVERY_EDITS);

  it('確認済みの効果は、正式な試算に年度ごとに入り、営業利益貢献は合計58.8万円になる', () => {
    const news = confirmedOf(newsDrafts(), NEWS_ANSWERS);
    const delivery = confirmedOf(deliveryDrafts(), DELIVERY_ANSWERS);
    const trial = trialOf([
      {
        name: '新聞販売・配達事業',
        projects: [{ title: '新聞', financeEffect: pickKind(news, 'COST_REDUCTION'), financeEffects: [pickKind(news, 'COST_INCREASE')] }],
      },
      {
        name: '宅配事業',
        projects: [{ title: '宅配', financeEffect: pickKind(delivery, 'REVENUE_UP'), financeEffects: [pickKind(delivery, 'COST_INCREASE')] }],
      },
    ]);
    const y = trial.years[0];
    expect(y).toMatchObject({ revenueYen: 720_000, costReductionYen: 500_000, costIncreaseYen: 200_000, operatingEffectYen: 300_000 });
    expect((y.revenueOperatingIncomeYen ?? 0) + y.operatingEffectYen).toBe(588_000);
    const opOf = (name: string) =>
      trial.projects.filter((r) => r.projectTitle === name && r.status === 'REFLECTED').reduce((sum, r) => sum + (r.years[0]?.operatingIncomeYen ?? 0), 0);
    expect(opOf('新聞')).toBe(400_000);
    expect(opOf('宅配')).toBe(188_000);
    expect(trial.scenario.years[0]).toMatchObject({ revenueYen: 0, costReductionYen: 0, costIncreaseYen: 0 });
  });

  it('未確認の効果は、正式な試算には入らず、未確認の参考試算にだけ金額が出る', () => {
    const news = applyFinanceAnswers(draftOf(newsDrafts(), 'COST_REDUCTION'), NEWS_ANSWERS.COST_REDUCTION!);
    const newsCost = applyFinanceAnswers(draftOf(newsDrafts(), 'COST_INCREASE'), NEWS_ANSWERS.COST_INCREASE!);
    const delivery = applyFinanceAnswers(draftOf(deliveryDrafts(), 'REVENUE_UP'), DELIVERY_ANSWERS.REVENUE_UP!);
    const deliveryCost = applyFinanceAnswers(draftOf(deliveryDrafts(), 'COST_INCREASE'), DELIVERY_ANSWERS.COST_INCREASE!);
    const trial = trialOf([
      { name: '新聞販売・配達事業', projects: [{ title: '新聞', financeEffect: news, financeEffects: [newsCost] }] },
      { name: '宅配事業', projects: [{ title: '宅配', financeEffect: delivery, financeEffects: [deliveryCost] }] },
    ]);

    expect(trial.years[0]).toMatchObject({ revenueYen: 0, costReductionYen: 0, costIncreaseYen: 0, operatingEffectYen: 0, revenueOperatingIncomeYen: 0 });
    expect(trial.included).toEqual([]);
    expect(trial.excluded).toHaveLength(4);
    expect(trial.scenario.years[0]).toMatchObject({ revenueYen: 720_000, costReductionYen: 500_000, costIncreaseYen: 200_000, operatingEffectYen: 300_000 });
    expect(trial.scenario.years[0].revenueOperatingIncomeYen).toBe(288_000);
    expect((trial.scenario.years[0].revenueOperatingIncomeYen ?? 0) + trial.scenario.years[0].operatingEffectYen).toBe(588_000);
    const statuses = trial.projects.map((p) => p.status);
    expect(statuses.every((s) => s === 'DRAFT')).toBe(true);
    expect(trial.projects.every((p) => p.scenarioYears && p.scenarioYears.length === 1)).toBe(true);
  });

  it('同じ施策に確認済みの同じ種類の効果がある場合、未確認の参考試算では二重に数えない', () => {
    const confirmed = confirmedOf(newsDrafts(), NEWS_ANSWERS);
    const draft = applyFinanceAnswers(draftOf(newsDrafts(), 'COST_REDUCTION'), NEWS_ANSWERS.COST_REDUCTION!);
    const trial = trialOf([{ name: '新聞', projects: [{ title: '新聞', financeEffect: pickKind(confirmed, 'COST_REDUCTION'), financeEffects: [{ ...draft, confirmed: false }] }] }]);
    expect(trial.years[0].costReductionYen).toBe(500_000);
    expect(trial.scenario.years[0].costReductionYen).toBe(0);
    const dup = trial.projects.find((p) => p.status === 'DRAFT');
    expect(dup?.scenarioYears).toBeNull();
    expect(dup?.scenarioNote).toContain('二重計上');
  });

  it('保存して読み直しても、金額と確認の状態は変わらない', () => {
    const saved = confirmedOf(deliveryDrafts(), DELIVERY_ANSWERS);
    const reloaded = saved.map((e) => normalizeFinanceEffect(JSON.parse(JSON.stringify(e))) as FinanceEffect);
    expect(reloaded).toEqual(saved);
    expect(reloaded.find((e) => e.kind === 'REVENUE_UP')).toMatchObject({ method: 'QUANTITY_UNIT_PRICE', quantity: 24, unitPriceYen: 2500, revenueKind: 'SERVICE', confirmed: true });
  });
});

describe('年度ごとの期間按分（既存のルール）', () => {
  it('年額の効果は、会計年度と重なる月数で按分する（10月〜翌9月は、各年度に6か月ずつ）', () => {
    const effect: FinanceEffect = {
      kind: 'COST_REDUCTION',
      method: 'DIRECT_AMOUNT',
      directAmountYen: 1_200_000,
      amountBasis: 'ANNUAL',
      startYm: '2027-10',
      endYm: '2028-09',
      sourceNote: '按分の確認',
      source: 'USER_INPUT',
      confirmed: true,
      confirmedAt: AT,
    };
    const trial = trialOf([{ name: '製造', projects: [{ title: '工程', financeEffect: effect }] }], [2028, 2029]);
    expect(trial.years.map((y) => y.costReductionYen)).toEqual([600_000, 600_000]);
  });
});
