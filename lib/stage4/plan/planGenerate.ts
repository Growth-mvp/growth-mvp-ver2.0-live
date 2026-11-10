/* 実行計画書のAI生成（サーバー側の新STAGE4専用の経路）。
 * 会社・戦略・プロジェクトを照合し、信頼できる保存データから入力を組み立て、既存の計画エンジンで草案を作る。
 * 同じプロジェクトの生成は1つだけ（生成の権利を取ってから、モデルを呼ぶ）。草案がある間は再生成しない。
 * 再生成のプレビューは、保存せずに新しい案を返す（権利も取らず、保存された計画書には触れない）。
 * モデルの呼び出しは外から渡す（本番は既存のモデル設定、検証はモック）。 */
import { runExecutionPlanEngine } from './generate';
import type { PlanDocKey, PlanDocRecord } from './planDocumentStore';
import { stableIdOf } from './projectResolver';
import type { RawPlanInput, RawPlanStrategy } from './source';
import { allowed, type ServiceContext } from './planService';

export type ModelReply = { text: string; finishReason?: string | null; model?: string | null; usage?: unknown };

export type GenerateDeps = {
  now: () => string;
  currentYm: () => string;
  /** 保存された戦略の行を、計画エンジンの入力（戦略の形）に変える */
  mapStrategy: (row: Record<string, unknown>) => RawPlanStrategy;
  /** モデルへの呼び出し口を作る。本番は既存のモデル設定で、検証はモック */
  modelFor: (raw: RawPlanInput) => Promise<(prompt: string) => Promise<ModelReply>>;
};

export type GenerateOutcome =
  | { status: 'CREATED'; record: PlanDocRecord }
  | { status: 'EXISTS'; record: PlanDocRecord }
  | { status: 'IN_PROGRESS' }
  | { status: 'NOT_FOUND' }
  | { status: 'DENIED' }
  | { status: 'INVALID'; messages: string[] }
  | { status: 'MODEL_FAILED'; message: string }
  | { status: 'FAILED'; message: string };

export type PreviewOutcome =
  | { status: 'PREVIEW'; draft: Record<string, unknown> }
  | { status: 'NOT_FOUND' }
  | { status: 'DENIED' }
  | { status: 'INVALID'; messages: string[] }
  | { status: 'MODEL_FAILED'; message: string }
  | { status: 'FAILED'; message: string };

const SWOT_LABELS: Array<[keyof RawPlanStrategy, string]> = [
  ['strength', '強み'],
  ['weakness', '弱み'],
  ['opportunity', '機会'],
  ['threat', '脅威'],
];

const MODEL_FAILED = 'AIによる草案を作れませんでした。内容は保存されていません。もう一度お試しください。';
const FAILED = '草案を保存できませんでした。もう一度お試しください。';
// 関数の上限（300秒）より長く作成中のままの行は、打ち切られた生成の残りとみなす
const STALE_GENERATION_MS = 6 * 60 * 1000;

function isStale(updatedAt: string, now: string): boolean {
  return Date.parse(now) - Date.parse(updatedAt) > STALE_GENERATION_MS;
}

/* 計画エンジンの結果を、保存する草案の形（画面と検証で同じ形）にする */
function toRunRecord(args: {
  result: Awaited<ReturnType<typeof runExecutionPlanEngine>>;
  raw: RawPlanInput;
  reply: ModelReply;
  createdAt: string;
  caseId: string;
  companyName: string;
  departmentName: string;
}): Record<string, unknown> {
  const { result, reply } = args;
  return {
    caseId: args.caseId,
    sentAt: args.createdAt,
    usage: reply.usage ?? null,
    costUsd: null,
    durationMs: 0,
    finishReason: reply.finishReason ?? 'UNKNOWN',
    model: reply.model ?? null,
    rawOutputSha256: '',
    rawOutput: reply.text,
    ok: result.ok,
    executionStartable: result.executionStartable,
    plan: result.plan,
    issues: result.issues,
    estimates: result.estimates,
    checks: [],
    context: { ...result.context, departmentName: args.departmentName },
    inputSummary: { companyName: args.companyName },
    generatedBy: 'SERVER',
  };
}

type Target = { key: PlanDocKey; raw: RawPlanInput; departmentName: string };
type Refusal =
  | { status: 'DENIED' }
  | { status: 'FAILED'; message: string }
  | { status: 'NOT_FOUND' }
  | { status: 'INVALID'; messages: string[] };

