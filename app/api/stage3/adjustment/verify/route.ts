// /app/api/stage3/adjustment/verify/route.ts
// STAGE3: 採用・編集された変更を当てた計画を、部門間の重複・不整合として再検証する。
// 結果は作業版（verification）に版つきで保存する。正式データは変えない。
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
import { buildConfirmPlan } from '@/lib/server/stage3ConfirmPlan';
import { loadWorkspace, saveWorkspace } from '@/lib/server/stage3StrategyBook';
import { planBasisKey, verifyWorkspaceState, type Verification } from '@/lib/cascade/stage3StrategyBook';
import { settleLegacySelections } from '@/lib/cascade/stage3Settle';
import {
  buildAnalysisMessages,
  collectPlanUnits,
  countDepartments,
  formatFinanceSummary,
  resolveCandidates,
} from '@/lib/cascade/stage3Adjustment';

const BodySchema = z.object({
  companyId: z.string().uuid(),
  strategyId: z.string().uuid(),
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
    if (!check.ok) return failResponse(409, check.error);
    if (check.state.status === 'confirmed') return failResponse(409, 'already_confirmed');
    const current = settleLegacySelections(check.state, access.access.departments).state;

    const built = await buildConfirmPlan(admin, {
      companyId: body.companyId,
      strategyId: body.strategyId,
      state: current,
      departments: access.access.departments,
      actorUserId: access.access.userId,
    });
    if (built.kind === 'error') return failResponse(built.status, built.error);
    if (built.kind === 'failed') {
      return NextResponse.json(
        { ok: false, error: built.failure.error, departmentName: built.failure.departmentName, item: built.failure.item },
        { status: 409 },
      );
    }
    const plan = built.plan;
    const changeCount =
      plan.appliedCount + plan.editedProjectCount + plan.adoptedProjectIds.length + plan.excludedProjectIds.length;

    const units = collectPlanUnits(plan.departments);
    let result: { candidates: Verification['candidates']; rejectedCandidates: number; rejectedReferences: number } = {
      candidates: [],
      rejectedCandidates: 0,
      rejectedReferences: 0,
    };
    if (changeCount > 0) {
      if (countDepartments(units) < 2) return failResponse(422, 'insufficient_departments');
      const completion = await openai.chat.completions.create({
        ...getOpenAIModelParamsForProcess('stage3AdjustmentAnalyze'),
        messages: buildAnalysisMessages({
          companyStrategy: confirmed.companyStrategy,
          units,
          finance: formatFinanceSummary(access.access.financePl),
          planLabel: '調整後の部門別の行動計画案',
        }),
      });
      let raw: unknown;
      try {
        raw = JSON.parse(completion.choices[0]?.message?.content ?? '');
      } catch {
        return failResponse(502, 'upstream_unparseable');
      }
      result = resolveCandidates(raw, units);
    }

    const verification: Verification = {
      basisKey: planBasisKey(check.state),
      createdAt: new Date().toISOString(),
      changeCount,
      rejectedCount: result.rejectedCandidates + result.rejectedReferences,
      candidates: result.candidates,
    };
    const saved = await saveWorkspace(admin, {
      companyId: body.companyId,
      strategyId: body.strategyId,
      userId: access.access.userId,
      expectedVersion: loaded.workspace.version,
      state: { ...check.state, verification },
    });

    await logAuditEvent({
      companyId: access.access.companyId,
      actorUserId: access.access.userId,
      action: 'stage3_adjustment_verified',
      targetType: 'strategy',
      targetId: body.strategyId,
      metadata: {
        changeCount,
        candidateCount: result.candidates.length,
        rejectedCandidates: result.rejectedCandidates,
        rejectedReferences: result.rejectedReferences,
        planUnitCount: units.length,
        persisted: saved.ok,
      },
    });

    return NextResponse.json({
      ok: true,
      persisted: saved.ok,
      workspaceVersion: saved.ok ? saved.version : loaded.workspace.version,
      verification,
    });
  } catch {
    return failResponse(500, 'internal_error');
  }
}
