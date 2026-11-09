import {
  STAGE3_SNAPSHOT_MEMBERSHIPS,
  STAGE3_SNAPSHOT_SAVED_PLANS,
  STAGE3_SNAPSHOT_STRATEGIES,
} from '@/lib/stage4/planView/fixtures/stage3Snapshot';
import { buildStage3Tree, readStage3Project, selectionKey, stage3SourceFromScope, type Stage3ScopeInput, type Stage3Selection } from './stage3Read';

const sel = (projectKey: string, companyId = 'fict-co-a', strategyId = 'fict-strategy-a'): Stage3Selection => ({
  companyId,
  strategyId,
  projectKey,
});
const read = (s: Stage3Selection) =>
  readStage3Project({
    memberships: STAGE3_SNAPSHOT_MEMBERSHIPS,
    strategies: STAGE3_SNAPSHOT_STRATEGIES,
    savedPlans: STAGE3_SNAPSHOT_SAVED_PLANS,
    selection: s,
  });

describe('選択の一覧（buildStage3Tree）', () => {
  const tree = buildStage3Tree({ memberships: STAGE3_SNAPSHOT_MEMBERSHIPS, strategies: STAGE3_SNAPSHOT_STRATEGIES });

  it('所属している企業だけを返し、他社の部門・プロジェクトは含めない', () => {
    expect(tree.map((t) => t.companyId)).toEqual(['fict-co-a']);
    const text = JSON.stringify(tree);
    expect(text).not.toContain('他社だけの案件');
    expect(text).not.toContain('他社の秘密のKPI');
  });

  it('部門ごとに、部門のミッションとプロジェクトを並べる', () => {
    const depts = tree[0].departments;
    expect(depts.map((d) => d.name)).toEqual(['営業部', '設計部', '新規事業開発部']);
    expect(depts[0].mission).toBe('既存顧客との関係を深め、継続的に売上を伸ばす');
    expect(depts[0].projects.map((p) => p.projectTitle)).toEqual(['既存顧客の保守契約更新', '新規顧客開拓']);
  });

  it('同じ名前の「新規顧客開拓」は、部門が違えば別のキーになる', () => {
    const keys = tree[0].departments.flatMap((d) => d.projects).filter((p) => p.projectTitle === '新規顧客開拓').map((p) => p.projectKey);
    expect(keys).toEqual(['id:fict-proj-referral-sales', 'id:fict-proj-referral-design']);
  });
});

describe('プロジェクトの読み取り（readStage3Project）', () => {
  it('確定KPI・印の無いKPI（目標0を含む）・AI仮提案KPIを、分けて読む', () => {
    const v = read(sel('id:fict-proj-renewal'));
    expect(v.status).toBe('READY');
    if (v.status !== 'READY') return;
    expect(v.model.kpis.confirmed.map((k) => [k.label, k.target, k.due, k.owner])).toEqual([
      ['保守契約の継続率', 95, '2027-06', '鈴木一郎（仮）'],
    ]);
    expect(v.model.kpis.unconfirmed.map((k) => [k.label, k.target])).toEqual([['更新案内の到達率', 0]]);
    expect(v.model.kpis.aiProvisional.map((k) => [k.label, k.target])).toEqual([['更新時の値引き率', 3]]);
  });

  it('部門の戦略（ミッション・戦略）と、プロジェクトの目的・役割・仮説（オブジェクト形式）を読む', () => {
    const v = read(sel('id:fict-proj-renewal'));
    if (v.status !== 'READY') throw new Error('expected READY');
    expect(v.model.department).toEqual({
      name: '営業部',
      mission: '既存顧客との関係を深め、継続的に売上を伸ばす',
      missionDescription: '保守契約の継続と、紹介による新規の獲得を両立する',
      strategy: '既存顧客の保守契約を守りながら、紹介経由の顧客を増やす',
    });
    expect(v.model.project).toEqual({
      title: '既存顧客の保守契約更新',
      objective: '保守契約の更新率を高める',
      hypothesis: '更新案内を早めると、解約が減る',
      rationale: '解約の理由の多くは、更新時期の案内の遅れにある',
      role: 'REVENUE',
    });
  });

  it('データが不足していても、欠けた項目はnullで返し、計画がなければ「計画なし」を返す', () => {
    const v = read(sel('id:fict-proj-referral-sales'));
    expect(v.status).toBe('READY');
    if (v.status !== 'READY') return;
    expect(v.model.project.objective).toBeNull();
    expect(v.model.kpis.confirmed).toEqual([]);
    expect(v.model.kpis.aiProvisional).toEqual([]);
    expect(v.model.kpis.unconfirmed.map((k) => [k.label, k.origin])).toEqual([['紹介件数', 'LEGACY_LABEL']]);
    expect(v.document).toEqual({ kind: 'NO_PLAN' });
  });

  it('保存済みの計画があるプロジェクトは、その計画を返す（KPIが一致していれば変わっていない）', () => {
    const v = read(sel('id:fict-proj-clinic-pilot', 'fict-co-a', 'fict-strategy-a'));
    expect(v.status).toBe('READY');
    if (v.status !== 'READY') return;
    expect(v.document).toMatchObject({ kind: 'SAVED_PLAN', kpiChanged: false, savedAt: '2026-10-20T09:00:00+09:00' });
    expect(v.model.kpis.confirmed.map((k) => k.label)).toEqual([
      '試験導入に合意した医療機関数',
      '試験導入後に継続利用の意向を確認した医療機関数',
    ]);
  });

  it('同じ名前のプロジェクトは、キーで選べば正しい部門を読み、別企業のものは読まない', () => {
    const design = read(sel('id:fict-proj-referral-design'));
    if (design.status !== 'READY') throw new Error('expected READY');
    expect(design.model.department.name).toBe('設計部');
    expect(design.model.kpis.aiProvisional.map((k) => k.label)).toEqual(['設計提案の件数']);
    const sales = read(sel('id:fict-proj-referral-sales'));
    if (sales.status !== 'READY') throw new Error('expected READY');
    expect(sales.model.department.name).toBe('営業部');
    expect(JSON.stringify(sales)).not.toContain('他社の新規KPI');
  });
});

