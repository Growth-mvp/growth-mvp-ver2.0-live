import {
  assignProjectIdentity,
  loadPlan,
  readStrategyProjects,
  saveEdits,
  type GatewayResult,
  type IdentityRpcResult,
  type PlanGateway,
  type ServiceContext,
} from './planService';
import type { PlanDocRecord } from './planDocumentStore';

const CO = 'co-a';
const KEY = { companyId: CO, strategyId: 'st-a', projectId: 'p-1' };
const rec = (version: number, status: PlanDocRecord['status'] = 'DRAFT'): PlanDocRecord => ({
  key: KEY,
  version,
  aiDraft: { mock: true },
  userEdits: { x: String(version) },
  adopted: false,
  updatedAt: '2026-11-10T00:00:00.000Z',
  updatedBy: 'u',
  status,
  adoption: null,
  startInfo: null,
});

/* 権限の確認と、各操作の結果だけを決められる最小のゲートウェイ */
function fakeGateway(over: Partial<PlanGateway> & { role?: string | null } = {}): PlanGateway {
  const ok = <T,>(value: T): GatewayResult<T> => ({ ok: true, value });
  return {
    membershipRole: async () => ok(over.role === undefined ? 'member' : over.role),
    findPlan: async () => ok(null),
    listEvents: async () => ok([]),
    claimGeneration: async () => ok({ claimed: true, record: rec(1, 'GENERATING') }),
    completeGeneration: async () => ok(rec(1)),
    failGeneration: async () => ok(null),
    updatePlan: async () => ok(rec(2)),
    readStrategyRow: async () => ok(null),
    assignIdentity: async () => ok<IdentityRpcResult>({ status: 'ASSIGNED', projectId: 'new', revision: 2, alreadyAssigned: false }),
    ...over,
  } as PlanGateway;
}
const ctx = (gateway: PlanGateway): ServiceContext => ({ userId: 'u-1', gateway });
const identity = () => ({
  companyId: CO,
  strategyId: 'st-a',
  departmentIndex: 0,
  projectIndex: 0,
  expectedTitle: '案件',
  expectedRevision: 5,
  newId: 'new',
});

describe('権限（会社への所属は、データベースの役割で確かめる）', () => {
  it('所属していない（役割が無い）利用者は、読み書きも番号の付与もできない', async () => {
    const g = fakeGateway({ role: null });
    expect(await loadPlan(ctx(g), KEY)).toEqual({ status: 'DENIED' });
    expect(await saveEdits(ctx(g), KEY, 1, {})).toEqual({ status: 'DENIED' });
    expect((await assignProjectIdentity(ctx(g), identity())).status).toBe('DENIED');
    expect((await readStrategyProjects(ctx(g), CO, 'st-a')).status).toBe('DENIED');
  });

  it('許可されていない役割は拒否する', async () => {
    expect(await loadPlan(ctx(fakeGateway({ role: 'viewer' })), KEY)).toEqual({ status: 'DENIED' });
  });
});

describe('草案の読み込み', () => {
  it('草案があれば、操作の履歴と一緒に返す', async () => {
    const g = fakeGateway({
      findPlan: async () => ({ ok: true, value: rec(3) }),
      listEvents: async () => ({ ok: true, value: [{ action: 'SAVED', version: 3, actorUserId: 'u', at: 'x', payload: {} }] }),
    });
    const out = await loadPlan(ctx(g), KEY);
    expect(out.status === 'FOUND' && out.record.events?.map((e) => e.action)).toEqual(['SAVED']);
  });

  it('草案が無ければ NONE', async () => {
    expect(await loadPlan(ctx(fakeGateway()), KEY)).toEqual({ status: 'NONE' });
  });
});

