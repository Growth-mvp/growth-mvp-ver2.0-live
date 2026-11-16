import { computeFinanceEffect, isFinanceEffectMaterialChange } from '@/lib/financeEffect';
import { blockingChecksDone, candidateChecks, planCandidateWrite } from '@/lib/okr/financeEffectCandidate';
import { parseFiscalYearEndMonth } from '@/utils/stage6/investmentDemand';
import { formatYenScaled } from '@/utils/yenScale';
import type { FinanceEffect, SpendAmountBasis } from '@/types/strategy';
import { SOURCE_LABEL, type ImpactEstimate, type ParamKey, type ParamView } from './impactEstimate';

const MILLION = 1_000_000;
const pad2 = (n: number): string => String(n).padStart(2, '0');

export type FinanceDraftKind = 'REVENUE_UP' | 'COST_REDUCTION' | 'COST_INCREASE';

export type FinanceEffectDraft = {
  kind: FinanceDraftKind;
  label: string;
  fromAi: boolean;
  base: FinanceEffect;
  /** 参考試算がなく、利用者が一から入力する空の草案 */
  blank?: boolean;
};

const BLANK_DRAFT_LABEL: Record<FinanceDraftKind, string> = {
  REVENUE_UP: '売上増加',
  COST_REDUCTION: '削減効果（年間削減額）',
  COST_INCREASE: '追加費用',
};

/* 参考試算の草案がない種類には、空の草案を補う。入力欄は常に出し、AI草案は未入力時の初期提案に限る */
export function withBlankFinanceDrafts(drafts: FinanceEffectDraft[]): FinanceEffectDraft[] {
  const out = [...drafts];
  for (const kind of ['REVENUE_UP', 'COST_REDUCTION', 'COST_INCREASE'] as const) {
    if (out.some((d) => d.kind === kind)) continue;
    out.push({
      kind,
      label: BLANK_DRAFT_LABEL[kind],
      fromAi: false,
      blank: true,
      base: { kind, method: 'DIRECT_AMOUNT', source: 'USER_INPUT', confirmed: false, sourceNote: '利用者が入力' },
    });
  }
  return out;
}

/* 財務効果の状態の要約（閉じているときも見える）。確認済みの売上増加額・営業利益貢献額を、算定できたものだけ示す */
export function financeStatusSummary(saved: FinanceEffect[]): string {
  if (saved.length === 0) return '未設定';
  if (saved.some((e) => e.confirmed !== true)) return '未確認';
  const parts: string[] = [];
  for (const e of saved) {
    const r = computeFinanceEffect(e);
    if (e.kind === 'REVENUE_UP' && r.annualRevenueYen !== undefined) parts.push(`売上増加 ${formatYenScaled(r.annualRevenueYen)}`);
    if (r.annualOperatingEffectYen !== undefined) parts.push(`営業利益貢献 ${formatYenScaled(r.annualOperatingEffectYen)}`);
  }
  return parts.length > 0 ? `確認済み（${parts.join('、')}／年額）` : '確認済み';
}

export type FinanceAnswers = {
  amountBasis?: SpendAmountBasis;
  startYm?: string;
  endYm?: string;
  meetingBasisConfirmed?: boolean;
  isIncremental?: boolean;
  operatingIncomeEffectYen?: number;
  opIncomeIncludesAddCost?: boolean;
  revenueKind?: 'PAID_DEVELOPMENT' | 'MASS_PRODUCTION' | 'SERVICE';
  reductionConfirmed?: boolean;
  /** 費用削減の計算根拠（円・%）。年間削減額 = 削減対象の年間費用 × 想定削減率 */
  reductionBaseYen?: number;
  reductionRatePct?: number;
  /** 売上増加（商談型）の計算根拠：商談数・受注率（%）・平均受注額（円） */
  meetingsPerPeriod?: number;
  winRatePct?: number;
  averageDealYen?: number;
  /** 計算方式（売上増加）と、コスト削減の計算方式（費用×削減率 / 直接入力） */
  method?: FinanceEffect['method'];
  costInputMode?: 'RATE' | 'DIRECT';
  /** 直接入力の金額（円。売上増加・コスト削減） */
  directAmountYen?: number;
  /** 売上増加の粗利益（原価率＝100−粗利率）と追加販売管理費等（円） */
  costRatePct?: number;
  sgaCostYen?: number;
  /** 追加販売管理費等が、同じ案件の追加費用と同じ費用か（未回答は undefined） */
  sgaSameAsAddCost?: boolean;
  /** サービス提供型：顧客数・1社当たり月間件数・1件当たり単価（円） */
  serviceCustomers?: number;
  servicePerCustomerCount?: number;
  unitPriceYen?: number;
  overlapNote?: string;
};

