/* 実行計画書の永続化の本体（サーバー側）。
 * 認証された利用者の会社への所属を、データベースから読んだ役割で確かめてから、ゲートウェイ経由で読み書きする。
 * ゲートウェイは利用者の権限のもとで動く（行単位の権限は、データベース側の規則で強制される）。 */
import type { UserEdits } from './mergeUserEdits';
import type { PlanDocKey, PlanDocRecord } from './planDocumentStore';
import { ALLOWED_ROLES, stableIdOf } from './projectResolver';

export const SAVE_FAILED = '保存できませんでした。編集内容はこの画面に残っています。もう一度保存してください。';

export type GatewayFailure = 'DUPLICATE' | 'FORBIDDEN' | 'CONFLICT' | 'ERROR';
export type GatewayResult<T> = { ok: true; value: T } | { ok: false; code: GatewayFailure; message?: string };

export type IdentityRpcStatus =
  | 'ASSIGNED'
  | 'REVISION_CHANGED'
  | 'TITLE_CHANGED'
  | 'ID_IN_USE'
  | 'INVALID'
  | 'NOT_FOUND'
  | 'FORBIDDEN';

export type IdentityRpcResult = {
  status: IdentityRpcStatus;
  projectId?: string;
  revision?: number;
  alreadyAssigned?: boolean;
};

export type StrategyView = {
  revision: number;
  departments: unknown;
};

/** 利用者の権限のもとで行う読み書き。実装は、Supabase（本番）や検証用のデータベースなど */
export interface PlanGateway {
  membershipRole(userId: string, companyId: string): Promise<GatewayResult<string | null>>;
  findPlan(key: PlanDocKey): Promise<GatewayResult<PlanDocRecord | null>>;
  insertPlan(
    key: PlanDocKey,
    input: { aiDraft: Record<string, unknown>; userEdits: UserEdits; adopted: boolean },
    userId: string
  ): Promise<GatewayResult<PlanDocRecord>>;
  /** 版番号が一致した時だけ更新する。一致しなければ value が null */
  updatePlan(
    key: PlanDocKey,
    expectedVersion: number,
    input: { userEdits: UserEdits; adopted: boolean },
    userId: string
  ): Promise<GatewayResult<PlanDocRecord | null>>;
  readStrategy(companyId: string, strategyId: string): Promise<GatewayResult<StrategyView | null>>;
  assignIdentity(args: {
    companyId: string;
    strategyId: string;
    departmentIndex: number;
    projectIndex: number;
    expectedTitle: string;
    expectedRevision: number;
    newId: string;
  }): Promise<GatewayResult<IdentityRpcResult>>;
}

export type ServiceContext = { userId: string; gateway: PlanGateway };

export type LoadOutcome =
  | { status: 'FOUND'; record: PlanDocRecord }
  | { status: 'NONE' }
  | { status: 'DENIED' }
  | { status: 'FAILED'; message: string };

export type WriteOutcome =
  | { status: 'SAVED'; record: PlanDocRecord }
  | { status: 'CONFLICT'; current: PlanDocRecord }
  | { status: 'NOT_FOUND' }
  | { status: 'DENIED' }
  | { status: 'FAILED'; message: string };

export type IdentityOutcome =
  | { status: 'ASSIGNED'; projectId: string; revision: number; alreadyAssigned: boolean }
  | { status: 'REVISION_CHANGED'; revision: number }
  | { status: 'TITLE_CHANGED' | 'ID_IN_USE' | 'NOT_FOUND' | 'FORBIDDEN' | 'INVALID' }
  | { status: 'DENIED' }
  | { status: 'FAILED'; message: string };

export type StrategyProjectsOutcome =
  | {
      status: 'FOUND';
      revision: number;
      projects: Array<{ departmentIndex: number; projectIndex: number; title: string; projectId: string | null }>;
    }
  | { status: 'NOT_FOUND' }
  | { status: 'DENIED' }
  | { status: 'FAILED'; message: string };

async function allowed(ctx: ServiceContext, companyId: string): Promise<'OK' | 'DENIED' | 'FAILED'> {
  const r = await ctx.gateway.membershipRole(ctx.userId, companyId);
  if (!r.ok) return 'FAILED';
  return r.value !== null && ALLOWED_ROLES.includes(r.value) ? 'OK' : 'DENIED';
}

export async function loadPlan(ctx: ServiceContext, key: PlanDocKey): Promise<LoadOutcome> {
  const access = await allowed(ctx, key.companyId);
  if (access === 'DENIED') return { status: 'DENIED' };
  if (access === 'FAILED') return { status: 'FAILED', message: SAVE_FAILED };
  const r = await ctx.gateway.findPlan(key);
  if (!r.ok) return { status: 'FAILED', message: '読み込めませんでした。もう一度開いてください。' };
  return r.value ? { status: 'FOUND', record: r.value } : { status: 'NONE' };
}

