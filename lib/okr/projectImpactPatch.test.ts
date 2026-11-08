import { applyProjectImpactPatch } from './projectImpactPatch';
import { buildAssumptionPatch, getImpactPreset } from './impactAssumptions';
import { resolveManualImpacts } from './impactRows';
import { normalizeStrategyData } from '@/utils/supabase/normalize';

function stateWith(project: Record<string, any>) {
  return {
    version: 1,
    dirty: false,
    departments: [{ id: 'd1', name: '営業部', projects: [{ title: '新規開拓A', role: 'REVENUE', ...project }] }],
    companyTargets: [
      { id: 'rev-target', label: '売上', unit: '百万円' },
      { id: 'op-target', label: '営業利益', unit: '百万円' },
    ],
    projectTargetImpacts: [] as any[],
  };
}

const projectOf = (st: any) => st.departments[0].projects[0];

/** 施策（0,0）の売上行。施策の一意IDで探す（添字キーには依存しない） */
const revRow = (st: any) =>
  st.projectTargetImpacts.find((r: any) => r.targetId === 'rev-target' && r.projectId === projectOf(st).projectUid);

const CURRENT_ASSUMPTIONS = { conversionRatePct: 20, averageDealMJPY: 20 };

function withRegisteredRevenue(amountMJPY: number) {
  return applyProjectImpactPatch(stateWith({ impactAssumptions: CURRENT_ASSUMPTIONS }), 0, 0, {
    impactRevenueMJPY: amountMJPY,
  });
}

describe('前提編集・プリセットは、明示的に反映するまで既存の金額を変えない', () => {
  it('前提編集後も、既存の金額と北極星の行は変わらない（前提だけが保存される）', () => {
    const st0 = withRegisteredRevenue(10);
    const rowBefore = revRow(st0);
    const st1 = applyProjectImpactPatch(st0, 0, 0, buildAssumptionPatch(CURRENT_ASSUMPTIONS, { targetCustomers: 30 }));

    expect(projectOf(st1).impactRevenueMJPY).toBe(10);
    expect(st1.projectTargetImpacts).toEqual(st0.projectTargetImpacts);
    expect(revRow(st1)).toEqual(rowBefore);
    expect(projectOf(st1).impactAssumptions).toEqual({ ...CURRENT_ASSUMPTIONS, targetCustomers: 30 });
  });

  it('プリセット選択後も、既存の金額と北極星の行は変わらない', () => {
    const st0 = withRegisteredRevenue(10);
    const st1 = applyProjectImpactPatch(
      st0,
      0,
      0,
      buildAssumptionPatch(CURRENT_ASSUMPTIONS, getImpactPreset('REVENUE', 'large')),
    );

    expect(projectOf(st1).impactRevenueMJPY).toBe(10);
    expect(revRow(st1).delta).toBe(10);
    expect(projectOf(st1).impactAssumptions).toEqual(getImpactPreset('REVENUE', 'large'));
  });

  it('金額が未登録の施策で前提を編集しても、金額も北極星の行も作られない', () => {
    const st1 = applyProjectImpactPatch(
      stateWith({}),
      0,
      0,
      buildAssumptionPatch(undefined, getImpactPreset('REVENUE', 'standard')),
    );

    expect(projectOf(st1).impactRevenueMJPY).toBeUndefined();
    expect(st1.projectTargetImpacts).toEqual([]);
  });

});

describe('直接入力は従来どおり保存され、北極星の行にも同期される', () => {
  it('直接入力した金額は保存され、北極星の行にも同期される', () => {
    const st1 = applyProjectImpactPatch(stateWith({}), 0, 0, { impactRevenueMJPY: 15 });
    expect(projectOf(st1).impactRevenueMJPY).toBe(15);
    expect(revRow(st1).delta).toBe(15);
  });
});