/** 確認の判定に使う、同じ案件の他の効果の状態 */
export type ConfirmContext = {
  overlapCount: number;
  hasCostEffect: boolean;
  costConfirmed: boolean;
  revenueOpIncludesAddCost: boolean;
  /** 同じ案件の売上増加が、営業利益増分を持つか（コスト削減との二重計上の確認に使う） */
  revenueHasOperatingEffect?: boolean;
  /** 同じ案件の追加費用の年額（円）。金額が決まらないときは undefined */
  addCostAnnualYen?: number;
};

/* REVISE：確認済みの効果を修正内容で未確認に置き換える（修正の保存）。UNCONFIRM：確認を解除する。 */
export type FinanceWriteAction = 'SAVE_DRAFT' | 'CONFIRM' | 'REVISE' | 'UNCONFIRM';

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
  const calculated = args.estimate.status === 'CALCULATED';
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

  const serviceOn = valueOf(params, 'serviceRevenue').value === 1;
  const perCustomer = valueOf(params, 'serviceCountPerCustomerMonthly');
  const unitPrice = valueOf(params, 'serviceUnitPriceYen');
  const costRatePct = margin.value !== null && margin.value >= 0 && margin.value <= 100 ? 100 - margin.value : undefined;

  if (calculated && serviceOn && customers.value !== null && perCustomer.value !== null && unitPrice.value !== null) {
    const ps = [customers, perCustomer, unitPrice];
    const yenPerCase = Math.round(unitPrice.value);
    const base: FinanceEffect = {
      kind: 'REVENUE_UP',
      method: 'QUANTITY_UNIT_PRICE',
      quantity: customers.value * perCustomer.value,
      serviceCustomers: customers.value,
      servicePerCustomerCount: perCustomer.value,
      unitPriceYen: yenPerCase,
      source: fromAiOf(ps) ? 'AI_PROPOSED' : 'USER_INPUT',
      confirmed: false,
      sourceNote: `サービス提供型：${customers.value}社 × 1社当たり月間配送件数${perCustomer.value}件 × 1件当たり料金${yenPerCase.toLocaleString('ja-JP')}円（月額で計上）。${sourceNoteOf(ps)}`,
    };
    if (costRatePct !== undefined) base.costRatePct = costRatePct;
    if (startYm) base.startYm = startYm;
    if (endYm) base.endYm = endYm;
    drafts.push({ kind: 'REVENUE_UP', label: '売上増加（サービス提供型）', fromAi: fromAiOf(ps), base });
  } else if (calculated && !serviceOn && customers.value !== null && rate.value !== null && deal.value !== null) {
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
    if (costRatePct !== undefined) base.costRatePct = costRatePct;
    if (startYm) base.startYm = startYm;
    if (endYm) base.endYm = endYm;
    drafts.push({ kind: 'REVENUE_UP', label: '売上増加（参考試算の売上）', fromAi: fromAiOf(ps), base });
  }

  const cost = valueOf(params, 'currentCostMJPY');
  const reduction = valueOf(params, 'reductionRatePct');
  if (cost.value !== null && reduction.value !== null && cost.value >= 0 && reduction.value >= 0 && reduction.value <= 100) {
    const base: FinanceEffect = {
      kind: 'COST_REDUCTION',
      method: 'DIRECT_AMOUNT',
      directAmountYen: Math.round((cost.value * reduction.value) / 100 * MILLION),
      reductionBaseYen: Math.round(cost.value * MILLION),
      reductionRatePct: reduction.value,
      amountBasis: 'ANNUAL',
      source: 'USER_INPUT',
      confirmed: false,
      sourceNote:
        `削減対象の年間費用：${SOURCE_LABEL[cost.source]}（${cost.value}百万円）、想定削減率：${SOURCE_LABEL[reduction.source]}（${reduction.value}%）。` +
        `年間削減額＝削減対象の年間費用×想定削減率。実際に減らせる費用として確認できた分だけを計上する（費用配賦の見直しや作業時間短縮だけでは計上しない）`,
    };
    if (startYm) base.startYm = startYm;
    if (endYm) base.endYm = endYm;
    drafts.push({ kind: 'COST_REDUCTION', label: '削減効果（年間削減額）', fromAi: false, base });
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
    drafts.push({ kind: 'COST_INCREASE', label: '追加費用', fromAi: fromAiOf([addCost]), base });
  }

  return drafts;
}

