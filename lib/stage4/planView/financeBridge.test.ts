import { findFinanceEffectOverlapCandidates } from '@/lib/financeEffect';
import { applyProjectImpactPatch } from '@/lib/okr/projectImpactPatch';
import { buildFinanceEffectTrial } from '@/utils/stage6/financeEffectPlan';
import { estimateProjectImpact, type ImpactEstimate } from './impactEstimate';
import {
  applyFinanceAnswers,
  buildFinanceEffectDrafts,
  confirmBlockers,
  fiscalYearEndYm,
  fiscalYearStartYm,
  planFinanceEffectWrite,
  type FinanceAnswers,
} from './financeBridge';

/* 架空の案件（日本製罐の数値例に合わせたテスト入力）：10社 × 30% × 20百万円 = 売上60百万円、追加費用6百万円 */
const PROJECT = {
  id: 'p-jnc-renewal',
  title: '既存顧客の保守契約更新',
  role: 'REVENUE',
  impactRevenueMJPY: 60,
  impactAssumptions: { targetCustomers: 10, conversionRatePct: 30, averageDealMJPY: 20 },
  impactRationale: '売上増加に伴う追加費用6百万円を見込む',
  okrsV2: [{ id: 'kr-1', label: '保守契約の継続率', target: 95, unit: '%' }],
};

const edits = (extra: Record<string, number> = {}) => ({
  'impact:startYear': 2027,
  'impact:endYear': 2028,
  ...extra,
});

function calculated(est: ImpactEstimate): Extract<ImpactEstimate, { status: 'CALCULATED' }> {
  if (est.status !== 'CALCULATED') throw new Error('参考試算が計算されていない');
  return est;
}

const NOW = '2026-11-10T00:00:00.000Z';

describe('会計年度の年月', () => {
  it('年度末が3月なら、FY2027は2026-04〜2027-03', () => {
    expect(fiscalYearStartYm(2027, 3)).toBe('2026-04');
    expect(fiscalYearEndYm(2027, 3)).toBe('2027-03');
  });
  it('年度末が12月なら、FY2027は2027-01〜2027-12', () => {
    expect(fiscalYearStartYm(2027, 12)).toBe('2027-01');
    expect(fiscalYearEndYm(2027, 12)).toBe('2027-12');
  });
});

describe('参考試算から財務効果の草案を作る', () => {
  it('売上は FUNNEL（商談数×受注率×平均受注額）、単位は百万円から円へ換算する', () => {
    const est = calculated(estimateProjectImpact(PROJECT, { edits: edits() }));
    const drafts = buildFinanceEffectDrafts({ estimate: est, fiscalYearEnd: '3' });
    const revenue = drafts.find((d) => d.kind === 'REVENUE_UP')!;
    expect(revenue.base).toMatchObject({
      kind: 'REVENUE_UP',
      method: 'FUNNEL',
      meetingsPerPeriod: 10,
      winRatePct: 30,
      averageDealYen: 20_000_000,
      confirmed: false,
      source: 'USER_INPUT',
      startYm: '2026-04',
      endYm: '2028-03',
    });
    expect(revenue.base.sourceNote).toContain('STAGE3');
  });

  it('追加費用は COST_INCREASE の直接金額（6百万円＝6,000,000円）になる', () => {
    const est = calculated(estimateProjectImpact(PROJECT, { edits: edits() }));
    const cost = buildFinanceEffectDrafts({ estimate: est, fiscalYearEnd: '3' }).find((d) => d.kind === 'COST_INCREASE')!;
    expect(cost.base).toMatchObject({ kind: 'COST_INCREASE', method: 'DIRECT_AMOUNT', directAmountYen: 6_000_000, confirmed: false });
  });

  it('AIの仮説の値を含む草案は AI_PROPOSED になり、確認に追加の項目が要る', () => {
    const noFacts = { ...PROJECT, impactAssumptions: undefined, impactRationale: '' };
    const est = calculated(
      estimateProjectImpact(noFacts, { edits: edits(), hypothesis: { customers: 10, rate: 30, deal: 20 } }),
    );
    const revenue = buildFinanceEffectDrafts({ estimate: est, fiscalYearEnd: '3' }).find((d) => d.kind === 'REVENUE_UP')!;
    expect(revenue.fromAi).toBe(true);
    expect(revenue.base.source).toBe('AI_PROPOSED');
    const withAnswers = applyFinanceAnswers(revenue, { amountBasis: 'ANNUAL', startYm: '2026-04' });
    expect(confirmBlockers(withAnswers, 0)).toEqual(expect.arrayContaining([
      expect.stringContaining('商談数として扱ってよいか'),
      expect.stringContaining('既存の売上に対する追加効果か'),
    ]));
  });

  it('参考試算が計算されていなければ草案は作らない', () => {
    const est = estimateProjectImpact({ ...PROJECT, impactAssumptions: undefined, impactRationale: '' }, { edits: {} });
    expect(buildFinanceEffectDrafts({ estimate: est, fiscalYearEnd: '3' })).toEqual([]);
  });
});

