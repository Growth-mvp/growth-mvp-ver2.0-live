import type { ExecutionHumanInvestment } from '@/types/strategy';
import { checkInvestmentRow, investmentRowOf, newInvestmentRow, upsertInvestmentRecords, type InvestmentRowDraft } from './investmentRows';

const base = (overrides: Partial<InvestmentRowDraft>): InvestmentRowDraft => ({ ...newInvestmentRow('rec-1'), ...overrides });

describe('checkInvestmentRow', () => {
  it('一時支出のCAPEXは、総額・支出年月の明細にする', () => {
    const r = checkInvestmentRow(base({ name: '検査装置', category: 'CAPEX', amount: '3000000', recurrence: 'ONE_TIME', paymentYm: '2026-09' }));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.record).toEqual({
      id: 'rec-1',
      type: 'OTHER',
      name: '検査装置',
      amount: 3000000,
      spend: { category: 'CAPEX', recurrence: 'ONE_TIME', amountBasis: 'TOTAL', paymentYm: '2026-09' },
    });
  });

  it('継続支出のOPEXは、金額基準と営業利益との関係を持つ', () => {
    const r = checkInvestmentRow(
      base({
        name: '外注費',
        category: 'OPEX',
        amount: '100000',
        recurrence: 'RECURRING',
        startYm: '2026-04',
        endYm: '2026-06',
        amountBasis: 'MONTHLY',
        opexRelation: 'NOT_IN_PLAN',
      }),
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.record.spend).toEqual({
      category: 'OPEX',
      recurrence: 'RECURRING',
      amountBasis: 'MONTHLY',
      startYm: '2026-04',
      endYm: '2026-06',
      opexRelation: 'NOT_IN_PLAN',
    });
  });

  it('未入力・0円・不正な年月は、理由つきで保存しない（0円を確定しない）', () => {
    const zero = checkInvestmentRow(base({ name: 'x', category: 'CAPEX', amount: '0', recurrence: 'ONE_TIME', paymentYm: '2026-09' }));
    expect(zero).toEqual({ ok: false, reasons: ['金額（0より大きい円の整数）'] });

    const empty = checkInvestmentRow(base({ name: 'x', category: 'CAPEX', amount: '', recurrence: 'ONE_TIME', paymentYm: '2026-13' }));
    expect(empty).toEqual({ ok: false, reasons: ['金額（0より大きい円の整数）', '支出年月'] });
  });

  it('OPEXは営業利益との関係が未回答なら保存しない', () => {
    const r = checkInvestmentRow(base({ name: '人件費', category: 'OPEX', amount: '500000', recurrence: 'ONE_TIME', paymentYm: '2026-05' }));
    expect(r).toEqual({ ok: false, reasons: ['営業利益との関係'] });
  });

  it('継続支出は終了年月が開始年月より前なら保存しない', () => {
    const r = checkInvestmentRow(
      base({ name: '設備保守', category: 'CAPEX', amount: '1000', recurrence: 'RECURRING', startYm: '2026-06', endYm: '2026-04', amountBasis: 'TOTAL' }),
    );
    expect(r).toEqual({ ok: false, reasons: ['終了年月が開始年月より前'] });
  });
});

describe('investmentRowOf', () => {
  it('保存済みの明細を入力行に戻し、同じ内容で再び検証できる', () => {
    const record: ExecutionHumanInvestment = {
      id: 'rec-9',
      type: 'OTHER',
      name: '外注費',
      amount: 120000,
      spend: { category: 'OPEX', recurrence: 'RECURRING', amountBasis: 'ANNUAL', startYm: '2026-04', endYm: '2027-03', opexRelation: 'IN_PLAN' },
    };
    const row = investmentRowOf(record);
    expect(row).toMatchObject({ recordId: 'rec-9', name: '外注費', category: 'OPEX', amount: '120000', amountBasis: 'ANNUAL', opexRelation: 'IN_PLAN' });
    const again = checkInvestmentRow(row);
    expect(again.ok && again.record.spend).toEqual(record.spend);
  });
});

describe('upsertInvestmentRecords', () => {
  it('同じIDの明細だけ置き換え、他の明細・並び順・重複判断を残す', () => {
    const existing: ExecutionHumanInvestment[] = [
      { id: 'a', type: 'TRAINING', amount: 50000, headcount: 2, spend: { category: 'OPEX', recurrence: 'ONE_TIME', paymentYm: '2026-05' } },
      {
        id: 'b',
        type: 'OTHER',
        name: '旧名',
        amount: 1000000,
        spend: {
          category: 'CAPEX',
          recurrence: 'ONE_TIME',
          amountBasis: 'TOTAL',
          paymentYm: '2026-06',
          duplicateReview: { decision: 'DIFFERENT', fingerprint: 'old' },
        },
      },
    ];
    const next = upsertInvestmentRecords(existing, [
      { id: 'b', type: 'OTHER', name: '新名', amount: 2000000, spend: { category: 'CAPEX', recurrence: 'ONE_TIME', amountBasis: 'TOTAL', paymentYm: '2026-07' } },
      { id: 'c', type: 'OTHER', name: '追加', amount: 300000, spend: { category: 'OPEX', recurrence: 'ONE_TIME', amountBasis: 'TOTAL', paymentYm: '2026-08', opexRelation: 'NOT_IN_PLAN' } },
    ]);
    expect(next.map((r) => r.id)).toEqual(['a', 'b', 'c']);
    expect(next[0]).toBe(existing[0]);
    expect(next[1]).toMatchObject({ name: '新名', amount: 2000000 });
    expect(next[1].spend).toEqual({
      category: 'CAPEX',
      recurrence: 'ONE_TIME',
      amountBasis: 'TOTAL',
      paymentYm: '2026-07',
      duplicateReview: { decision: 'DIFFERENT', fingerprint: 'old' },
    });
  });

  it('既存の明細がないときは追加だけする', () => {
    expect(upsertInvestmentRecords(undefined, [{ id: 'n', type: 'OTHER', name: 'n', amount: 1, spend: { category: 'CAPEX' } }])).toHaveLength(1);
  });
});
