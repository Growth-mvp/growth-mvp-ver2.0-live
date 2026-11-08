import type { Department, FinanceEffect } from '@/types/strategy';
import { computeFinanceEffect } from '@/lib/financeEffect';
import { buildFinanceEffectTrial } from '@/utils/stage6/financeEffectPlan';
import { applyProjectImpactPatch } from './projectImpactPatch';
import {
  ORIGIN_LABEL,
  UNVERIFIED_ORIGIN_LABEL,
  blockingChecksDone,
  buildFinanceEffectCandidate,
  candidateChecks,
  planCandidateWrite,
} from './financeEffectCandidate';

/* 手計算の前提：AI算定前提 対象顧客30社 × 受注率20% × 平均単価20百万円 = 120百万円（年額・2026年4月開始） */
const M = 1_000_000;
const AI_REVENUE = { targetCustomers: 30, conversionRatePct: 20, averageDealMJPY: 20 };
const RATIONALE = '既存顧客の保守契約更新の見込み（架空）';

const revenueCandidate = (origin: 'AI_PROPOSED' | 'PRESET' | 'USER_INPUT' | undefined = 'AI_PROPOSED') => {
  const r = buildFinanceEffectCandidate({ role: 'REVENUE', assumptions: AI_REVENUE, rationale: RATIONALE, origin });
  if (!r.ok) throw new Error(r.reason);
  return r;
};

describe('AI算定前提から財務効果の候補を作る', () => {
  it('売上：FUNNEL方式に、対象顧客数・受注率・平均単価を金額単位を換算して引き継ぐ', () => {
    const r = revenueCandidate();
    expect(r.effect).toMatchObject({
      kind: 'REVENUE_UP',
      method: 'FUNNEL',
      meetingsPerPeriod: 30,
      winRatePct: 20,
      averageDealYen: 20 * M,
    });
    expect(r.formula).toBe('30社 × 20% × 20百万円 = 120百万円');
  });

  it('売上：引き継いだ式で計算すると、AIの見込み額（120百万円）と一致する', () => {
    const r = revenueCandidate();
    const result = computeFinanceEffect({ ...r.effect, amountBasis: 'ANNUAL', startYm: '2026-04' });
    expect(result.annualRevenueYen).toBe(120 * M);
  });

  it('候補は未確認で作られ、根拠文と算定式と出所を残す（AI案は確認済みにしない）', () => {
    const r = revenueCandidate();
    expect(r.effect.confirmed).toBe(false);
    expect(r.effect.source).toBe('AI_PROPOSED');
    expect(r.effect.sourceNote).toContain(RATIONALE);
    expect(r.effect.sourceNote).toContain('算定式：30社 × 20% × 20百万円 = 120百万円');
    expect(r.effect.sourceNote).toContain(ORIGIN_LABEL.AI_PROPOSED);
  });

  it('費用削減：現在コスト × 削減率を、費用削減の直接金額として保持する（根拠の式も残す）', () => {
    const r = buildFinanceEffectCandidate({ role: 'COST', assumptions: { currentCostMJPY: 120, reductionRatePct: 10 }, rationale: '外注費の見直し（架空）', origin: 'AI_PROPOSED' });
    if (!r.ok) throw new Error(r.reason);
    expect(r.effect).toMatchObject({ kind: 'COST_REDUCTION', method: 'DIRECT_AMOUNT', directAmountYen: 12 * M, confirmed: false });
    expect(r.effect.sourceNote).toContain('算定式：120百万円 × 10% = 12百万円');
    expect(computeFinanceEffect({ ...r.effect, amountBasis: 'ANNUAL', startYm: '2026-04' }).annualOperatingEffectYen).toBe(12 * M);
  });

  it('投資（FUTURE）は投資計画で扱うため、財務効果の候補を作らない', () => {
    const r = buildFinanceEffectCandidate({ role: 'FUTURE', assumptions: { peopleCount: 3, durationMonths: 6, monthlyCostPerPersonMJPY: 1 }, origin: 'AI_PROPOSED' });
    expect(r.ok).toBe(false);
  });

  it('売上の前提が揃っていなければ候補を作らない（0で補わない）', () => {
    const r = buildFinanceEffectCandidate({ role: 'REVENUE', assumptions: { targetCustomers: 30 }, origin: 'AI_PROPOSED' });
    expect(r.ok).toBe(false);
  });

  it('前提の出所：固定プリセットは利用者の選択、出所不明の既存値は未確認の既存値として扱う', () => {
    const preset = revenueCandidate('PRESET');
    expect(preset.effect.source).toBe('USER_INPUT');
    expect(preset.effect.sourceNote).toContain(ORIGIN_LABEL.PRESET);
    const unknown = buildFinanceEffectCandidate({ role: 'REVENUE', assumptions: AI_REVENUE, rationale: RATIONALE, origin: undefined });
    if (!unknown.ok) throw new Error(unknown.reason);
    expect(unknown.effect.sourceNote).toContain(UNVERIFIED_ORIGIN_LABEL);
  });
});

