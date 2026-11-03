import { buildDbRowFromState, buildStateFromDbRow } from './strategy';

const chapters = (n: number) =>
  Array.from({ length: n }, (_, i) => ({ title: `章${i + 1}の見出し（利用者の文言）`, body: `本文${i + 1}：確定した説明です。` }));

const kr = (overrides: Record<string, unknown> = {}) => ({
  id: 'kr-retention',
  kind: 'CHURN',
  label: '保守契約の継続率',
  target: 95,
  unit: '%',
  scope: 'company',
  baseKey: 'churn',
  track: 'EXPLORE',
  metricRole: 'LEADING',
  hypothesis: { text: '点検記録の共有で解約が減る' },
  probability: 0.4,
  impact: { revenueYen: 1000 },
  targetSegment: '中小製造業',
  validation: { method: 'A/B' },
  actual: { value: 92, asOf: '2026-10', recordedAt: '2026-11-03T00:00:00.000Z', note: '月次' },
  actualHistory: [{ value: 90, asOf: '2026-09', recordedAt: '2026-10-03T00:00:00.000Z' }],
  spend: undefined,
  ...overrides,
});

const aiBridgeWithoutCore = {
  keyThemes: Array.from({ length: 10 }, (_, i) => `重要テーマ${i + 1}`),
  departmentIssues: ['保守技術者の育成'],
  kpiCriteria: Array.from({ length: 9 }, (_, i) => `KPI${i + 1}`),
  commonBehaviorChanges: ['点検記録を当日中に共有する'],
};

const baseState = () =>
  ({
    id: 'strategy-rt-1',
    company_id: 'company-rt-1',
    companyName: '架空株式会社',
    fiscalYearEnd: '3',
    finalStoryDraft: chapters(5),
    finalStoryEdited: chapters(3),
    finalStoryFinal: chapters(4),
    stage3_strategy_bridge: aiBridgeWithoutCore,
    simulationResults: [
      { id: 's1', created_at: '2026-10-01T00:00:00.000Z', title: '案A', scenario_id: null, payload: { revenue: 100 } },
    ],
    departments: [
      {
        id: 'dept-sales',
        name: '営業部',
        projects: [
          {
            id: 'proj-sales-1',
            title: '既存顧客の保守契約更新',
            projectUid: 'uid-A',
            financeEffect: {
              kind: 'REVENUE_UP',
              method: 'DIRECT_AMOUNT',
              directAmountYen: 6_000_000,
              amountBasis: 'ANNUAL',
              startYm: '2026-04',
              sourceNote: '見積書（架空）',
              confirmed: true,
            },
            okrsV2: [kr()],
            roles: [
              {
                role: '担当',
                okrs: [kr({ id: 'kr-role-1', label: '担当者の点検件数', track: 'EVOLVE', actual: { value: 40, asOf: '2026-10', recordedAt: '2026-11-03T00:00:00.000Z' } })],
              },
            ],
          },
        ],
      },
    ],
  }) as any;

const roundTrip = (state: any) => {
  const row = buildDbRowFromState(state) as any;
  return buildStateFromDbRow(JSON.parse(JSON.stringify(row))) as any;
};

describe('保存→読込の往復で、利用者の保存内容が変わらない', () => {
  it('finalStoryDraft・finalStoryEdited・finalStoryFinal は章数・見出し・順序・本文がそのまま残る', () => {
    const before = baseState();
    const after = roundTrip(before);
    expect(after.finalStoryDraft).toEqual(before.finalStoryDraft);
    expect(after.finalStoryEdited).toEqual(before.finalStoryEdited);
    expect(after.finalStoryFinal).toEqual(before.finalStoryFinal);
  });

  it('stage3_strategy_bridge は、保存された内容のまま（既定値・生成時刻・strategicCore を補わず、件数も切り詰めない）', () => {
    const before = baseState();
    const after = roundTrip(before);
    const bridge = after.stage3_strategy_bridge;
    expect(bridge.keyThemes).toEqual(aiBridgeWithoutCore.keyThemes);
    expect(bridge.keyThemes).toHaveLength(10);
    expect(bridge.kpiCriteria).toHaveLength(9);
    expect(bridge.departmentIssues).toEqual(aiBridgeWithoutCore.departmentIssues);
    expect(bridge).not.toHaveProperty('strategicCore');
    expect(bridge).not.toHaveProperty('departmentTranslationRules');
    expect(bridge).not.toHaveProperty('generatedAt');
  });

  it('roles.okrs のKRは、ID・戦略メタ・実績・履歴を保つ（事業部のKRと同じ扱い）', () => {
    const before = baseState();
    const after = roundTrip(before);
    const roleKr = after.departments[0].projects[0].roles[0].okrs[0];
    expect(roleKr).toMatchObject({
      id: 'kr-role-1',
      track: 'EVOLVE',
      label: '担当者の点検件数',
      actual: { value: 40, asOf: '2026-10' },
    });
  });

  it('施策ID・projectUid・財務効果・事業部KRのID・実績・履歴・戦略メタは残る', () => {
    const before = baseState();
    const after = roundTrip(before);
    const p = after.departments[0].projects[0];
    expect(p.id).toBe('proj-sales-1');
    expect(p.projectUid).toBe('uid-A');
    expect(p.financeEffect).toEqual(before.departments[0].projects[0].financeEffect);
    expect(p.okrsV2[0]).toMatchObject({
      id: 'kr-retention',
      track: 'EXPLORE',
      metricRole: 'LEADING',
      hypothesis: { text: '点検記録の共有で解約が減る' },
      targetSegment: '中小製造業',
      actual: { value: 92, asOf: '2026-10' },
      actualHistory: [{ value: 90, asOf: '2026-09' }],
    });
  });

  it('simulationResults（STAGE6履歴）は保存→読込で件数と内容が残る', () => {
    const before = baseState();
    const after = roundTrip(before);
    expect(after.simulationResults).toEqual(before.simulationResults);
  });

  it('不正な実績は読込時に除外し、KRそのものは残す（旧データの互換性）', () => {
    const before = baseState();
    before.departments[0].projects[0].okrsV2 = [kr({ actual: { value: 'x', asOf: 'bad' } })];
    const after = roundTrip(before);
    const got = after.departments[0].projects[0].okrsV2[0];
    expect(got.id).toBe('kr-retention');
    expect(got.actual).toBeUndefined();
    expect(got.track).toBe('EXPLORE');
  });

  it('stage3_strategy_bridge が非オブジェクトなら保存しない（旧来の不正値の扱いを維持）', () => {
    const before = baseState();
    before.stage3_strategy_bridge = 'テキストのみ';
    const row = buildDbRowFromState(before) as any;
    expect(row.stage3_strategy_bridge).toBeNull();
  });
});