/** 利用者の回答を草案に反映する。確認状態はここでは立てない（保存時のガードと確認操作で決める） */
const isNonNegativeNumber = (v: number | undefined): v is number => typeof v === 'number' && Number.isFinite(v) && v >= 0;
const isPercentage = (v: number): boolean => Number.isFinite(v) && v >= 0 && v <= 100;

/* 入力欄に値が残っているか（空欄に戻した項目を含む）。残っていれば、その値をそのまま使う。 */
const hasAnswer = (answers: FinanceAnswers, key: keyof FinanceAnswers): boolean => Object.prototype.hasOwnProperty.call(answers, key);

type AnswerNumberKey =
  | 'sgaCostYen'
  | 'costRatePct'
  | 'directAmountYen'
  | 'meetingsPerPeriod'
  | 'winRatePct'
  | 'averageDealYen'
  | 'serviceCustomers'
  | 'servicePerCustomerCount'
  | 'unitPriceYen'
  | 'reductionBaseYen'
  | 'reductionRatePct';

/* 初期値（参考試算由来）は、入力欄に一度も値が入っていないときだけ使う。利用者が空欄にした値は、空欄のまま残す */
function setAnswerNumber(e: FinanceEffect, answers: FinanceAnswers, key: AnswerNumberKey, valid: (v: number) => boolean): void {
  const value = hasAnswer(answers, key) ? answers[key] : e[key];
  if (typeof value === 'number' && valid(value)) e[key] = value;
  else delete e[key];
}

