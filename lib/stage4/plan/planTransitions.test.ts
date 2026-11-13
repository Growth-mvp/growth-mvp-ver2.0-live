import { STAGE3_SNAPSHOT_STRATEGIES } from '@/lib/stage4/planView/fixtures/stage3Snapshot';
import { generateMockExecutionPlan } from './mockGenerate';
import type { PlanDocRecord } from './planDocumentStore';
import type { GatewayResult, PlanGateway, PlanPatch, ServiceContext } from './planService';
import { transitionPlan, validateRegulatory, type TransitionAction } from './planTransitions';
import type { RawPlanStrategy } from './source';

const CO = 'fict-co-a';
const ST = 'fict-strategy-a';
const RENEWAL = 'fict-proj-renewal';
const NOW = '2026-11-10T00:00:00.000Z';
const KEY = { companyId: CO, strategyId: ST, projectId: RENEWAL };
const REG_OK = {
  decision: 'NOT_APPLICABLE',
  judgement: '医療機器の製造販売には当たらない',
  basis: '社内の該当性チェック表',
  confirmer: '法務 山田',
  confirmedOn: '2026-11-08',
};

let draft: Record<string, unknown>;
beforeAll(async () => {
  const r = await generateMockExecutionPlan({
    strategy: JSON.parse(JSON.stringify(STAGE3_SNAPSHOT_STRATEGIES[0])) as RawPlanStrategy,
    membershipCompanyId: CO,
    requestedStrategyId: ST,
    requestedProjectId: RENEWAL,
    currentYm: '2026-11',
    companyName: '架空',
    createdAt: NOW,
  });
  if (r.status !== 'READY') throw new Error('mock draft must be ready');
  draft = r.bundle;
});

function record(over: Partial<PlanDocRecord> = {}): PlanDocRecord {
  return {
    key: KEY,
    version: 5,
    aiDraft: draft,
    userEdits: {},
    adopted: false,
    updatedAt: NOW,
    updatedBy: 'u',
    status: 'DRAFT',
    adoption: null,
    startInfo: null,
    regulatory: undefined,
    ...over,
  };
}

function fake(initial: PlanDocRecord | null, opts: { role?: string | null; strategy?: Record<string, unknown> } = {}) {
  let current = initial;
  const patches: PlanPatch[] = [];
  const ok = <T,>(value: T): GatewayResult<T> => ({ ok: true, value });
  const gateway = {
    membershipRole: async () => ok(opts.role === undefined ? 'member' : opts.role),
    readStrategyRow: async () => ok(opts.strategy ?? JSON.parse(JSON.stringify(STAGE3_SNAPSHOT_STRATEGIES[0]))),
    findPlan: async () => ok(current),
    updatePlan: async (_k: unknown, expected: number, patch: PlanPatch, userId: string) => {
      patches.push(patch);
      if (!current || current.version !== expected) return ok(null);
      const next: PlanDocRecord = {
        ...current,
        version: current.version + 1,
        updatedBy: userId,
        aiDraft: patch.aiDraft !== undefined ? patch.aiDraft : current.aiDraft,
        adoption: patch.adoption !== undefined ? patch.adoption : current.adoption,
        adopted: patch.adoption !== undefined ? patch.adoption !== null : current.adopted,
        startInfo: patch.startInfo !== undefined ? patch.startInfo : current.startInfo,
        regulatory: patch.regulatory !== undefined ? patch.regulatory : current.regulatory,
        userEdits: patch.userEdits ?? current.userEdits,
      };
      current = next;
      return ok(next);
    },
  } as unknown as PlanGateway;
  return { gateway, patches, get: () => current };
}

const ctxOf = (g: PlanGateway, userId = 'alice'): ServiceContext => ({ userId, gateway: g });
const act = (g: PlanGateway, version: number, action: TransitionAction, regulatory?: unknown, userId = 'alice') =>
  transitionPlan(ctxOf(g, userId), KEY, version, action, { regulatory, now: NOW });

function strategyWith(edit: (kpis: Array<Record<string, unknown>>) => Array<Record<string, unknown>>) {
  const row = JSON.parse(JSON.stringify(STAGE3_SNAPSHOT_STRATEGIES[0]));
  for (const d of row.departments as Array<{ projects: Array<Record<string, unknown>> }>) {
    for (const p of d.projects) if (p.id === RENEWAL) p.okrsV2 = edit(p.okrsV2 as Array<Record<string, unknown>>);
  }
  return row;
}

