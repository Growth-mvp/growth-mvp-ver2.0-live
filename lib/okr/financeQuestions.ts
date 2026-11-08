import type { FinanceEffect, FinanceEffectQuestionAnswers, SpendAmountBasis, Ym } from '@/types/strategy';
import { buildFinanceEffectCandidate, type AssumptionOrigin } from './financeEffectCandidate';
import type { ImpactAssumptions } from './impactAssumptions';
import type { ImpactRoleKey } from './impactAssumptions';

export type FinanceQuestionId = 'validity' | 'meaning' | 'timing' | 'operatingIncome';

const MILLION = 1_000_000;

/** 回答の記録。未設定の項目は既存フィールドから推定する（既存の候補データを壊さないため） */
export function effectiveAnswers(effect: FinanceEffect): FinanceEffectQuestionAnswers {
  const stored = effect.questionAnswers ?? {};
  return {
    validity: stored.validity ?? (effect.meetingBasisConfirmed === true ? 'OK' : undefined),
    meaning: stored.meaning ?? (effect.isIncremental === true ? 'YES' : undefined),
    timing: stored.timing ?? (effect.amountBasis !== undefined && effect.startYm !== undefined ? 'SET' : undefined),
    operatingIncome:
      stored.operatingIncome ?? (typeof effect.operatingIncomeEffectYen === 'number' ? 'SET' : undefined),
  };
}

/** 売上は4問（利益は任意の4問目）、費用削減は数字の妥当性と発生時期の2問 */
export function questionPlan(role: ImpactRoleKey | undefined): FinanceQuestionId[] {
  if (role === 'REVENUE') return ['validity', 'meaning', 'timing', 'operatingIncome'];
  if (role === 'COST') return ['validity', 'timing'];
  return [];
}

/** 次に聞く1問。確認済みの効果や、既に回答済みの項目は聞かない */
export function nextFinanceQuestion(role: ImpactRoleKey | undefined, effect: FinanceEffect | undefined): FinanceQuestionId | null {
  if (!effect || effect.confirmed || effect.kind === 'NOT_FINANCIAL') return null;
  const answers = effectiveAnswers(effect);
  const plan = questionPlan(role);
  if (plan.length === 0) return null;
  if (answers.meaning === 'NO') return null;
  for (const id of plan) {
    const answered = answers[id] !== undefined;
    if (!answered) return id;
  }
  return null;
}

/** 確認ボタンを有効にできる条件（必須の回答がそろい、売上なら既存売上への追加と確認されている） */
export function readyToConfirm(role: ImpactRoleKey | undefined, effect: FinanceEffect | undefined): boolean {
  if (!effect || effect.kind === 'NOT_FINANCIAL') return false;
  const answers = effectiveAnswers(effect);
  if (answers.validity !== 'OK' && answers.validity !== 'EDITED') return false;
  if (answers.timing !== 'SET') return false;
  if (role === 'REVENUE' && answers.meaning !== 'YES') return false;
  return true;
}

export function answerValidity(effect: FinanceEffect, value: 'OK' | 'EDITED' | 'UNKNOWN'): FinanceEffect {
  return {
    ...effect,
    meetingBasisConfirmed: value !== 'UNKNOWN',
    questionAnswers: { ...effect.questionAnswers, validity: value },
  };
}

export function answerMeaning(effect: FinanceEffect, value: 'YES' | 'NO' | 'UNKNOWN'): FinanceEffect {
  return {
    ...effect,
    isIncremental: value === 'YES',
    questionAnswers: { ...effect.questionAnswers, meaning: value },
  };
}

export function answerTiming(
  effect: FinanceEffect,
  value: { startYm: Ym; amountBasis: SpendAmountBasis } | 'UNKNOWN',
): FinanceEffect {
  const next: FinanceEffect = { ...effect, questionAnswers: { ...effect.questionAnswers, timing: value === 'UNKNOWN' ? 'UNKNOWN' : 'SET' } };
  if (value === 'UNKNOWN') {
    delete next.startYm;
    delete next.amountBasis;
  } else {
    next.startYm = value.startYm;
    next.amountBasis = value.amountBasis;
  }
  return next;
}

export function answerOperatingIncome(effect: FinanceEffect, value: number | 'UNKNOWN'): FinanceEffect {
  const next: FinanceEffect = { ...effect, questionAnswers: { ...effect.questionAnswers, operatingIncome: value === 'UNKNOWN' ? 'UNKNOWN' : 'SET' } };
  if (value === 'UNKNOWN') delete next.operatingIncomeEffectYen;
  else next.operatingIncomeEffectYen = Math.round(value * MILLION);
  return next;
}

/** 回答を取り消し、その回答に対応する入力も空に戻す（次の質問として聞き直せるようにする） */
export function resetAnswer(effect: FinanceEffect, id: FinanceQuestionId): FinanceEffect {
  const questionAnswers = { ...effect.questionAnswers };
  delete questionAnswers[id];
  const next: FinanceEffect = { ...effect, questionAnswers };
  if (id === 'validity') delete next.meetingBasisConfirmed;
  if (id === 'meaning') delete next.isIncremental;
  if (id === 'timing') {
    delete next.startYm;
    delete next.amountBasis;
  }
  if (id === 'operatingIncome') delete next.operatingIncomeEffectYen;
  return next;
}

const CALC_KEYS = ['meetingsPerPeriod', 'winRatePct', 'averageDealYen', 'directAmountYen'] as const;

/**
 * 算定前提を修正したとき、未確認の候補の計算値を新しい前提に合わせる。
 * 利用者が入力した時期・利益・根拠文は残す。確認済みの効果は変えない。
 * 数値が変わったので、対象顧客数の妥当性の回答は取り消す。
 */
export function syncEffectWithAssumptions(args: {
  effect: FinanceEffect | undefined;
  role: ImpactRoleKey | undefined;
  prevAssumptions: ImpactAssumptions | undefined;
  nextAssumptions: ImpactAssumptions;
  rationale: string | undefined;
  prevOrigin: AssumptionOrigin | undefined;
  nextOrigin: AssumptionOrigin | undefined;
}): FinanceEffect | undefined {
  const { effect } = args;
  if (!effect || effect.confirmed || effect.kind === 'NOT_FINANCIAL') return undefined;
  if (!args.role || args.role === 'FUTURE') return undefined;
  const numbersChanged = JSON.stringify(args.prevAssumptions ?? {}) !== JSON.stringify(args.nextAssumptions);
  if (!numbersChanged) return undefined;

  const next = buildFinanceEffectCandidate({
    role: args.role,
    assumptions: args.nextAssumptions,
    rationale: args.rationale,
    origin: args.nextOrigin,
  });
  if (!next.ok) return undefined;

  const prev = buildFinanceEffectCandidate({
    role: args.role,
    assumptions: args.prevAssumptions,
    rationale: args.rationale,
    origin: args.prevOrigin,
  });

  const out: FinanceEffect = {
    ...effect,
    kind: next.effect.kind,
    method: next.effect.method,
    source: next.effect.source,
    meetingBasisConfirmed: false,
    questionAnswers: { ...effect.questionAnswers },
  };
  delete out.questionAnswers!.validity;
  for (const key of CALC_KEYS) {
    if (next.effect[key] !== undefined) out[key] = next.effect[key] as never;
    else delete out[key];
  }
  if (prev.ok && effect.sourceNote === prev.effect.sourceNote) out.sourceNote = next.effect.sourceNote;
  return out;
}
