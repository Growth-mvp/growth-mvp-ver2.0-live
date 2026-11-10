import { isFinanceEffectMaterialChange } from '@/lib/financeEffect';
import { blockingChecksDone, candidateChecks, planCandidateWrite } from '@/lib/okr/financeEffectCandidate';
import { parseFiscalYearEndMonth } from '@/utils/stage6/investmentDemand';
import type { FinanceEffect, SpendAmountBasis } from '@/types/strategy';
import { SOURCE_LABEL, type ImpactEstimate, type ParamKey, type ParamView } from './impactEstimate';

const MILLION = 1_000_000;
const pad2 = (n: number): string => String(n).padStart(2, '0');

export type FinanceDraftKind = 'REVENUE_UP' | 'COST_INCREASE';

export type FinanceEffectDraft = {
  kind: FinanceDraftKind;
  label: string;
  fromAi: boolean;
  base: FinanceEffect;
};

export type FinanceAnswers = {
  amountBasis?: SpendAmountBasis;
  startYm?: string;
  endYm?: string;
  meetingBasisConfirmed?: boolean;
  isIncremental?: boolean;
  operatingIncomeEffectYen?: number;
  overlapNote?: string;
};

export type FinanceWriteAction = 'SAVE_DRAFT' | 'CONFIRM';

export type FinanceWritePlan =
  | {
      ok: true;
      outcome: 'created' | 'created_additional' | 'draft_replaced' | 'confirmed' | 'unchanged';
      patch: { financeEffect?: FinanceEffect; financeEffects?: FinanceEffect[] };
    }
  | { ok: false; reason: string };

/** 会計年度の開始月（年度末の月の翌月）。年度末が12月なら1月始まり */
export function fiscalYearStartYm(fiscalYear: number, endMonth: number): string {
  return endMonth === 12 ? `${fiscalYear}-01` : `${fiscalYear - 1}-${pad2(endMonth + 1)}`;
}

export function fiscalYearEndYm(fiscalYear: number, endMonth: number): string {
  return `${fiscalYear}-${pad2(endMonth)}`;
}

function valueOf(params: ParamView[], key: ParamKey): ParamView {
  return params.find((p) => p.key === key) ?? { key, label: key, unit: '', value: null, source: 'MISSING' };
}

/** 参考試算（第5章）から、財務効果の未確認の草案を作る。AIの仮説の値を含むときは fromAi にする */
export function buildFinanceEffectDrafts(args: { estimate: ImpactEstimate; fiscalYearEnd: string | undefined }): FinanceEffectDraft[] {
  if (args.estimate.status !== 'CALCULATED') return [];
  const params = args.estimate.params;
  const customers = valueOf(params, 'customers');
  const rate = valueOf(params, 'rate');
  const deal = valueOf(params, 'deal');
  const margin = valueOf(params, 'grossMarginPct');
  const addCost = valueOf(params, 'addCostMJPY');
  const startYear = valueOf(params, 'startYear');
  const endYear = valueOf(params, 'endYear');

  const endMonth = parseFiscalYearEndMonth(args.fiscalYearEnd);
  const startYm = endMonth !== null && startYear.value !== null ? fiscalYearStartYm(startYear.value, endMonth) : undefined;
  const endYm = endMonth !== null && endYear.value !== null ? fiscalYearEndYm(endYear.value, endMonth) : undefined;

  const drafts: FinanceEffectDraft[] = [];
  const fromAiOf = (ps: ParamView[]): boolean => ps.some((p) => p.value !== null && p.source === 'AI_HYPOTHESIS');
  const sourceNoteOf = (ps: ParamView[]): string =>
    `第5章の参考試算。` + ps.map((p) => `${p.label}：${SOURCE_LABEL[p.source]}`).join('、');

  if (customers.value !== null && rate.value !== null && deal.value !== null) {
    const ps = [customers, rate, deal];
    const base: FinanceEffect = {
      kind: 'REVENUE_UP',
      method: 'FUNNEL',
      meetingsPerPeriod: customers.value,
      winRatePct: rate.value,
      averageDealYen: Math.round(deal.value * MILLION),
      source: fromAiOf(ps) ? 'AI_PROPOSED' : 'USER_INPUT',
      confirmed: false,
      sourceNote: sourceNoteOf(ps),
    };
    if (margin.value !== null && margin.value >= 0 && margin.value <= 100) base.costRatePct = 100 - margin.value;
    if (startYm) base.startYm = startYm;
    if (endYm) base.endYm = endYm;
    drafts.push({ kind: 'REVENUE_UP', label: '売上増加（参考試算の売上）', fromAi: fromAiOf(ps), base });
  }

  if (addCost.value !== null) {
    const base: FinanceEffect = {
      kind: 'COST_INCREASE',
      method: 'DIRECT_AMOUNT',
      directAmountYen: Math.round(addCost.value * MILLION),
      source: fromAiOf([addCost]) ? 'AI_PROPOSED' : 'USER_INPUT',
      confirmed: false,
      sourceNote: sourceNoteOf([addCost]),
    };
    if (startYm) base.startYm = startYm;
    if (endYm) base.endYm = endYm;
    drafts.push({ kind: 'COST_INCREASE', label: '追加費用', fromAi: fromAiOf([addCost]), base });
  }

  return drafts;
}

