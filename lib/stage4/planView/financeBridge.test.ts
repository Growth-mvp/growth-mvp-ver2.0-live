import { financeSaveSteps, financeWriteReason } from './financeBridge';
import { findFinanceEffectOverlapCandidates, normalizeFinanceEffect } from '@/lib/financeEffect';
import type { CompanyTarget, Department, FinanceBSRow, FinancePLRow, FinanceEffect } from '@/types/strategy';
import { buildFinanceEffectTrial } from '@/utils/stage6/financeEffectPlan';
import { buildFinanceOutlook } from '@/utils/stage6/financeOutlook';
import { estimateProjectImpact, type ImpactEstimate } from './impactEstimate';
import {
  applyFinanceAnswers,
  buildFinanceEffectDrafts,
  confirmBlockers,
  fiscalYearEndYm,
  fiscalYearStartYm,
  periodOfLabel,
  periodOutsidePlanNote,
  planFinanceEffectWrite,
  type ConfirmContext,
  type FinanceAnswers,
  type FinanceEffectDraft,
} from './financeBridge';

/* 架空の案件（日本製罐の数値例に合わせたテスト入力）：10社 × 30% × 20百万円 = 売上60百万円、追加費用6百万円 */
const PROJECT = {
  id: 'p-jnc-renewal',
  title: '既存顧客の保守契約更新',
  role: 'REVENUE',
  impactRevenueMJPY: 60,
  impactOpIncomeMJPY: 40,
  impactAssumptions: { targetCustomers: 10, conversionRatePct: 30, averageDealMJPY: 20 },
  impactRationale: '売上増加に伴う追加費用6百万円を見込む',
  okrsV2: [{ id: 'kr-1', label: '保守契約の継続率', target: 95, unit: '%' }],
};

const NOW = '2026-11-10T00:00:00.000Z';
const M = 1_000_000;

const ctx = (overlapCount = 0, extra: Partial<ConfirmContext> = {}): ConfirmContext => ({
  overlapCount,
  hasCostEffect: false,
  costConfirmed: false,
  revenueOpIncludesAddCost: false,
  ...extra,
});

function calculated(est: ImpactEstimate): Extract<ImpactEstimate, { status: 'CALCULATED' }> {
  if (est.status !== 'CALCULATED') throw new Error('参考試算が計算されていない');
  return est;
}

function draftsOf(opts: { startYear?: number; endYear?: number } = {}): FinanceEffectDraft[] {
  const edits: Record<string, number> = {};
  if (opts.startYear !== undefined) edits['impact:startYear'] = opts.startYear;
  if (opts.endYear !== undefined) edits['impact:endYear'] = opts.endYear;
  const est = calculated(estimateProjectImpact(PROJECT, { edits }));
  return buildFinanceEffectDrafts({ estimate: est, fiscalYearEnd: '3' });
}

const revenueDraft = (opts?: { startYear?: number; endYear?: number }) => draftsOf(opts).find((d) => d.kind === 'REVENUE_UP')!;
const costDraft = (opts?: { startYear?: number; endYear?: number }) => draftsOf(opts).find((d) => d.kind === 'COST_INCREASE')!;

/* 架空企業の財務（百万円）。2024年度の売上 1,000・営業利益 70、決算月3月。STAGE6の統合計算の入力 */
const PL: FinancePLRow[] = [{ year: 2024, revenue: 1_000 * M, operatingIncome: 70 * M, interest: 0 }];
const BS: FinanceBSRow[] = [{ year: 2024, cash: 100 * M, ar: 150 * M, inventory: 50 * M, ap: 80 * M }];
const TARGETS = [
  { id: 't-rev', label: '売上', unit: '百万円', base: 1_200, dueYear: 2027 },
  { id: 't-op', label: '営業利益', unit: '百万円', base: 100, dueYear: 2027 },
] as unknown as CompanyTarget[];