describe('切り替えと拒否', () => {
  it('別の企業のキーは拒否し、その企業の情報を返さない', () => {
    const v = read(sel('id:fict-b-proj-1', 'fict-co-b', 'fict-strategy-b'));
    expect(v).toEqual({ status: 'NO_DATA', reason: 'COMPANY_NOT_ACCESSIBLE' });
  });

  it('存在しないキーは拒否する（別の部門の番号を指定しても通らない）', () => {
    expect(read(sel('id:missing'))).toEqual({ status: 'NO_DATA', reason: 'PROJECT_NOT_FOUND' });
  });

  it('プロジェクトを切り替えると、前のプロジェクトのKPI・計画が混ざらない', () => {
    const a = read(sel('id:fict-proj-clinic-pilot'));
    const b = read(sel('id:fict-proj-renewal'));
    if (a.status !== 'READY' || b.status !== 'READY') throw new Error('expected READY');
    expect(JSON.stringify(b)).not.toContain('試験導入に合意した医療機関数');
    expect(b.document.kind).toBe('NO_PLAN');
    expect(a.document.kind).toBe('SAVED_PLAN');
    expect(a.key).not.toBe(b.key);
    expect(selectionKey(sel('id:fict-proj-renewal'))).toBe('fict-co-a|fict-strategy-a|id:fict-proj-renewal');
  });

  it('読み取りは、入力の戦略データ・保存済みの計画を変えない', () => {
    const before = JSON.stringify({ STAGE3_SNAPSHOT_STRATEGIES, STAGE3_SNAPSHOT_SAVED_PLANS });
    read(sel('id:fict-proj-clinic-pilot'));
    read(sel('id:fict-proj-renewal'));
    expect(JSON.stringify({ STAGE3_SNAPSHOT_STRATEGIES, STAGE3_SNAPSHOT_SAVED_PLANS })).toBe(before);
  });

  it('読み取りは、ネットワークにもDBにもAIにも接続しない', () => {
    const spy = jest.spyOn(globalThis, 'fetch');
    read(sel('id:fict-proj-clinic-pilot'));
    buildStage3Tree({ memberships: STAGE3_SNAPSHOT_MEMBERSHIPS, strategies: STAGE3_SNAPSHOT_STRATEGIES });
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });
});

describe('stage3SourceFromScope（読み取り元の判定）', () => {
  const ready: Stage3ScopeInput = {
    storeCompanyId: 'co-a',
    storeStrategyId: 'strat-a',
    storeDepartments: [{ name: '営業部', projects: [] }],
    storeStrategyFields: {},
    storeCompanyName: '架空会社',
    storeHydrated: true,
    storeRestoreReady: true,
    storeIsRestoring: false,
    storePendingCompanyId: null,
    userCompanyId: 'co-a',
    userRole: 'member',
  };

  it('読み込み中・会社切替中・復元中は、前の情報を出さない（LOADING）', () => {
    expect(stage3SourceFromScope({ ...ready, storeHydrated: false }).status).toBe('LOADING');
    expect(stage3SourceFromScope({ ...ready, storeRestoreReady: false }).status).toBe('LOADING');
    expect(stage3SourceFromScope({ ...ready, storeIsRestoring: true }).status).toBe('LOADING');
    expect(stage3SourceFromScope({ ...ready, storePendingCompanyId: 'co-b' }).status).toBe('LOADING');
    expect(stage3SourceFromScope({ ...ready, userRole: null }).status).toBe('LOADING');
  });

  it('ストアの企業が所属企業と違えば、何も出さない（SCOPE_MISMATCH）', () => {
    expect(stage3SourceFromScope({ ...ready, storeCompanyId: 'co-b' }).status).toBe('SCOPE_MISMATCH');
  });

  it('企業や戦略がなければ、戦略なしとして扱う（NO_STRATEGY）', () => {
    expect(stage3SourceFromScope({ ...ready, storeCompanyId: null }).status).toBe('NO_STRATEGY');
    expect(stage3SourceFromScope({ ...ready, storeStrategyId: null }).status).toBe('NO_STRATEGY');
  });

  it('準備ができたら、所属企業と戦略の1件だけを渡す。企業名がなければ補わない', () => {
    const r = stage3SourceFromScope(ready);
    expect(r.status).toBe('READY');
    if (r.status !== 'READY') return;
    expect(r.memberships).toEqual([{ company_id: 'co-a', role: 'member' }]);
    expect(r.strategies).toEqual([{ id: 'strat-a', company_id: 'co-a', departments: ready.storeDepartments }]);
    expect(r.companyLabels).toEqual({ 'co-a': '架空会社' });
    const noName = stage3SourceFromScope({ ...ready, storeCompanyName: null });
    expect(noName.status === 'READY' && noName.companyLabels).toEqual({ 'co-a': '企業名未設定' });
  });
});
