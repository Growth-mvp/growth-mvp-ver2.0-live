/* STAGE5：財務実績（月次）の項目化・入力検証・保存時の置き換え（純粋関数）。
 * 財務項目の対応は、同じ案件に同じ種類の財務効果が1つだけという既存の保存ルールを使う（EFFECT:種類）。
 * OPEXは既存の執行明細IDを使う（OPEX:明細ID）。STAGE4の計画・STAGE6の計算には使わない。 */
import { computeFinanceEffect } from '@/lib/financeEffect';
import type { ExecutionHumanInvestment, FinanceActualEntry, FinanceEffect, Project } from '@/types/strategy';

export const FINANCE_ACTUAL_NOTE_MAX = 300;
const YM_PATTERN = /^\d{4}-(0[1-9]|1[0-2])$/;

export type FinanceActualKind = 'REVENUE_UP' | 'COST_REDUCTION' | 'COST_INCREASE' | 'OPEX';

export type FinanceActualItem = {
  itemKey: string;
  kind: FinanceActualKind;
  label: string;
  /** STAGE4の計画額（読み取り専用） */
  planText: string;
  periodText: string;
  statusText: string;
  recordable: boolean;
  unrecordableReason: string | null;
  /** 対象年月の昇順 */
  actuals: FinanceActualEntry[];
};

export type FinanceActualProject = Pick<Project, 'financeEffect' | 'financeEffects' | 'executionHumanInvestments' | 'financeActuals'>;

const EFFECT_KINDS: Array<Exclude<FinanceActualKind, 'OPEX'>> = ['REVENUE_UP', 'COST_REDUCTION', 'COST_INCREASE'];
const EFFECT_LABEL: Record<Exclude<FinanceActualKind, 'OPEX'>, string> = {
  REVENUE_UP: '売上増加',
  COST_REDUCTION: '費用削減',
  COST_INCREASE: '追加費用',
};
const RELATION_TEXT: Record<NonNullable<NonNullable<ExecutionHumanInvestment['spend']>['opexRelation']>, string> = {
  IN_PLAN: '営業利益に含まれる',
  NOT_IN_PLAN: '営業利益に含まれない',
  SAME_AS_ADD_COST: '追加費用と同じ費用',
  DIFFERENT_FROM_ADD_COST: '追加費用とは別の費用',
};

export const effectItemKey = (kind: FinanceActualKind) => `EFFECT:${kind}`;
export const opexItemKey = (recordId: string) => `OPEX:${recordId}`;

const yenText = (yen: number) => `${Math.round(yen).toLocaleString('ja-JP')}円`;

function effectPlanOf(effect: FinanceEffect): { planText: string; periodText: string; statusText: string } {
  const r = computeFinanceEffect(effect);
  const amount = effect.kind === 'REVENUE_UP' ? (r.annualRevenueYen ?? r.annualYen) : r.annualYen;
  const planText =
    amount !== undefined ? `年額 ${yenText(amount)}` : r.totalYen !== undefined ? `一回限り ${yenText(r.totalYen)}` : '未算定（STAGE4の入力が不足）';
  const periodText = effect.startYm ? `${effect.startYm} 〜 ${effect.endYm ?? '終了未設定'}` : '開始時期 未設定';
  const statusText = r.status === 'CONFIRMED' ? 'STAGE6に反映済み（確認済み）' : r.status === 'DRAFT' ? '未確認（STAGE6には未反映）' : '未算定';
  return { planText, periodText, statusText };
}

function opexPlanOf(record: ExecutionHumanInvestment): { planText: string; periodText: string; statusText: string } {
  const spend = record.spend ?? {};
  const amount = record.amount !== undefined ? yenText(record.amount) : '金額 未入力';
  const planText =
    spend.recurrence === 'RECURRING' ? `継続 ${amount}（金額基準：${basisText(spend.amountBasis)}）` : `一時支出 ${amount}`;
  const periodText =
    spend.recurrence === 'RECURRING'
      ? `${spend.startYm ?? '未設定'} 〜 ${spend.endYm ?? '未設定'}`
      : `支出年月 ${spend.paymentYm ?? '未設定'}`;
  const statusText = spend.opexRelation ? RELATION_TEXT[spend.opexRelation] : '営業利益との関係 未確認';
  return { planText, periodText, statusText };
}