function departmentsWith(args: { revenue?: FinanceEffect; cost?: FinanceEffect; legacy?: boolean; extraProjects?: unknown[] } = {}) {
  const project: Record<string, unknown> = { id: PROJECT.id, title: PROJECT.title, okrsV2: PROJECT.okrsV2 };
  if (args.legacy) {
    project.impactRevenueMJPY = PROJECT.impactRevenueMJPY;
    project.impactOpIncomeMJPY = PROJECT.impactOpIncomeMJPY;
    project.impactRationale = PROJECT.impactRationale;
  }
  if (args.revenue) project.financeEffect = args.revenue;
  if (args.cost) project.financeEffects = [args.cost];
  return [{ id: 'd1', name: '営業部', projects: [project, ...(args.extraProjects ?? [])] }] as unknown as Department[];
}

const outlookOf = (departments: Department[]) =>
  buildFinanceOutlook({
    financePL: PL,
    financeBS: BS,
    departments,
    fiscalYearEnd: '3',
    companyTargets: TARGETS,
    domain: null,
    currentYear: 2025,
  });

const yearOf = (o: ReturnType<typeof outlookOf>, fy: number) => o.unifiedPl.years.find((y) => y.fiscalYear === fy)!;

/** 確認済みの効果（保存と確認の書き込みは financeBridgeStore のテストで確認する） */
const confirmed = (c: FinanceEffect): FinanceEffect => ({ ...c, confirmed: true, confirmedAt: NOW });

describe('財務効果の草案（参考試算から）', () => {
  it('売上は FUNNEL、単位は百万円から円へ換算し、年度は会計年度の月に合わせる', () => {
    const revenue = revenueDraft({ startYear: 2027, endYear: 2028 });
    expect(revenue.base).toMatchObject({
      kind: 'REVENUE_UP',
      method: 'FUNNEL',
      meetingsPerPeriod: 10,
      winRatePct: 30,
      averageDealYen: 20 * M,
      confirmed: false,
      source: 'USER_INPUT',
      startYm: '2026-04',
      endYm: '2028-03',
    });
  });

  it('追加費用は COST_INCREASE の直接金額（6百万円＝6,000,000円）', () => {
    expect(costDraft({ startYear: 2027 }).base).toMatchObject({ kind: 'COST_INCREASE', method: 'DIRECT_AMOUNT', directAmountYen: 6 * M, confirmed: false });
  });

  it('AIの仮説の値を含む草案は AI_PROPOSED になり、商談数と追加効果の確認が要る', () => {
    const est = calculated(
      estimateProjectImpact(
        { ...PROJECT, impactAssumptions: undefined, impactRationale: '' },
        { edits: { 'impact:startYear': 2027, 'impact:endYear': 2028 }, hypothesis: { customers: 10, rate: 30, deal: 20 } },
      ),
    );
    const revenue = buildFinanceEffectDrafts({ estimate: est, fiscalYearEnd: '3' }).find((d) => d.kind === 'REVENUE_UP')!;
    expect(revenue.base.source).toBe('AI_PROPOSED');
    const blockers = confirmBlockers(applyFinanceAnswers(revenue, { amountBasis: 'ANNUAL' }), ctx());
    expect(blockers).toEqual(expect.arrayContaining([
      expect.stringContaining('商談数として扱ってよいか'),
      expect.stringContaining('既存の売上に対する追加効果か'),
    ]));
  });

  it('参考試算が計算されていなければ草案は作らない', () => {
    const est = estimateProjectImpact({ ...PROJECT, impactAssumptions: undefined, impactRationale: '' }, { edits: {} });
    expect(buildFinanceEffectDrafts({ estimate: est, fiscalYearEnd: '3' })).toEqual([]);
  });

  it('会計年度の開始・終了の年月（年度末が3月と12月の場合）', () => {
    expect([fiscalYearStartYm(2027, 3), fiscalYearEndYm(2027, 3)]).toEqual(['2026-04', '2027-03']);
    expect([fiscalYearStartYm(2027, 12), fiscalYearEndYm(2027, 12)]).toEqual(['2027-01', '2027-12']);
  });
});

