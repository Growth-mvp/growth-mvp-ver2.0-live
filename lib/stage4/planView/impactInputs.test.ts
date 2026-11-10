import { estimateProjectImpact, hypothesisOf, IMPACT_EDIT_PREFIX, type EstimateRow, type ImpactEstimate } from './impactEstimate';
import { scenarioRowsOf, type ScenarioRecord } from './scenarioRows';

const stage3 = {
  role: 'COST',
  impactAssumptions: { targetCustomers: 10, conversionRatePct: 30, averageDealMJPY: 20, currentCostMJPY: 200, reductionRatePct: 20 },
  impactRevenueMJPY: 60,
  impactOpIncomeMJPY: 40,
  impactRationale: '粗利率25%による粗利15百万円から案件対応の追加費用6百万円を差し引き、営業利益増分を9百万円と見込む。',
  okrsV2: [{ label: '用途別案件の粗利率', target: 20, unit: '%' }],
};

const calc = (e: ImpactEstimate) => {
  if (e.status !== 'CALCULATED') throw new Error('not calculated: ' + e.reason);
  return e;
};
const rowOf = (e: ImpactEstimate, prefix: string): EstimateRow => {
  const r = calc(e).rows.find((x) => x.label.startsWith(prefix));
  if (!r) throw new Error(`row not found: ${prefix}`);
  return r;
};
const paramOf = (e: ImpactEstimate, key: string) => e.params.find((p) => p.key === key)!;

describe('利用者の修正がSTAGE3の前提より優先される', () => {
  it('受注率を修正すると、売上は修正値で計算され、出所は利用者の修正になる', () => {
    const e = estimateProjectImpact(stage3, { edits: { [`${IMPACT_EDIT_PREFIX}rate`]: 35 } });
    expect(rowOf(e, '売上').valueMJPY).toBe(70);
    expect(rowOf(e, '売上').formula).toBe('10社 × 35% × 20百万円 = 70百万円');
    expect(paramOf(e, 'rate')).toMatchObject({ value: 35, source: 'USER' });
    expect(paramOf(e, 'customers')).toMatchObject({ value: 10, source: 'STAGE3' });
  });

  it('修正を消すと（空欄）、STAGE3の値に戻る', () => {
    const e = estimateProjectImpact(stage3, { edits: {} });
    expect(paramOf(e, 'rate')).toMatchObject({ value: 30, source: 'STAGE3' });
  });

  it('追加費用・投資額の修正は、計算に反映され、出所が利用者の修正になる', () => {
    const e = estimateProjectImpact(stage3, {
      edits: { [`${IMPACT_EDIT_PREFIX}addCostMJPY`]: 4, [`${IMPACT_EDIT_PREFIX}investmentMJPY`]: 12 },
    });
    expect(paramOf(e, 'addCostMJPY')).toMatchObject({ value: 4, source: 'USER' });
    expect(rowOf(e, '営業利益の参考値').valueText).toBe('8〜11');
    expect(rowOf(e, '投資支出').valueMJPY).toBe(12);
  });
});

describe('STAGE3に前提が無いときは、AIの仮説で試算する（未確認）', () => {
  const noAssumption = { ...stage3, impactAssumptions: undefined, impactRevenueMJPY: undefined, impactOpIncomeMJPY: undefined, impactRationale: undefined, okrsV2: [] };

  it('仮説の数値で売上・粗利益を計算し、出所をAIの仮説（未確認）と示す', () => {
    const e = estimateProjectImpact(noAssumption, {
      hypothesis: { customers: 10, rate: 20, deal: 10, grossMarginPct: 30, addCostMJPY: 2 },
    });
    expect(rowOf(e, '売上').valueMJPY).toBe(20);
    expect(rowOf(e, '売上').source).toContain('AIの仮説（未確認）');
    expect(rowOf(e, '粗利益').valueMJPY).toBe(6);
    expect(rowOf(e, '営業利益の参考値').valueText).toBe('4');
    expect(paramOf(e, 'customers').source).toBe('AI_HYPOTHESIS');
  });

  it('仮説も無ければ未算定（数値を作らない）。修正欄のための項目は返す', () => {
    const e = estimateProjectImpact(noAssumption, {});
    expect(e.status).toBe('NOT_CALCULATED');
    expect(e.params.length).toBeGreaterThan(0);
  });

  it('利用者の修正は、仮説より優先される', () => {
    const e = estimateProjectImpact(noAssumption, {
      edits: { [`${IMPACT_EDIT_PREFIX}rate`]: 25 },
      hypothesis: { customers: 10, rate: 20, deal: 10 },
    });
    expect(rowOf(e, '売上').valueMJPY).toBe(25);
    expect(paramOf(e, 'rate')).toMatchObject({ source: 'USER' });
  });
});