/** 利用者の回答を草案に反映する。確認状態はここでは立てない（保存時のガードと確認操作で決める） */
export function applyFinanceAnswers(draft: FinanceEffectDraft, answers: FinanceAnswers): FinanceEffect {
  const e: FinanceEffect = { ...draft.base, confirmed: false };
  delete e.confirmedAt;
  if (answers.amountBasis) e.amountBasis = answers.amountBasis;
  e.startYm = answers.startYm || draft.base.startYm;
  if (e.startYm === undefined) delete e.startYm;
  e.endYm = answers.endYm || draft.base.endYm;
  if (e.endYm === undefined) delete e.endYm;
  if (draft.kind === 'REVENUE_UP') {
    if (answers.meetingBasisConfirmed !== undefined) e.meetingBasisConfirmed = answers.meetingBasisConfirmed;
    if (answers.isIncremental !== undefined) e.isIncremental = answers.isIncremental;
    if (typeof answers.operatingIncomeEffectYen === 'number' && Number.isFinite(answers.operatingIncomeEffectYen)) {
      e.operatingIncomeEffectYen = answers.operatingIncomeEffectYen;
    }
  }
  if (answers.overlapNote?.trim()) e.overlapNote = answers.overlapNote.trim();
  return e;
}

/** 確認できない理由（空なら確認できる）。重複の可能性がある効果は、利用者の説明がないと保留する */
export function confirmBlockers(effect: FinanceEffect, overlapCount: number): string[] {
  const reasons = candidateChecks(effect)
    .filter((c) => c.blocking && !c.done)
    .map((c) => `${c.label}が未確認`);
  if (overlapCount > 0 && !effect.overlapNote?.trim()) {
    reasons.push('同じ効果の可能性がある他の施策について、重複していない理由を入力する（重複が判定できないため保留）');
  }
  return reasons;
}

const sameKind = (e: FinanceEffect | undefined, kind: FinanceEffect['kind']): boolean => !!e && e.kind === kind;

/**
 * 候補を施策の財務効果へ書き込む計画を作る。
 * 確定済みの効果は、同じ内容の確認を除き変更しない。草案は差し替えられるが、確定はしない。
 * 確認は、保存済みの草案と同じ内容のときだけ行う（内容が変われば草案からやり直す）。
 */
export function planFinanceEffectWrite(args: {
  primary: FinanceEffect | undefined;
  additional: FinanceEffect[] | undefined;
  candidate: FinanceEffect;
  action: FinanceWriteAction;
  nowIso: string;
}): FinanceWritePlan {
  const additional = Array.isArray(args.additional) ? args.additional : [];
  const list: (FinanceEffect | undefined)[] = [args.primary, ...additional];
  const idx = list.findIndex((e) => sameKind(e, args.candidate.kind));

  if (idx === -1) {
    if (args.action === 'CONFIRM') return { ok: false, reason: '先に草案として保存してください' };
    const plan = planCandidateWrite({ primary: args.primary, additional, candidate: args.candidate });
    if (plan.outcome === 'already_has_same_kind') return { ok: false, reason: '同じ種類の財務効果が既にあります' };
    return { ok: true, outcome: plan.outcome, patch: plan.patch };
  }

  const existing = list[idx]!;
  const same = !isFinanceEffectMaterialChange(existing, args.candidate);

  if (existing.confirmed) {
    if (!same) return { ok: false, reason: '確認済みの財務効果と内容が違うため、ここでは変更しません' };
    return { ok: true, outcome: 'unchanged', patch: {} };
  }

  let next: FinanceEffect;
  let outcome: 'draft_replaced' | 'confirmed';
  if (args.action === 'SAVE_DRAFT') {
    next = { ...args.candidate, confirmed: false };
    delete next.confirmedAt;
    outcome = 'draft_replaced';
  } else {
    if (!same) return { ok: false, reason: '保存済みの草案と内容が違います。先に草案として保存し直してください' };
    next = { ...args.candidate, confirmed: true, confirmedAt: args.nowIso };
    outcome = 'confirmed';
  }

  if (idx === 0) return { ok: true, outcome, patch: { financeEffect: next } };
  return {
    ok: true,
    outcome,
    patch: { financeEffects: additional.map((e, i) => (i === idx - 1 ? next : e)) },
  };
}