describe('確認の判定（営業利益増分・計上期間・重複）', () => {
  const PERIOD = { startYm: '2026-12', endYm: '2027-05' };
  const revAnswers = { amountBasis: 'ANNUAL' as const, isIncremental: true, meetingBasisConfirmed: true, revenueKind: 'PAID_DEVELOPMENT' as const, startYm: PERIOD.startYm, endYm: PERIOD.endYm };
  const costAnswers = { amountBasis: 'TOTAL' as const, startYm: PERIOD.startYm };

  it('営業利益増分を入力すると、追加費用を差し引いた後かどうかが決まるまで確認しない', () => {
    const rev = applyFinanceAnswers(revenueDraft({ startYear: 2027, endYear: 2027 }), { ...revAnswers, operatingIncomeEffectYen: 3 * M });
    expect(confirmBlockers(rev, ctx(0, { hasCostEffect: true }))).toEqual([
      expect.stringContaining('追加費用を差し引いた後の値か'),
    ]);
  });

  it('営業利益増分に追加費用が含まれると答えたら、追加費用は別に確定しない', () => {
    const rev = applyFinanceAnswers(revenueDraft({ startYear: 2027, endYear: 2027 }), {
      ...revAnswers,
      operatingIncomeEffectYen: 3 * M,
      opIncomeIncludesAddCost: true,
    });
    expect(confirmBlockers(rev, ctx(0, { hasCostEffect: true }))).toEqual([]);
    const cost = applyFinanceAnswers(costDraft(), costAnswers);
    expect(confirmBlockers(cost, ctx(0, { revenueOpIncludesAddCost: true }))).toEqual([
      expect.stringContaining('この追加費用は別に確定しません'),
    ]);
  });

  it('追加費用が確定済みなら、営業利益増分を「含む」にする確認は拒否する', () => {
    const rev = applyFinanceAnswers(revenueDraft({ startYear: 2027, endYear: 2027 }), {
      ...revAnswers,
      operatingIncomeEffectYen: 3 * M,
      opIncomeIncludesAddCost: true,
    });
    expect(confirmBlockers(rev, ctx(0, { hasCostEffect: true, costConfirmed: true }))).toEqual([
      expect.stringContaining('追加費用は確定済み'),
    ]);
  });

  it('売上の区分（有償開発か量産か）が未確認なら、売上は確認しない', () => {
    const rev = applyFinanceAnswers(revenueDraft({ startYear: 2027, endYear: 2027 }), { ...revAnswers, revenueKind: undefined });
    expect(confirmBlockers(rev, ctx())).toEqual([expect.stringContaining('売上の区分（有償開発か量産か）が未確認')]);
    const typed = applyFinanceAnswers(revenueDraft({ startYear: 2027, endYear: 2027 }), { ...revAnswers, revenueKind: 'MASS_PRODUCTION' });
    expect(typed.revenueKind).toBe('MASS_PRODUCTION');
    expect(confirmBlockers(typed, ctx())).toEqual([]);
  });

  it('追加費用の発生期間は、売上の期間から自動では設定せず、利用者が入力するまで確認しない', () => {
    const cost = costDraft({ startYear: 2027, endYear: 2027 });
    expect(cost.base.startYm).toBeUndefined();
    expect(cost.base.endYm).toBeUndefined();
    expect(confirmBlockers(applyFinanceAnswers(cost, { amountBasis: 'TOTAL' }), ctx())).toEqual([expect.stringContaining('効果の開始月')]);
  });

  it('年額・月額は終了年月が無いと確認しない（後の年度まで両年度に計上されるため）', () => {
    const noEnd = applyFinanceAnswers(revenueDraft({ startYear: 2027 }), { ...revAnswers, endYm: undefined });
    expect(noEnd.endYm).toBeUndefined();
    expect(confirmBlockers(noEnd, ctx())).toEqual([expect.stringContaining('計上の終了年月')]);
  });

  it('一回限りの効果は、終了年月が無くても確認できる', () => {
    const once = applyFinanceAnswers(costDraft(), { amountBasis: 'TOTAL', startYm: PERIOD.startYm });
    expect(confirmBlockers(once, ctx())).toEqual([]);
  });

  it('一回限りの金額に終了年月を入れると、期間に按分されるため確認しない（開始月に全額計上する）', () => {
    const once = applyFinanceAnswers(costDraft(), { amountBasis: 'TOTAL', startYm: PERIOD.startYm, endYm: PERIOD.endYm });
    expect(confirmBlockers(once, ctx())).toEqual([expect.stringContaining('開始月に全額計上')]);
  });

  it('重複の可能性がある効果は、説明が無いと確認を保留する', () => {
    const cost = applyFinanceAnswers(costDraft(), costAnswers);
    expect(confirmBlockers(cost, ctx(1))).toEqual([expect.stringContaining('重複していない理由')]);
    expect(confirmBlockers(applyFinanceAnswers(costDraft(), { ...costAnswers, overlapNote: '対象が別' }), ctx(1))).toEqual([]);
  });

  it('同じ種類・同じ算定方法で期間が重なる別の施策を、重複の候補として出す', () => {
    const rev = confirmed(applyFinanceAnswers(revenueDraft({ startYear: 2027, endYear: 2027 }), { amountBasis: 'ANNUAL', isIncremental: true, meetingBasisConfirmed: true }));
    const departments = [
      { id: 'd1', name: '営業部', projects: [{ id: 'p-a', title: PROJECT.title, financeEffect: rev }] },
      { id: 'd2', name: '企画部', projects: [{ id: 'p-b', title: '別の施策', financeEffect: { ...rev, confirmed: false } }] },
    ] as unknown as Department[];
    expect(findFinanceEffectOverlapCandidates(departments, 0, 0)).toEqual(['企画部 / 別の施策']);
  });
});