export async function createPlan(
  ctx: ServiceContext,
  key: PlanDocKey,
  input: { aiDraft: Record<string, unknown>; userEdits: UserEdits; adopted: boolean }
): Promise<WriteOutcome> {
  const access = await allowed(ctx, key.companyId);
  if (access === 'DENIED') return { status: 'DENIED' };
  if (access === 'FAILED') return { status: 'FAILED', message: SAVE_FAILED };
  const r = await ctx.gateway.insertPlan(key, input, ctx.userId);
  if (r.ok) return { status: 'SAVED', record: r.value };
  if (r.code === 'DUPLICATE') {
    const current = await ctx.gateway.findPlan(key);
    if (current.ok && current.value) return { status: 'CONFLICT', current: current.value };
    return { status: 'FAILED', message: SAVE_FAILED };
  }
  if (r.code === 'FORBIDDEN') return { status: 'DENIED' };
  return { status: 'FAILED', message: SAVE_FAILED };
}

export async function updatePlan(
  ctx: ServiceContext,
  key: PlanDocKey,
  expectedVersion: number,
  input: { userEdits: UserEdits; adopted: boolean }
): Promise<WriteOutcome> {
  const access = await allowed(ctx, key.companyId);
  if (access === 'DENIED') return { status: 'DENIED' };
  if (access === 'FAILED') return { status: 'FAILED', message: SAVE_FAILED };
  const r = await ctx.gateway.updatePlan(key, expectedVersion, input, ctx.userId);
  if (!r.ok) return r.code === 'FORBIDDEN' ? { status: 'DENIED' } : { status: 'FAILED', message: SAVE_FAILED };
  if (r.value) return { status: 'SAVED', record: r.value };
  const current = await ctx.gateway.findPlan(key);
  if (!current.ok) return { status: 'FAILED', message: SAVE_FAILED };
  if (!current.value) return { status: 'NOT_FOUND' };
  return { status: 'CONFLICT', current: current.value };
}

/* プロジェクトの番号（安定ID）を、対象の1項目だけ付与する。戦略の他の項目は書き換えない */
export async function assignProjectIdentity(
  ctx: ServiceContext,
  args: {
    companyId: string;
    strategyId: string;
    departmentIndex: number;
    projectIndex: number;
    expectedTitle: string;
    expectedRevision: number;
    newId: string;
  }
): Promise<IdentityOutcome> {
  const access = await allowed(ctx, args.companyId);
  if (access === 'DENIED') return { status: 'DENIED' };
  if (access === 'FAILED') return { status: 'FAILED', message: SAVE_FAILED };
  const r = await ctx.gateway.assignIdentity(args);
  if (!r.ok) return { status: 'FAILED', message: SAVE_FAILED };
  const v = r.value;
  if (v.status === 'ASSIGNED' && v.projectId) {
    return { status: 'ASSIGNED', projectId: v.projectId, revision: v.revision ?? 0, alreadyAssigned: v.alreadyAssigned === true };
  }
  if (v.status === 'REVISION_CHANGED') return { status: 'REVISION_CHANGED', revision: v.revision ?? 0 };
  if (v.status === 'FORBIDDEN') return { status: 'FORBIDDEN' };
  if (v.status === 'ASSIGNED') return { status: 'FAILED', message: SAVE_FAILED };
  return { status: v.status };
}

/* 戦略の版番号と、各プロジェクトの番号（あれば）。番号を付ける前に、画面が見ている対象を確かめるために使う */
export async function readStrategyProjects(
  ctx: ServiceContext,
  companyId: string,
  strategyId: string
): Promise<StrategyProjectsOutcome> {
  const access = await allowed(ctx, companyId);
  if (access === 'DENIED') return { status: 'DENIED' };
  if (access === 'FAILED') return { status: 'FAILED', message: SAVE_FAILED };
  const r = await ctx.gateway.readStrategy(companyId, strategyId);
  if (!r.ok) return { status: 'FAILED', message: SAVE_FAILED };
  if (!r.value) return { status: 'NOT_FOUND' };
  const depts = Array.isArray(r.value.departments) ? (r.value.departments as Array<{ projects?: unknown }>) : [];
  const projects = depts.flatMap((d, departmentIndex) =>
    (Array.isArray(d?.projects) ? (d.projects as Array<Record<string, unknown>>) : []).map((p, projectIndex) => ({
      departmentIndex,
      projectIndex,
      title: typeof p.title === 'string' ? p.title.trim() : '',
      projectId: stableIdOf(p),
    }))
  );
  return { status: 'FOUND', revision: r.value.revision, projects };
}
