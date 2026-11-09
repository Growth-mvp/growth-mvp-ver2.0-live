/* 実行計画書の永続化のHTTP入口。認証・入力の検証・結果のHTTPステータスへの変換だけを行う。
 * 認証（利用者の確認）とゲートウェイは外から渡す。本番では既存の認証と利用者のトークンのクライアントを渡す。 */
import { z } from 'zod';

import {
  SAVE_FAILED,
  assignProjectIdentity,
  createPlan,
  loadPlan,
  readStrategyProjects,
  updatePlan,
  type PlanGateway,
} from './planService';

export type PlanApiDeps = {
  verifyUser: (req: Request) => Promise<string | null>;
  gatewayFor: (req: Request, userId: string) => PlanGateway;
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
const CreateBody = Key.extend({
  aiDraft: z
    .record(z.string(), z.unknown())
    .refine((o) => JSON.stringify(o).length <= 2_000_000, 'draft too large'),
  userEdits: UserEdits,
  adopted: z.boolean(),
});
const UpdateBody = Key.extend({
  expectedVersion: z.number().int().min(1),
  userEdits: UserEdits,
  adopted: z.boolean(),
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
  async function withUser(req: Request): Promise<{ ctx: { userId: string; gateway: PlanGateway } } | { error: Response }> {
    const userId = await deps.verifyUser(req);
    if (!userId) return { error: json(401, { error: 'Unauthorized' }) };
    return { ctx: { userId, gateway: deps.gatewayFor(req, userId) } };
  }

  /* 草案の読み書き：GET（読み込み）、POST（新規作成）、PUT（版番号つき更新） */
  async function plans(req: Request): Promise<Response> {
    const auth = await withUser(req);
    if ('error' in auth) return auth.error;
    const { ctx } = auth;

    if (req.method === 'GET') {
      const url = new URL(req.url);
      const parsed = Key.safeParse({
        companyId: url.searchParams.get('companyId'),
        strategyId: url.searchParams.get('strategyId'),
        projectId: url.searchParams.get('projectId'),
      });
      if (!parsed.success) return json(400, { error: 'Invalid input' });
      const out = await loadPlan(ctx, parsed.data);
      if (out.status === 'FOUND') return json(200, { status: 'FOUND', record: out.record });
      if (out.status === 'NONE') return json(200, { status: 'NONE' });
      if (out.status === 'DENIED') return json(403, { status: 'DENIED' });
      return json(500, { status: 'FAILED', message: out.message });
    }

    if (req.method === 'POST') {
      const parsed = CreateBody.safeParse(await readJson(req));
      if (!parsed.success) return json(400, { error: 'Invalid input' });
      const { companyId, strategyId, projectId, aiDraft, userEdits, adopted } = parsed.data;
      const out = await createPlan(ctx, { companyId, strategyId, projectId }, { aiDraft, userEdits, adopted });
      if (out.status === 'SAVED') return json(201, { status: 'SAVED', record: out.record });
      if (out.status === 'CONFLICT') return json(409, { status: 'CONFLICT', current: out.current });
      if (out.status === 'NOT_FOUND') return json(404, { status: 'NOT_FOUND' });
      if (out.status === 'DENIED') return json(403, { status: 'DENIED' });
      return json(500, { status: 'FAILED', message: out.message });
    }

    if (req.method === 'PUT') {
      const parsed = UpdateBody.safeParse(await readJson(req));
      if (!parsed.success) return json(400, { error: 'Invalid input' });
      const { companyId, strategyId, projectId, expectedVersion, userEdits, adopted } = parsed.data;
      const out = await updatePlan(ctx, { companyId, strategyId, projectId }, expectedVersion, { userEdits, adopted });
      if (out.status === 'SAVED') return json(200, { status: 'SAVED', record: out.record });
      if (out.status === 'CONFLICT') return json(409, { status: 'CONFLICT', current: out.current });
      if (out.status === 'NOT_FOUND') return json(404, { status: 'NOT_FOUND' });
      if (out.status === 'DENIED') return json(403, { status: 'DENIED' });
      return json(500, { status: 'FAILED', message: out.message });
    }

    return json(405, { error: 'Method not allowed' });
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

  return { plans, identity };
}
