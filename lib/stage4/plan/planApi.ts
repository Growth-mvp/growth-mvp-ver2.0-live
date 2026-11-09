/* 実行計画書の永続化・生成・採用・実行開始のHTTP入口。認証・入力の検証・結果のHTTPステータスへの変換だけを行う。
 * 認証（利用者の確認）・ゲートウェイ・モデル呼び出しは外から渡す。本番では既存の認証と、利用者のトークンのクライアントを渡す。
 * 草案（AI内容）はクライアントから受け取らない。作るのはサーバーの生成経路だけ。 */
import { z } from 'zod';

import { generatePlanDraft, type GenerateDeps } from './planGenerate';
import { TRANSITION_ACTIONS, transitionPlan } from './planTransitions';
import {
  SAVE_FAILED,
  assignProjectIdentity,
  loadPlan,
  readStrategyProjects,
  saveEdits,
  type PlanGateway,
} from './planService';

export type PlanApiDeps = {
  verifyUser: (req: Request) => Promise<string | null>;
  gatewayFor: (req: Request, userId: string) => PlanGateway;
  /** 生成の経路を使うか（本番では環境変数で切り替える。既定は使わない） */
  generationEnabled: boolean;
  generation: Omit<GenerateDeps, 'now'> & { now?: () => string };
  companyNameOf?: (companyId: string) => string;
  now?: () => string;
};

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
  });

const Key = z.object({
  companyId: z.string().uuid(),
  strategyId: z.string().uuid(),
  projectId: z.string().min(1).max(200),
});
const EditValue = z.union([z.string().max(4000), z.number(), z.boolean(), z.null()]);
const UserEdits = z.record(z.string().min(1).max(200), EditValue).refine((o) => Object.keys(o).length <= 500, 'too many edits');
const SaveBody = Key.extend({
  expectedVersion: z.number().int().min(1),
  userEdits: UserEdits,
});
const TransitionBody = Key.extend({
  expectedVersion: z.number().int().min(1),
  action: z.enum(TRANSITION_ACTIONS),
  regulatory: z.unknown().optional(),
});
const IdentityBody = z.object({
  companyId: z.string().uuid(),
  strategyId: z.string().uuid(),
  departmentIndex: z.number().int().min(0),
  projectIndex: z.number().int().min(0),
  expectedTitle: z.string().max(200),
  expectedRevision: z.number().int().min(0),
  newId: z.string().uuid(),
});
const StrategyQuery = z.object({ companyId: z.string().uuid(), strategyId: z.string().uuid() });

async function readJson(req: Request): Promise<unknown> {
  try {
    return await req.json();
  } catch {
    return null;
  }
}

