import { normalizeStrategyData } from '@/utils/supabase/normalize';
import { computeFinanceEffect } from './financeEffect';

const M = 1_000_000;

const financeEffect = {
  kind: 'REVENUE_UP',
  method: 'FUNNEL',
  meetingsPerPeriod: 10,
  winRatePct: 20,
  averageDealYen: 20 * M,
  amountBasis: 'MONTHLY',
  startYm: '2027-04',
  endYm: '2028-03',
  sourceNote: '営業実績の架空値',
  scopeNote: '首都圏',
  source: 'USER_INPUT',
  confirmed: true,
  confirmedAt: '2026-11-01T00:00:00.000Z',
  overlapNote: '既存の法人顧客と重複しない想定',
};

function strategyWith(project: Record<string, unknown>) {
  return {
    departments: [{ id: 'd1', name: '営業部', projects: [{ title: '新規開拓', ...project }] }],
  };
}

describe('財務効果の保存・再読込（新規データ）', () => {
  it('保存した形のまま再読込しても、意味（金額・時期・確認状態）が変わらない', () => {
    const saved = JSON.parse(JSON.stringify(strategyWith({ financeEffect })));
    const loaded = normalizeStrategyData(saved) as any;
    const p = loaded.departments[0].projects[0];
    expect(p.financeEffect).toEqual(financeEffect);

    const again = normalizeStrategyData(JSON.parse(JSON.stringify(loaded))) as any;
    expect(again.departments[0].projects[0].financeEffect).toEqual(financeEffect);
  });

  it('再読込後も、同じ算定結果になる（年額 480百万円）', () => {
    const loaded = normalizeStrategyData(JSON.parse(JSON.stringify(strategyWith({ financeEffect })))) as any;
    const r = computeFinanceEffect(loaded.departments[0].projects[0].financeEffect);
    expect(r.status).toBe('CONFIRMED');
    expect(r.annualRevenueYen).toBe(480 * M);
  });
});

describe('旧データとの互換性', () => {
  it('財務効果が未設定の旧データは、そのまま読め、未設定として扱われる', () => {
    const legacy = strategyWith({ impactRevenueMJPY: 120, impactAssumptions: { targetCustomers: 30, conversionRatePct: 20, averageDealMJPY: 20 } });
    const loaded = normalizeStrategyData(JSON.parse(JSON.stringify(legacy))) as any;
    const p = loaded.departments[0].projects[0];
    expect(p.financeEffect).toBeUndefined();
    expect(computeFinanceEffect(p.financeEffect).status).toBe('NOT_SET');
  });

  it('既存の効果額・前提は、読み込みで書き換えも削除もされない', () => {
    const legacy = strategyWith({
      impactRevenueMJPY: 120,
      impactOpIncomeMJPY: 5,
      impactAssumptions: { targetCustomers: 30, conversionRatePct: 20, averageDealMJPY: 20 },
    });
    const loaded = normalizeStrategyData(JSON.parse(JSON.stringify(legacy))) as any;
    const p = loaded.departments[0].projects[0];
    expect(p.impactRevenueMJPY).toBe(120);
    expect(p.impactOpIncomeMJPY).toBe(5);
    expect(p.impactAssumptions).toEqual({ targetCustomers: 30, conversionRatePct: 20, averageDealMJPY: 20 });
  });

  it('壊れた財務効果の値があっても、読み込みは失敗せず、未算定として扱われる', () => {
    const broken = strategyWith({ financeEffect: { kind: 'REVENUE_UP', method: 'FUNNEL', meetingsPerPeriod: 'many' } });
    const loaded = normalizeStrategyData(JSON.parse(JSON.stringify(broken))) as any;
    const r = computeFinanceEffect(loaded.departments[0].projects[0].financeEffect);
    expect(r.status).toBe('INCOMPLETE');
    expect(r.missing).toEqual(expect.arrayContaining(['商談数', '受注率（0〜100%）', '平均受注額']));
  });
});
