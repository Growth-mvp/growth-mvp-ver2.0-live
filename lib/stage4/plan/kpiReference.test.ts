import { refreshKpiReference } from './kpiReference';

const PROJ = 'proj-a';

const kpi = (id: string, over: Record<string, unknown> = {}) => ({
  id,
  label: `指標${id}`,
  target: 10,
  unit: '件',
  due: '2027-03',
  owner: '担当',
  targetBasis: 'USER_CONFIRMED',
  ...over,
});

const departments = (kpis: unknown[], otherProjectKpis: unknown[] = []) => [
  { name: '事業部', projects: [{ id: PROJ, title: '案件', okrsV2: kpis }] },
  { name: '他部門', projects: [{ id: 'proj-b', title: '別案件', okrsV2: otherProjectKpis }] },
];

const planned = (k: Record<string, unknown>, key: string) => ({
  key,
  origin: 'STAGE3',
  stage3KpiId: k.id,
  kind: 'UNCLASSIFIED',
  label: k.label,
  target: k.target,
  unit: k.unit,
  targetBasis: 'STAGE_DATA',
  confirmation: 'USER_CONFIRMED',
  due: k.due,
  owner: k.owner,
  measurement: '確定済みKPI（STAGE3）の測定方法に従う',
  supportsActionOrders: ['A1'],
  judgeCandidateYm: null,
});

const draft = (protectedKpis: unknown[]) => ({
  caseId: 'gen:proj-a',
  plan: {
    period: { startYm: '2027-01', endYm: '2027-06' },
    section1: { purpose: '利用者が書いた目的' },
    section3: { protectedKpis, proposedKpis: [{ label: 'AIの提案' }] },
    section5: { responsible: { name: null } },
  },
});

const protectedOf = (d: ReturnType<typeof draft>) => (d.plan.section3.protectedKpis as Array<Record<string, unknown>>);

describe('計画書の参照KPIを、正式KPIに合わせる（開始を止めない整合処理）', () => {
  it('変わっていなければ、そのままの計画書を返す', () => {
    const k1 = kpi('k1');
    const d = draft([planned(k1, 'S1')]);
    const out = refreshKpiReference(d, departments([k1]), PROJ);
    expect(out.ok).toBe(true);
    if (!out.ok) throw new Error('ok');
    expect(out.changed).toBe(false);
    expect(out.aiDraft).toBe(d);
  });

  it('計画書の作成後に追加されたKPIは、保護一覧に次の番号で加わり、本文は変わらない', () => {
    const k1 = kpi('k1');
    const added = kpi('k2', { label: '後から追加' });
    const d = draft([planned(k1, 'S1')]);
    const out = refreshKpiReference(d, departments([k1, added]), PROJ);
    if (!out.ok) throw new Error('ok');
    expect(out.changed).toBe(true);
    const list = protectedOf(out.aiDraft as ReturnType<typeof draft>);
    expect(list.map((x) => x.key)).toEqual(['S1', 'S2']);
    expect(list[1]).toMatchObject({ stage3KpiId: 'k2', label: '後から追加', target: 10, confirmation: 'USER_CONFIRMED' });
    expect((out.aiDraft as ReturnType<typeof draft>).plan.section1).toEqual({ purpose: '利用者が書いた目的' });
    expect((out.aiDraft as ReturnType<typeof draft>).plan.section3.proposedKpis).toEqual([{ label: 'AIの提案' }]);
  });

  it('正式KPIの目標値や期限が変わったら、保護一覧を最新の値にし、実施事項の対応（supportsActionOrders）は残す', () => {
    const k1 = kpi('k1', { target: 120, due: '2027-05', owner: '別の担当' });
    const d = draft([planned(kpi('k1'), 'S1')]);
    const out = refreshKpiReference(d, departments([k1]), PROJ);
    if (!out.ok) throw new Error('ok');
    expect(protectedOf(out.aiDraft as ReturnType<typeof draft>)[0]).toMatchObject({ target: 120, due: '2027-05', owner: '別の担当', supportsActionOrders: ['A1'] });
  });

  it('目標値が未入力のKPIは0にせず、未設定のまま残す', () => {
    const k1 = kpi('k1', { target: null, targetBasis: undefined });
    const d = draft([planned(kpi('k1'), 'S1')]);
    const out = refreshKpiReference(d, departments([k1]), PROJ);
    if (!out.ok) throw new Error('ok');
    expect(protectedOf(out.aiDraft as ReturnType<typeof draft>)[0]).toMatchObject({ target: null, targetBasis: null });
  });

  it('正式データから消えたKPIは、旧い目標値を最新として出さず、名称に注記する（何度行っても注記は1つ）', () => {
    const d = draft([planned(kpi('k1'), 'S1'), planned(kpi('gone', { label: '消えた指標', target: 7 }), 'S2')]);
    const once = refreshKpiReference(d, departments([kpi('k1')]), PROJ);
    if (!once.ok) throw new Error('ok');
    const gone = protectedOf(once.aiDraft as ReturnType<typeof draft>)[1];
    expect(gone).toMatchObject({ label: '消えた指標（正式データにありません）', target: null, confirmation: 'UNCONFIRMED' });
    const twice = refreshKpiReference(once.aiDraft as ReturnType<typeof draft>, departments([kpi('k1')]), PROJ);
    if (!twice.ok) throw new Error('ok');
    expect(protectedOf(twice.aiDraft as ReturnType<typeof draft>)[1].label).toBe('消えた指標（正式データにありません）');
  });

  it('別のプロジェクトのKPIは混ぜない', () => {
    const d = draft([planned(kpi('k1'), 'S1')]);
    const out = refreshKpiReference(d, departments([kpi('k1')], [kpi('other', { label: '他案件の指標' })]), PROJ);
    if (!out.ok) throw new Error('ok');
    expect(out.changed).toBe(false);
    expect(JSON.stringify(out.aiDraft)).not.toContain('他案件の指標');
  });

  it('AIの仮のKPIは、確定の保護一覧に入れない', () => {
    const d = draft([]);
    const provisional = kpi('ai1', { targetBasis: 'AI_PROVISIONAL' });
    const out = refreshKpiReference(d, departments([provisional]), PROJ);
    if (!out.ok) throw new Error('ok');
    expect(out.changed).toBe(false);
  });

  it('対象プロジェクトが無い、または同じIDが複数ある時は、整合させず止める', () => {
    const d = draft([]);
    expect(refreshKpiReference(d, departments([]), 'proj-missing').ok).toBe(false);
    const dup = [
      { name: 'A', projects: [{ id: PROJ, okrsV2: [] }] },
      { name: 'B', projects: [{ id: PROJ, okrsV2: [] }] },
    ];
    expect(refreshKpiReference(d, dup, PROJ).ok).toBe(false);
  });
});
