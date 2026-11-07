import { MAIN_PROJECT_LIMIT, selectMainProjects } from './projectSelection';

type Row = { name: string; revenueYen: number | null; investmentYen: number };

describe('主要施策の選択', () => {
  it('売上寄与の大きい施策と投資額の大きい施策の両方を含め、売上寄与だけで決めない', () => {
    const rows: Row[] = [
      { name: 'R1', revenueYen: 100, investmentYen: 0 },
      { name: 'R2', revenueYen: 90, investmentYen: 0 },
      { name: 'R3', revenueYen: 80, investmentYen: 0 },
      { name: 'R4', revenueYen: 70, investmentYen: 0 },
      { name: 'R5', revenueYen: 60, investmentYen: 0 },
      { name: 'I1', revenueYen: null, investmentYen: 500 },
    ];
    const picked = selectMainProjects(rows).map((r) => r.name);
    expect(picked).toEqual(['R1', 'R2', 'R3', 'R4', 'I1']);
  });

  it('元の並び順を保ち、上限を超えない', () => {
    const rows: Row[] = Array.from({ length: 20 }, (_, i) => ({
      name: `P${i + 1}`,
      revenueYen: 20 - i,
      investmentYen: i % 2 === 0 ? (i + 1) * 10 : 0,
    }));
    const picked = selectMainProjects(rows);
    expect(picked.length).toBeLessThanOrEqual(MAIN_PROJECT_LIMIT);
    const names = picked.map((r) => r.name);
    expect(names).toEqual([...names].sort((a, b) => Number(a.slice(1)) - Number(b.slice(1))));
  });

  it('金額が無い施策だけなら何も選ばない', () => {
    expect(selectMainProjects([{ name: 'X', revenueYen: null, investmentYen: 0 }])).toEqual([]);
  });
});
