/* 実行計画書のAI生成（サーバー側の新STAGE4専用の経路）。
 * 会社・戦略・プロジェクトを照合し、信頼できる保存データから入力を組み立て、既存の計画エンジンで草案を作る。
 * 同じプロジェクトの生成は1つだけ（生成の権利を取ってから、モデルを呼ぶ）。草案がある間は再生成しない。
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

const SWOT_LABELS: Array<[keyof RawPlanStrategy, string]> = [
  ['strength', '強み'],
  ['weakness', '弱み'],
  ['opportunity', '機会'],
  ['threat', '脅威'],
];

const MODEL_FAILED = 'AIによる草案を作れませんでした。内容は保存されていません。もう一度お試しください。';
const FAILED = '草案を保存できませんでした。もう一度お試しください。';

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

export async function generatePlanDraft(
  ctx: ServiceContext,
  args: { companyId: string; strategyId: string; projectId: string; companyName: string },
  deps: GenerateDeps
): Promise<GenerateOutcome> {
  const access = await allowed(ctx, args.companyId);
  if (access === 'DENIED') return { status: 'DENIED' };
  if (access === 'FAILED') return { status: 'FAILED', message: FAILED };

  const row = await ctx.gateway.readStrategyRow(args.companyId, args.strategyId);
  if (!row.ok) return { status: 'FAILED', message: FAILED };
  if (!row.value) return { status: 'NOT_FOUND' };

  const strategy = deps.mapStrategy({ ...row.value, id: args.strategyId, company_id: args.companyId });
  const departments = Array.isArray(strategy.departments) ? (strategy.departments as Array<Record<string, unknown>>) : [];
  let departmentName = '';
  let found = false;
  for (const d of departments) {
    const projects = Array.isArray(d.projects) ? (d.projects as Array<Record<string, unknown>>) : [];
    if (projects.some((p) => stableIdOf(p) === args.projectId)) {
      found = true;
      departmentName = typeof d.name === 'string' ? d.name : '';
      break;
    }
  }
  if (!found) return { status: 'NOT_FOUND' };

  const missing = SWOT_LABELS.filter(([k]) => {
    const v = strategy[k];
    return typeof v !== 'string' || !v.trim();
  }).map(([, label]) => label);
  if (missing.length > 0) {
    return { status: 'INVALID', messages: [`STAGE2のSWOT（${missing.join('・')}）が未入力のため、計画書を作れません`] };
  }

  const key: PlanDocKey = { companyId: args.companyId, strategyId: args.strategyId, projectId: args.projectId };
  const claim = await ctx.gateway.claimGeneration(key, ctx.userId);
  if (!claim.ok) return { status: 'FAILED', message: FAILED };
  if (!claim.value.claimed) {
    const existing = claim.value.existing;
    if (existing.status === 'DRAFT') return { status: 'EXISTS', record: existing };
    return { status: 'IN_PROGRESS' };
  }

  const raw: RawPlanInput = {
    membershipCompanyId: args.companyId,
    requestedStrategyId: args.strategyId,
    requestedProjectId: args.projectId,
    currentYm: deps.currentYm(),
    strategy,
  };

  let reply: ModelReply | null = null;
  try {
    const callModel = await deps.modelFor(raw);
    const result = await runExecutionPlanEngine({
      raw,
      callModel: async (prompt) => {
        reply = await callModel(prompt);
        return reply.text;
      },
    });
    if (!reply) throw new Error('model returned no reply');
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
      caseId: `gen:${args.projectId}`,
      companyName: args.companyName,
      departmentName,
    });
    const done = await ctx.gateway.completeGeneration(key, ctx.userId, bundle);
    if (!done.ok || !done.value) {
      await ctx.gateway.failGeneration(key, ctx.userId);
      return { status: 'FAILED', message: FAILED };
    }
    return { status: 'CREATED', record: done.value };
  } catch {
    await ctx.gateway.failGeneration(key, ctx.userId);
    return { status: 'MODEL_FAILED', message: MODEL_FAILED };
  }
}
