/* 実行計画書の永続化の本体（サーバー側）。
 * 認証された利用者の会社への所属を、データベースから読んだ役割で確かめてから、ゲートウェイ経由で読み書きする。
 * ゲートウェイは利用者の権限のもとで動く（行単位の権限は、データベース側の規則で強制される）。 */
import type { RegulatoryRecord } from '../planView/model';
import type { UserEdits } from './mergeUserEdits';
import type { AdoptionInfo, PlanDocEvent, PlanDocKey, PlanDocRecord, StartInfo } from './planDocumentStore';
import { refreshKpiReference } from './kpiReference';
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

/* 草案の更新で書き換える項目だけを表す（省略した項目は変えない） */
export type PlanPatch = {
  aiDraft?: Record<string, unknown>;
  userEdits?: UserEdits;
  adoption?: AdoptionInfo | null;
  regulatory?: RegulatoryRecord;
  startInfo?: StartInfo | null;
};

export type ClaimResult = { claimed: true; record: PlanDocRecord } | { claimed: false; existing: PlanDocRecord };

export type DraftReplaceResult =
  | { status: 'REPLACED'; record: PlanDocRecord }
  | { status: 'CONFLICT' }
  | { status: 'NOT_READY' }
  | { status: 'NOT_FOUND' }
  | { status: 'DENIED' }
  | { status: 'INVALID' };

