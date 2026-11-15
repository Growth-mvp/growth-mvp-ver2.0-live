// /app/api/stage3/adjustment/propose/route.ts
// STAGE3: 部門間調整の候補ごとに、AIの調整案を5件まとめて作る（保存はしない。採用は利用者が選ぶ）
import 'server-only';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

import { NextResponse } from 'next/server';
import { z } from 'zod';
import { openai } from '@/lib/openai';
import { getOpenAIModelParamsForProcess } from '@/lib/modelConfig';
import { getSupabaseAdmin } from '@/lib/supabaseAdmin';
import { logAuditEvent } from '@/lib/server/auditLog';
import { failResponse } from '@/lib/server/stage3DepartmentWrite';
import { loadStrategyAccess, requireConfirmedStrategy } from '@/lib/server/stage3Adjustment';
import { loadWorkspace } from '@/lib/server/stage3StrategyBook';
import { sourceDepartments, verifyWorkspaceState } from '@/lib/cascade/stage3StrategyBook';
import { buildProposalMessages, collectPlanUnits, resolveProposals, verifyCandidates } from '@/lib/cascade/stage3Adjustment';

const BodySchema = z.object({
  companyId: z.string().uuid(),
  strategyId: z.string().uuid(),
  draft: z.object({ draftId: z.string().min(1).max(60), version: z.number().int().min(1) }).nullable().optional(),
  candidates: z.array(z.unknown()).min(1).max(8),
});

export async function POST(req: Request) {
  try {
    const parsed = BodySchema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) return failResponse(400, 'invalid_request');
    const body = parsed.data;

    const admin = getSupabaseAdmin();
    const access = await loadStrategyAccess(admin, req, body);
    if (!access.ok) return failResponse(access.status, access.error);
    const confirmed = requireConfirmedStrategy(access.access);
    if (!confirmed.ok) return failResponse(confirmed.status, confirmed.error);

    const loaded = await loadWorkspace(admin, body.strategyId);
    if (!loaded.ok) return failResponse(loaded.status, loaded.error);
    const check = verifyWorkspaceState(loaded.workspace.state, access.access.departments);
    if (!check.ok) return failResponse(409, 'workspace_mismatch');

    const source = sourceDepartments(check.state, body.draft ?? null, access.access.departments);
    if (!source.ok) return failResponse(409, source.error);
    const units = collectPlanUnits(source.departments);
    const candidates = verifyCandidates(body.candidates, units);
    if (!candidates) return failResponse(400, 'invalid_candidates');

    const completion = await openai.chat.completions.create({
      ...getOpenAIModelParamsForProcess('stage3AdjustmentRegenerate'),
      messages: buildProposalMessages({ companyStrategy: confirmed.companyStrategy, units, candidates }),
    });

    let raw: unknown;
    try {
      raw = JSON.parse(completion.choices[0]?.message?.content ?? '');
    } catch {
      return failResponse(502, 'upstream_unparseable');
    }
    const result = resolveProposals(raw, candidates);

    await logAuditEvent({
      companyId: access.access.companyId,
      actorUserId: access.access.userId,
      action: 'stage3_adjustment_proposed',
      targetType: 'strategy',
      targetId: body.strategyId,
      metadata: {
        candidateCount: candidates.length,
        proposalCount: result.proposals.length,
        rejectedChanges: result.rejectedChanges,
        sourceDraftId: body.draft?.draftId ?? null,
      },
    });

    return NextResponse.json({
      ok: true,
      revision: access.access.revision,
      workspaceVersion: loaded.workspace.version,
      proposals: result.proposals,
      rejectedChanges: result.rejectedChanges,
    });
  } catch {
    return failResponse(500, 'internal_error');
  }
}
