import type { FinanceActualEntry, FinanceEffect } from '@/types/strategy';
import { financeActualItemsOf, parseFinanceActualInput, upsertFinanceActual } from './financeActuals';
import { applyFinanceActualToDepartments } from './partialStrategyWrite';

const confirmed = { confirmed: true, sourceNote: '見積書（架空）', source: 'USER_INPUT' as const };
const costReduction: FinanceEffect = {
  ...confirmed,
  kind: 'COST_REDUCTION',
  method: 'DIRECT_AMOUNT',
  directAmountYen: 5_000_000,
  amountBasis: 'ANNUAL',
  startYm: '2026-04',
};
const revenue: FinanceEffect = { ...confirmed, kind: 'REVENUE_UP', method: 'DIRECT_AMOUNT', directAmountYen: 12_000_000, amountBasis: 'ANNUAL', startYm: '2026-06' };

const project = (overrides: Record<string, unknown> = {}) => ({
  id: 'p-1',
  title: '少量配送',
  financeEffect: costReduction,
  executionHumanInvestments: [
    { id: 'ac16', type: 'OTHER', name: '外注費（検証用）', amount: 1_000_000, spend: { category: 'OPEX', recurrence: 'ONE_TIME', amountBasis: 'TOTAL', paymentYm: '2026-10', opexRelation: 'NOT_IN_PLAN' } },
    { id: 'cap1', type: 'OTHER', name: '検査装置', amount: 3_000_000, spend: { category: 'CAPEX', recurrence: 'ONE_TIME', amountBasis: 'TOTAL', paymentYm: '2026-09' } },
  ],
  ...overrides,
});

describe('財務項目の一覧', () => {
  it('STAGE4の財務効果とOPEX明細を、安定キーつきで並べる（CAPEXは対象外）', () => {
    const items = financeActualItemsOf(project({ financeEffects: [revenue] }) as never);
    expect(items.map((i) => [i.itemKey, i.kind, i.recordable])).toEqual([
      ['EFFECT:REVENUE_UP', 'REVENUE_UP', true],
      ['EFFECT:COST_REDUCTION', 'COST_REDUCTION', true],
      ['OPEX:ac16', 'OPEX', true],
    ]);
    const cost = items.find((i) => i.kind === 'COST_REDUCTION');
    expect(cost).toMatchObject({ planText: '年額 5,000,000円', periodText: '2026-04 〜 終了未設定' });
    const opex = items.find((i) => i.kind === 'OPEX');
    expect(opex).toMatchObject({ label: '外注費（検証用）', planText: '一時支出 1,000,000円', periodText: '支出年月 2026-10', statusText: '営業利益に含まれない' });
  });

  it('同じ種類の財務効果が複数ある項目は、記録先を特定できないため記録できない', () => {
    const items = financeActualItemsOf(project({ financeEffects: [{ ...costReduction, directAmountYen: 1 }] }) as never);
    const cost = items.find((i) => i.kind === 'COST_REDUCTION');
    expect(cost).toMatchObject({ recordable: false });
    expect(cost?.unrecordableReason).toContain('複数');
  });

  it('識別子のないOPEX明細は記録できない（推測で対応づけない）', () => {
    const items = financeActualItemsOf(
      project({ executionHumanInvestments: [{ id: '', type: 'OTHER', name: '外注', amount: 1, spend: { category: 'OPEX' } }] }) as never,
    );
    expect(items).toHaveLength(2);
    expect(items.find((i) => i.kind === 'OPEX')).toMatchObject({ recordable: false, itemKey: '' });
  });

  it('財務効果が無い案件では、実績の対象が無い', () => {
    expect(financeActualItemsOf(project({ financeEffect: undefined, executionHumanInvestments: [] }) as never)).toEqual([]);
  });

  it('登録済みの実績は、対象の財務項目ごとに年月の昇順で並ぶ', () => {
    const actuals: FinanceActualEntry[] = [
      { itemKey: 'EFFECT:COST_REDUCTION', ym: '2026-12', amountYen: 400_000, recordedAt: 'b', createdAt: 'b' },
      { itemKey: 'EFFECT:COST_REDUCTION', ym: '2026-10', amountYen: 0, recordedAt: 'a', createdAt: 'a' },
      { itemKey: 'OPEX:ac16', ym: '2026-10', amountYen: 900_000, recordedAt: 'c', createdAt: 'c' },
    ];
    const items = financeActualItemsOf(project({ financeActuals: actuals }) as never);
    expect(items.find((i) => i.kind === 'COST_REDUCTION')?.actuals.map((a) => a.ym)).toEqual(['2026-10', '2026-12']);
    expect(items.find((i) => i.kind === 'OPEX')?.actuals).toHaveLength(1);
  });
});

