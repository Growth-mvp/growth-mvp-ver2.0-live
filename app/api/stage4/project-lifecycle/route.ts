// /app/api/stage4/project-lifecycle/route.ts
import 'server-only';
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { getSupabaseAdmin } from '@/lib/supabaseAdmin';
import { logAuditEvent } from '@/lib/server/auditLog';
import { requireAdminMfa } from '@/lib/server/mfaGuard';
import { loadStrategyAccess } from '@/lib/server/stage3Adjustment';
import { failResponse, writeDepartmentGuarded } from '@/lib/server/stage3DepartmentWrite';
import { canAdoptCandidate } from '@/lib/cascade/stage3Candidates';
import { lifecycleActionRefusal, lifecycleOf, setProjectLifecycle } from '@/lib/cascade/projectLifecycle';

/**
 * POST /api/stage4/project-lifecycle
 *
 * STAGE4 の施策を「計画から外す（EXCLUDE）」または「中止する（STOP）」。管理者・管理職だけが行える。
 * 権限・所属・戦略・版（revision）は既存の確認処理（loadStrategyAccess・writeDepartmentGuarded）で確かめ、
 * 計画の採用・開始の有無は書き込みの直前に保存済みの計画から読み直して判定する（画面の表示は信用しない）。
 * 書き込みは strategy_data.departments の、その部門1件だけ。物理削除はしない（無効化・中止の状態を付ける）。
 */

type AnyRecord = Record<string, unknown>;

const BodySchema = z.object({
  companyId: z.string().uuid(),
  strategyId: z.string().uuid(),
  projectId: z.string().min(1).max(200),
  action: z.enum(['EXCLUDE', 'STOP']),
  expectedRevision: z.number().int().min(0),
});

const REFUSAL_CODE = {
  ALREADY_OUT: 'already_out',
  APPROVED: 'approved',
  EXECUTING: 'executing',
  NOT_STARTED: 'not_started',
} as const;

const MISSING_TABLE_CODES = new Set(['42P01', 'PGRST205']);

export async function POST(req: Request) {
  try {
    const admin = getSupabaseAdmin();

    const mfa = await requireAdminMfa(admin, req);
    if (!mfa.ok) return failResponse(mfa.status, mfa.error);

    let raw: unknown;
    try {
      raw = await req.json();
    } catch {
      return failResponse(400, 'invalid_request');
    }
    const parsed = BodySchema.safeParse(raw);
    if (!parsed.success) return failResponse(400, 'invalid_request');
    const body = parsed.data;

    const loaded = await loadStrategyAccess(admin, req, body);
    if (!loaded.ok) return failResponse(loaded.status, loaded.error);
    const { access } = loaded;
    if (!canAdoptCandidate(access.role)) return failResponse(403, 'insufficient_role');
    if (access.revision !== body.expectedRevision) return failResponse(409, 'revision_changed');

    const departments = access.departments as AnyRecord[];
    const hits: Array<{ d: number; p: number }> = [];
    departments.forEach((dept, d) => {
      const list = Array.isArray(dept?.projects) ? (dept.projects as AnyRecord[]) : [];
      list.forEach((project, p) => {
        if (String(project?.id ?? '') === body.projectId) hits.push({ d, p });
      });
    });
    if (hits.length === 0) return failResponse(409, 'project_missing');
    if (hits.length > 1) return failResponse(409, 'project_ambiguous');
    const { d, p } = hits[0];
    const dept = departments[d];
    const project = (dept.projects as AnyRecord[])[p];
    const departmentName = String(dept.name ?? '');
    const sameName = departments.filter((x) => String(x?.name ?? '') === departmentName).length;
    if (departmentName === '' || sameName !== 1) return failResponse(409, 'department_ambiguous');

    const plans = await admin
      .from('stage4_plan_documents')
      .select('adopted, started')
      .eq('company_id', body.companyId)
      .eq('strategy_id', body.strategyId)
      .eq('project_id', body.projectId);
    if (plans.error && !MISSING_TABLE_CODES.has(String(plans.error.code ?? ''))) {
      return failResponse(503, 'plan_check_unavailable');
    }
    const plan = (Array.isArray(plans.data) ? plans.data : [])[0] as AnyRecord | undefined;
    const started = plan?.started === true;
    const executing = plan?.adopted === true || started;
    const refusal = lifecycleActionRefusal(project, body.action, { executing, started });
    if (refusal) return failResponse(409, REFUSAL_CODE[refusal]);

    const changedAt = new Date().toISOString();
    const status = body.action === 'EXCLUDE' ? 'EXCLUDED' : 'STOPPED';
    const outcome = await writeDepartmentGuarded({
      admin,
      userId: access.userId,
      companyId: body.companyId,
      strategyId: body.strategyId,
      expectedRevision: body.expectedRevision,
      departmentName,
      loaded: { revision: access.revision, departments: access.departments },
      apply: (target) => {
        const next = setProjectLifecycle([target], {
          projectId: body.projectId,
          status,
          changedAt,
          changedBy: access.userId,
          stoppedAt: changedAt,
        });
        if (!next.ok) return { ok: false, status: 409, error: next.error };
        return { ok: true, target: next.departments[0] };
      },
    });
    if (!outcome.ok) return failResponse(outcome.status, outcome.error);

    await logAuditEvent({
      companyId: body.companyId,
      actorUserId: access.userId,
      action: 'stage4_project_lifecycle',
      targetType: 'strategy',
      targetId: body.strategyId,
      before: { projectId: body.projectId, lifecycle: lifecycleOf(project) },
      after: { projectId: body.projectId, status },
      metadata: { action: body.action, expectedRevision: body.expectedRevision, executing, started },
    });

    return NextResponse.json({ ok: true, revision: outcome.revision, departments: outcome.departments });
  } catch {
    return failResponse(500, 'internal_error');
  }
}
