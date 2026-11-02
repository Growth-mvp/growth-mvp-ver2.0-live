// /app/api/cascade/adopt-candidate/route.ts
import 'server-only';
import { NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabaseAdmin';
import { getAuthUserIdFromBearer } from '@/lib/server/rbacGuard';
import { requireAdminMfa } from '@/lib/server/mfaGuard';
import {
  collectProjectIds,
  pickAdoptableProject,
  stripOkrIdentity,
  validateAdoptableProject,
} from '@/lib/cascade/stage3Candidates';
import { logAuditEvent } from '@/lib/server/auditLog';
import { failResponse, writeDepartmentGuarded } from '@/lib/server/stage3DepartmentWrite';

/**
 * POST /api/cascade/adopt-candidate
 *
 * STAGE3 の未採用候補を、利用者が選んだ1件だけ既存の部門に追加する。
 * 既存のプロジェクト・OKR・承認・人的投資・進捗は変更しない。書き込みは strategy_data.departments だけ。
 * 保存済みの revision と一致しなければ書き込まない（別の変更を上書きしない）。
 *
 * Body:
 *   companyId: uuid            作業中の会社
 *   strategyId: uuid           作業中の戦略（companyId に属することを確認する）
 *   expectedRevision: number   候補を表示したときに使った revision
 *   departmentName: string     追加先の部門名（完全一致）
 *   project: object            追加するプロジェクト（id は採用時に発行したもの）
 */

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const PROJECT_ID_RE = /^[A-Za-z0-9_-]{1,120}$/;
const MAX_TEXT = 5000;
const MAX_OKRS = 30;
const MAX_PROJECT_JSON = 100_000;

type AnyRecord = Record<string, unknown>;

function isOptionalText(v: unknown, max = MAX_TEXT): boolean {
  return v === undefined || v === null || (typeof v === 'string' && v.length <= max);
}

function parseProject(raw: unknown): { ok: true; value: AnyRecord } | { ok: false; error: string } {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { ok: false, error: 'invalid_project' };
  const p = raw as AnyRecord;
  if (typeof p.id !== 'string' || !PROJECT_ID_RE.test(p.id)) return { ok: false, error: 'invalid_project_id' };
  if (typeof p.title !== 'string' || p.title.trim().length === 0 || p.title.length > 200) {
    return { ok: false, error: 'invalid_project_title' };
  }
  for (const key of ['hypothesis', 'reason', 'description', 'mainLever', 'horizon', 'kind']) {
    if (!isOptionalText(p[key])) return { ok: false, error: 'invalid_project_field' };
  }
  if (p.okrs !== undefined && (!Array.isArray(p.okrs) || p.okrs.length > MAX_OKRS)) {
    return { ok: false, error: 'invalid_project_okrs' };
  }
  if (JSON.stringify(p).length > MAX_PROJECT_JSON) return { ok: false, error: 'project_too_large' };
  return { ok: true, value: p };
}

export async function POST(req: Request) {
  try {
    const admin = getSupabaseAdmin();

    const mfa = await requireAdminMfa(admin, req);
    if (!mfa.ok) return failResponse(mfa.status, mfa.error);
    const userId = await getAuthUserIdFromBearer(admin, req);
    if (!userId) return failResponse(401, 'unauthorized');

    let body: AnyRecord;
    try {
      const raw = await req.json();
      if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return failResponse(400, 'invalid_request');
      body = raw as AnyRecord;
    } catch {
      return failResponse(400, 'invalid_request');
    }
    if (typeof body.companyId !== 'string' || !UUID_RE.test(body.companyId)) return failResponse(400, 'invalid_company_id');
    if (typeof body.strategyId !== 'string' || !UUID_RE.test(body.strategyId)) return failResponse(400, 'invalid_strategy_id');
    if (typeof body.expectedRevision !== 'number' || !Number.isInteger(body.expectedRevision) || body.expectedRevision < 0) {
      return failResponse(400, 'invalid_expected_revision');
    }
    if (typeof body.departmentName !== 'string' || body.departmentName.trim().length === 0 || body.departmentName.length > 200) {
      return failResponse(400, 'invalid_department_name');
    }
    const parsed = parseProject(body.project);
    if (!parsed.ok) return failResponse(400, parsed.error);
    const allowed = validateAdoptableProject(parsed.value);
    if (!allowed.ok) return failResponse(400, allowed.error);
    const projectId = parsed.value.id as string;
    const project: AnyRecord = { ...pickAdoptableProject(parsed.value), okrs: stripOkrIdentity(parsed.value.okrs) };

    const outcome = await writeDepartmentGuarded({
      admin,
      userId,
      companyId: body.companyId,
      strategyId: body.strategyId,
      expectedRevision: body.expectedRevision,
      departmentName: body.departmentName,
      apply: (target, departments) => {
        if (collectProjectIds(departments).has(projectId)) {
          return { ok: false, status: 409, error: 'duplicate_project_id' };
        }
        const existing = Array.isArray(target.projects) ? target.projects : [];
        return { ok: true, target: { ...target, projects: [...existing, project] } };
      },
    });
    if (!outcome.ok) return failResponse(outcome.status, outcome.error);

    await logAuditEvent({
      companyId: body.companyId,
      actorUserId: userId,
      action: 'stage3_project_adopted',
      targetType: 'strategy',
      targetId: body.strategyId,
      after: { departmentName: body.departmentName, projectId, title: project.title ?? null },
      metadata: { expectedRevision: body.expectedRevision, source: 'stage3_candidate' },
    });

    return NextResponse.json({
      ok: true,
      companyId: body.companyId,
      strategyId: body.strategyId,
      departmentName: body.departmentName,
      projectId,
    });
  } catch {
    return failResponse(500, 'internal_error');
  }
}
