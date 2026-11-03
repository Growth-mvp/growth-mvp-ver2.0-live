import {
  computeFinanceEffect,
  findFinanceEffectOverlapCandidates,
  financeEffectViewModel,
  normalizeFinanceEffect,
} from './financeEffect';
import type { FinanceEffect } from '@/types/strategy';

const M = 1_000_000;

const base = (o: Partial<FinanceEffect>): FinanceEffect => ({
  kind: 'COST_REDUCTION',
  method: 'QUANTITY_UNIT_PRICE',
  quantity: 1000,
  unitPriceYen: 30_000,
  amountBasis: 'ANNUAL',
  startYm: '2027-04',
  sourceNote: '製造実績（架空）',
  source: 'USER_INPUT',
  confirmed: false,
  ...o,
});

describe('財務効果の算定：方法と金額の単位', () => {
  it('数量×単価は、年額として年額の効果になる（原価削減は営業利益へプラス）', () => {
    const r = computeFinanceEffect(base({}));
    expect(r.status).toBe('DRAFT');
    expect(r.annualYen).toBe(30 * M);
    expect(r.annualOperatingEffectYen).toBe(30 * M);
    expect(r.annualRevenueYen).toBeUndefined();
  });

  it('月額は12倍して年額になる', () => {
    const r = computeFinanceEffect(base({ amountBasis: 'MONTHLY', quantity: 1, unitPriceYen: 2 * M }));
    expect(r.monthlyYen).toBe(2 * M);
    expect(r.annualYen).toBe(24 * M);
  });

  it('一回限りは総額として扱い、年額は作らない（費用は符号が負）', () => {
    const r = computeFinanceEffect(
      base({ kind: 'COST_INCREASE', method: 'DIRECT_AMOUNT', directAmountYen: 18 * M, amountBasis: 'TOTAL', endYm: undefined }),
    );
    expect(r.totalYen).toBe(18 * M);
    expect(r.annualYen).toBeUndefined();
    expect(r.oneTimeOperatingEffectYen).toBe(-18 * M);
  });

  it('商談数×受注率×平均受注額は、売上増加の年額になり、参考原価を別に示す', () => {
    const r = computeFinanceEffect(
      base({
        kind: 'REVENUE_UP',
        method: 'FUNNEL',
        meetingsPerPeriod: 10,
        winRatePct: 20,
        averageDealYen: 20 * M,
        amountBasis: 'MONTHLY',
        costRatePct: 40,
      }),
    );
    expect(r.status).toBe('DRAFT');
    expect(r.monthlyYen).toBe(40 * M);
    expect(r.annualRevenueYen).toBe(480 * M);
    expect(r.referenceCostYen).toBe(192 * M);
    expect(r.annualOperatingEffectYen).toBeUndefined();
  });

  it('売上増加以外の施策には商談型の算定方法を使えない', () => {
    const r = computeFinanceEffect(base({ kind: 'COST_REDUCTION', method: 'FUNNEL', meetingsPerPeriod: 1, winRatePct: 1, averageDealYen: 1 }));
    expect(r.status).toBe('INCOMPLETE');
    expect(r.missing.join()).toContain('売上増加の施策にのみ');
  });
});

describe('入力不足・不正は未算定にする', () => {
  it('単位が不明なら金額を返さない', () => {
    const r = computeFinanceEffect(base({ amountBasis: undefined }));
    expect(r.status).toBe('INCOMPLETE');
    expect(r.missing).toEqual(['金額の単位（一回限り・月額・年額）']);
    expect(r.annualYen).toBeUndefined();
  });

  it('開始時期と算定根拠が無いと未算定', () => {
    const r = computeFinanceEffect(base({ startYm: undefined, sourceNote: '  ' }));
    expect(r.status).toBe('INCOMPLETE');
    expect(r.missing).toEqual(expect.arrayContaining(['効果の開始時期', '算定根拠・出所']));
  });

  it('負の数量や受注率100%超は不正として未算定', () => {
    expect(computeFinanceEffect(base({ quantity: -1 })).status).toBe('INCOMPLETE');
    expect(
      computeFinanceEffect(base({ kind: 'REVENUE_UP', method: 'FUNNEL', meetingsPerPeriod: 1, winRatePct: 150, averageDealYen: 1 })).status,
    ).toBe('INCOMPLETE');
  });

  it('終了月が開始月より前なら未算定', () => {
    const r = computeFinanceEffect(base({ endYm: '2027-01' }));
    expect(r.missing.join()).toContain('終了時期');
  });

  it('効果の種類が未設定、または財務換算しない施策は、金額を持たない', () => {
    expect(computeFinanceEffect(undefined).status).toBe('NOT_SET');
    expect(computeFinanceEffect({ kind: 'NOT_FINANCIAL', source: 'USER_INPUT', confirmed: false }).status).toBe('NOT_FINANCIAL');
  });
});

