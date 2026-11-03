import { normalizeStrategyData } from './normalize';

const krBase = {
  id: 'kr-1',
  kind: 'REVENUE',
  label: '新規受注件数',
  target: 20,
  unit: '件',
  scope: 'company',
  baseKey: 'sales',
};

const confirmedEffect = {
  kind: 'REVENUE_UP',
  method: 'DIRECT_AMOUNT',
  directAmountYen: 6_000_000,
  amountBasis: 'ANNUAL',
  startYm: '2026-04',
  sourceNote: '見積書（架空）',
  confirmed: true,
};

describe('正規化でのデータ保全', () => {
  it('finalStoryFinal は章の順序・見出し・本文を変えずに保持する（5章目も残す）', () => {
    const chapters = [
      { title: '危機', body: '価格競争で受注が減っている。' },
      { title: '提供価値', body: '点検の確実さを届ける。' },
      { title: 'カスタム見出し', body: '独自の章。' },
      { title: '実行', body: '1〜2年で標準化する。' },
      { title: '補足', body: '5章目。' },
    ];
    const out: any = normalizeStrategyData({ finalStoryFinal: chapters } as any);
    expect(out.finalStoryFinal).toEqual(chapters);
  });

  it('simulationResults（保存履歴）は正規化で落ちず、中身も変わらない', () => {
    const history = [
      { id: 's1', created_at: '2026-10-01T00:00:00.000Z', title: '案A', scenario_id: null, payload: { revenue: 100 } },
    ];
    const out: any = normalizeStrategyData({ simulationResults: history } as any);
    expect(out.simulationResults).toEqual(history);
  });

  it('okrsV2 の戦略メタ項目と実績・履歴は正規化後も残る', () => {
    const kr = {
      ...krBase,
      track: 'EXPLORE',
      metricRole: 'LEADING',
      hypothesis: { text: '紹介が増える' },
      probability: 0.4,
      impact: { revenueYen: 1000 },
      targetSegment: '中小製造業',
      validation: { method: 'A/B' },
      actual: { value: 12, asOf: '2026-10', recordedAt: '2026-11-03T00:00:00.000Z' },
      actualHistory: [{ value: 10, asOf: '2026-09', recordedAt: '2026-10-03T00:00:00.000Z' }],
    };
    const out: any = normalizeStrategyData({
      departments: [{ id: 'd1', name: '営業部', projects: [{ id: 'p1', title: '新規開拓', okrsV2: [kr] }] }],
    } as any);
    const got = out.departments[0].projects[0].okrsV2[0];
    expect(got).toMatchObject({
      track: 'EXPLORE',
      metricRole: 'LEADING',
      hypothesis: { text: '紹介が増える' },
      probability: 0.4,
      impact: { revenueYen: 1000 },
      targetSegment: '中小製造業',
      validation: { method: 'A/B' },
      actual: { value: 12, asOf: '2026-10' },
      actualHistory: [{ value: 10, asOf: '2026-09' }],
    });
  });

  it('不正な実績は落とすが、他のKR項目は残す', () => {
    const kr = { ...krBase, track: 'EVOLVE', actual: { value: 'abc', asOf: 'bad' } };
    const out: any = normalizeStrategyData({
      departments: [{ id: 'd1', name: '営業部', projects: [{ id: 'p1', title: '新規開拓', okrsV2: [kr] }] }],
    } as any);
    const got = out.departments[0].projects[0].okrsV2[0];
    expect(got.actual).toBeUndefined();
    expect(got.track).toBe('EVOLVE');
  });

  it('施策の financeEffect と projectUid は正規化後も同じ値で残る', () => {
    const out: any = normalizeStrategyData({
      departments: [
        {
          id: 'd1',
          name: '営業部',
          projects: [{ id: 'p1', title: '新規開拓', projectUid: 'uid-A', financeEffect: confirmedEffect }],
        },
      ],
    } as any);
    const p = out.departments[0].projects[0];
    expect(p.projectUid).toBe('uid-A');
    expect(p.financeEffect).toEqual(confirmedEffect);
  });

  it('STAGE6 の目標・寄与行は正規化後も残る', () => {
    const targets = [{ id: 'rev', label: '売上', unit: '百万円', base: 1000 }];
    const rows = [{ projectId: 'uid-A', targetId: 'rev', delta: 10, source: 'manual', locked: true }];
    const out: any = normalizeStrategyData({ companyTargets: targets, projectTargetImpacts: rows } as any);
    expect(out.companyTargets).toEqual(targets);
    expect(out.projectTargetImpacts).toEqual(rows);
  });
});