export function applyFinanceAnswers(draft: FinanceEffectDraft, answers: FinanceAnswers): FinanceEffect {
  const e: FinanceEffect = { ...draft.base, confirmed: false };
  delete e.confirmedAt;
  if (draft.kind === 'REVENUE_UP' && answers.method) e.method = answers.method;
  const serviceRevenue = draft.kind === 'REVENUE_UP' && e.method === 'QUANTITY_UNIT_PRICE';
  if (draft.kind === 'COST_REDUCTION') {
    e.amountBasis = 'ANNUAL';
    if (answers.reductionConfirmed !== undefined) e.reductionConfirmed = answers.reductionConfirmed;
  } else if (answers.amountBasis) {
    e.amountBasis = answers.amountBasis;
  } else if (serviceRevenue) {
    e.amountBasis = 'MONTHLY';
  }
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
    if (answers.opIncomeIncludesAddCost !== undefined && e.operatingIncomeEffectYen !== undefined) {
      e.opIncomeIncludesAddCost = answers.opIncomeIncludesAddCost;
    }
    if (serviceRevenue) e.revenueKind = 'SERVICE';
    else if (answers.revenueKind) e.revenueKind = answers.revenueKind;
    setAnswerNumber(e, answers, 'sgaCostYen', isNonNegativeNumber);
    setAnswerNumber(e, answers, 'costRatePct', isPercentage);
    if (hasAnswer(answers, 'sgaSameAsAddCost')) {
      if (answers.sgaSameAsAddCost === undefined) delete e.sgaSameAsAddCost;
      else e.sgaSameAsAddCost = answers.sgaSameAsAddCost;
    }
    if (e.method === 'DIRECT_AMOUNT') setAnswerNumber(e, answers, 'directAmountYen', isNonNegativeNumber);
    if (e.method === 'FUNNEL') {
      setAnswerNumber(e, answers, 'meetingsPerPeriod', isNonNegativeNumber);
      setAnswerNumber(e, answers, 'winRatePct', isPercentage);
      setAnswerNumber(e, answers, 'averageDealYen', isNonNegativeNumber);
    }
    if (e.method === 'QUANTITY_UNIT_PRICE') {
      setAnswerNumber(e, answers, 'serviceCustomers', isNonNegativeNumber);
      setAnswerNumber(e, answers, 'servicePerCustomerCount', isNonNegativeNumber);
      setAnswerNumber(e, answers, 'unitPriceYen', isNonNegativeNumber);
      if (hasAnswer(answers, 'serviceCustomers') || hasAnswer(answers, 'servicePerCustomerCount')) {
        if (e.serviceCustomers !== undefined && e.servicePerCustomerCount !== undefined) {
          e.quantity = e.serviceCustomers * e.servicePerCustomerCount;
        } else {
          delete e.quantity;
        }
      }
    }
  }
  if (draft.kind === 'COST_REDUCTION') {
    const mode = answers.costInputMode ?? (draft.base.reductionBaseYen !== undefined ? 'RATE' : 'DIRECT');
    if (mode === 'DIRECT') {
      delete e.reductionBaseYen;
      delete e.reductionRatePct;
      setAnswerNumber(e, answers, 'directAmountYen', isNonNegativeNumber);
    } else {
      setAnswerNumber(e, answers, 'reductionBaseYen', isNonNegativeNumber);
      setAnswerNumber(e, answers, 'reductionRatePct', isPercentage);
      if (e.reductionBaseYen !== undefined && e.reductionRatePct !== undefined) {
        e.directAmountYen = Math.round((e.reductionBaseYen * e.reductionRatePct) / 100);
      } else {
        delete e.directAmountYen;
      }
    }
  }
  if (answers.overlapNote?.trim()) e.overlapNote = answers.overlapNote.trim();
  return e;
}

/* 営業利益増分（年額）が、売上の年額・原価率・追加費用の差し引き方と整合するか。整合しなければ確認できない */
function operatingIncomeConsistencyOf(effect: FinanceEffect, ctx: ConfirmContext): string | null {
  const result = computeFinanceEffect(effect);
  const annualRevenue = result.annualRevenueYen;
  const annualOperating = result.annualOperatingEffectYen;
  if (annualRevenue === undefined || annualOperating === undefined) return null;
  if (annualOperating > annualRevenue) {
    return `営業利益増分（年額${formatYenScaled(annualOperating)}）が年額の売上（${formatYenScaled(annualRevenue)}）を超えています。売上と営業利益増分の単位（月額・年額）が合っているか確認してください`;
  }
  if (effect.costRatePct === undefined || (ctx.hasCostEffect && effect.opIncomeIncludesAddCost === undefined)) return null;
  const grossYen = annualRevenue * (1 - effect.costRatePct / 100);
  const includesAddCost = ctx.hasCostEffect && effect.opIncomeIncludesAddCost === true;
  if (includesAddCost && ctx.addCostAnnualYen === undefined) {
    return '追加費用の年額が決まらないため、追加費用を差し引いた後の営業利益増分と整合するか確認できません';
  }
  const expectedYen = includesAddCost ? grossYen - (ctx.addCostAnnualYen ?? 0) : grossYen;
  if (Math.abs(annualOperating - expectedYen) > 1) {
    const deduction = includesAddCost ? `から追加費用（${formatYenScaled(ctx.addCostAnnualYen ?? 0)}）を差し引いた${formatYenScaled(expectedYen)}` : '';
    return `営業利益増分（年額${formatYenScaled(annualOperating)}）が、売上の粗利（${formatYenScaled(grossYen)}）${deduction}と一致しません。追加費用を差し引く前の値か後の値かを確かめてください`;
  }
  return null;
}

