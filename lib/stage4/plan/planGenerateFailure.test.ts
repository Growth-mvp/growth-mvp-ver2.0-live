import { STAGE3_SNAPSHOT_STRATEGIES } from '@/lib/stage4/planView/fixtures/stage3Snapshot';
import { generatePlanDraft, type GenerateDeps } from './planGenerate';
import type { GatewayResult, PlanGateway, ServiceContext } from './planService';
import type { PlanDocRecord } from './planDocumentStore';
import type { RawPlanStrategy } from './source';

const CO = 'fict-co-a';
const ST = 'fict-strategy-a';
const PROJECT = 'fict-proj-renewal';
const KEY = { companyId: CO, strategyId: ST, projectId: PROJECT };
const ok = <T,>(value: T): GatewayResult<T> => ({ ok: true, value });
const record = (status: PlanDocRecord['status']): PlanDocRecord => ({
  key: KEY,
  version: 1,
  aiDraft: {},
  userEdits: {},
  adopted: false,
  updatedAt: '2026-11-10T00:00:00.000Z',
  updatedBy: 'u',
  status,
  adoption: null,
  startInfo: null,
});

function gateway() {
  const calls = { claim: 0, complete: 0, fail: 0 };
  const g = {
    membershipRole: async () => ok('member'),
    readStrategyRow: async () => ok(JSON.parse(JSON.stringify(STAGE3_SNAPSHOT_STRATEGIES[0])) as Record<string, unknown>),
    claimGeneration: async () => {
      calls.claim += 1;
      return ok({ claimed: true as const, record: record('GENERATING') });
    },
    completeGeneration: async () => {
      calls.complete += 1;
      return ok(record('DRAFT'));
    },
    failGeneration: async () => {
      calls.fail += 1;
      return ok(record('GENERATION_FAILED'));
    },
  } as unknown as PlanGateway;
  return { g, calls };
}

const deps = (modelFor: GenerateDeps['modelFor']): GenerateDeps => ({
  now: () => '2026-11-10T00:00:00.000Z',
  currentYm: () => '2026-11',
  mapStrategy: (row) => row as unknown as RawPlanStrategy,
  modelFor,
});
const args = { companyId: CO, strategyId: ST, projectId: PROJECT, companyName: '架空' };
const apiError = (name: string, status?: number) => Object.assign(new Error(name), { name, status });

/* モデルの呼び出し回数と、失敗時に何が書かれたかを確かめる（失敗しても既存の計画は変えない） */
async function failingRun(model: () => Promise<string>) {
  const t = gateway();
  let modelCalls = 0;
  const out = await generatePlanDraft(
    { userId: 'u-1', gateway: t.g } as ServiceContext,
    args,
    deps(async () => async () => {
      modelCalls += 1;
      return { text: await model() };
    }),
  );
  return { out, modelCalls, calls: t.calls };
}

describe('実行計画書の生成の失敗を原因ごとに分ける（課題No.3・18・29）', () => {
  it('時間切れは TIMEOUT。モデルは1回だけ呼び、内容は保存しない', async () => {
    const r = await failingRun(async () => {
      throw apiError('APIConnectionTimeoutError');
    });
    expect(r.out).toMatchObject({ status: 'MODEL_FAILED', cause: 'TIMEOUT' });
    expect((r.out as { message: string }).message).toContain('保存されていません');
    expect(r.modelCalls).toBe(1);
    expect(r.calls).toEqual({ claim: 1, complete: 0, fail: 1 });
  });

  it('通信・一時的な障害は TRANSPORT', async () => {
    const r = await failingRun(async () => {
      throw apiError('APIConnectionError');
    });
    expect(r.out).toMatchObject({ status: 'MODEL_FAILED', cause: 'TRANSPORT' });
    expect(r.calls.complete).toBe(0);
  });

  it('それ以外のモデルの失敗は MODEL', async () => {
    const r = await failingRun(async () => {
      throw apiError('BadRequestError', 400);
    });
    expect(r.out).toMatchObject({ status: 'MODEL_FAILED', cause: 'MODEL' });
  });

  it('モデルの出力がJSONでなければ VALIDATION。案内を付け、既存の計画は変えない（再生成の全体の繰り返しはしない）', async () => {
    const r = await failingRun(async () => 'これはJSONではありません');
    expect(r.out).toMatchObject({ status: 'INVALID', cause: 'VALIDATION' });
    const messages = (r.out as { messages: string[] }).messages;
    expect(messages.at(-1)).toContain('既存の計画は変わっていません');
    expect(r.modelCalls).toBe(1);
    expect(r.calls.complete).toBe(0);
  });
});
