import type { ExecutionHumanInvestment, SpendAmountBasis, SpendSchedule } from '@/types/strategy';

export type OpexRelation = NonNullable<SpendSchedule['opexRelation']>;

export type InvestmentRowDraft = {
  key: string;
  /** 保存先の明細ID。新規行も追加時に採番し、保存のたびに同じ明細として扱う */
  recordId: string;
  name: string;
  category: 'CAPEX' | 'OPEX' | '';
  /** 円。入力欄の文字列のまま保持する（0 や空欄は未入力として区別する） */
  amount: string;
  recurrence: 'ONE_TIME' | 'RECURRING' | '';
  paymentYm: string;
  startYm: string;
  endYm: string;
  amountBasis: SpendAmountBasis | '';
  opexRelation: OpexRelation | '';
};

export type InvestmentRowCheck = { ok: true; record: ExecutionHumanInvestment } | { ok: false; reasons: string[] };

const YM_PATTERN = /^\d{4}-(0[1-9]|1[0-2])$/;

export function newInvestmentRow(recordId: string): InvestmentRowDraft {
  return {
    key: recordId,
    recordId,
    name: '',
    category: '',
    amount: '',
    recurrence: '',
    paymentYm: '',
    startYm: '',
    endYm: '',
    amountBasis: '',
    opexRelation: '',
  };
}

export function isInvestmentRecord(record: ExecutionHumanInvestment | null | undefined): record is ExecutionHumanInvestment {
  const category = record?.spend?.category;
  return !!record && !!record.name?.trim() && (category === 'CAPEX' || category === 'OPEX');
}

export function investmentRowOf(record: ExecutionHumanInvestment): InvestmentRowDraft {
  const spend = record.spend ?? {};
  const recurrence = spend.recurrence === 'ONE_TIME' || spend.recurrence === 'RECURRING' ? spend.recurrence : '';
  const recurring = recurrence === 'RECURRING';
  return {
    key: String(record.id),
    recordId: String(record.id),
    name: record.name ?? '',
    category: spend.category === 'OPEX' ? 'OPEX' : 'CAPEX',
    amount: record.amount === undefined ? '' : String(record.amount),
    recurrence,
    paymentYm: spend.paymentYm ?? '',
    startYm: spend.startYm ?? '',
    endYm: spend.endYm ?? '',
    amountBasis: recurring ? spend.amountBasis ?? '' : '',
    opexRelation: spend.category === 'OPEX' ? spend.opexRelation ?? '' : '',
  };
}

export function checkInvestmentRow(row: InvestmentRowDraft): InvestmentRowCheck {
  const reasons: string[] = [];
  const name = row.name.trim();
  if (name === '') reasons.push('項目名・内容');
  if (row.category === '') reasons.push('支出区分');

  const amountText = row.amount.trim();
  const amount = Number(amountText);
  const amountOk = amountText !== '' && Number.isInteger(amount) && amount > 0;
  if (!amountOk) reasons.push('金額（0より大きい円の整数）');

  if (row.recurrence === '') reasons.push('支出形態');
  if (row.recurrence === 'ONE_TIME' && !YM_PATTERN.test(row.paymentYm)) reasons.push('支出年月');
  if (row.recurrence === 'RECURRING') {
    const startOk = YM_PATTERN.test(row.startYm);
    const endOk = YM_PATTERN.test(row.endYm);
    if (!startOk) reasons.push('開始年月');
    if (!endOk) reasons.push('終了年月');
    if (startOk && endOk && row.endYm < row.startYm) reasons.push('終了年月が開始年月より前');
    if (row.amountBasis === '') reasons.push('金額基準（総額・月額・年額）');
  }
  if (row.category === 'OPEX' && row.opexRelation === '') reasons.push('営業利益との関係');

  if (reasons.length > 0) return { ok: false, reasons };

  const isOpex = row.category === 'OPEX';
  const oneTime = row.recurrence === 'ONE_TIME';
  const spend = oneTime
    ? {
        category: row.category as 'CAPEX' | 'OPEX',
        recurrence: 'ONE_TIME' as const,
        amountBasis: 'TOTAL' as const,
        paymentYm: row.paymentYm,
      }
    : {
        category: row.category as 'CAPEX' | 'OPEX',
        recurrence: 'RECURRING' as const,
        amountBasis: row.amountBasis as SpendAmountBasis,
        startYm: row.startYm,
        endYm: row.endYm,
      };
  const record: ExecutionHumanInvestment = {
    id: row.recordId,
    type: 'OTHER',
    name,
    amount,
    spend: isOpex ? { ...spend, opexRelation: row.opexRelation as OpexRelation } : spend,
  };
  return { ok: true, record };
}

/** 保存済みの明細に、今回の入力を反映する。他の明細・並び順・重複判断は変えない */
export function upsertInvestmentRecords(
  list: ExecutionHumanInvestment[] | undefined,
  records: ExecutionHumanInvestment[],
): ExecutionHumanInvestment[] {
  const next = [...(list ?? [])];
  for (const record of records) {
    const index = next.findIndex((r) => String(r.id) === String(record.id));
    if (index < 0) {
      next.push(record);
      continue;
    }
    const prev = next[index];
    const review = prev.spend?.duplicateReview;
    next[index] = {
      ...prev,
      ...record,
      spend: { ...record.spend, ...(review ? { duplicateReview: review } : {}) },
    };
  }
  return next;
}