describe('規制・安全の判断の検査', () => {
  it('該当性がなければ記録できない', () => {
    expect(validateRegulatory({})).toMatchObject({ ok: false });
  });

  it('判断・根拠・確認者・確認日が揃わなければ記録できない（「確認済み」だけでは通さない）', () => {
    expect(validateRegulatory({ decision: 'NOT_APPLICABLE' })).toMatchObject({ ok: false });
    expect(validateRegulatory({ ...REG_OK, basis: '' })).toMatchObject({ ok: false });
    expect(validateRegulatory({ ...REG_OK, confirmedOn: '2026/11/08' })).toMatchObject({ ok: false });
  });

  it('揃っていれば記録できる。未確認は、確認内容が無くても保留として記録できる', () => {
    expect(validateRegulatory(REG_OK)).toMatchObject({ ok: true });
    expect(validateRegulatory({ decision: 'UNCONFIRMED' })).toMatchObject({ ok: true });
  });
});

describe('採用', () => {
  it('草案を、採用者・日時・対象の版つきで採用する', async () => {
    const f = fake(record());
    const out = await act(f.gateway, 5, 'ADOPT');
    expect(out.status).toBe('OK');
    expect(f.get()?.adoption).toMatchObject({ version: 5, byUserId: 'alice', at: NOW });
    expect(f.get()?.adopted).toBe(true);
  });

  it('採用済みなら、何も書き換えない', async () => {
    const f = fake(record({ adopted: true, adoption: { version: 5, byUserId: 'bob', at: NOW, edits: {} } }));
    await act(f.gateway, 5, 'ADOPT');
    expect(f.patches).toHaveLength(0);
  });

  it('版番号が違えば競合（採用後に変わった内容は採用しない）', async () => {
    const f = fake(record({ version: 6 }));
    const out = await act(f.gateway, 5, 'ADOPT');
    expect(out.status === 'CONFLICT' && out.current.version).toBe(6);
    expect(f.patches).toHaveLength(0);
  });

  it('生成中の計画は採用できない（NOT_READY）', async () => {
    const f = fake(record({ status: 'GENERATING' }));
    expect((await act(f.gateway, 5, 'ADOPT')).status).toBe('NOT_READY');
  });

  it('所属していなければ DENIED', async () => {
    const f = fake(record(), { role: null });
    expect((await act(f.gateway, 5, 'ADOPT')).status).toBe('DENIED');
  });

  it('採用を取り消すと、開始も一緒に解除する', async () => {
    const f = fake(record({ adopted: true, adoption: { version: 5, byUserId: 'alice', at: NOW, edits: {} } }));
    await act(f.gateway, 5, 'UNADOPT');
    expect(f.get()?.adopted).toBe(false);
    expect(f.patches[0]).toEqual({ adoption: null, startInfo: null });
  });
});

