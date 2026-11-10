import { estimateProjectImpact, type EstimateRow, type ImpactEstimate } from './impactEstimate';

const RATIONALE =
  '対象10社のうち30%が受注し、平均受注額を20百万円と想定して売上増分を60百万円と試算。粗利率25%による粗利15百万円から案件対応の追加費用6百万円を差し引き、営業利益増分を9百万円と見込む。';

function projectOf(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    role: 'COST',
    impactAssumptions: { targetCustomers: 10, conversionRatePct: 30, averageDealMJPY: 20, currentCostMJPY: 200, reductionRatePct: 20 },
    impactRevenueMJPY: 60,
    impactOpIncomeMJPY: 40,
    impactRationale: RATIONALE,
    okrsV2: [{ label: '用途別案件の粗利率', target: 20, unit: '%' }],
    ...over,
  };
}

function calc(e: ImpactEstimate) {
  if (e.status !== 'CALCULATED') throw new Error('not calculated');
  return e;
}
const rowOf = (e: ImpactEstimate, label: string): EstimateRow => {
  const r = calc(e).rows.find((x) => x.label.startsWith(label));
  if (!r) throw new Error(`row not found: ${label}`);
  return r;
};

describe('estimateProjectImpact（STAGE3の前提からの参考試算）', () => {
  it('売上は対象数×受注率×平均受注額で計算し、対象区分と年度が未確認であることを示す', () => {
    const e = calc(estimateProjectImpact(projectOf()));
    const r = rowOf(e, '売上');
    expect(r.valueMJPY).toBe(60);
    expect(r.formula).toBe('10社 × 30% × 20百万円 = 60百万円');
    expect(r.note).toContain('対象区分（有償開発か量産か）は未確認');
    expect(e.warnings).toContain('売上の対象区分（有償開発か量産か）は未確認');
    expect(e.warnings).toContain('計上年度は未確認のため、年度別の業績としては表示しない');
  });

  it('売上がSTAGE3の目標と違えば、その旨を注意として示す', () => {
    const e = calc(estimateProjectImpact(projectOf({ impactRevenueMJPY: 50 })));
    expect(rowOf(e, '売上').check).toBe('UNCONFIRMED');
    expect(e.warnings.some((w) => w.includes('一致しない'))).toBe(true);
  });

  it('粗利益は、KPI目標値の粗利率20%で既存データから算出し、粗利益であって営業利益ではないと明示する', () => {
    const e = calc(estimateProjectImpact(projectOf()));
    const gp = rowOf(e, '粗利益（参考試算');
    expect(gp.label).toBe('粗利益（参考試算・粗利率20%）');
    expect(gp.valueMJPY).toBe(12);
    expect(gp.formula).toBe('60百万円 × 20% = 12百万円');
    expect(gp.source).toContain('KPI目標値');
    expect(gp.note).toContain('営業利益ではない');
  });

  it('粗利率25%の値は、別の入力値に基づく比較値として明示する', () => {
    const e = calc(estimateProjectImpact(projectOf()));
    const cmp = rowOf(e, '粗利益（比較値');
    expect(cmp.label).toBe('粗利益（比較値・粗利率25%）');
    expect(cmp.valueMJPY).toBe(15);
    expect(cmp.note).toContain('別の入力値に基づく比較値');
    expect(e.warnings.some((w) => w.includes('粗利率が一致しない'))).toBe(true);
  });

  it('追加費用控除後は、6〜9を参考値として示し、確定した営業利益とは表示しない', () => {
    const e = calc(estimateProjectImpact(projectOf()));
    const r = rowOf(e, '営業利益の参考値');
    expect(r.valueMJPY).toBeNull();
    expect(r.valueText).toBe('6〜9');
    expect(r.formula).toContain('12 − 6 = 6');
    expect(r.formula).toContain('15 − 6 = 9');
    expect(r.label).toContain('参考値');
    expect(r.note).toContain('確定した営業利益としては扱わない');
  });

  it('STAGE3の営業利益（費用削減の式）40百万円は、どの行にも数値として出さない', () => {
    const e = calc(estimateProjectImpact(projectOf()));
    expect(JSON.stringify(e)).not.toContain('40');
    expect(e.rows.some((r) => r.label.includes('費用削減'))).toBe(false);
    expect(e.warnings.some((w) => w.includes('利益貢献として対応を確認できない'))).toBe(true);
  });

  it('追加費用の記載が無ければ、営業利益の参考値は作らない', () => {
    const e = calc(estimateProjectImpact(projectOf({ impactRationale: '粗利率20%で粗利を見込む。' })));
    expect(e.rows.some((r) => r.label.startsWith('営業利益の参考値'))).toBe(false);
    expect(rowOf(e, '粗利益（参考試算').valueMJPY).toBe(12);
  });

  it('粗利率の前提が本文にだけあれば、それを使い、比較値は作らない', () => {
    const e = calc(estimateProjectImpact(projectOf({ okrsV2: [] })));
    const gp = rowOf(e, '粗利益（参考試算');
    expect(gp.label).toBe('粗利益（参考試算・粗利率25%）');
    expect(gp.valueMJPY).toBe(15);
    expect(gp.source).toContain('本文');
    expect(e.rows.some((r) => r.label.includes('比較値'))).toBe(false);
  });

  it('売上の前提が無い案件は、未算定として返す（数値を作らない）', () => {
    expect(estimateProjectImpact(projectOf({ impactAssumptions: null })).status).toBe('NOT_CALCULATED');
    expect(estimateProjectImpact(projectOf({ impactAssumptions: { currentCostMJPY: 200, reductionRatePct: 20 } })).status).toBe('NOT_CALCULATED');
  });

  it('計算は入力の案件を変えない', () => {
    const p = projectOf();
    const before = JSON.parse(JSON.stringify(p));
    estimateProjectImpact(p);
    expect(p).toEqual(before);
  });
});