/** 利用者の権限のもとで行う読み書き。実装は、Supabase（本番）や検証用のデータベースなど */
export interface PlanGateway {
  membershipRole(userId: string, companyId: string): Promise<GatewayResult<string | null>>;
  findPlan(key: PlanDocKey): Promise<GatewayResult<PlanDocRecord | null>>;
  /** 会社・戦略の計画書の一覧（利用者の権限のもとで読む）。STAGE6の参考シナリオに使う */
  listPlans?(companyId: string, strategyId: string): Promise<GatewayResult<PlanDocRecord[]>>;
  listEvents(key: PlanDocKey): Promise<GatewayResult<PlanDocEvent[]>>;
  /** 生成の権利を取る。同じキーが生成中・草案ありなら取らない。生成に失敗した行だけ、再び取れる */
  claimGeneration(key: PlanDocKey, userId: string): Promise<GatewayResult<ClaimResult>>;
  /** 生成中の行に、生成した草案を入れて、草案の状態にする */
  completeGeneration(key: PlanDocKey, userId: string, aiDraft: Record<string, unknown>): Promise<GatewayResult<PlanDocRecord | null>>;
  failGeneration(key: PlanDocKey, userId: string): Promise<GatewayResult<PlanDocRecord | null>>;
  /** 版番号と状態（草案）が一致した時だけ更新する。一致しなければ value が null */
  updatePlan(key: PlanDocKey, expectedVersion: number, patch: PlanPatch, userId: string): Promise<GatewayResult<PlanDocRecord | null>>;
  /* 「この案を使う」専用：AI原案と修正を、版番号・状態・開始の有無を保存先の中で確かめてから差し替える（通常の更新では原案を変えられない） */
  replaceDraft(
    key: PlanDocKey,
    expectedVersion: number,
    args: { aiDraft: Record<string, unknown>; userEdits: UserEdits },
    userId: string
  ): Promise<GatewayResult<DraftReplaceResult>>;
  readStrategyRow(companyId: string, strategyId: string): Promise<GatewayResult<Record<string, unknown> | null>>;
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

const FAILED_READ = '読み込めませんでした。もう一度開いてください。';

export async function allowed(ctx: ServiceContext, companyId: string): Promise<'OK' | 'DENIED' | 'FAILED'> {
  const r = await ctx.gateway.membershipRole(ctx.userId, companyId);
  if (!r.ok) return 'FAILED';
  return r.value !== null && ALLOWED_ROLES.includes(r.value) ? 'OK' : 'DENIED';
}

export type LoadOutcome =
  | { status: 'FOUND'; record: PlanDocRecord }
  | { status: 'NONE' }
  | { status: 'DENIED' }
  | { status: 'FAILED'; message: string };

/* 会社・戦略の草案の一覧（STAGE6の参考シナリオ用）。草案の状態のものだけ返す */
export async function listPlans(
  ctx: ServiceContext,
  companyId: string,
  strategyId: string
): Promise<{ status: 'FOUND'; records: PlanDocRecord[] } | { status: 'DENIED' } | { status: 'FAILED'; message: string }> {
  const access = await allowed(ctx, companyId);
  if (access === 'DENIED') return { status: 'DENIED' };
  if (access === 'FAILED' || !ctx.gateway.listPlans) return { status: 'FAILED', message: FAILED_READ };
  const r = await ctx.gateway.listPlans(companyId, strategyId);
  if (!r.ok) return { status: 'FAILED', message: FAILED_READ };
  return { status: 'FOUND', records: r.value.filter((rec) => (rec.status ?? 'DRAFT') === 'DRAFT') };
}

export async function loadPlan(ctx: ServiceContext, key: PlanDocKey): Promise<LoadOutcome> {
  const access = await allowed(ctx, key.companyId);
  if (access === 'DENIED') return { status: 'DENIED' };
  if (access === 'FAILED') return { status: 'FAILED', message: FAILED_READ };
  const r = await ctx.gateway.findPlan(key);
  if (!r.ok) return { status: 'FAILED', message: FAILED_READ };
  if (!r.value || (r.value.status ?? 'DRAFT') !== 'DRAFT') return { status: 'NONE' };
  const events = await ctx.gateway.listEvents(key);
  const record = await displayedRecord(ctx, r.value);
  return { status: 'FOUND', record: { ...record, events: events.ok ? events.value : [] } };
}

/* 保存された草案の参照KPIを、いまの正式KPIに合わせた表示用の写しにする。保存された草案は変えない（草案は作った後に変えられない） */
export async function displayedRecord(ctx: ServiceContext, record: PlanDocRecord): Promise<PlanDocRecord> {
  const row = await ctx.gateway.readStrategyRow(record.key.companyId, record.key.strategyId);
  if (!row.ok || !row.value) return record;
  if (String(row.value.id) !== record.key.strategyId || String(row.value.company_id) !== record.key.companyId) return record;
  const refreshed = refreshKpiReference(record.aiDraft, row.value.departments, record.key.projectId);
  if (!refreshed.ok || !refreshed.changed) return record;
  return { ...record, aiDraft: refreshed.aiDraft };
}

export type WriteOutcome =
  | { status: 'SAVED'; record: PlanDocRecord }
  | { status: 'CONFLICT'; current: PlanDocRecord }
  | { status: 'NOT_FOUND' }
  | { status: 'NOT_READY'; current: PlanDocRecord }
  | { status: 'DENIED' }
  | { status: 'FAILED'; message: string };

/* 利用者の修正だけを保存する（採用や開始の状態は、ここでは変えられない） */
export async function saveEdits(
  ctx: ServiceContext,
  key: PlanDocKey,
  expectedVersion: number,
  userEdits: UserEdits
): Promise<WriteOutcome> {
  const access = await allowed(ctx, key.companyId);
  if (access === 'DENIED') return { status: 'DENIED' };
  if (access === 'FAILED') return { status: 'FAILED', message: SAVE_FAILED };
  const r = await ctx.gateway.updatePlan(key, expectedVersion, { userEdits }, ctx.userId);
  if (!r.ok) return r.code === 'FORBIDDEN' ? { status: 'DENIED' } : { status: 'FAILED', message: SAVE_FAILED };
  if (r.value) return { status: 'SAVED', record: await displayedRecord(ctx, r.value) };
  const current = await ctx.gateway.findPlan(key);
  if (!current.ok) return { status: 'FAILED', message: SAVE_FAILED };
  if (!current.value) return { status: 'NOT_FOUND' };
  if (current.value.status && current.value.status !== 'DRAFT') return { status: 'NOT_READY', current: current.value };
  return { status: 'CONFLICT', current: current.value };
}

/* プロジェクトの番号（安定ID）を、対象の1項目だけ付与する。戦略の他の項目は書き換えない */
export type IdentityOutcome =
  | { status: 'ASSIGNED'; projectId: string; revision: number; alreadyAssigned: boolean }
  | { status: 'REVISION_CHANGED'; revision: number }
  | { status: 'TITLE_CHANGED' | 'ID_IN_USE' | 'NOT_FOUND' | 'FORBIDDEN' | 'INVALID' }
  | { status: 'DENIED' }
  | { status: 'FAILED'; message: string };

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
export type StrategyProjectsOutcome =
  | {
      status: 'FOUND';
      revision: number;
      projects: Array<{ departmentIndex: number; projectIndex: number; title: string; projectId: string | null }>;
    }
  | { status: 'NOT_FOUND' }
  | { status: 'DENIED' }
  | { status: 'FAILED'; message: string };

export async function readStrategyProjects(
  ctx: ServiceContext,
  companyId: string,
  strategyId: string
): Promise<StrategyProjectsOutcome> {
  const access = await allowed(ctx, companyId);
  if (access === 'DENIED') return { status: 'DENIED' };
  if (access === 'FAILED') return { status: 'FAILED', message: SAVE_FAILED };
  const r = await ctx.gateway.readStrategyRow(companyId, strategyId);
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
  return { status: 'FOUND', revision: Number(r.value.revision), projects };
}