/**
 * 確認できない理由（空なら確認できる）。
 * - 計上の終了年月が無い年額・月額は、後の年度まで両年度に計上されるため、終了年月の確認を要する
 * - 営業利益増分は、同じ案件の追加費用を差し引いた後かどうかが決まるまで確認しない（二重控除を防ぐ）
 * - 重複の可能性がある効果は、利用者の説明がないと保留する
 */
export function confirmBlockers(effect: FinanceEffect, ctx: ConfirmContext): string[] {
  const reasons = candidateChecks(effect)
    .filter((c) => c.blocking && !c.done)
    .map((c) => `${c.label}が未確認`);
  if (effect.amountBasis !== 'TOTAL' && !effect.endYm) {
    reasons.push('計上の終了年月（未入力だと、後の年度まで計上されます）が未確認');
  }
  if (effect.amountBasis === 'TOTAL' && effect.endYm) {
    reasons.push('一回限りの金額は開始月に全額計上します（終了年月を入れると期間に按分されるため、終了年月を消してください）');
  }
  if (effect.kind === 'REVENUE_UP' && !effect.revenueKind) {
    reasons.push('売上の区分（有償開発・量産・サービス提供）が未確認');
  }
  if (effect.kind === 'REVENUE_UP' && effect.operatingIncomeEffectYen !== undefined) {
    if (ctx.hasCostEffect && effect.opIncomeIncludesAddCost === undefined) {
      reasons.push('営業利益増分が、同じ案件の追加費用を差し引いた後の値か（含む／含まない）が未確認');
    }
    if (effect.opIncomeIncludesAddCost === true && ctx.costConfirmed) {
      reasons.push('追加費用は確定済みのため、営業利益増分は追加費用を差し引く前の値に直してください');
    }
    const inconsistent = operatingIncomeConsistencyOf(effect, ctx);
    if (inconsistent) reasons.push(inconsistent);
  }
  if (effect.kind === 'COST_REDUCTION' && ctx.revenueHasOperatingEffect && !effect.overlapNote?.trim()) {
    reasons.push('同じ案件の売上増加で営業利益増分を計上しているため、コスト削減との重複がないことの説明が未入力です');
  }
  if (effect.kind === 'COST_INCREASE' && ctx.revenueOpIncludesAddCost) {
    reasons.push('売上増加の営業利益増分に追加費用が含まれているため、この追加費用は別に確定しません');
  }
  if (ctx.overlapCount > 0 && !effect.overlapNote?.trim()) {
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
  const patchAt = (next: FinanceEffect): FinancePatch =>
    idx === 0 ? { financeEffect: next } : { financeEffects: additional.map((e, i) => (i === idx - 1 ? next : e)) };

  if (idx === -1) {
    if (args.action === 'CONFIRM') return { ok: false, reason: '先に計画を保存してください' };
    if (args.action === 'UNCONFIRM') return { ok: false, reason: '確認済みの財務効果がありません' };
    const plan = planCandidateWrite({ primary: args.primary, additional, candidate: args.candidate });
    if (plan.outcome === 'already_has_same_kind') return { ok: false, reason: '同じ種類の財務効果が既にあります' };
    return { ok: true, outcome: plan.outcome, patch: plan.patch };
  }

  const existing = list[idx]!;
  const same = !isFinanceEffectMaterialChange(existing, args.candidate);

  if (args.action === 'UNCONFIRM') {
    if (!existing.confirmed) return { ok: true, outcome: 'unchanged', patch: {} };
    const next: FinanceEffect = { ...existing, confirmed: false };
    delete next.confirmedAt;
    return { ok: true, outcome: 'draft_replaced', patch: patchAt(next) };
  }

  if (args.action === 'REVISE') {
    const next: FinanceEffect = { ...args.candidate, confirmed: false };
    delete next.confirmedAt;
    return { ok: true, outcome: 'draft_replaced', patch: patchAt(next) };
  }

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
    if (!same) return { ok: false, reason: '保存済みの草案と内容が違います。先に計画を保存し直してください' };
    next = { ...args.candidate, confirmed: true, confirmedAt: args.nowIso };
    outcome = 'confirmed';
  }

  return { ok: true, outcome, patch: patchAt(next) };
}