describe('草案の書き込み（同種の確定済みの効果は上書きしない）', () => {
  it('草案は作成でき、確認は内容が同じ草案にだけ行える', () => {
    const cand = applyFinanceAnswers(revenueDraft({ startYear: 2027, endYear: 2027 }), { amountBasis: 'ANNUAL', isIncremental: true, meetingBasisConfirmed: true });
    const created = planFinanceEffectWrite({ primary: undefined, additional: undefined, candidate: cand, action: 'SAVE_DRAFT', nowIso: NOW });
    expect(created).toMatchObject({ ok: true, outcome: 'created' });
    const saved = (created as any).patch.financeEffect as FinanceEffect;
    expect(saved.confirmed).toBe(false);
    const changed = applyFinanceAnswers(revenueDraft({ startYear: 2027, endYear: 2027 }), { amountBasis: 'MONTHLY', isIncremental: true, meetingBasisConfirmed: true });
    expect(planFinanceEffectWrite({ primary: saved, additional: undefined, candidate: changed, action: 'CONFIRM', nowIso: NOW }).ok).toBe(false);
    const confirmedPlan = planFinanceEffectWrite({ primary: saved, additional: undefined, candidate: cand, action: 'CONFIRM', nowIso: NOW });
    expect(confirmedPlan).toMatchObject({ ok: true, outcome: 'confirmed' });
  });

  it('確定済みの効果は、同じ内容の再確認では変えず、内容が違えば変更しない', () => {
    const cand = applyFinanceAnswers(revenueDraft({ startYear: 2027, endYear: 2027 }), { amountBasis: 'ANNUAL', isIncremental: true, meetingBasisConfirmed: true });
    const done = confirmed(cand);
    expect(planFinanceEffectWrite({ primary: done, additional: undefined, candidate: cand, action: 'SAVE_DRAFT', nowIso: NOW }))
      .toEqual({ ok: true, outcome: 'unchanged', patch: {} });
    const changed = applyFinanceAnswers(revenueDraft({ startYear: 2027, endYear: 2027 }), { amountBasis: 'MONTHLY', isIncremental: true, meetingBasisConfirmed: true });
    expect(planFinanceEffectWrite({ primary: done, additional: undefined, candidate: changed, action: 'SAVE_DRAFT', nowIso: NOW }).ok).toBe(false);
  });

  it('売上増加と追加費用は同じ施策でも別の効果として併存する', () => {
    const rev = confirmed(applyFinanceAnswers(revenueDraft({ startYear: 2027, endYear: 2027 }), { amountBasis: 'ANNUAL', isIncremental: true, meetingBasisConfirmed: true }));
    const cost = applyFinanceAnswers(costDraft({ startYear: 2027, endYear: 2027 }), { amountBasis: 'ANNUAL' });
    const plan = planFinanceEffectWrite({ primary: rev, additional: undefined, candidate: cost, action: 'SAVE_DRAFT', nowIso: NOW });
    expect(plan).toMatchObject({ ok: true, outcome: 'created_additional' });
    expect((plan as any).patch.financeEffects).toEqual([cost]);
  });
});