/* 所属・戦略・プロジェクトを照合し、保存データから計画エンジンの入力を作る（ここでは何も書かない） */
async function targetOf(
  ctx: ServiceContext,
  args: { companyId: string; strategyId: string; projectId: string },
  deps: GenerateDeps
): Promise<{ ok: true; target: Target } | { ok: false; refusal: Refusal }> {
  const access = await allowed(ctx, args.companyId);
  if (access === 'DENIED') return { ok: false, refusal: { status: 'DENIED' } };
  if (access === 'FAILED') return { ok: false, refusal: { status: 'FAILED', message: FAILED } };

  const row = await ctx.gateway.readStrategyRow(args.companyId, args.strategyId);
  if (!row.ok) return { ok: false, refusal: { status: 'FAILED', message: FAILED } };
  if (!row.value) return { ok: false, refusal: { status: 'NOT_FOUND' } };

  const strategy = deps.mapStrategy({ ...row.value, id: args.strategyId, company_id: args.companyId });
  const departments = Array.isArray(strategy.departments) ? (strategy.departments as Array<Record<string, unknown>>) : [];
  let departmentName = '';
  let hits = 0;
  for (const d of departments) {
    const projects = Array.isArray(d.projects) ? (d.projects as Array<Record<string, unknown>>) : [];
    const matched = projects.filter((p) => stableIdOf(p) === args.projectId).length;
    if (matched > 0 && hits === 0) departmentName = typeof d.name === 'string' ? d.name : '';
    hits += matched;
  }
  if (hits === 0) return { ok: false, refusal: { status: 'NOT_FOUND' } };
  if (hits > 1) {
    return {
      ok: false,
      refusal: { status: 'INVALID', messages: ['同じIDのプロジェクトが複数あるため、計画書を作れません。STAGE3でプロジェクトのIDを確認してください'] },
    };
  }

  const missing = SWOT_LABELS.filter(([k]) => {
    const v = strategy[k];
    return typeof v !== 'string' || !v.trim();
  }).map(([, label]) => label);
  if (missing.length > 0) {
    return {
      ok: false,
      refusal: { status: 'INVALID', messages: [`STAGE2のSWOT（${missing.join('・')}）が未入力のため、計画書を作れません`] },
    };
  }

  const key: PlanDocKey = { companyId: args.companyId, strategyId: args.strategyId, projectId: args.projectId };
  const raw: RawPlanInput = {
    membershipCompanyId: args.companyId,
    requestedStrategyId: args.strategyId,
    requestedProjectId: args.projectId,
    currentYm: deps.currentYm(),
    strategy,
  };
  return { ok: true, target: { key, raw, departmentName } };
}

/* モデルを1回呼び、計画エンジンで検証する。モデルの応答が無ければ例外 */
async function draftWithModel(raw: RawPlanInput, deps: GenerateDeps): Promise<{ result: Awaited<ReturnType<typeof runExecutionPlanEngine>>; reply: ModelReply }> {
  let reply: ModelReply | null = null;
  const callModel = await deps.modelFor(raw);
  const result = await runExecutionPlanEngine({
    raw,
    callModel: async (prompt) => {
      reply = await callModel(prompt);
      return reply.text;
    },
  });
  if (!reply) throw new Error('model returned no reply');
  return { result, reply };
}

export async function generatePlanDraft(
  ctx: ServiceContext,
  args: { companyId: string; strategyId: string; projectId: string; companyName: string },
  deps: GenerateDeps
): Promise<GenerateOutcome> {
  const found = await targetOf(ctx, args, deps);
  if (!found.ok) return found.refusal;
  const { key, raw, departmentName } = found.target;

  let claim = await ctx.gateway.claimGeneration(key, ctx.userId);
  if (!claim.ok) return { status: 'FAILED', message: FAILED };
  if (!claim.value.claimed && claim.value.existing.status === 'GENERATING' && isStale(claim.value.existing.updatedAt, deps.now())) {
    const failed = await ctx.gateway.failGeneration(key, ctx.userId);
    if (!failed.ok) return { status: 'FAILED', message: FAILED };
    claim = await ctx.gateway.claimGeneration(key, ctx.userId);
    if (!claim.ok) return { status: 'FAILED', message: FAILED };
  }
  if (!claim.value.claimed) {
    const existing = claim.value.existing;
    if (existing.status === 'DRAFT') return { status: 'EXISTS', record: existing };
    return { status: 'IN_PROGRESS' };
  }

  try {
    const { result, reply } = await draftWithModel(raw, deps);
    if (!result.ok || !result.plan) {
      await ctx.gateway.failGeneration(key, ctx.userId);
      return {
        status: 'INVALID',
        messages: result.issues.filter((i) => i.severity === 'error').map((i) => i.message),
      };
    }
    const bundle = toRunRecord({
      result,
      raw,
      reply,
      createdAt: deps.now(),
      caseId: `gen:${key.projectId}`,
      companyName: args.companyName,
      departmentName,
    });
    const done = await ctx.gateway.completeGeneration(key, ctx.userId, bundle);
    if (!done.ok || !done.value) {
      await ctx.gateway.failGeneration(key, ctx.userId);
      return { status: 'FAILED', message: FAILED };
    }
    return { status: 'CREATED', record: done.value };
  } catch (e) {
    console.error('[stage4-generate] draft failed', describeError(e));
    await ctx.gateway.failGeneration(key, ctx.userId);
    return { status: 'MODEL_FAILED', message: MODEL_FAILED };
  }
}

/* 再生成のプレビュー：新しい案を返すだけで、保存もしない（生成の権利も取らない） */
export async function previewPlanDraft(
  ctx: ServiceContext,
  args: { companyId: string; strategyId: string; projectId: string; companyName: string },
  deps: GenerateDeps
): Promise<PreviewOutcome> {
  const found = await targetOf(ctx, args, deps);
  if (!found.ok) return found.refusal;
  const { key, raw, departmentName } = found.target;
  try {
    const { result, reply } = await draftWithModel(raw, deps);
    if (!result.ok || !result.plan) {
      return { status: 'INVALID', messages: result.issues.filter((i) => i.severity === 'error').map((i) => i.message) };
    }
    const draft = toRunRecord({
      result,
      raw,
      reply,
      createdAt: deps.now(),
      caseId: `preview:${key.projectId}`,
      companyName: args.companyName,
      departmentName,
    });
    return { status: 'PREVIEW', draft };
  } catch (e) {
    console.error('[stage4-preview] draft failed', describeError(e));
    return { status: 'MODEL_FAILED', message: MODEL_FAILED };
  }
}

function describeError(e: unknown): string {
  const o = (e && typeof e === 'object' ? e : {}) as { name?: unknown; status?: unknown; code?: unknown };
  const message = e instanceof Error ? e.message : String(e);
  return [o.name, o.status && `status=${String(o.status)}`, o.code && `code=${String(o.code)}`, message.slice(0, 300)]
    .filter(Boolean)
    .join(' ');
}