describe('北極星への同期と財務効果', () => {
  it('財務効果の保存は、北極星の行を変えない（財務効果は北極星に接続しない）', () => {
    const st0 = withRegisteredRevenue(10);
    const st1 = applyProjectImpactPatch(st0, 0, 0, {
      financeEffect: {
        kind: 'REVENUE_UP',
        method: 'DIRECT_AMOUNT',
        directAmountYen: 20_000_000,
        amountBasis: 'ANNUAL',
        startYm: '2027-04',
        sourceNote: '架空',
        source: 'USER_INPUT',
        confirmed: false,
      },
    });
    expect(st1.projectTargetImpacts).toEqual(st0.projectTargetImpacts);
  });

  it('同期の基準：施策に付いた一意IDで、売上10百万円の行（delta 10・手動・locked）が作られる', () => {
    const st = withRegisteredRevenue(10);
    expect(projectOf(st).projectUid).toEqual(expect.any(String));
    expect(revRow(st)).toMatchObject({ targetId: 'rev-target', delta: 10, source: 'manual', locked: true, deltaUnit: 'million_yen' });
  });

  it('施策の一意IDは、再度の書き込みでも維持される', () => {
    const st0 = withRegisteredRevenue(10);
    const st1 = applyProjectImpactPatch(st0, 0, 0, { impactRevenueMJPY: 12 });
    expect(projectOf(st1).projectUid).toBe(projectOf(st0).projectUid);
    expect(st1.projectTargetImpacts).toHaveLength(1);
    expect(revRow(st1).delta).toBe(12);
  });

  it('同じ施策の旧形式の行は、新しい書き込みで置き換えられ、二重に残らない', () => {
    const legacy = stateWith({ impactRevenueMJPY: 10 });
    legacy.projectTargetImpacts = [
      { projectId: '営業部::新規開拓A::0', targetId: 'rev-target', delta: 10, source: 'manual', locked: true },
    ];
    const st1 = applyProjectImpactPatch(legacy, 0, 0, { impactRevenueMJPY: 15 });
    const kept = st1.projectTargetImpacts.filter((r: any) => r.targetId === 'rev-target');
    expect(kept).toHaveLength(1);
    expect(kept[0].delta).toBe(15);
    expect(kept[0].projectId).toBe(projectOf(st1).projectUid);
  });

  it('金額を消去すると、その施策の行は消える（別の施策の行は残る）', () => {
    const st0 = applyProjectImpactPatch(
      stateWith({ impactRevenueMJPY: 10 }),
      0,
      0,
      { impactRevenueMJPY: 10 },
    );
    const withOther = {
      ...st0,
      departments: [
        {
          ...st0.departments[0],
          projects: [...st0.departments[0].projects, { title: 'B', role: 'REVENUE' }],
        },
      ],
    };
    const otherRow = { projectId: 'other-uid', targetId: 'rev-target', delta: 7, source: 'manual', locked: true };
    const st1 = applyProjectImpactPatch({ ...withOther, projectTargetImpacts: [...st0.projectTargetImpacts, otherRow] }, 0, 0, {
      impactRevenueMJPY: undefined,
    });
    expect(st1.projectTargetImpacts).toEqual([otherRow]);
  });

  it('金額に関係しない保存（財務効果・前提）では、行の配列に触れない', () => {
    const st0 = withRegisteredRevenue(10);
    const st1 = applyProjectImpactPatch(st0, 0, 0, { impactAssumptions: { targetCustomers: 99 } });
    expect(st1.projectTargetImpacts).toBe(st0.projectTargetImpacts);
  });
});

describe('保存・再読込・施策の並べ替えと改名', () => {
  it('保存して再読込しても、施策の一意IDと行は同じ施策を指す', () => {
    const st = withRegisteredRevenue(10);
    const reloaded: any = normalizeStrategyData(JSON.parse(JSON.stringify({ departments: st.departments, projectTargetImpacts: st.projectTargetImpacts })) as any);
    expect(reloaded.departments[0].projects[0].projectUid).toBe(projectOf(st).projectUid);
    const res = resolveManualImpacts({ rows: st.projectTargetImpacts, departments: reloaded.departments, companyTargets: st.companyTargets });
    expect(res.rows).toHaveLength(1);
    expect(res.rows[0].delta).toBe(10);
    expect(res.excluded).toEqual([]);
  });

  it('並べ替えても、行は同じ施策に付いたまま（金額は変わらない）', () => {
    const st0 = applyProjectImpactPatch(
      stateWith({}),
      0,
      0,
      { impactRevenueMJPY: 10 },
    );
    const second = { title: 'B', role: 'REVENUE' };
    const s1 = { ...st0, departments: [{ ...st0.departments[0], projects: [second, projectOf(st0)] }] };
    const res = resolveManualImpacts({ rows: s1.projectTargetImpacts, departments: s1.departments, companyTargets: s1.companyTargets });
    expect(res.rows).toHaveLength(1);
    expect(res.rows[0].projectId).toBe('営業部::新規開拓A::1');
    expect(res.rows[0].delta).toBe(10);
  });
});