describe('STAGE6の統合計算（経路B）と二重計上', () => {
  const revenueConfirmed = (over: Partial<FinanceAnswers> = {}) =>
    confirmed(
      applyFinanceAnswers(revenueDraft({ startYear: 2026, endYear: 2026 }), {
        amountBasis: 'ANNUAL',
        isIncremental: true,
        meetingBasisConfirmed: true,
        ...over,
      }),
    );
  const costConfirmed = () =>
    confirmed(applyFinanceAnswers(costDraft(), { amountBasis: 'ANNUAL', startYm: '2025-04', endYm: '2026-03' }));

  const base = outlookOf(departmentsWith());
  const baseOp = (fy: number) => yearOf(base, fy).plan.operatingIncomeYen!;

  it('売上の確認（FY2026のみ）は、FY2026の売上だけに60百万円を計上し、FY2027には計上しない', () => {
    const o = outlookOf(departmentsWith({ revenue: revenueConfirmed() }));
    expect(yearOf(o, 2026).effect.revenueUpYen).toBe(60 * M);
    expect(yearOf(o, 2027).effect.revenueUpYen).toBe(0);
  });

  it('営業利益増分を「含まない」と答えると、営業利益は増分3百万円から追加費用6百万円を差し引いた▲3百万円になる', () => {
    const o = outlookOf(departmentsWith({
      revenue: revenueConfirmed({ operatingIncomeEffectYen: 3 * M, opIncomeIncludesAddCost: false }),
      cost: costConfirmed(),
    }));
    expect(yearOf(o, 2026).plan.operatingIncomeYen! - baseOp(2026)).toBe(-3 * M);
    expect(yearOf(o, 2027).plan.operatingIncomeYen! - baseOp(2027)).toBe(0);
  });

  it('営業利益増分を「含む」と答えると、営業利益の増分は3百万円だけになり、追加費用は別に差し引かない（二重控除しない）', () => {
    const o = outlookOf(departmentsWith({
      revenue: revenueConfirmed({ operatingIncomeEffectYen: 3 * M, opIncomeIncludesAddCost: true }),
    }));
    expect(yearOf(o, 2026).plan.operatingIncomeYen! - baseOp(2026)).toBe(3 * M);
    expect(yearOf(o, 2026).effect.costIncreaseYen).toBe(0);
  });

  it('営業利益増分が未回答なら、売上増加の営業利益は未算定（0扱いにしない）', () => {
    const o = outlookOf(departmentsWith({ revenue: revenueConfirmed() }));
    expect(yearOf(o, 2026).plan.operatingIncomeYen).toBeNull();
    expect(yearOf(o, 2026).unknownReasons.join('')).toContain('未算定');
  });

  it('経路A（旧フィールドの売上60・営業利益40）が残っていても、統合計算の結果は変わらない（二重計上しない）', () => {
    const revenue = revenueConfirmed({ operatingIncomeEffectYen: 3 * M, opIncomeIncludesAddCost: false });
    const cost = costConfirmed();
    const withLegacy = outlookOf(departmentsWith({ revenue, cost, legacy: true }));
    const withoutLegacy = outlookOf(departmentsWith({ revenue, cost, legacy: false }));
    expect(withLegacy.unifiedPl).toEqual(withoutLegacy.unifiedPl);
    expect(withLegacy.effectTrial.years).toEqual(withoutLegacy.effectTrial.years);
    expect(yearOf(withLegacy, 2026).effect.revenueUpYen).toBe(60 * M);
  });

  it('確認前（草案）のAI仮説は、統合計算に一切入らない', () => {
    const draft = applyFinanceAnswers(revenueDraft({ startYear: 2026, endYear: 2026 }), { amountBasis: 'ANNUAL', operatingIncomeEffectYen: 3 * M });
    const o = outlookOf(departmentsWith({ revenue: { ...draft, confirmed: false } }));
    expect(o.unifiedPl).toEqual(base.unifiedPl);
  });

  it('確定済みの効果は、保存データを読み直した後も同じ計算結果になる（再読み込み）', () => {
    const saved = revenueConfirmed({ operatingIncomeEffectYen: 3 * M, opIncomeIncludesAddCost: false });
    const reloaded = normalizeFinanceEffect(JSON.parse(JSON.stringify(saved)))!;
    expect(reloaded).toMatchObject({ opIncomeIncludesAddCost: false, operatingIncomeEffectYen: 3 * M, endYm: '2026-03', confirmed: true });
    expect(outlookOf(departmentsWith({ revenue: reloaded })).unifiedPl).toEqual(outlookOf(departmentsWith({ revenue: saved })).unifiedPl);
  });

  it('実行計画の期間（2026年12月〜2027年5月）に合わせた年額の売上は、FY2027に4か月分（20）、FY2028に2か月分（10）を配分する', () => {
    const revenue = confirmed(
      applyFinanceAnswers(revenueDraft({ startYear: 2027, endYear: 2028 }), {
        amountBasis: 'ANNUAL',
        isIncremental: true,
        meetingBasisConfirmed: true,
        revenueKind: 'PAID_DEVELOPMENT',
        startYm: '2026-12',
        endYm: '2027-05',
      }),
    );
    const trial = buildFinanceEffectTrial({ departments: departmentsWith({ revenue }), fiscalYearEnd: '3', fiscalYears: [2027, 2028] });
    expect(trial.years.find((y) => y.fiscalYear === 2027)!.revenueYen).toBe(20 * M);
    expect(trial.years.find((y) => y.fiscalYear === 2028)!.revenueYen).toBe(10 * M);
  });

  it('STAGE3の営業利益増分9百万円（粗利15−追加費用6）を「含む」と答えると、追加費用は二重に控除せず、営業利益は9百万円の年額どおりに配分される', () => {
    const revenue = confirmed(
      applyFinanceAnswers(revenueDraft({ startYear: 2027, endYear: 2028 }), {
        amountBasis: 'ANNUAL',
        isIncremental: true,
        meetingBasisConfirmed: true,
        revenueKind: 'PAID_DEVELOPMENT',
        startYm: '2026-12',
        endYm: '2027-05',
        operatingIncomeEffectYen: 9 * M,
        opIncomeIncludesAddCost: true,
      }),
    );
    const o = outlookOf(departmentsWith({ revenue }));
    const base27 = yearOf(base, 2027).plan.operatingIncomeYen!;
    expect(yearOf(o, 2027).plan.operatingIncomeYen! - base27).toBe(3 * M);
    expect(yearOf(o, 2027).effect.costIncreaseYen).toBe(0);
  });
});

