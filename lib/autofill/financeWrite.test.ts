import { combineFinance, splitFinanceWrite } from './financeWrite';
import type { FilingApplyPlan } from './filingCandidates';

const emptyPlan = (over: Partial<FilingApplyPlan>): FilingApplyPlan => ({
  segmentsPatch: null,
  segmentsSkipped: null,
  profilePatch: {},
  profileApplied: [],
  profileSkipped: [],
  financeRows: [],
  financeApplied: [],
  financeSkipped: [],
  ...over,
});

describe('財務の反映：既存の行を壊さず、計画の項目だけを変える', () => {
  it('年度ごとに損益と貸借を1つにまとめて、計画の入力に使う', () => {
    const rows = combineFinance([{ year: 2026, revenue: 1 }], [{ year: 2026, netAssets: 2 }, { year: 2025, totalAssets: 3 }]);
    expect(rows).toEqual([
      expect.objectContaining({ year: 2025, totalAssets: 3 }),
      expect.objectContaining({ year: 2026, revenue: 1, netAssets: 2 }),
    ]);
  });

  it('計画が指定した年度と項目だけを、既存の行に書き込む（他の項目・年度は変えない）', () => {
    const pl = [{ year: 2026, revenue: 1, grossProfit: 77 }];
    const bs = [{ year: 2026, totalAssets: 5 }];
    const plan = emptyPlan({
      financeRows: [{ year: 2026, revenue: 100, netIncome: -9, totalAssets: 500, netAssets: 300 }],
      financeApplied: [{ year: 2026, keys: ['netIncome', 'netAssets'] }],
    });
    const out = splitFinanceWrite(plan, pl, bs);
    expect(out.pl).toEqual([{ year: 2026, revenue: 1, grossProfit: 77, netIncome: -9 }]);
    expect(out.bs).toEqual([{ year: 2026, totalAssets: 5, netAssets: 300 }]);
  });

  it('計画の変更がない配列は、書き込まない（null）', () => {
    const out = splitFinanceWrite(emptyPlan({}), [{ year: 2026, revenue: 1 }], []);
    expect(out).toEqual({ pl: null, bs: null });
  });

  it('行が無い年度は、新しい行として追加する（年度順）', () => {
    const plan = emptyPlan({
      financeRows: [{ year: 2022, revenue: 10 }],
      financeApplied: [{ year: 2022, keys: ['revenue'] }],
    });
    const out = splitFinanceWrite(plan, [{ year: 2026, revenue: 1 }], []);
    expect(out.pl).toEqual([{ year: 2022, revenue: 10 }, { year: 2026, revenue: 1 }]);
  });
});
