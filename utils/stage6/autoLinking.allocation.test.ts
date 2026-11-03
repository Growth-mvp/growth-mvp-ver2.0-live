import { allocateGapAcrossProjects, clampExecWeight, inferAutoProjectTargetImpacts } from './autoLinking';

const kr = (kind: string, weight = 1) => ({ id: kind, kind, label: kind, target: 1, unit: '件', scope: 'project', baseKey: 'x', weight });

function run(label: string, base: number, high: number, krs: Record<string, any[]>, weights: Record<string, number> = {}, unit = '百万円') {
  return inferAutoProjectTargetImpacts({
    companyTargets: [{ id: 'T', label, unit, base, low: base, high } as any],
    projectKeys: Object.keys(krs),
    projectKrsMap: new Map(Object.entries(krs)) as any,
    executionWeightsMap: new Map(Object.entries(weights).map(([k, w]) => [k, { weight: w }])),
    scenarioKey: 'high',
  });
}

const sum = (rows: Array<{ delta: number }>) => rows.reduce((s, r) => s + r.delta, 0);

describe('配分：元の金額・配分済み・未配分の照合', () => {
  it('有効な施策がある場合、配分済みと未配分の合計は元の差分に一致する', () => {
    const r = allocateGapAcrossProjects({
      gapYen: 100_000_000,
      relevances: new Map([['A', 1.0], ['B', 0.5]]),
      weights: new Map([['A', 1], ['B', 1]]),
    });
    expect(r.allocatedYen + r.unallocatedYen).toBeCloseTo(100_000_000, 6);
    expect(r.unallocatedYen).toBeCloseTo(0, 6);
    expect(Array.from(r.shares.values()).reduce((s, v) => s + v, 0)).toBeCloseTo(1, 12);
  });

  it('有効な施策がない場合は、全額を未配分とし、均等配分しない', () => {
    const r = allocateGapAcrossProjects({
      gapYen: 100_000_000,
      relevances: new Map([['A', 0], ['B', 0]]),
      weights: new Map(),
    });
    expect(r.shares.size).toBe(0);
    expect(r.allocatedYen).toBe(0);
    expect(r.unallocatedYen).toBe(100_000_000);
  });
});

describe('配分率の合計と分母', () => {
  it('負の関連度の施策が分母に入らず、配分率の合計は100%を超えない', () => {
    const rows = run('営業利益', 100, 120, { 'D::P1::0': [kr('REVENUE')], 'D::P2::1': [kr('INVEST')] });
    expect(rows.map((r) => r.projectId)).toEqual(['D::P1::0']);
    expect(sum(rows)).toBeCloseTo(20, 9);
  });

  it('合計が負になる組み合わせでも、正の関連度の施策の配分は失われない', () => {
    const rows = run('ROIC', 10, 12, { 'D::P1::0': [kr('REVENUE'), kr('INVEST')], 'D::P2::1': [kr('INVEST')] });
    expect(rows.map((r) => r.projectId)).toEqual(['D::P1::0']);
    expect(rows[0].delta).toBeCloseTo(2, 9);
  });

  it('分母が0近辺でも、倍率は発散せず、配分合計は差分を超えない', () => {
    const rows = run('PBR', 1, 2, {
      'D::P1::0': [{ ...kr('REVENUE'), weight: 3 }, { ...kr('INVEST'), weight: 0.5 }],
      'D::P2::1': [kr('INVEST')],
    });
    expect(rows.every((r) => Number.isFinite(r.delta))).toBe(true);
    expect(sum(rows)).toBeLessThanOrEqual(1 + 1e-9);
    expect(sum(rows)).toBeGreaterThanOrEqual(0);
  });

  it('関連性のない施策には、根拠なく配分しない', () => {
    expect(run('売上', 1000, 1100, { 'D::P1::0': [], 'D::P2::1': [] })).toEqual([]);
  });

  it('差分の符号は保たれる（目標が下がる場合は、配分も負になる）', () => {
    const rows = run('売上', 1100, 1000, { 'D::P1::0': [kr('REVENUE')], 'D::P2::1': [kr('REVENUE')] });
    expect(sum(rows)).toBeCloseTo(-100, 9);
    expect(rows.every((r) => r.delta < 0)).toBe(true);
  });
});

describe('実行重みは配分の中で一度だけ働く', () => {
  it('実行重みを変えても、配分の合計は差分のまま（重みで増えない）', () => {
    const same = run('売上', 1000, 1100, { 'D::P1::0': [kr('REVENUE')], 'D::P2::1': [kr('REVENUE')] });
    const weighted = run('売上', 1000, 1100, { 'D::P1::0': [kr('REVENUE')], 'D::P2::1': [kr('REVENUE')] }, { 'D::P1::0': 1.2, 'D::P2::1': 0.7 });
    expect(sum(same)).toBeCloseTo(100, 9);
    expect(sum(weighted)).toBeCloseTo(100, 9);
    const p1 = weighted.find((r) => r.projectId === 'D::P1::0')!.delta;
    const p2 = weighted.find((r) => r.projectId === 'D::P2::1')!.delta;
    expect(p1 / p2).toBeCloseTo(1.2 / 0.7, 9);
  });

  it('実行重みは範囲 0.7〜1.2 に収まり、非有限値は 1 とみなす', () => {
    expect(clampExecWeight(5)).toBe(1.2);
    expect(clampExecWeight(0)).toBe(0.7);
    expect(clampExecWeight(Number.NaN)).toBe(1);
    expect(clampExecWeight(undefined)).toBe(1);
  });
});

describe('金額単位と対象外の目標', () => {
  it('万円の目標では、行の値は目標の単位（万円）のまま出る（差分100万円 → 行の値100）', () => {
    const rows = run('売上', 1000, 1100, { 'D::P::0': [kr('REVENUE')] }, {}, '万円');
    expect(rows).toHaveLength(1);
    expect(rows[0].delta).toBeCloseTo(100, 9);
  });

  it('金額単位でない目標（%・件など）は配分しない', () => {
    expect(run('ROIC', 10, 12, { 'D::P::0': [kr('REVENUE')] }, {}, '%')).toEqual([]);
  });
});