describe('規制・安全の記録と実行開始', () => {
  it('規制・安全の記録が不完全なら、記録しない（INVALID）', async () => {
    const f = fake(record());
    expect((await act(f.gateway, 5, 'RECORD_REGULATORY', { decision: 'NOT_APPLICABLE' })).status).toBe('INVALID');
    expect(f.patches).toHaveLength(0);
  });

  it('採用していなくても、開始は採用を内部で行ってから開始する（保存された採用の記録も残る）', async () => {
    const f = fake(record({ userEdits: { responsible: '鈴木一郎（仮）' } }));
    const out = await act(f.gateway, 5, 'START');
    expect(out.status).toBe('OK');
    expect(f.get()?.adoption).not.toBeNull();
    expect(f.get()?.startInfo).not.toBeNull();
  });

  it('実行責任者や実行前の確認が無いと、開始できない（画面と同じ判定）', async () => {
    const f = fake(record({ adopted: true, adoption: { version: 5, byUserId: 'alice', at: NOW, edits: {} }, regulatory: REG_OK as never }));
    const out = await act(f.gateway, 5, 'START');
    expect(out.status === 'BLOCKED' && out.blockers.join(' ')).toContain('実行責任者');
  });

  it('「未確認」の記録は開始を止めず、記録も確認済みに変えない（準備活動として開始する）', async () => {
    const edits = { responsible: '鈴木一郎（仮）', 'task:verify-1': true };
    const f = fake(record({ userEdits: edits, regulatory: { decision: 'UNCONFIRMED' } as never, adopted: true, adoption: { version: 5, byUserId: 'alice', at: NOW, edits } }));
    const out = await act(f.gateway, 5, 'START');
    expect(out.status).toBe('OK');
    expect(f.get()?.startInfo).not.toBeNull();
    expect(f.get()?.regulatory).toMatchObject({ decision: 'UNCONFIRMED' });
  });

  it('KPIが後から追加されても、採用・開始は止まらず、保護一覧は最新の正式KPIに合う（本文は変えない）', async () => {
    const edits = { responsible: '鈴木一郎（仮）' };
    const extra = strategyWith((kpis) => [...kpis, { id: 'kr-renew-9', label: '後から追加した指標', target: 4, unit: '件', due: '2027-03', owner: null, targetBasis: 'USER_CONFIRMED' }]);
    const f = fake(record({ userEdits: edits }), { strategy: extra });
    const before = JSON.stringify((draft as { plan: { section1: unknown } }).plan.section1);
    const out = await act(f.gateway, 5, 'START');
    expect(out.status).toBe('OK');
    const plan = (f.get()?.aiDraft as { plan: { section1: unknown; section3: { protectedKpis: Array<{ stage3KpiId: string; target: unknown }> } } }).plan;
    expect(plan.section3.protectedKpis.map((k) => k.stage3KpiId)).toContain('kr-renew-9');
    expect(JSON.stringify(plan.section1)).toBe(before);
  });

  it('KPIの目標値が変わっても止めず、保護一覧に最新の目標値を出す。目標が未入力なら0にしない', async () => {
    const edits = { responsible: '鈴木一郎（仮）' };
    const changed = strategyWith((kpis) => kpis.map((k) => (k.id === 'kr-renew-1' ? { ...k, target: 120 } : k.id === 'kr-renew-2' ? { ...k, target: null } : k)));
    const f = fake(record({ userEdits: edits }), { strategy: changed });
    expect((await act(f.gateway, 5, 'START')).status).toBe('OK');
    const list = (f.get()?.aiDraft as { plan: { section3: { protectedKpis: Array<{ stage3KpiId: string; target: unknown }> } } }).plan.section3.protectedKpis;
    expect(list.find((k) => k.stage3KpiId === 'kr-renew-1')?.target).toBe(120);
    expect(list.find((k) => k.stage3KpiId === 'kr-renew-2')?.target).toBeNull();
  });

  it('対象プロジェクトが正式データに無ければ、採用も開始もせず、理由を返す', async () => {
    const row = JSON.parse(JSON.stringify(STAGE3_SNAPSHOT_STRATEGIES[0]));
    for (const d of row.departments as Array<{ projects: Array<Record<string, unknown>> }>) {
      d.projects = d.projects.filter((p) => p.id !== RENEWAL);
    }
    const f = fake(record({ userEdits: { responsible: '鈴木一郎（仮）' } }), { strategy: row });
    const out = await act(f.gateway, 5, 'ADOPT');
    expect(out.status === 'BLOCKED' && out.blockers.join(' ')).toContain('対象プロジェクト');
    expect(f.get()?.adoption).toBeNull();
  });

  it('草案の差し替え：採用前なら新しい案に替わり、利用者の編集は残る。採用後は差し替えられない', async () => {
    const edits = { responsible: '鈴木一郎（仮）' };
    const f = fake(record({ userEdits: edits }));
    const newDraft = JSON.parse(JSON.stringify(draft)) as Record<string, unknown> & { plan: { section1: { goalState: { text: string } } } };
    newDraft.plan.section1.goalState.text = '新しい案の目指す状態';
    const replaced = await transitionPlan(ctxOf(f.gateway, 'alice'), KEY, 5, 'USE_DRAFT', { now: NOW, aiDraft: newDraft });
    expect(replaced.status).toBe('OK');
    expect(f.get()?.aiDraft).toEqual(newDraft);
    expect(f.get()?.userEdits).toEqual(edits);
    const adopted = await act(f.gateway, 6, 'ADOPT');
    expect(adopted.status).toBe('OK');
    const after = await transitionPlan(ctxOf(f.gateway, 'alice'), KEY, 7, 'USE_DRAFT', { now: NOW, aiDraft: newDraft });
    expect(after.status).toBe('NOT_READY');
  });

  it('規制・安全の判断が無くても、条件が揃えば開始でき、規制の記録は作られない', async () => {
    const edits = { responsible: '鈴木一郎（仮）', 'task:verify-1': true };
    const f = fake(record({ userEdits: edits, adopted: true, adoption: { version: 5, byUserId: 'alice', at: NOW, edits } }));
    const out = await act(f.gateway, 5, 'START');
    expect(out.status).toBe('OK');
    expect(f.get()?.regulatory).toBeUndefined();
  });

  it('条件と規制の判断が揃えば、開始者・日時・対象の版を残して開始する', async () => {
    const edits = { responsible: '鈴木一郎（仮）', 'task:verify-1': true };
    const f = fake(record({ userEdits: edits, regulatory: REG_OK as never, adopted: true, adoption: { version: 5, byUserId: 'alice', at: NOW, edits } }));
    const out = await act(f.gateway, 5, 'START');
    expect(out.status).toBe('OK');
    expect(f.get()?.startInfo).toEqual({ version: 5, byUserId: 'alice', at: NOW });
  });

  it('開始の取り消しは、開始の記録だけを消す', async () => {
    const edits = { responsible: '鈴木一郎（仮）', 'task:verify-1': true };
    const f = fake(record({ userEdits: edits, regulatory: REG_OK as never, adopted: true, adoption: { version: 5, byUserId: 'alice', at: NOW, edits }, startInfo: { version: 5, byUserId: 'alice', at: NOW } }));
    await act(f.gateway, 5, 'UNSTART');
    expect(f.get()?.startInfo).toBeNull();
    expect(f.get()?.adopted).toBe(true);
  });
});