describe('AI提案の効果は、確認項目を済ませないと確認できない', () => {
  it('AI提案の売上（FUNNEL）は、対象顧客数の意味と追加効果の確認が必須', () => {
    const e: FinanceEffect = { ...revenueCandidate().effect, amountBasis: 'ANNUAL', startYm: '2026-04' };
    expect(blockingChecksDone(e)).toBe(false);
    expect(candidateChecks(e).filter((c) => c.blocking && !c.done).map((c) => c.key)).toEqual(['meaning', 'incremental']);
    expect(blockingChecksDone({ ...e, meetingBasisConfirmed: true, isIncremental: true })).toBe(true);
  });

  it('利用者が入力した売上は、AI提案の確認項目を要求しない（期間などの必須項目のみ）', () => {
    const e: FinanceEffect = { ...revenueCandidate('USER_INPUT').effect, source: 'USER_INPUT', amountBasis: 'ANNUAL', startYm: '2026-04' };
    expect(blockingChecksDone(e)).toBe(true);
  });

  it('営業利益の増分が未入力なら未確認の項目として出し、利益は推定しない', () => {
    const e: FinanceEffect = { ...revenueCandidate().effect, amountBasis: 'ANNUAL', startYm: '2026-04' };
    const oi = candidateChecks(e).find((c) => c.key === 'operatingIncome');
    expect(oi?.done).toBe(false);
    expect(oi?.blocking).toBe(false);
    expect(computeFinanceEffect({ ...e, meetingBasisConfirmed: true, isIncremental: true }).annualOperatingEffectYen).toBeUndefined();
  });
});

describe('同じ施策に複数の効果を保持し、重複を作らない', () => {
  const confirmedCost: FinanceEffect = {
    kind: 'COST_REDUCTION',
    method: 'DIRECT_AMOUNT',
    directAmountYen: 1 * M,
    amountBasis: 'MONTHLY',
    startYm: '2026-04',
    sourceNote: '工程表（架空）',
    source: 'USER_INPUT',
    confirmed: true,
  };

  it('効果がない施策には、候補を最初の効果として作る', () => {
    const plan = planCandidateWrite({ primary: undefined, additional: undefined, candidate: revenueCandidate().effect });
    expect(plan.outcome).toBe('created');
    expect(plan.patch.financeEffect?.kind).toBe('REVENUE_UP');
  });

  it('既に売上の効果がある施策に、費用削減を作ると、2つ目として保持する（既存は変えない）', () => {
    const plan = planCandidateWrite({
      primary: { ...revenueCandidate().effect, confirmed: true },
      additional: undefined,
      candidate: { ...confirmedCost, confirmed: false },
    });
    expect(plan.outcome).toBe('created_additional');
    expect(plan.patch.financeEffect).toBeUndefined();
    expect(plan.patch.financeEffects).toHaveLength(1);
  });

  it('同じ種類の効果が既にあれば、候補を作らない（確認済みの効果を上書きしない）', () => {
    const plan = planCandidateWrite({ primary: undefined, additional: [confirmedCost], candidate: { ...confirmedCost, confirmed: false } });
    expect(plan.outcome).toBe('already_has_same_kind');
    expect(plan.patch).toEqual({});
  });

  it('試算：2つの効果は、それぞれ別の行として年度に反映され、年度合計は両方を足したもの', () => {
    const dept = {
      id: 'd',
      name: '営業部',
      projects: [
        {
          id: 'p',
          title: '新規開拓',
          financeEffect: { ...revenueCandidate().effect, amountBasis: 'ANNUAL', startYm: '2026-04', confirmed: true, isIncremental: true, meetingBasisConfirmed: true },
          financeEffects: [confirmedCost],
        },
      ],
    } as unknown as Department;
    const trial = buildFinanceEffectTrial({ departments: [dept], fiscalYearEnd: '3', fiscalYears: [2027, 2028] });
    const rows = trial.projects.filter((p) => p.projectTitle === '新規開拓');
    expect(rows.map((r) => [r.effectIndex, r.status])).toEqual([
      [0, 'REFLECTED'],
      [1, 'REFLECTED'],
    ]);
    expect(trial.years.find((y) => y.fiscalYear === 2027)).toMatchObject({ revenueYen: 120 * M, costReductionYen: 12 * M });
  });

  it('試算：未確認の候補は、年度の金額に入らない', () => {
    const dept = {
      id: 'd',
      name: '営業部',
      projects: [{ id: 'p', title: '新規開拓', financeEffect: { ...revenueCandidate().effect, amountBasis: 'ANNUAL', startYm: '2026-04' } }],
    } as unknown as Department;
    const trial = buildFinanceEffectTrial({ departments: [dept], fiscalYearEnd: '3', fiscalYears: [2027] });
    expect(trial.projects[0].status).toBe('DRAFT');
    expect(trial.years[0].revenueYen).toBe(0);
  });

  it('保存の書き込み：新しく入る追加の効果は、確認済みの指定があっても未確認になる', () => {
    const st = {
      departments: [{ id: 'd', name: '営業部', projects: [{ id: 'p', title: '新規開拓', financeEffect: { ...confirmedCost } }] }],
      companyTargets: [],
      projectTargetImpacts: [],
    };
    const next = applyProjectImpactPatch(st, 0, 0, {
      financeEffects: [{ ...confirmedCost, confirmed: true }, { ...revenueCandidate().effect }],
    }) as any;
    const list = next.departments[0].projects[0].financeEffects;
    expect(list[0].confirmed).toBe(false);
    expect(list[1].confirmed).toBe(false);
  });
});