export function createPlanApi(deps: PlanApiDeps) {
  const now = deps.now ?? (() => new Date().toISOString());

  async function withUser(req: Request): Promise<{ ctx: { userId: string; gateway: PlanGateway } } | { error: Response }> {
    const userId = await deps.verifyUser(req);
    if (!userId) return { error: json(401, { error: 'Unauthorized' }) };
    return { ctx: { userId, gateway: deps.gatewayFor(req, userId) } };
  }

  function keyFromSearch(url: URL) {
    return Key.safeParse({
      companyId: url.searchParams.get('companyId'),
      strategyId: url.searchParams.get('strategyId'),
      projectId: url.searchParams.get('projectId'),
    });
  }

  /* 草案の読み込み（GET）と、利用者の修正の保存（PUT） */
  async function plans(req: Request): Promise<Response> {
    const auth = await withUser(req);
    if ('error' in auth) return auth.error;
    const { ctx } = auth;

    if (req.method === 'GET') {
      const parsed = keyFromSearch(new URL(req.url));
      if (!parsed.success) return json(400, { error: 'Invalid input' });
      const out = await loadPlan(ctx, parsed.data);
      if (out.status === 'FOUND') return json(200, { status: 'FOUND', record: out.record });
      if (out.status === 'NONE') return json(200, { status: 'NONE' });
      if (out.status === 'DENIED') return json(403, { status: 'DENIED' });
      return json(500, { status: 'FAILED', message: out.message });
    }

    if (req.method === 'PUT') {
      const parsed = SaveBody.safeParse(await readJson(req));
      if (!parsed.success) return json(400, { error: 'Invalid input' });
      const { companyId, strategyId, projectId, expectedVersion, userEdits } = parsed.data;
      const out = await saveEdits(ctx, { companyId, strategyId, projectId }, expectedVersion, userEdits);
      if (out.status === 'SAVED') return json(200, { status: 'SAVED', record: out.record });
      if (out.status === 'CONFLICT') return json(409, { status: 'CONFLICT', current: out.current });
      if (out.status === 'NOT_READY') return json(409, { status: 'NOT_READY', current: out.current });
      if (out.status === 'NOT_FOUND') return json(404, { status: 'NOT_FOUND' });
      if (out.status === 'DENIED') return json(403, { status: 'DENIED' });
      return json(500, { status: 'FAILED', message: out.message ?? SAVE_FAILED });
    }

    return json(405, { error: 'Method not allowed' });
  }

  /* AI生成（POST …/generate）：同じプロジェクトは1つだけ。草案がある間は再生成しない */
  async function generate(req: Request): Promise<Response> {
    if (req.method !== 'POST') return json(405, { error: 'Method not allowed' });
    const auth = await withUser(req);
    if ('error' in auth) return auth.error;
    if (!deps.generationEnabled) return json(503, { status: 'DISABLED' });

    const parsed = Key.safeParse(await readJson(req));
    if (!parsed.success) return json(400, { error: 'Invalid input' });
    const { companyId, strategyId, projectId } = parsed.data;
    const out = await generatePlanDraft(
      auth.ctx,
      { companyId, strategyId, projectId, companyName: deps.companyNameOf?.(companyId) ?? '' },
      { ...deps.generation, now: deps.generation.now ?? now }
    );
    switch (out.status) {
      case 'CREATED':
        return json(201, { status: 'CREATED', record: out.record });
      case 'EXISTS':
        return json(200, { status: 'EXISTS', record: out.record });
      case 'IN_PROGRESS':
        return json(409, { status: 'IN_PROGRESS' });
      case 'NOT_FOUND':
        return json(404, { status: 'NOT_FOUND' });
      case 'DENIED':
        return json(403, { status: 'DENIED' });
      case 'INVALID':
        return json(422, { status: 'INVALID', messages: out.messages });
      case 'MODEL_FAILED':
        return json(502, { status: 'MODEL_FAILED', message: out.message });
      default:
        return json(500, { status: 'FAILED', message: out.message });
    }
  }

  /* 採用・規制の記録・実行開始・取り消し（POST …/transition） */
  async function transition(req: Request): Promise<Response> {
    if (req.method !== 'POST') return json(405, { error: 'Method not allowed' });
    const auth = await withUser(req);
    if ('error' in auth) return auth.error;
    const parsed = TransitionBody.safeParse(await readJson(req));
    if (!parsed.success) return json(400, { error: 'Invalid input' });
    const { companyId, strategyId, projectId, expectedVersion, action, regulatory } = parsed.data;
    const out = await transitionPlan(auth.ctx, { companyId, strategyId, projectId }, expectedVersion, action, {
      regulatory,
      now: now(),
    });
    switch (out.status) {
      case 'OK':
        return json(200, { status: 'OK', record: out.record });
      case 'CONFLICT':
        return json(409, { status: 'CONFLICT', current: out.current });
      case 'BLOCKED':
        return json(422, { status: 'BLOCKED', blockers: out.blockers });
      case 'INVALID':
        return json(400, { status: 'INVALID', message: out.message });
      case 'NOT_FOUND':
        return json(404, { status: 'NOT_FOUND' });
      case 'NOT_READY':
        return json(409, { status: 'NOT_READY' });
      case 'DENIED':
        return json(403, { status: 'DENIED' });
      default:
        return json(500, { status: 'FAILED', message: out.message });
    }
  }

  /* プロジェクトの番号：GET（戦略の版番号と各プロジェクトの番号）、POST（番号の付与） */
  async function identity(req: Request): Promise<Response> {
    const auth = await withUser(req);
    if ('error' in auth) return auth.error;
    const { ctx } = auth;

    if (req.method === 'GET') {
      const url = new URL(req.url);
      const parsed = StrategyQuery.safeParse({
        companyId: url.searchParams.get('companyId'),
        strategyId: url.searchParams.get('strategyId'),
      });
      if (!parsed.success) return json(400, { error: 'Invalid input' });
      const out = await readStrategyProjects(ctx, parsed.data.companyId, parsed.data.strategyId);
      if (out.status === 'FOUND') return json(200, out);
      if (out.status === 'NOT_FOUND') return json(404, { status: 'NOT_FOUND' });
      if (out.status === 'DENIED') return json(403, { status: 'DENIED' });
      return json(500, { status: 'FAILED', message: out.message });
    }

    if (req.method === 'POST') {
      const parsed = IdentityBody.safeParse(await readJson(req));
      if (!parsed.success) return json(400, { error: 'Invalid input' });
      const out = await assignProjectIdentity(ctx, parsed.data);
      if (out.status === 'ASSIGNED') return json(200, out);
      if (out.status === 'REVISION_CHANGED' || out.status === 'TITLE_CHANGED' || out.status === 'ID_IN_USE') {
        return json(409, out);
      }
      if (out.status === 'NOT_FOUND') return json(404, out);
      if (out.status === 'FORBIDDEN' || out.status === 'DENIED') return json(403, { status: 'FORBIDDEN' });
      if (out.status === 'INVALID') return json(400, out);
      return json(500, { status: 'FAILED', message: SAVE_FAILED });
    }

    return json(405, { error: 'Method not allowed' });
  }

  return { plans, generate, transition, identity };
}
