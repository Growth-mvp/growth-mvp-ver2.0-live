/* 本番読込相当の経路（DBの行 → buildStateFromDbRow → normalizeStrategyData と退避・復元）をモックの行で再現する。通信はしない。 */
import { buildStateFromDbRow } from '@/utils/supabase/strategy';
import { normalizeStrategyData } from '@/utils/supabase/normalize';

const rowWith = (overrides: Record<string, unknown>) => ({
  id: 'strategy-test-1',
  company_id: 'company-test-1',
  departments: [
    {
      id: 'dept-sales',
      name: '営業部',
      projects: [
        {
          id: 'proj-sales-1',
          title: '既存顧客の保守契約更新',
          role: 'REVENUE',
          impactRevenueMJPY: 10,
          okrsV2: [
            {
              id: 'kr-retention',
              kind: 'CHURN',
              label: '保守契約の継続率',
              target: 95,
              unit: '%',
              scope: 'company',
              baseKey: 'churn',
              actual: { value: 92, asOf: '2026-10', recordedAt: '2026-11-03T00:00:00.000Z', note: '月次' },
              actualHistory: [{ value: 90, asOf: '2026-09', recordedAt: '2026-10-03T00:00:00.000Z' }],
            },
          ],
        },
      ],
    },
  ],
  company_targets: [{ id: 'rev', label: '売上', unit: '百万円', base: 1000 }],
  ...overrides,
});

describe('本番読込相当の経路（DB行 → 状態）での北極星の行とKR実績', () => {
  it('北極星の手動行は、読込で1件も欠落しない（正規化で一度消えても、退避して復元する）', () => {
    const rows = [
      { projectId: 'uid-A', targetId: 'rev', delta: 10, source: 'manual', locked: true, notes: '[STAGE4] 売上寄与' },
      { projectId: 'uid-B', targetId: 'rev', delta: 7, source: 'manual', locked: true },
    ];
    const state: any = buildStateFromDbRow(rowWith({ project_target_impacts: rows }));
    expect(state.projectTargetImpacts).toEqual(rows);
  });

  it('KRの実績・履歴・目標・IDは、読込後も同じ値で残る（STAGE4の目標は変わらない）', () => {
    const state: any = buildStateFromDbRow(rowWith({ project_target_impacts: [] }));
    const kr = state.departments[0].projects[0].okrsV2[0];
    expect(kr).toMatchObject({
      id: 'kr-retention',
      label: '保守契約の継続率',
      target: 95,
      unit: '%',
      actual: { value: 92, asOf: '2026-10', recordedAt: '2026-11-03T00:00:00.000Z', note: '月次' },
    });
    expect(kr.actualHistory).toEqual([{ value: 90, asOf: '2026-09', recordedAt: '2026-10-03T00:00:00.000Z' }]);
  });

  it('正規化を通しても、STAGE2の目標と北極星の手動行は残る', () => {
    const rows = [{ projectId: 'uid-A', targetId: 'rev', delta: 10, source: 'manual', locked: true }];
    const targets = [{ id: 'rev', label: '売上', unit: '百万円', base: 1000 }];
    const out: any = normalizeStrategyData({ departments: [], companyTargets: targets, projectTargetImpacts: rows } as any);
    expect(out.companyTargets).toEqual(targets.map((t) => ({ ...t, rationale: '', linkedIssueIds: [] })));
    expect(out.projectTargetImpacts).toEqual(rows);
  });

  it('旧データ（実績なし・北極星の行なし）でも正常に読める', () => {
    const legacy = rowWith({ project_target_impacts: null });
    const state: any = buildStateFromDbRow(legacy);
    expect(state.projectTargetImpacts ?? []).toHaveLength(0);
    const kr = state.departments[0].projects[0].okrsV2[0];
    expect(kr.target).toBe(95);
  });
});
