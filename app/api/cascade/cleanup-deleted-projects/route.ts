// /app/api/cascade/cleanup-deleted-projects/route.ts
import 'server-only';
import { NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabaseAdmin';
import { getAuthUserIdFromBearer } from '@/lib/server/rbacGuard';
import { requireAdminMfa } from '@/lib/server/mfaGuard';

/**
 * POST /api/cascade/cleanup-deleted-projects
 *
 * STAGE3 再生成で置き換えられたプロジェクトの OKR を論理削除する。
 * 保存成功後にだけ呼ばれること、保存済みの計画に現存するIDは削除しないことを、サーバーで確認する。
 * 進捗ログは変更しない（読み取り側が削除フラグを参照せず、列の有無も未確認のため）。
 *
 * Body:
 *   companyId: uuid            作業中の会社（必須。所属の自動選択は使わない）
 *   strategyId: uuid           作業中の戦略（必須。companyId に属することを確認する）
 *   expectedRevision: number   保存直後の revision（必須。別の保存が入っていれば拒否する）
 *   deletedProjectIds: string[]  削除対象のプロジェクトID（1〜200件、重複なし）
 *   departmentId?: string      ログ用（照合には使わない）
 */

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const PROJECT_ID_RE = /^[A-Za-z0-9_-]{1,120}$/;
const MAX_PROJECT_IDS = 200;
const ALLOWED_ROLES = ['admin', 'manager'];

type ParsedBody = {
  companyId: string;
  strategyId: string;
  expectedRevision: number;
  deletedProjectIds: string[];
};

function fail(status: number, error: string, extra?: Record<string, unknown>) {
  return NextResponse.json({ error, ...(extra ?? {}) }, { status });
}

function parseBody(body: unknown): { ok: true; value: ParsedBody } | { ok: false; error: string } {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return { ok: false, error: 'invalid_request' };
  const b = body as Record<string, unknown>;
  if (typeof b.companyId !== 'string' || !UUID_RE.test(b.companyId)) return { ok: false, error: 'invalid_company_id' };
  if (typeof b.strategyId !== 'string' || !UUID_RE.test(b.strategyId)) return { ok: false, error: 'invalid_strategy_id' };
  if (typeof b.expectedRevision !== 'number' || !Number.isInteger(b.expectedRevision) || b.expectedRevision < 0) {
    return { ok: false, error: 'invalid_expected_revision' };
  }
  const ids = b.deletedProjectIds;
  if (!Array.isArray(ids) || ids.length === 0 || ids.length > MAX_PROJECT_IDS) {
    return { ok: false, error: 'invalid_project_ids' };
  }
  for (const id of ids) {
    if (typeof id !== 'string' || !PROJECT_ID_RE.test(id)) return { ok: false, error: 'invalid_project_id' };
  }
  if (new Set(ids).size !== ids.length) return { ok: false, error: 'duplicate_project_ids' };
  return {
    ok: true,
    value: {
      companyId: b.companyId,
      strategyId: b.strategyId,
      expectedRevision: b.expectedRevision,
      deletedProjectIds: ids as string[],
    },
  };
}

/** 保存済みの departments に現存するプロジェクトIDを集める。判定できない形式なら ok: false。 */
function collectActiveProjectIds(departments: unknown): { ok: true; ids: Set<string> } | { ok: false } {
  if (!Array.isArray(departments)) return { ok: false };
  const ids = new Set<string>();
  for (const dept of departments) {
    if (!dept || typeof dept !== 'object') return { ok: false };
    const projects = (dept as Record<string, unknown>).projects;
    if (projects === undefined || projects === null) continue;
    if (!Array.isArray(projects)) return { ok: false };
    for (const p of projects) {
      const id = p && typeof p === 'object' ? (p as Record<string, unknown>).id : undefined;
      if (typeof id !== 'string' || id.length === 0) return { ok: false };
      ids.add(id);
    }
  }
  return { ok: true, ids };
}

export async function POST(req: Request) {
  try {
    const admin = getSupabaseAdmin();

    const mfa = await requireAdminMfa(admin, req);
    if (!mfa.ok) return fail(mfa.status, mfa.error);
    const userId = await getAuthUserIdFromBearer(admin, req);
    if (!userId) return fail(401, 'unauthorized');

    let rawBody: unknown;
    try {
      rawBody = await req.json();
    } catch {
      return fail(400, 'invalid_request');
    }
    const parsed = parseBody(rawBody);
    if (!parsed.ok) return fail(400, parsed.error);
    const { companyId, strategyId, expectedRevision, deletedProjectIds } = parsed.value;

    // 作業対象の会社への所属と、その会社での権限（admin または manager）を確認する
    const membership = await admin
      .from('company_members')
      .select('role')
      .eq('user_id', userId)
      .eq('company_id', companyId)
      .limit(1);
    if (membership.error) return fail(503, 'membership_check_unavailable');
    if (!Array.isArray(membership.data) || membership.data.length === 0) return fail(403, 'forbidden');
    if (!ALLOWED_ROLES.includes(String(membership.data[0]?.role ?? '').toLowerCase())) {
      return fail(403, 'insufficient_role');
    }

    // 戦略が会社に属することを確認する（不一致は存在を明かさず拒否）
    const strategy = await admin
      .from('strategy_data')
      .select('id, company_id, revision, departments')
      .eq('id', strategyId)
      .maybeSingle();
    if (strategy.error) return fail(503, 'strategy_check_unavailable');
    if (!strategy.data || strategy.data.company_id !== companyId) return fail(403, 'strategy_mismatch');

    // 保存世代: 保存直後の revision と一致しなければ、別の変更が入っているため拒否する
    if (strategy.data.revision !== expectedRevision) return fail(409, 'revision_changed');

    // 保存済みの計画に現存するプロジェクトは削除しない。判定できない形式も削除しない
    const active = collectActiveProjectIds(strategy.data.departments);
    if (!active.ok) return fail(409, 'unverifiable_departments');
    if (deletedProjectIds.some((id) => active.ids.has(id))) return fail(409, 'active_project_included');

    const now = new Date().toISOString();
    const okrs = await admin
      .from('okrs')
      .update({ is_deleted: true, updated_at: now })
      .eq('company_id', companyId)
      .eq('strategy_id', strategyId)
      .in('project_id', deletedProjectIds)
      .eq('is_deleted', false)
      .select('id');
    if (okrs.error) return fail(500, 'okrs_cleanup_failed');
    const okrCount = Array.isArray(okrs.data) ? okrs.data.length : 0;

    return NextResponse.json({
      ok: true,
      companyId,
      strategyId,
      cleaned: { okrs: okrCount },
      deletedProjectIds,
      timestamp: now,
    });
  } catch {
    return fail(500, 'internal_error');
  }
}