describe('実行計画の期間との整合', () => {
  it('計画書の期間の表示を、年月の範囲にする', () => {
    expect(periodOfLabel('2026-12 〜 2027-05')).toEqual({ startYm: '2026-12', endYm: '2027-05' });
    expect(periodOfLabel('未設定')).toBeNull();
    expect(periodOfLabel(undefined)).toBeNull();
  });

  it('計上期間が実行計画の期間の外にあると注意を出す（自動では変えない）', () => {
    const plan = { startYm: '2026-12', endYm: '2027-05' };
    const early = { ...revenueDraft({ startYear: 2027, endYear: 2027 }).base, startYm: '2026-04', endYm: '2027-03' } as FinanceEffect;
    expect(periodOutsidePlanNote(early, plan)).toContain('実行計画の期間');
    const inside = { ...early, startYm: '2026-12', endYm: '2027-05' } as FinanceEffect;
    expect(periodOutsidePlanNote(inside, plan)).toBeNull();
    expect(periodOutsidePlanNote(inside, null)).toBeNull();
  });
});

describe('財務効果を画面から書けない理由（計画の保存と一緒に書くので、本文や識別子では止めない）', () => {
  const ok = { scopeMatches: true, planLoaded: true };

  it('採用済み・開始済み・未保存の本文・識別子が無い場合でも、財務効果は書ける', () => {
    expect(financeWriteReason(ok)).toBeUndefined();
  });

  it('会社や戦略が切り替わった・計画書が未読込のときは、理由を返す', () => {
    expect(financeWriteReason({ ...ok, scopeMatches: false })).toContain('切り替わった');
    expect(financeWriteReason({ ...ok, planLoaded: false })).toBe('計画書を読み込んでいます。');
  });
});

