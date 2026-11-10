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
const row = (e: ImpactEstimate, label: string): EstimateRow => {
  const r = calc(e).rows.find((x) => x.label === label);
  if (!r) throw new Error(`row not found: ${label}`);
  return r;
};

describe('estimateProjectImpact（STAGE3の前提からの業績の参考試算）', () => {
  it('売上は、対象数×受注率×平均受注額で計算し、STAGE3の売上目標と一致することを示す', () => {
    const r = row(estimateProjectImpact(projectOf()), '売上（試算）');
    expect(r.valueMJPY).toBe(60);
    expect(r.formula).toBe('10社 × 30% × 20百万円 = 60百万円');
    expect(r.check).toBe('MATCHES_STAGE3');
    expect(r.note).toContain('未確認');
  });

  it('売上がSTAGE3の目標と違えば、不一致として示す', () => {
    const r = row(estimateProjectImpact(projectOf({ impactRevenueMJPY: 50 })), '売上（試算）');
    expect(r.check).toBe('MISMATCH');
  });

  it('粗利率はKPIの目標値（20%）を基本とし、本文の25%を比較として並べ、不一致を警告する', () => {
    const e = calc(estimateProjectImpact(projectOf()));
    const base = e.rows.find((x) => x.label === '粗利益（試算・前提 粗利率20%）');
    const alt = e.rows.find((x) => x.label === '粗利益（比較・前提 粗利率25%）');
    expect(base?.valueMJPY).toBe(12);
    expect(base?.source).toContain('KPI目標値');
    expect(alt?.valueMJPY).toBe(15);
    expect(alt?.source).toContain('本文');
    expect(e.warnings.some((w) => w.includes('粗利率が一致しない'))).toBe(true);
  });

  it('営業利益（売上経由）は、粗利益から追加費用を一度だけ差し引く', () => {
    const e = calc(estimateProjectImpact(projectOf()));
    expect(e.rows.find((x) => x.label === '営業利益（売上経由・基本）')?.valueMJPY).toBe(6);
    expect(e.rows.find((x) => x.label === '営業利益（売上経由・比較）')?.valueMJPY).toBe(9);
    expect(e.rows.find((x) => x.label === '営業利益（売上経由・基本）')?.note).toContain('二重に控除');
  });

  it('費用削減の営業利益（現行コスト×削減率）は、STAGE3の営業利益40と一致し、売上経由とは合算しない', () => {
    const e = calc(estimateProjectImpact(projectOf()));
    const cost = e.rows.find((x) => x.label === '営業利益（費用削減）');
    expect(cost?.valueMJPY).toBe(40);
    expect(cost?.check).toBe('MATCHES_STAGE3');
    expect(cost?.note).toContain('合算しない');
    expect(e.consistency.some((c) => c.includes('費用削減の式'))).toBe(true);
    expect(e.consistency.some((c) => c.includes('一致しない'))).toBe(true);
  });

  it('本文の営業利益増分9百万円は、粗利率25%の売上経由の計算と一致することを示す', () => {
    const e = calc(estimateProjectImpact(projectOf()));
    expect(e.consistency.some((c) => c.includes('本文の中では整合'))).toBe(true);
  });

  it('役割がCOSTで売上の前提もある場合は、売上の対象を未確認として警告する', () => {
    const e = calc(estimateProjectImpact(projectOf()));
    expect(e.warnings.some((w) => w.includes('役割はCOST'))).toBe(true);
  });

  it('計上年度は記載が無いので、年度別の表示はしないと明示する', () => {
    const e = calc(estimateProjectImpact(projectOf()));
    expect(e.warnings.some((w) => w.includes('年度別'))).toBe(true);
  });

  it('粗利率の前提が本文にだけあれば、それを使い、比較は作らない', () => {
    const e = calc(estimateProjectImpact(projectOf({ okrsV2: [] })));
    const base = e.rows.find((x) => x.label === '粗利益（試算・前提 粗利率25%）');
    expect(base?.valueMJPY).toBe(15);
    expect(base?.source).toContain('本文');
    expect(e.rows.some((x) => x.label.includes('比較・前提'))).toBe(false);
  });

  it('追加費用の記載が無ければ、営業利益は算定しない（未算定）', () => {
    const e = calc(estimateProjectImpact(projectOf({ impactRationale: '粗利率20%で粗利を見込む。' })));
    const op = e.rows.find((x) => x.label === '営業利益（売上経由・基本）');
    expect(op?.valueMJPY).toBeNull();
    expect(op?.check).toBe('NOT_CALCULATED');
  });

  it('計算の前提が無い案件は、未算定として返す（数値を作らない）', () => {
    const r = estimateProjectImpact(projectOf({ impactAssumptions: null }));
    expect(r.status).toBe('NOT_CALCULATED');
  });

  it('計算は入力の案件を変えない', () => {
    const p = projectOf();
    const before = JSON.parse(JSON.stringify(p));
    estimateProjectImpact(p);
    expect(p).toEqual(before);
  });
});
