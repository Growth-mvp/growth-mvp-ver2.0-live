import { STAGE3_SNAPSHOT_STRATEGIES } from '@/lib/stage4/planView/fixtures/stage3Snapshot';
import { createMockModel } from './mockGenerate';
import { generatePlanDraft, type GenerateDeps } from './planGenerate';
import type { GatewayResult, PlanGateway, ServiceContext } from './planService';
import type { PlanDocRecord } from './planDocumentStore';
import type { RawPlanStrategy } from './source';

const CO = 'fict-co-a';
const ST = 'fict-strategy-a';
const RENEWAL = 'fict-proj-renewal';
const rec = (status: PlanDocRecord['status'], version = 1): PlanDocRecord => ({
  key: { companyId: CO, strategyId: ST, projectId: RENEWAL },
  version,
  aiDraft: { x: 1 },
  userEdits: {},
  adopted: false,
  updatedAt: '2026-11-10T00:00:00.000Z',
  updatedBy: 'u',
  status,
  adoption: null,
  startInfo: null,
});

function strategyRow(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  const base = JSON.parse(JSON.stringify(STAGE3_SNAPSHOT_STRATEGIES[0])) as Record<string, unknown>;
  return { ...base, ...overrides };
}

type Calls = { claim: number; complete: number; fail: number };
function gateway(opts: { role?: string | null; row?: Record<string, unknown> | null; claim?: 'claimed' | GatewayResult<never> | { existing: PlanDocRecord }; claimSeq?: Array<'claimed' | { existing: PlanDocRecord }>; complete?: PlanDocRecord | null } = {}) {
  const calls: Calls = { claim: 0, complete: 0, fail: 0 };
  let completed: Record<string, unknown> | null = null;
  const ok = <T,>(value: T): GatewayResult<T> => ({ ok: true, value });
  const g = {
    membershipRole: async () => ok(opts.role === undefined ? 'member' : opts.role),
    readStrategyRow: async () => ok(opts.row === undefined ? strategyRow() : opts.row),
    claimGeneration: async () => {
      calls.claim += 1;
      const c = opts.claimSeq?.shift() ?? opts.claim ?? 'claimed';
      if (c === 'claimed') return ok({ claimed: true as const, record: rec('GENERATING') });
      if (typeof c === 'object' && 'existing' in c) return ok({ claimed: false as const, existing: c.existing });
      return c as GatewayResult<never>;
    },
    completeGeneration: async (_k: unknown, _u: unknown, aiDraft: Record<string, unknown>) => {
      calls.complete += 1;
      completed = aiDraft;
      return ok(opts.complete === undefined ? rec('DRAFT') : opts.complete);
    },
    failGeneration: async () => {
      calls.fail += 1;
      return ok(rec('GENERATION_FAILED'));
    },
  } as unknown as PlanGateway;
  return { g, calls, completed: () => completed };
}

const ctxOf = (g: PlanGateway): ServiceContext => ({ userId: 'u-1', gateway: g });
const deps = (over: Partial<GenerateDeps> = {}): GenerateDeps => ({
  now: () => '2026-11-10T00:00:00.000Z',
  currentYm: () => '2026-11',
  mapStrategy: (row) => row as unknown as RawPlanStrategy,
  modelFor: async (raw) => {
    const mock = createMockModel(raw);
    return async (prompt) => mock(prompt);
  },
  ...over,
});
const args = { companyId: CO, strategyId: ST, projectId: RENEWAL, companyName: '架空' };