const basisText = (basis: string | undefined) => (basis === 'MONTHLY' ? '月額' : basis === 'ANNUAL' ? '年額' : basis === 'TOTAL' ? '総額' : '未設定');

/** 財務実績を登録できる財務項目の一覧。計画の内容は変えず、実績の対応先だけを表す */
export function financeActualItemsOf(project: FinanceActualProject | null | undefined): FinanceActualItem[] {
  if (!project) return [];
  const effects = [project.financeEffect, ...(Array.isArray(project.financeEffects) ? project.financeEffects : [])].filter(
    (e): e is FinanceEffect => !!e && typeof e === 'object',
  );
  const actualsOf = (itemKey: string) =>
    (Array.isArray(project.financeActuals) ? project.financeActuals : [])
      .filter((a) => a.itemKey === itemKey)
      .sort((a, b) => a.ym.localeCompare(b.ym));

  const items: FinanceActualItem[] = [];
  for (const kind of EFFECT_KINDS) {
    const matches = effects.filter((e) => e.kind === kind);
    if (matches.length === 0) continue;
    const plan = effectPlanOf(matches[0]);
    const duplicated = matches.length > 1;
    const itemKey = effectItemKey(kind);
    items.push({
      itemKey,
      kind,
      label: EFFECT_LABEL[kind],
      ...plan,
      recordable: !duplicated,
      unrecordableReason: duplicated ? '同じ種類の財務効果が複数あるため、実績の対応先を特定できません' : null,
      actuals: actualsOf(itemKey),
    });
  }

  for (const record of Array.isArray(project.executionHumanInvestments) ? project.executionHumanInvestments : []) {
    if (record?.spend?.category !== 'OPEX') continue;
    const hasId = String(record.id ?? '').trim() !== '';
    const itemKey = hasId ? opexItemKey(String(record.id)) : '';
    items.push({
      itemKey,
      kind: 'OPEX',
      label: record.name?.trim() || 'OPEX（名称未設定）',
      ...opexPlanOf(record),
      recordable: hasId,
      unrecordableReason: hasId ? null : 'この明細には識別子（ID）がないため、実績を記録できません',
      actuals: hasId ? actualsOf(itemKey) : [],
    });
  }
  return items;
}

export type FinanceActualInput = { ym: string; amount: string; note: string };

export function parseFinanceActualInput(
  raw: FinanceActualInput,
): { ok: true; ym: string; amountYen: number; note?: string } | { ok: false; error: string } {
  const ym = raw.ym.trim();
  if (!YM_PATTERN.test(ym)) return { ok: false, error: '対象年月は YYYY-MM で入力してください。' };

  const amountText = raw.amount.replace(/[,，\s]/g, '');
  if (amountText === '') return { ok: false, error: '実績金額を入力してください（0円の場合は 0 と入力）。' };
  if (!/^\d+$/.test(amountText)) return { ok: false, error: '実績金額は0以上の円の整数で入力してください。' };
  const amountYen = Number(amountText);
  if (!Number.isSafeInteger(amountYen)) return { ok: false, error: '実績金額が大きすぎます。' };

  const note = raw.note.trim();
  if (note.length > FINANCE_ACTUAL_NOTE_MAX) return { ok: false, error: `根拠・補足は${FINANCE_ACTUAL_NOTE_MAX}文字以内で入力してください。` };

  return { ok: true, ym, amountYen, ...(note ? { note } : {}) };
}

/** 同じ財務項目・同じ年月は1件に置き換える（追加しない）。初回登録日時は保つ */
export function upsertFinanceActual(
  list: readonly FinanceActualEntry[] | undefined,
  input: { itemKey: string; ym: string; amountYen: number; note?: string; nowIso: string },
): FinanceActualEntry[] {
  const next = [...(list ?? [])];
  const index = next.findIndex((a) => a.itemKey === input.itemKey && a.ym === input.ym);
  const entry: FinanceActualEntry = {
    itemKey: input.itemKey,
    ym: input.ym,
    amountYen: input.amountYen,
    ...(input.note ? { note: input.note } : {}),
    recordedAt: input.nowIso,
    createdAt: index >= 0 ? next[index].createdAt : input.nowIso,
  };
  if (index >= 0) next[index] = entry;
  else next.push(entry);
  return next;
}