type FinancePatch = { financeEffect?: FinanceEffect; financeEffects?: FinanceEffect[] };

export type PlanPeriod = { startYm: string; endYm: string };

/** 計画書の期間の表示（"2026-12 〜 2027-05"）を、年月の範囲にする。読めなければ null */
export function periodOfLabel(label: string | null | undefined): PlanPeriod | null {
  const m = /^(\d{4}-\d{2}) 〜 (\d{4}-\d{2})$/.exec(label ?? '');
  return m ? { startYm: m[1], endYm: m[2] } : null;
}

/** 財務効果の計上期間が、実行計画の期間の外にあるときの注意（自動では変えない） */
export function periodOutsidePlanNote(effect: FinanceEffect, plan: PlanPeriod | null): string | null {
  if (!plan || !effect.startYm) return null;
  const startsBefore = effect.startYm < plan.startYm;
  const endsAfter = !!effect.endYm && effect.endYm > plan.endYm;
  if (!startsBefore && !endsAfter) return null;
  return `計上期間（${effect.startYm}〜${effect.endYm ?? '未入力'}）が、実行計画の期間（${plan.startYm}〜${plan.endYm}）の外にあります。根拠を確認してください`;
}

/* 財務効果を画面から書けない理由。計画の保存と一緒に書くため、識別子や本文の未保存では止めない */
export function financeWriteReason(args: { scopeMatches: boolean; planLoaded: boolean }): string | undefined {
  if (!args.scopeMatches) return '表示中の会社・戦略が切り替わったため、ここからは保存できません。画面を読み込み直してください。';
  if (!args.planLoaded) return '計画書を読み込んでいます。';
  return undefined;
}

/* 保存済みの財務効果がある種類は、草案の代わりにその保存値を基点にする（入力欄・保存の両方で同じ基点を使う） */
export function anchorDraftsToSaved(drafts: FinanceEffectDraft[], saved: FinanceEffect[]): FinanceEffectDraft[] {
  return drafts.map((draft) => {
    const savedOne = saved.find((e) => e.kind === draft.kind);
    return savedOne ? { ...draft, blank: false, base: { ...savedOne, confirmed: false } } : draft;
  });
}

export type FinanceLine = { label: string; status: 'CONFIRMED' | 'AI_ESTIMATE' | 'NOT_CALCULATED'; text: string };