describe('計画の保存で書く財務効果（financeSaveSteps）', () => {
  const userDraft = () => {
    const d = revenueDraft();
    return { ...d, fromAi: false, base: { ...d.base, source: 'USER_INPUT' as const } };
  };
  const complete = { amountBasis: 'MONTHLY' as const, startYm: '2027-04', endYm: '2028-03', revenueKind: 'PAID_DEVELOPMENT' as const };

  it('入力の無い効果は触らない', () => {
    expect(financeSaveSteps({ drafts: [userDraft()], answers: {}, saved: [], overlapCount: 0 })).toEqual([]);
  });

  it('必須項目が足りない効果は、未確認の草案として保存し、確認はしない', () => {
    const steps = financeSaveSteps({ drafts: [userDraft()], answers: { REVENUE_UP: { startYm: '2027-04' } }, saved: [], overlapCount: 0 });
    expect(steps.map((s) => s.action)).toEqual(['SAVE_DRAFT']);
  });

  it('必須項目がそろった効果は、草案の保存のあとに確認まで行う', () => {
    const steps = financeSaveSteps({ drafts: [userDraft()], answers: { REVENUE_UP: complete }, saved: [], overlapCount: 0 });
    expect(steps.map((s) => s.action)).toEqual(['SAVE_DRAFT', 'CONFIRM']);
    expect(steps[1].candidate.amountBasis).toBe('MONTHLY');
  });

  it('AI提案の売上は、対象顧客数と追加効果の確認項目が自動では済まないため、確認しない', () => {
    const d = revenueDraft();
    const aiDraft = { ...d, fromAi: true, base: { ...d.base, source: 'AI_PROPOSED' as const } };
    const steps = financeSaveSteps({ drafts: [aiDraft], answers: { REVENUE_UP: complete }, saved: [], overlapCount: 0 });
    expect(steps.map((s) => s.action)).toEqual(['SAVE_DRAFT']);
  });

  it('確認済みの効果は、入力があっても書き直さない', () => {
    const d = userDraft();
    const saved = [{ ...d.base, confirmed: true }];
    expect(financeSaveSteps({ drafts: [d], answers: { REVENUE_UP: complete }, saved, overlapCount: 0 })).toEqual([]);
  });
});
