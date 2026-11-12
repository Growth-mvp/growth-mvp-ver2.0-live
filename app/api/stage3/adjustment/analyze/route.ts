// /app/api/stage3/adjustment/analyze/route.ts
// STAGE3: 最新の計画案（保存済みの正式データ、または指定された草案の版）を横断分析し、部門間の調整候補を返す。保存はしない。
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
import {
  buildAnalysisMessages,
  collectPlanUnits,
  countDepartments,
  resolveCandidates,
} from '@/lib/cascade/stage3Adjustment';

const BodySchema = z.object({
  companyId: z.string().uuid(),
  strategyId: z.string().uuid(),
  draft: z.object({ draftId: z.string().min(1).max(60), version: z.number().int().min(1) }).nullable().optional(),
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
    if (countDepartments(units) < 2) return failResponse(422, 'insufficient_departments');

    const completion = await openai.chat.completions.create({
      ...getOpenAIModelParamsForProcess('stage3AdjustmentAnalyze'),
      messages: buildAnalysisMessages({ companyStrategy: confirmed.companyStrategy, units }),
    });

    let raw: unknown;
    try {
      raw = JSON.parse(completion.choices[0]?.message?.content ?? '');
    } catch {
      return failResponse(502, 'upstream_unparseable');
    }
    const result = resolveCandidates(raw, units);

    await logAuditEvent({
      companyId: access.access.companyId,
      actorUserId: access.access.userId,
      action: 'stage3_adjustment_analyzed',
      targetType: 'strategy',
      targetId: body.strategyId,
      metadata: {
        candidateCount: result.candidates.length,
        rejectedCandidates: result.rejectedCandidates,
        rejectedReferences: result.rejectedReferences,
        planUnitCount: units.length,
        sourceDraftId: body.draft?.draftId ?? null,
      },
    });

    return NextResponse.json({
      ok: true,
      revision: access.access.revision,
      workspaceVersion: loaded.workspace.version,
      sourceDraft: body.draft ?? null,
      candidates: result.candidates,
      rejectedCandidates: result.rejectedCandidates,
      rejectedReferences: result.rejectedReferences,
    });
  } catch {
    return failResponse(500, 'internal_error');
  }
}