describe('確認項目と書き込みの判定', () => {
  const est = calculated(estimateProjectImpact(PROJECT, { edits: edits() }));
  const drafts = buildFinanceEffectDrafts({ estimate: est, fiscalYearEnd: '3' });
  const revenueDraft = drafts.find((d) => d.kind === 'REVENUE_UP')!;
  const costDraft = drafts.find((d) => d.kind === 'COST_INCREASE')!;

  it('金額の単位が未選択なら確認できない', () => {
    const e = applyFinanceAnswers(costDraft, {});
    expect(confirmBlockers(e, 0)).toEqual(['金額の単位（一回限り・月額・年額）が未確認']);
  });

  it('単位を選べば、社内の数値（STAGE3由来）の追加費用は確認できる', () => {
    const e = applyFinanceAnswers(costDraft, { amountBasis: 'ANNUAL' });
    expect(confirmBlockers(e, 0)).toEqual([]);
  });

  it('重複の可能性がある効果は、説明が無いと確認を保留する', () => {
    const e = applyFinanceAnswers(revenueDraft, { amountBasis: 'ANNUAL', isIncremental: true });
    expect(confirmBlockers(e, 1)).toEqual([expect.stringContaining('重複していない理由')]);
    const explained = applyFinanceAnswers(revenueDraft, { amountBasis: 'ANNUAL', isIncremental: true, overlapNote: '別の施策は対象の顧客が違う' });
    expect(confirmBlockers(explained, 1)).toEqual([]);
  });

  it('営業利益の増分は、利用者が入力した場合だけ設定する（利益の推定はしない）', () => {
    const e = applyFinanceAnswers(revenueDraft, { amountBasis: 'ANNUAL' });
    expect(e.operatingIncomeEffectYen).toBeUndefined();
    const withOp = applyFinanceAnswers(revenueDraft, { amountBasis: 'ANNUAL', operatingIncomeEffectYen: 3_000_000 });
    expect(withOp.operatingIncomeEffectYen).toBe(3_000_000);
  });

  it('草案の保存は、同じ種類の草案を差し替えるが、確認はしない', () => {
    const draft = applyFinanceAnswers(revenueDraft, { amountBasis: 'ANNUAL', isIncremental: true, meetingBasisConfirmed: true });
    const plan = planFinanceEffectWrite({ primary: undefined, additional: undefined, candidate: draft, action: 'SAVE_DRAFT', nowIso: NOW });
    expect(plan).toMatchObject({ ok: true, outcome: 'created' });
    const saved = (plan as any).patch.financeEffect;
    expect(saved.confirmed).toBe(false);
  });

  it('確認は、保存済みの草案と同じ内容のときだけ行い、確認日時を付ける', () => {
    const answers: FinanceAnswers = { amountBasis: 'ANNUAL', isIncremental: true, meetingBasisConfirmed: true };
    const draft = applyFinanceAnswers(revenueDraft, answers);
    const saved = { ...draft, confirmed: false };
    const plan = planFinanceEffectWrite({ primary: saved, additional: undefined, candidate: draft, action: 'CONFIRM', nowIso: NOW });
    expect(plan).toMatchObject({ ok: true, outcome: 'confirmed' });
    expect((plan as any).patch.financeEffect).toMatchObject({ confirmed: true, confirmedAt: NOW });
  });

  it('草案と内容が違うときは確認を拒否する', () => {
    const saved = { ...applyFinanceAnswers(revenueDraft, { amountBasis: 'ANNUAL', isIncremental: true, meetingBasisConfirmed: true }), confirmed: false };
    const changed = applyFinanceAnswers(revenueDraft, { amountBasis: 'MONTHLY', isIncremental: true, meetingBasisConfirmed: true });
    const plan = planFinanceEffectWrite({ primary: saved, additional: undefined, candidate: changed, action: 'CONFIRM', nowIso: NOW });
    expect(plan.ok).toBe(false);
  });

  it('確認済みの効果は、同じ内容の再確認では変えず、内容が違えば変更しない', () => {
    const answers: FinanceAnswers = { amountBasis: 'ANNUAL', isIncremental: true, meetingBasisConfirmed: true };
    const draft = applyFinanceAnswers(revenueDraft, answers);
    const confirmed = { ...draft, confirmed: true, confirmedAt: NOW };
    expect(planFinanceEffectWrite({ primary: confirmed, additional: undefined, candidate: draft, action: 'SAVE_DRAFT', nowIso: NOW }))
      .toEqual({ ok: true, outcome: 'unchanged', patch: {} });
    const changed = applyFinanceAnswers(revenueDraft, { ...answers, amountBasis: 'MONTHLY' });
    expect(planFinanceEffectWrite({ primary: confirmed, additional: undefined, candidate: changed, action: 'SAVE_DRAFT', nowIso: NOW }).ok).toBe(false);
  });

  it('売上増加と追加費用は、同じ施策でも別の効果として保持し、互いに上書きしない', () => {
    const revenueConfirmed = {
      ...applyFinanceAnswers(revenueDraft, { amountBasis: 'ANNUAL', isIncremental: true, meetingBasisConfirmed: true }),
      confirmed: true,
      confirmedAt: NOW,
    };
    const costCandidate = applyFinanceAnswers(costDraft, { amountBasis: 'ANNUAL' });
    const plan = planFinanceEffectWrite({ primary: revenueConfirmed, additional: undefined, candidate: costCandidate, action: 'SAVE_DRAFT', nowIso: NOW });
    expect(plan).toMatchObject({ ok: true, outcome: 'created_additional' });
    expect((plan as any).patch.financeEffects).toEqual([costCandidate]);
  });

  it('2つ目以降の草案を差し替えるときは、同じ位置の効果だけを変える', () => {
    const cost = applyFinanceAnswers(costDraft, { amountBasis: 'ANNUAL' });
    const revenue = applyFinanceAnswers(revenueDraft, { amountBasis: 'ANNUAL', isIncremental: true, meetingBasisConfirmed: true });
    const newRevenue = applyFinanceAnswers(revenueDraft, { amountBasis: 'MONTHLY', isIncremental: true, meetingBasisConfirmed: true });
    const plan = planFinanceEffectWrite({
      primary: cost,
      additional: [revenue],
      candidate: newRevenue,
      action: 'SAVE_DRAFT',
      nowIso: NOW,
    });
    expect(plan).toMatchObject({ ok: true, outcome: 'draft_replaced' });
    expect((plan as any).patch.financeEffects).toEqual([newRevenue]);
    expect((plan as any).patch.financeEffect).toBeUndefined();
  });
});