describe('AI提案と利用者確認済みの区別', () => {
  it('利用者が確認するまで、確認済みにはならない（AI提案でも同じ計算）', () => {
    expect(computeFinanceEffect(base({ source: 'AI_PROPOSED', confirmed: false })).status).toBe('DRAFT');
    expect(computeFinanceEffect(base({ source: 'AI_PROPOSED', confirmed: true })).status).toBe('CONFIRMED');
  });

  it('表示の状態は、未確定・確認済み・未算定で異なる', () => {
    expect(financeEffectViewModel(base({ confirmed: false })).statusLabel).toBe('未確定（確認待ち）');
    expect(financeEffectViewModel(base({ confirmed: true })).statusLabel).toBe('利用者が確認済み');
    expect(financeEffectViewModel(base({ amountBasis: undefined })).statusLabel).toBe('未算定（入力不足）');
    expect(financeEffectViewModel(undefined).statusLabel).toBe('未設定（任意）');
  });

  it('どの状態でもSTAGE6へは反映されない旨を添える', () => {
    expect(financeEffectViewModel(base({ confirmed: true })).notice).toContain('STAGE6');
  });
});

describe('他施策との重複候補', () => {
  const proj = (title: string, financeEffect?: FinanceEffect) => ({ title, financeEffect });
  const departments = [
    {
      name: '製造部',
      projects: [
        proj('工程A', base({ scopeNote: '第1工場', startYm: '2027-04' })),
        proj('工程B', base({ scopeNote: '第1工場', startYm: '2028-01' })),
        proj('工程C', base({ scopeNote: '第2工場', startYm: '2027-06', endYm: '2027-12', method: 'DIRECT_AMOUNT', directAmountYen: M })),
        proj('工程D', base({ kind: 'REVENUE_UP', method: 'FUNNEL', scopeNote: '第1工場', meetingsPerPeriod: 1, winRatePct: 1, averageDealYen: 1 })),
        proj('工程E', base({ method: 'DIRECT_AMOUNT', directAmountYen: M, scopeNote: '第3工場', startYm: '2027-09' })),
        proj('工程F', base({ method: 'DIRECT_AMOUNT', directAmountYen: M, scopeNote: '第3工場', startYm: '2028-01' })),
      ],
    },
    { name: '営業部', projects: [proj('販売X', base({ scopeNote: '第1工場', startYm: '2027-05' }))] },
  ];

  it('同じ種類で対象範囲が同じ施策は、重複候補として挙げる（他部門も対象）', () => {
    const c = findFinanceEffectOverlapCandidates(departments, 0, 0);
    expect(c).toEqual(['製造部 / 工程B', '営業部 / 販売X']);
  });

  it('対象範囲が違っても、同じ種類・同じ方法で期間が重なれば候補。重ならなければ候補にしない', () => {
    const c = findFinanceEffectOverlapCandidates(departments, 0, 2);
    expect(c).toEqual(['製造部 / 工程E']);
  });

  it('種類が違う施策は候補にしない。自動では除外しない（候補を返すだけ）', () => {
    const c = findFinanceEffectOverlapCandidates(departments, 0, 3);
    expect(c).toEqual([]);
  });

  it('自分に財務効果が無ければ候補は空', () => {
    expect(findFinanceEffectOverlapCandidates([{ name: 'x', projects: [proj('a')] }], 0, 0)).toEqual([]);
  });
});

describe('既存データの読み込み（後方互換）', () => {
  it('未設定の旧データは未設定として読める', () => {
    expect(normalizeFinanceEffect(undefined)).toBeUndefined();
    expect(normalizeFinanceEffect(null)).toBeUndefined();
    expect(normalizeFinanceEffect('x')).toBeUndefined();
    expect(normalizeFinanceEffect({ kind: 'UNKNOWN' })).toBeUndefined();
  });

  it('不正な項目だけ捨て、有効な項目は保つ。確認フラグは真のときだけ真', () => {
    const n = normalizeFinanceEffect({
      kind: 'COST_REDUCTION',
      method: 'QUANTITY_UNIT_PRICE',
      quantity: '千',
      unitPriceYen: 5,
      amountBasis: 'WEEKLY',
      startYm: '2027/04',
      sourceNote: '根拠',
      source: 'HUMAN',
      confirmed: 'yes',
    });
    expect(n).toEqual({ kind: 'COST_REDUCTION', method: 'QUANTITY_UNIT_PRICE', unitPriceYen: 5, sourceNote: '根拠', source: 'USER_INPUT', confirmed: false });
  });
});