/* 計画書の「財務効果の算定」の文章。保存済みの財務効果から作り、編集中の値は未保存と明示する（STAGE4の入力欄と同じ計算） */
export function financeLinesOf(args: {
  drafts: FinanceEffectDraft[];
  saved: FinanceEffect[];
  answers: FinanceAnswersByKind;
  projectHasCostIncrease: boolean;
}): FinanceLine[] {
  const lines: FinanceLine[] = [];
  for (const draft of args.drafts) {
    const typed = args.answers[draft.kind];
    const savedOne = args.saved.find((e) => e.kind === draft.kind);
    if (!typed && !savedOne) continue;
    const effect = typed ? applyFinanceAnswers(draft, typed) : savedOne!;
    const unsaved = !!typed && (!savedOne || isFinanceEffectInputChanged(savedOne, effect));
    const suffix = unsaved ? '（未保存の入力中の値）' : '';
    const result = computeFinanceEffect(effect, { projectHasCostIncrease: args.projectHasCostIncrease });
    const label = draft.label;
    if (result.status === 'INCOMPLETE') {
      lines.push({ label, status: 'NOT_CALCULATED', text: `${label}は、${result.missing.join('、')}が未入力のため未算定です${suffix}` });
      continue;
    }
    const revenue = effect.kind === 'REVENUE_UP' ? `売上 ${yenTextOf(result.annualRevenueYen)}／` : '';
    const operating = `営業利益への効果 ${yenTextOf(result.annualOperatingEffectYen)}`;
    const confirmed = effect.confirmed === true && !unsaved;
    const note = confirmed ? '' : '。未確認のため、正式な計画には加算しません';
    lines.push({ label, status: confirmed ? 'CONFIRMED' : 'AI_ESTIMATE', text: `${label}：${revenue}${operating}（年額）${note}${suffix}` });
  }
  return lines;
}

const yenTextOf = (yen: number | undefined): string => (yen === undefined ? '未算定' : formatYenScaled(yen));

export type FinanceAnswersByKind = Partial<Record<FinanceDraftKind, FinanceAnswers>>;

/* 入力欄の初期値：保存済みの効果があればその内容、無ければ AI案の期間 */
export function initialFinanceAnswers(draft: FinanceEffectDraft, saved: FinanceEffect | undefined): FinanceAnswers {
  if (!saved) return { startYm: draft.base.startYm ?? '', endYm: draft.base.endYm ?? '' };
  return {
    amountBasis: saved.amountBasis,
    startYm: saved.startYm ?? '',
    endYm: saved.endYm ?? '',
    meetingBasisConfirmed: saved.meetingBasisConfirmed,
    isIncremental: saved.isIncremental,
    operatingIncomeEffectYen: saved.operatingIncomeEffectYen,
    opIncomeIncludesAddCost: saved.opIncomeIncludesAddCost,
    revenueKind: saved.revenueKind,
    reductionConfirmed: saved.reductionConfirmed,
    reductionBaseYen: saved.reductionBaseYen,
    reductionRatePct: saved.reductionRatePct,
    meetingsPerPeriod: saved.meetingsPerPeriod,
    winRatePct: saved.winRatePct,
    averageDealYen: saved.averageDealYen,
    method: saved.method,
    costInputMode: saved.kind === 'COST_REDUCTION' ? (saved.reductionBaseYen !== undefined ? 'RATE' : 'DIRECT') : undefined,
    directAmountYen: saved.directAmountYen,
    costRatePct: saved.costRatePct,
    sgaCostYen: saved.sgaCostYen,
    sgaSameAsAddCost: saved.sgaSameAsAddCost,
    serviceCustomers: saved.serviceCustomers,
    servicePerCustomerCount: saved.servicePerCustomerCount,
    unitPriceYen: saved.unitPriceYen,
    overlapNote: saved.overlapNote,
  };
}