describe('計上期間と、合計を作らないこと', () => {
  it('計上年度が無ければ「未確認」と示し、年度別の業績にはしない', () => {
    const e = calc(estimateProjectImpact(stage3));
    expect(rowOf(e, '計上期間').valueText).toBe('未確認');
    expect(e.warnings).toContain('計上年度は未確認のため、年度別の業績としては表示しない');
  });

  it('計上年度を入力すると、期間として示す（年度別の合計は作らない）', () => {
    const e = calc(estimateProjectImpact(stage3, { edits: { [`${IMPACT_EDIT_PREFIX}startYear`]: 2027, [`${IMPACT_EDIT_PREFIX}endYear`]: 2028 } }));
    expect(rowOf(e, '計上期間').valueText).toBe('2027年度〜2028年度');
    expect(e.rows.some((r) => r.label.includes('合計'))).toBe(false);
  });

  it('投資支出は利益とは別の行で、営業利益の計算には入らない', () => {
    const e = calc(estimateProjectImpact(stage3, { edits: { [`${IMPACT_EDIT_PREFIX}investmentMJPY`]: 50 } }));
    expect(rowOf(e, '営業利益の参考値').valueText).toBe('6〜9');
    expect(rowOf(e, '投資支出').note).toContain('回収の計算は行わない');
  });
});

describe('AIの算定入力から仮説の値を取り出す（hypothesisOf）', () => {
  it('役割ごとに対応づけ、HYPOTHESIS の値だけを使う', () => {
    const h = hypothesisOf([
      {
        inputs: [
          { role: 'MEETINGS', label: '顧客数', value: 10, basis: 'HYPOTHESIS' },
          { role: 'WIN_RATE', label: '受注率', value: 20, basis: 'HYPOTHESIS' },
          { role: 'AVG_DEAL', label: '平均', value: 10, basis: 'UNCONFIRMED' },
          { role: 'COST_RATE', label: '原価率', value: 70, basis: 'HYPOTHESIS' },
          { role: 'OTHER', label: '案件対応の追加費用', value: 2, basis: 'HYPOTHESIS' },
          { role: 'OTHER', label: '試作の投資', value: 12, basis: 'HYPOTHESIS' },
        ],
      },
    ]);
    expect(h).toEqual({ customers: 10, rate: 20, grossMarginPct: 30, addCostMJPY: 2, investmentMJPY: 12 });
  });

  it('値が無い入力や、仮説でない入力は使わない', () => {
    expect(hypothesisOf([{ inputs: [{ role: 'MEETINGS', value: null, basis: 'HYPOTHESIS' }] }])).toEqual({});
    expect(hypothesisOf(undefined)).toEqual({});
  });
});

describe('STAGE6の参考シナリオ（案件ごとに対応づけ、合計は作らない）', () => {
  const departments = [
    { name: '営業部', projects: [{ id: 'p-a', title: '塗料向け案件', ...stage3 }, { id: 'p-b', title: '別の案件' }] },
  ];
  const draft = { section4: { financeItems: [] } };
  const rec = (projectId: string, over: Partial<ScenarioRecord> = {}): ScenarioRecord => ({
    key: { projectId },
    status: 'DRAFT',
    aiDraft: { rawOutput: JSON.stringify(draft), plan: draft },
    userEdits: {},
    adopted: false,
    startInfo: null,
    ...over,
  });

  it('草案の案件だけ、同じIDの案件に対応づける（別の案件の金額は流用しない）', () => {
    const rows = scenarioRowsOf({ departments, records: [rec('p-b')] });
    expect(rows.map((r) => r.projectId)).toEqual(['p-b']);
    expect(rows[0].estimate.status).toBe('NOT_CALCULATED');
  });

  it('状態を、草案・採用済み・実行開始済みで区別する', () => {
    expect(scenarioRowsOf({ departments, records: [rec('p-a')] })[0].stateLabel).toBe('草案（未採用）');
    expect(scenarioRowsOf({ departments, records: [rec('p-a', { adopted: true })] })[0].stateLabel).toContain('正式な計画には未反映');
    expect(scenarioRowsOf({ departments, records: [rec('p-a', { adopted: true, startInfo: { at: 'x' } })] })[0].stateLabel).toContain('STAGE5');
  });

  it('生成中・失敗の行は含めない', () => {
    expect(scenarioRowsOf({ departments, records: [rec('p-a', { status: 'GENERATING' })] })).toEqual([]);
  });

  it('STAGE3の業績インパクトを持つ案件には、二重計上の注意を付ける', () => {
    const rows = scenarioRowsOf({ departments, records: [rec('p-a')] });
    expect(rows[0].overlapNote).toContain('合計には含めていない');
  });

  it('利用者の修正（計画書の中の前提）が、シナリオの試算に反映される', () => {
    const rows = scenarioRowsOf({ departments, records: [rec('p-a', { userEdits: { [`${IMPACT_EDIT_PREFIX}rate`]: 40 } })] });
    const r = rows[0].estimate;
    expect(r.status).toBe('CALCULATED');
    if (r.status === 'CALCULATED') expect(r.rows.find((x) => x.label.startsWith('売上'))?.valueMJPY).toBe(80);
  });
});
