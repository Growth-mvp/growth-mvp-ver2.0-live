// /app/api/cascade/apply-department-proposal/route.ts
import 'server-only';
import { NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabaseAdmin';
import { getAuthUserIdFromBearer } from '@/lib/server/rbacGuard';
import { requireAdminMfa } from '@/lib/server/mfaGuard';
import {
  currentItemValues,
  sameItemValues,
  validateProposalRequest,
} from '@/lib/cascade/stage3Candidates';
import { logAuditEvent } from '@/lib/server/auditLog';
import { failResponse, writeDepartmentGuarded } from '@/lib/server/stage3DepartmentWrite';

/**
 * POST /api/cascade/apply-department-proposal
 *
 * STAGE3 の部門戦略の変更案を、利用者が明示した1項目だけ既存の部門に反映する。
 * 既存のプロジェクト・OKR・承認・人的投資・スキル計画・進捗は変更しない。書き込みは strategy_data.departments だけ。
 * 案を作ったときの既存値（base）と現在値が違えば書き込まない（409）。
 *
 * Body:
 *   companyId, strategyId, expectedRevision, departmentName
 *   item: 反映する項目（ミッション・連携案など）
 *   value: 反映する値（項目のキーすべて）
 *   base: 案を作ったときの既存値（項目のキーすべて）
 */

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type AnyRecord = Record<string, unknown>;

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
    const request = validateProposalRequest(body.item, body.value, body.base);
    if (!request.ok) return failResponse(400, request.error);
    const item = request.item;
    const value = body.value as AnyRecord;
    const base = body.base as AnyRecord;

    const outcome = await writeDepartmentGuarded({
      admin,
      userId,
      companyId: body.companyId,
      strategyId: body.strategyId,
      expectedRevision: body.expectedRevision,
      departmentName: body.departmentName,
      apply: (target) => {
        if (!sameItemValues(base, currentItemValues(target, item))) {
          return { ok: false, status: 409, error: 'current_value_changed' };
        }
        return { ok: true, target: { ...target, ...value } };
      },
    });
    if (!outcome.ok) return failResponse(outcome.status, outcome.error);

    await logAuditEvent({
      companyId: body.companyId,
      actorUserId: userId,
      action: 'stage3_department_proposal_applied',
      targetType: 'strategy',
      targetId: body.strategyId,
      after: { departmentName: body.departmentName, item },
      metadata: { expectedRevision: body.expectedRevision, source: 'stage3_department_proposal' },
    });

    return NextResponse.json({
      ok: true,
      companyId: body.companyId,
      strategyId: body.strategyId,
      departmentName: body.departmentName,
      item,
    });
  } catch {
    return failResponse(500, 'internal_error');
  }
}