export function financeConfirmContext(
  drafts: FinanceEffectDraft[],
  saved: FinanceEffect[],
  overlapCount: number,
  answers?: FinanceAnswersByKind,
): ConfirmContext {
  const revenueSaved = saved.find((e) => e.kind === 'REVENUE_UP');
  const costSaved = saved.find((e) => e.kind === 'COST_INCREASE');
  const costDraft = drafts.find((d) => d.kind === 'COST_INCREASE');
  const costAnswers = answers?.COST_INCREASE;
  const costEffect = costDraft && costAnswers ? applyFinanceAnswers(costDraft, costAnswers) : costSaved;
  return {
    overlapCount,
    hasCostEffect: drafts.some((d) => d.kind === 'COST_INCREASE' && !d.blank) || !!costSaved,
    costConfirmed: costSaved?.confirmed === true,
    revenueOpIncludesAddCost: revenueSaved?.opIncomeIncludesAddCost === true && typeof revenueSaved.operatingIncomeEffectYen === 'number',
    revenueHasOperatingEffect: !!revenueSaved && typeof revenueSaved.operatingIncomeEffectYen === 'number',
    addCostAnnualYen: costEffect ? computeFinanceEffect(costEffect).annualYen : undefined,
  };
}

export type FinanceSaveStep = { kind: FinanceDraftKind; action: FinanceWriteAction; candidate: FinanceEffect };

/* 「計画を保存」で書く財務効果の手順。利用者が入力した効果だけを対象にする。
 * 確認済みの効果も、入力を変えたときは修正内容で置き換えてから確認し直す（変えなければ書かない）。
 * 必須項目がそろった効果は、草案の保存のあとに確認（CONFIRM）まで行う。足りない効果は未確認の草案のまま残す。
 * 確認の判定は confirmBlockers（STAGE6へ反映する条件）と同じで、ここでは緩めない。 */
export function financeSaveSteps(args: {
  drafts: FinanceEffectDraft[];
  answers: FinanceAnswersByKind;
  saved: FinanceEffect[];
  overlapCount: number;
}): FinanceSaveStep[] {
  const ctx = financeConfirmContext(args.drafts, args.saved, args.overlapCount, args.answers);
  const steps: FinanceSaveStep[] = [];
  for (const draft of args.drafts) {
    const savedOne = args.saved.find((e) => e.kind === draft.kind);
    const answers = args.answers[draft.kind] ?? (savedOne && !savedOne.confirmed ? initialFinanceAnswers(draft, savedOne) : undefined);
    if (!answers) continue;
    const candidate = applyFinanceAnswers(draft, answers);
    if (savedOne?.confirmed && !isFinanceEffectInputChanged(savedOne, candidate)) continue;
    const unchanged = !!savedOne && !isFinanceEffectInputChanged(savedOne, candidate);
    if (!unchanged) steps.push({ kind: draft.kind, action: savedOne?.confirmed ? 'REVISE' : 'SAVE_DRAFT', candidate });
    if (confirmBlockers(candidate, ctx).length === 0) steps.push({ kind: draft.kind, action: 'CONFIRM', candidate });
  }
  return steps;
}

/* 「計画を保存」の後に、確認できていない財務効果と、その不足理由（重複の確認を含む）。保存済みだけで成功と見せないために使う */
export function financePendingReasons(args: {
  drafts: FinanceEffectDraft[];
  answers: FinanceAnswersByKind;
  saved: FinanceEffect[];
  overlapCount: number;
}): { label: string; reasons: string[] }[] {
  const ctx = financeConfirmContext(args.drafts, args.saved, args.overlapCount, args.answers);
  const out: { label: string; reasons: string[] }[] = [];
  for (const draft of args.drafts) {
    const savedOne = args.saved.find((e) => e.kind === draft.kind);
    if (savedOne?.confirmed) continue;
    const answers = args.answers[draft.kind] ?? (savedOne ? initialFinanceAnswers(draft, savedOne) : undefined);
    if (!answers) continue;
    const reasons = confirmBlockers(applyFinanceAnswers(draft, answers), ctx);
    if (reasons.length > 0) out.push({ label: draft.label, reasons });
  }
  return out;
}

function isFinanceEffectInputChanged(prev: FinanceEffect, next: FinanceEffect): boolean {
  return isFinanceEffectMaterialChange(prev, next) || (prev.overlapNote ?? '') !== (next.overlapNote ?? '');
}