describe('実行計画書の生成（サーバーの経路）', () => {
  it('権利を取り、モデルを1回呼び、草案を保存して返す（サーバーが作った草案だと分かる）', async () => {
    const t = gateway();
    let modelCalls = 0;
    const out = await generatePlanDraft(
      ctxOf(t.g),
      args,
      deps({
        modelFor: async (raw) => {
          const mock = createMockModel(raw);
          return async (prompt) => {
            modelCalls += 1;
            return mock(prompt);
          };
        },
      })
    );
    expect(out.status).toBe('CREATED');
    expect(modelCalls).toBe(1);
    expect(t.calls).toEqual({ claim: 1, complete: 1, fail: 0 });
    const draft = t.completed() as { rawOutput: string; generatedBy: string };
    expect(typeof draft.rawOutput).toBe('string');
    expect(draft.generatedBy).toBe('SERVER');
  });

  it('草案が既にあれば、AIを呼ばずに既存の草案を返す（再生成しない）', async () => {
    const existing = rec('DRAFT');
    const t = gateway({ claim: { existing } });
    let modelCalls = 0;
    const out = await generatePlanDraft(ctxOf(t.g), args, deps({ modelFor: async () => { modelCalls += 1; throw new Error('not called'); } }));
    expect(out).toEqual({ status: 'EXISTS', record: existing });
    expect(modelCalls).toBe(0);
    expect(t.calls.complete).toBe(0);
  });

  it('他の社員が生成中なら、二重に呼ばない（IN_PROGRESS）', async () => {
    const t = gateway({ claim: { existing: rec('GENERATING') } });
    const out = await generatePlanDraft(ctxOf(t.g), args, deps({ modelFor: async () => { throw new Error('not called'); } }));
    expect(out.status).toBe('IN_PROGRESS');
    expect(t.calls.fail).toBe(0);
  });

  it('作成中のまま古くなった行（打ち切られた生成の残り）は、失敗として閉じてから、もう一度作る', async () => {
    const stale = { ...rec('GENERATING'), updatedAt: '2026-11-09T00:00:00.000Z' };
    const t = gateway({ claimSeq: [{ existing: stale }, 'claimed'] });
    const out = await generatePlanDraft(ctxOf(t.g), args, deps());
    expect(out.status).toBe('CREATED');
    expect(t.calls.fail).toBe(1);
    expect(t.calls.claim).toBe(2);
  });

  it('所属していなければ DENIED（権利も取らず、AIも呼ばない）', async () => {
    const t = gateway({ role: null });
    const out = await generatePlanDraft(ctxOf(t.g), args, deps());
    expect(out.status).toBe('DENIED');
    expect(t.calls.claim).toBe(0);
  });

  it('戦略が無い、またはプロジェクトが戦略に無ければ NOT_FOUND（権利も取らない）', async () => {
    expect((await generatePlanDraft(ctxOf(gateway({ row: null }).g), args, deps())).status).toBe('NOT_FOUND');
    expect((await generatePlanDraft(ctxOf(gateway().g), { ...args, projectId: 'no-such' }, deps())).status).toBe('NOT_FOUND');
  });

  it('SWOTが未入力なら、理由を返し、権利も取らない（AIに内容を創作させない）', async () => {
    const t = gateway({ row: strategyRow({ strength: '' }) });
    const out = await generatePlanDraft(ctxOf(t.g), args, deps());
    expect(out.status === 'INVALID' && out.messages[0]).toContain('STAGE2のSWOT（強み）が未入力');
    expect(t.calls.claim).toBe(0);
  });

  it('モデルの呼び出しが失敗したら、生成の失敗として記録し、草案は作らない', async () => {
    const t = gateway();
    const out = await generatePlanDraft(ctxOf(t.g), args, deps({ modelFor: async () => async () => { throw new Error('boom'); } }));
    expect(out.status).toBe('MODEL_FAILED');
    expect(t.calls.fail).toBe(1);
    expect(t.calls.complete).toBe(0);
  });

  it('モデルの出力が計画として検証できなければ、草案は作らず、理由を返す', async () => {
    const t = gateway();
    const out = await generatePlanDraft(ctxOf(t.g), args, deps({ modelFor: async () => async () => ({ text: 'not json' }) }));
    expect(out.status).toBe('INVALID');
    expect(t.calls.fail).toBe(1);
    expect(t.calls.complete).toBe(0);
  });

  it('同じIDのプロジェクトが複数あれば、別の案件の計画と混ざらないよう生成せず、権利も取らない', async () => {
    const row = strategyRow();
    const depts = row.departments as Array<{ projects: Array<Record<string, unknown>> }>;
    depts[depts.length - 1].projects.push({ id: RENEWAL, title: '同じIDの別案件', okrs: [] });
    const t = gateway({ row });
    const out = await generatePlanDraft(ctxOf(t.g), args, deps());
    expect(out.status).toBe('INVALID');
    expect(t.calls.claim).toBe(0);
  });
});
