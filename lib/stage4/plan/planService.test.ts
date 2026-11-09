import {
  assignProjectIdentity,
  createPlan,
  loadPlan,
  readStrategyProjects,
  updatePlan,
  type GatewayResult,
  type IdentityRpcResult,
  type PlanGateway,
  type ServiceContext,
} from './planService';
import type { PlanDocRecord } from './planDocumentStore';

const CO = 'co-a';
const KEY = { companyId: CO, strategyId: 'st-a', projectId: 'p-1' };
const rec = (version: number): PlanDocRecord => ({
  key: KEY,
  version,
  aiDraft: { mock: true },
  userEdits: { x: String(version) },
  adopted: false,
  updatedAt: '2026-11-10T00:00:00.000Z',
  updatedBy: 'u',
});

/* 権限の確認と、各操作の結果だけを決められる最小のゲートウェイ */
function fakeGateway(over: Partial<PlanGateway> & { role?: string | null } = {}): PlanGateway {
  const ok = <T,>(value: T): GatewayResult<T> => ({ ok: true, value });
  return {
    membershipRole: async () => ok(over.role === undefined ? 'member' : over.role),
    findPlan: async () => ok(null),
    insertPlan: async () => ok(rec(1)),
    updatePlan: async () => ok(rec(2)),
    readStrategy: async () => ok(null),
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
    expect(await createPlan(ctx(g), KEY, { aiDraft: {}, userEdits: {}, adopted: false })).toEqual({ status: 'DENIED' });
    expect(await updatePlan(ctx(g), KEY, 1, { userEdits: {}, adopted: false })).toEqual({ status: 'DENIED' });
    expect((await assignProjectIdentity(ctx(g), identity())).status).toBe('DENIED');
    expect((await readStrategyProjects(ctx(g), CO, 'st-a')).status).toBe('DENIED');
  });

  it('許可されていない役割は拒否する', async () => {
    expect(await loadPlan(ctx(fakeGateway({ role: 'viewer' })), KEY)).toEqual({ status: 'DENIED' });
  });
});

describe('草案の作成と更新', () => {
  it('同じキーの二重作成は、競合として最新の内容を返す', async () => {
    const g = fakeGateway({
      insertPlan: async () => ({ ok: false, code: 'DUPLICATE' }),
      findPlan: async () => ({ ok: true, value: rec(3) }),
    });
    const out = await createPlan(ctx(g), KEY, { aiDraft: {}, userEdits: {}, adopted: false });
    expect(out.status === 'CONFLICT' && out.current.version).toBe(3);
  });

  it('データベースが拒否した作成は DENIED（他社の紐づけなど）', async () => {
    const g = fakeGateway({ insertPlan: async () => ({ ok: false, code: 'FORBIDDEN' }) });
    expect(await createPlan(ctx(g), KEY, { aiDraft: {}, userEdits: {}, adopted: false })).toEqual({ status: 'DENIED' });
  });

  it('版番号が合わない更新（0件）は、対象があれば競合、無ければ対象なし', async () => {
    const conflict = fakeGateway({ updatePlan: async () => ({ ok: true, value: null }), findPlan: async () => ({ ok: true, value: rec(2) }) });
    const out = await updatePlan(ctx(conflict), KEY, 1, { userEdits: {}, adopted: false });
    expect(out.status === 'CONFLICT' && out.current.version).toBe(2);
    const missing = fakeGateway({ updatePlan: async () => ({ ok: true, value: null }), findPlan: async () => ({ ok: true, value: null }) });
    expect(await updatePlan(ctx(missing), KEY, 1, { userEdits: {}, adopted: false })).toEqual({ status: 'NOT_FOUND' });
  });

  it('通信や保存の失敗は、失敗として返す（成功とは見せない）', async () => {
    const g = fakeGateway({ updatePlan: async () => ({ ok: false, code: 'ERROR' }) });
    const out = await updatePlan(ctx(g), KEY, 1, { userEdits: {}, adopted: false });
    expect(out.status).toBe('FAILED');
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
      readStrategy: async () => ({
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
    const g = fakeGateway({ readStrategy: async () => ({ ok: true, value: null }) });
    expect(await readStrategyProjects(ctx(g), CO, 'st-a')).toEqual({ status: 'NOT_FOUND' });
  });
});