describe('実績の入力検証', () => {
  it('0円は「0円の実績」として有効。空欄・負数・小数・不正な年月は保存しない', () => {
    expect(parseFinanceActualInput({ ym: '2026-10', amount: '0', note: '' })).toEqual({ ok: true, ym: '2026-10', amountYen: 0 });
    expect(parseFinanceActualInput({ ym: '2026-10', amount: '1,200,000', note: ' 請求書 ' })).toEqual({ ok: true, ym: '2026-10', amountYen: 1_200_000, note: '請求書' });
    expect(parseFinanceActualInput({ ym: '2026-10', amount: '', note: '' })).toMatchObject({ ok: false });
    expect(parseFinanceActualInput({ ym: '2026-10', amount: '-1', note: '' })).toMatchObject({ ok: false });
    expect(parseFinanceActualInput({ ym: '2026-10', amount: '1.5', note: '' })).toMatchObject({ ok: false });
    expect(parseFinanceActualInput({ ym: '2026-13', amount: '1', note: '' })).toMatchObject({ ok: false });
    expect(parseFinanceActualInput({ ym: '2026-10', amount: '1', note: 'x'.repeat(301) })).toMatchObject({ ok: false });
  });
});

describe('実績の重複防止と更新', () => {
  it('同じ財務項目・同じ年月の再登録は1件に置き換え、初回登録日時は残す', () => {
    const first = upsertFinanceActual(undefined, { itemKey: 'OPEX:ac16', ym: '2026-10', amountYen: 1_050_000, nowIso: '2026-11-17T01:00:00.000Z' });
    const second = upsertFinanceActual(first, { itemKey: 'OPEX:ac16', ym: '2026-10', amountYen: 1_000_000, note: '確定', nowIso: '2026-11-17T02:00:00.000Z' });
    expect(second).toHaveLength(1);
    expect(second[0]).toEqual({
      itemKey: 'OPEX:ac16',
      ym: '2026-10',
      amountYen: 1_000_000,
      note: '確定',
      recordedAt: '2026-11-17T02:00:00.000Z',
      createdAt: '2026-11-17T01:00:00.000Z',
    });
  });

  it('別の年月・別の財務項目は別の実績として並ぶ（配列の位置に依存しない）', () => {
    let list = upsertFinanceActual(undefined, { itemKey: 'OPEX:ac16', ym: '2026-10', amountYen: 1, nowIso: 't' });
    list = upsertFinanceActual(list, { itemKey: 'OPEX:ac16', ym: '2026-11', amountYen: 2, nowIso: 't' });
    list = upsertFinanceActual(list, { itemKey: 'EFFECT:COST_REDUCTION', ym: '2026-10', amountYen: 3, nowIso: 't' });
    expect(list.map((a) => `${a.itemKey}|${a.ym}|${a.amountYen}`)).toEqual([
      'OPEX:ac16|2026-10|1',
      'OPEX:ac16|2026-11|2',
      'EFFECT:COST_REDUCTION|2026-10|3',
    ]);
  });
});

describe('実績の部分更新（対象の案件だけを書き換える）', () => {
  const departments = () => [
    { id: 'd1', name: '宅配', projects: [project({ okrsV2: [{ id: 'kr1', label: 'KR', unit: '件', target: 10, actual: { value: 4, asOf: '2026-10', recordedAt: 'x' } }] })] },
    { id: 'd2', name: '新聞', projects: [project({ id: 'p-2', title: '別件' })] },
  ];

  it('対象の案件に実績を足し、計画・KR・他の案件は変えない', () => {
    const before = departments();
    const result = applyFinanceActualToDepartments(before, {
      projectId: 'p-1',
      itemKey: 'OPEX:ac16',
      ym: '2026-10',
      amountYen: 900_000,
      note: '請求書',
      nowIso: '2026-11-17T03:00:00.000Z',
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const after = result.departments as Array<{ projects: Array<Record<string, unknown>> }>;
    const target = after[0].projects[0] as { financeActuals: FinanceActualEntry[]; financeEffect: unknown; executionHumanInvestments: unknown; okrsV2: unknown };
    expect(target.financeActuals).toEqual([
      { itemKey: 'OPEX:ac16', ym: '2026-10', amountYen: 900_000, note: '請求書', recordedAt: '2026-11-17T03:00:00.000Z', createdAt: '2026-11-17T03:00:00.000Z' },
    ]);
    const original = before[0] as { projects: Array<Record<string, unknown>> };
    expect(target.financeEffect).toEqual(original.projects[0].financeEffect);
    expect(target.executionHumanInvestments).toEqual(original.projects[0].executionHumanInvestments);
    expect(target.okrsV2).toEqual(original.projects[0].okrsV2);
    expect(after[1].projects[0]).toEqual(before[1].projects[0]);
  });

  it('案件が見つからない・同じIDが複数ある場合は書かない', () => {
    expect(
      applyFinanceActualToDepartments(departments(), { projectId: 'nope', itemKey: 'OPEX:ac16', ym: '2026-10', amountYen: 1, nowIso: 't' }),
    ).toEqual({ ok: false, reason: 'project-not-found' });
    const dup = [{ id: 'd1', projects: [project(), project()] }];
    expect(applyFinanceActualToDepartments(dup, { projectId: 'p-1', itemKey: 'OPEX:ac16', ym: '2026-10', amountYen: 1, nowIso: 't' })).toEqual({
      ok: false,
      reason: 'project-ambiguous',
    });
  });
});