describe('修正の保存（採用や開始の状態は変えられない）', () => {
  it('修正だけを、読んだ版番号と一致した時に保存する', async () => {
    let sent: unknown = null;
    const g = fakeGateway({
      updatePlan: async (_k, _v, patch) => {
        sent = patch;
        return { ok: true, value: rec(2) };
      },
    });
    const out = await saveEdits(ctx(g), KEY, 1, { a: 'x' });
    expect(out.status).toBe('SAVED');
    expect(sent).toEqual({ userEdits: { a: 'x' } });
  });

  it('版番号が合わなければ、最新の内容を返す（競合）', async () => {
    const g = fakeGateway({ updatePlan: async () => ({ ok: true, value: null }), findPlan: async () => ({ ok: true, value: rec(2) }) });
    const out = await saveEdits(ctx(g), KEY, 1, {});
    expect(out.status === 'CONFLICT' && out.current.version).toBe(2);
  });

  it('生成中の計画は、修正の保存を受け付けない（NOT_READY）', async () => {
    const g = fakeGateway({ updatePlan: async () => ({ ok: true, value: null }), findPlan: async () => ({ ok: true, value: rec(1, 'GENERATING') }) });
    expect((await saveEdits(ctx(g), KEY, 1, {})).status).toBe('NOT_READY');
  });

  it('対象が無ければ NOT_FOUND、データベースが拒否すれば DENIED、通信の失敗は失敗として返す', async () => {
    const missing = fakeGateway({ updatePlan: async () => ({ ok: true, value: null }), findPlan: async () => ({ ok: true, value: null }) });
    expect((await saveEdits(ctx(missing), KEY, 1, {})).status).toBe('NOT_FOUND');
    const forbidden = fakeGateway({ updatePlan: async () => ({ ok: false, code: 'FORBIDDEN' }) });
    expect((await saveEdits(ctx(forbidden), KEY, 1, {})).status).toBe('DENIED');
    const down = fakeGateway({ updatePlan: async () => ({ ok: false, code: 'ERROR' }) });
    expect((await saveEdits(ctx(down), KEY, 1, {})).status).toBe('FAILED');
  });
});

describe('番号の付与（データベースの関数の結果を、画面の結果に変える）', () => {
  const mapped = async (rpc: IdentityRpcResult) =>
    (await assignProjectIdentity(ctx(fakeGateway({ assignIdentity: async () => ({ ok: true, value: rpc }) })), identity())).status;

  it('各結果を、画面で使う結果に変える', async () => {
    expect(await mapped({ status: 'REVISION_CHANGED', revision: 6 })).toBe('REVISION_CHANGED');
    expect(await mapped({ status: 'TITLE_CHANGED' })).toBe('TITLE_CHANGED');
    expect(await mapped({ status: 'ID_IN_USE' })).toBe('ID_IN_USE');
    expect(await mapped({ status: 'NOT_FOUND' })).toBe('NOT_FOUND');
    expect(await mapped({ status: 'INVALID' })).toBe('INVALID');
    expect(await mapped({ status: 'FORBIDDEN' })).toBe('FORBIDDEN');
  });

  it('付与できた時は番号と版番号を返す。既にあった番号も同じ扱い（alreadyAssigned）', async () => {
    const out = await assignProjectIdentity(ctx(fakeGateway()), identity());
    expect(out).toEqual({ status: 'ASSIGNED', projectId: 'new', revision: 2, alreadyAssigned: false });
  });

  it('関数の呼び出しに失敗したら、失敗として返す', async () => {
    const g = fakeGateway({ assignIdentity: async () => ({ ok: false, code: 'ERROR' }) });
    expect((await assignProjectIdentity(ctx(g), identity())).status).toBe('FAILED');
  });
});

describe('戦略の読み取り（番号の確認に使う）', () => {
  it('各プロジェクトの位置・名称・番号（無ければ null）を返す', async () => {
    const g = fakeGateway({
      readStrategyRow: async () => ({
        ok: true,
        value: {
          revision: 7,
          departments: [
            { name: '営業部', projects: [{ id: 'p-a', title: ' 案件A ' }, { title: '案件B' }] },
            { name: '設計部', projects: [{ id: 'p-c', title: '案件C' }] },
          ],
        },
      }),
    });
    const out = await readStrategyProjects(ctx(g), CO, 'st-a');
    expect(out).toEqual({
      status: 'FOUND',
      revision: 7,
      projects: [
        { departmentIndex: 0, projectIndex: 0, title: '案件A', projectId: 'p-a' },
        { departmentIndex: 0, projectIndex: 1, title: '案件B', projectId: null },
        { departmentIndex: 1, projectIndex: 0, title: '案件C', projectId: 'p-c' },
      ],
    });
  });

  it('戦略が見つからなければ NOT_FOUND', async () => {
    const g = fakeGateway({ readStrategyRow: async () => ({ ok: true, value: null }) });
    expect(await readStrategyProjects(ctx(g), CO, 'st-a')).toEqual({ status: 'NOT_FOUND' });
  });
});