describe('STAGE6の計算結果（経路B）', () => {
  const baseDepartments = () => [{ id: 'd1', name: '営業部', projects: [{ ...PROJECT }] }];
  const trialOf = (departments: unknown) =>
    buildFinanceEffectTrial({ departments: departments as any, fiscalYearEnd: '3', fiscalYears: [2027, 2028] });

  function writeAndTrial(action: 'SAVE_DRAFT' | 'CONFIRM', answers: FinanceAnswers) {
    const est = calculated(estimateProjectImpact(PROJECT, { edits: edits() }));
    const drafts = buildFinanceEffectDrafts({ estimate: est, fiscalYearEnd: '3' });
    const revenue = applyFinanceAnswers(drafts.find((d) => d.kind === 'REVENUE_UP')!, answers);
    const cost = applyFinanceAnswers(drafts.find((d) => d.kind === 'COST_INCREASE')!, { amountBasis: 'ANNUAL' });
    let state: any = { departments: baseDepartments(), companyTargets: [], projectTargetImpacts: [] };
    const plan1 = planFinanceEffectWrite({ primary: undefined, additional: undefined, candidate: revenue, action: 'SAVE_DRAFT', nowIso: NOW });
    state = applyProjectImpactPatch(state, 0, 0, (plan1 as any).patch);
    if (action === 'CONFIRM') {
      const saved = state.departments[0].projects[0].financeEffect;
      const plan2 = planFinanceEffectWrite({ primary: saved, additional: undefined, candidate: revenue, action: 'CONFIRM', nowIso: NOW });
      state = applyProjectImpactPatch(state, 0, 0, (plan2 as any).patch);
    }
    const plan3 = planFinanceEffectWrite({
      primary: state.departments[0].projects[0].financeEffect,
      additional: undefined,
      candidate: cost,
      action: 'SAVE_DRAFT',
      nowIso: NOW,
    });
    state = applyProjectImpactPatch(state, 0, 0, (plan3 as any).patch);
    if (action === 'CONFIRM') {
      const savedCost = state.departments[0].projects[0].financeEffects[0];
      const plan4 = planFinanceEffectWrite({ primary: state.departments[0].projects[0].financeEffect, additional: [savedCost], candidate: cost, action: 'CONFIRM', nowIso: NOW });
      state = applyProjectImpactPatch(state, 0, 0, (plan4 as any).patch);
    }
    return { state, trial: trialOf(state.departments) };
  }

  it('確認前は、AIの草案も未確認の効果も、STAGE6の計算に入らない', () => {
    const before = trialOf(baseDepartments());
    const { trial } = writeAndTrial('SAVE_DRAFT', { amountBasis: 'ANNUAL', isIncremental: true, meetingBasisConfirmed: true });
    expect(trial.included).toEqual([]);
    expect(trial.years.map((y) => y.revenueYen)).toEqual(before.years.map((y) => y.revenueYen));
    expect(trial.years.map((y) => y.costIncreaseYen)).toEqual(before.years.map((y) => y.costIncreaseYen));
    expect(trial.projects.find((p) => p.status === 'DRAFT')).toBeTruthy();
  });

  it('確認すると、確認した売上・追加費用が、正しい年度でPL・CFの計算に入る', () => {
    const { trial } = writeAndTrial('CONFIRM', { amountBasis: 'ANNUAL', isIncremental: true, meetingBasisConfirmed: true });
    const [fy2027, fy2028] = trial.years;
    expect(fy2027.revenueYen).toBe(60_000_000);
    expect(fy2027.costIncreaseYen).toBe(6_000_000);
    expect(fy2027.operatingEffectYen).toBe(-6_000_000);
    expect(fy2028.revenueYen).toBe(60_000_000);
    expect(fy2028.costIncreaseYen).toBe(6_000_000);
  });

  it('売上増加の営業利益の増分を入力していなければ、営業利益は未算定として扱う（0扱いにしない）', () => {
    const { trial } = writeAndTrial('CONFIRM', { amountBasis: 'ANNUAL', isIncremental: true, meetingBasisConfirmed: true });
    expect(trial.years[0].revenueOperatingIncomeYen).toBeNull();
  });

  it('営業利益の増分を入力すると、売上増加の利益として計算に入る', () => {
    const { trial } = writeAndTrial('CONFIRM', {
      amountBasis: 'ANNUAL',
      isIncremental: true,
      meetingBasisConfirmed: true,
      operatingIncomeEffectYen: 3_000_000,
    });
    expect(trial.years[0].revenueOperatingIncomeYen).toBe(3_000_000);
    expect(trial.years[0].operatingEffectYen).toBe(-6_000_000);
    expect(trial.years[0].revenueOperatingIncomeYen! + trial.years[0].operatingEffectYen).toBe(-3_000_000);
  });

  it('書き込みはSTAGE3の業績（projectTargetImpacts）と既存のKPIを変えない', () => {
    const { state } = writeAndTrial('CONFIRM', { amountBasis: 'ANNUAL', isIncremental: true, meetingBasisConfirmed: true });
    expect(state.projectTargetImpacts).toEqual([]);
    expect(state.departments[0].projects[0].okrsV2).toEqual(PROJECT.okrsV2);
    expect(state.departments[0].projects[0].impactRevenueMJPY).toBe(60);
  });

  it('同じ種類・同じ算定方法で期間が重なる別の施策があると、重複の説明が無いかぎり確認を保留する', () => {
    const est = calculated(estimateProjectImpact(PROJECT, { edits: edits() }));
    const revenue = applyFinanceAnswers(buildFinanceEffectDrafts({ estimate: est, fiscalYearEnd: '3' }).find((d) => d.kind === 'REVENUE_UP')!, {
      amountBasis: 'ANNUAL',
      isIncremental: true,
      meetingBasisConfirmed: true,
    });
    const departments: any[] = [
      { id: 'd1', name: '営業部', projects: [{ ...PROJECT, financeEffect: { ...revenue, confirmed: true, confirmedAt: NOW } }] },
      { id: 'd2', name: '企画部', projects: [{ id: 'p-other', title: '別の施策', financeEffect: { ...revenue, confirmed: false } }] },
    ];
    const overlap = findFinanceEffectOverlapCandidates(departments, 0, 0);
    expect(overlap).toEqual(['企画部 / 別の施策']);
    expect(confirmBlockers(revenue, overlap.length)).toEqual([expect.stringContaining('重複していない理由')]);
    expect(confirmBlockers({ ...revenue, overlapNote: '対象の顧客が別' }, overlap.length)).toEqual([]);
  });
});
