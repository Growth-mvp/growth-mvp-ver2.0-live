import { computeFinanceEffect } from '@/lib/financeEffect';
import { COMMERCIAL_GOLDEN_DRAFT } from '@/eval/plan/fixtures/commercial.golden';
import { estimateFinanceItem } from './finance';
import { PlanDraftSchema, type FinanceInput, type PlanFinanceItem } from './types';

const input = (role: FinanceInput['role'], value: number | null, basis: FinanceInput['basis'] = 'HYPOTHESIS'): FinanceInput => ({
  role,
  label: role,
  value,
  unit: '件',
  basis,
  confirmState: 'AI_PROPOSED',
  sourceRefs: [],
});

const item = (over: Partial<PlanFinanceItem>): PlanFinanceItem => ({
  key: 'F9',
  label: 'テスト',
  kind: 'REVENUE_UP',
  method: 'FUNNEL',
  inputs: [],
  amountBasis: 'TOTAL',
  startYm: '2027-02',
  endYm: null,
  sourceNote: 'テスト用の算定根拠',
  basedOnKpiKeys: [],
  freeNote: null,
  ...over,
});

describe('estimateFinanceItem（経路Bの算定式を読み取り専用で利用）', () => {
  it('役割が揃えば、AI試算として計算し、確定はしない', () => {
    const r = estimateFinanceItem(
      item({ inputs: [input('MEETINGS', 10), input('WIN_RATE', 30), input('AVG_DEAL', 5_000_000)] })
    );
    expect(r.status).toBe('AI_ESTIMATE_UNCONFIRMED');
    expect(r.amountYen).toBe(15_000_000);
    expect(r.formula).toContain('10件');
  });

  it('必要な役割が無いと金額を作らず、不足を名前で示す', () => {
    const r = estimateFinanceItem(item({ inputs: [input('MEETINGS', 10)] }));
    expect(r.status).toBe('INPUT_MISSING');
    expect(r.amountYen).toBeNull();
    expect(r.missing).toEqual(expect.arrayContaining(['受注率', '平均受注額']));
  });

  it('値が null の入力は計算に使わない', () => {
    const r = estimateFinanceItem(
      item({ inputs: [input('MEETINGS', 10), input('WIN_RATE', null, 'UNCONFIRMED'), input('AVG_DEAL', 5_000_000)] })
    );
    expect(r.status).toBe('INPUT_MISSING');
    expect(r.missing).toEqual(['受注率']);
  });

  it('根拠区分が UNCONFIRMED の値は、値があっても計算に使わない', () => {
    const r = estimateFinanceItem(
      item({ inputs: [input('MEETINGS', 10), input('WIN_RATE', 30, 'UNCONFIRMED'), input('AVG_DEAL', 5_000_000)] })
    );
    expect(r.status).toBe('INPUT_MISSING');
  });

  it('自由項目（FREE）は算定式に入らず、金額を作らない', () => {
    const r = estimateFinanceItem(
      item({ method: 'FREE', freeNote: '歩留まりの改善額。算定の考え方は未確定', inputs: [input('OTHER', 1_000_000)] })
    );
    expect(r.status).toBe('NOT_ESTIMATED');
    expect(r.amountYen).toBeNull();
  });

  it('算定式に入らない役割（転換率など）は、方式の計算に入らない', () => {
    const r = estimateFinanceItem(
      item({
        method: 'QUANTITY_UNIT_PRICE',
        kind: 'COST_INCREASE',
        inputs: [input('QUANTITY', 4), input('UNIT_PRICE', 250_000), input('CONVERSION_RATE', 50)],
      })
    );
    expect(r.status).toBe('AI_ESTIMATE_UNCONFIRMED');
    expect(r.amountYen).toBe(1_000_000);
  });

  it('どの算定結果も確定（CONFIRMED）にはならない', () => {
    const r = estimateFinanceItem(
      item({ method: 'DIRECT_AMOUNT', kind: 'COST_REDUCTION', inputs: [input('DIRECT_AMOUNT', 2_000_000)] })
    );
    expect(r.status).not.toBe('CONFIRMED');
    expect(r.amountYen).toBe(2_000_000);
  });

  it('AIの出力を確定扱いの算定にそのまま渡すと、既存の算定は確定にならない（経路Bに届かない）', () => {
    const r = computeFinanceEffect({
      kind: 'REVENUE_UP',
      method: 'DIRECT_AMOUNT',
      directAmountYen: 1000000,
      amountBasis: 'TOTAL',
      startYm: '2027-02',
      sourceNote: 'AI出力',
      source: 'AI_PROPOSED',
      confirmed: false,
    });
    expect(r.status).toBe('DRAFT');
  });

  it('期待出力は v2 の形式で検証でき、財務項目に金額や確定の項目名を持たない', () => {
    const draft = PlanDraftSchema.parse(COMMERCIAL_GOLDEN_DRAFT);
    for (const f of draft.section4.financeItems) {
      expect(JSON.stringify(f)).not.toMatch(/amountYen|confirmed\b|financeEffect/);
    }
  });
});
