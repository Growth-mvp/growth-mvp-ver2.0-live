import { buildBusinessPortfolio, isGeneratedPortfolio } from './businessPortfolio';

const SEGMENTS = [
  { id: 'seg-1', name: '製造事業' },
  { id: 'seg-2', name: 'フィットネス' },
];

describe('事業ポートフォリオの生成（事業セグメントから）', () => {
  it('事業ごとに単位を作り、単位の ID は事業名にする', () => {
    const p = buildBusinessPortfolio({ segments: SEGMENTS });
    expect(p?.units.map((u) => [u.id, u.name])).toEqual([
      ['製造事業', '製造事業'],
      ['フィットネス', 'フィットネス'],
    ]);
    expect(p).toMatchObject({ unitType: 'business', periodLabel: 'FY2025', currency: 'JPY' });
  });

  it('事業がなければ、ポートフォリオは作らない', () => {
    expect(buildBusinessPortfolio({ segments: [] })).toBeNull();
  });

  it('分析の値がない事業は、既存の値を残す（他の事業の値を失わない）', () => {
    const fallback = buildBusinessPortfolio({ segments: SEGMENTS });
    const withValues = fallback && {
      ...fallback,
      units: fallback.units.map((u) => (u.name === '製造事業' ? { ...u, growthRate: 7, profitMargin: 12 } : u)),
    };
    const p = buildBusinessPortfolio({ segments: [SEGMENTS[0]], fallback: withValues });
    expect(p?.units[0]).toMatchObject({ name: '製造事業', growthRate: 7, profitMargin: 12 });
  });
});

describe('自動生成のポートフォリオかどうかの判定', () => {
  it('生成処理の出力そのものは、自動生成と判定する', () => {
    const p = buildBusinessPortfolio({ segments: SEGMENTS });
    expect(isGeneratedPortfolio(p, ['製造事業', 'フィットネス'])).toBe(true);
  });

  it('生成の設定値と違うもの、事業に対応しない単位は、自動生成と判定しない（安全側）', () => {
    const p = buildBusinessPortfolio({ segments: SEGMENTS });
    expect(isGeneratedPortfolio({ ...p!, threshold: { growthBaseline: 5, profitBaseline: 0 } }, ['製造事業', 'フィットネス'])).toBe(false);
    expect(isGeneratedPortfolio({ ...p!, units: [{ ...p!.units[0], name: '別名', id: '別名' }] }, ['製造事業', 'フィットネス'])).toBe(false);
  });
});
