// POST /api/org-alignment/cases/[id]/request-alignment
// 投稿者本人、または投稿の会社の管理者がすり合わせ依頼を作成する

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

import { NextResponse, NextRequest } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabaseAdmin';
import { getAuthUserIdFromBearer } from '@/lib/server/rbacGuard';
import { isOrgAlignmentVisibilityMode } from '@/utils/supabase/org-alignment-visibility';

type RouteContext = {
  params: Promise<{ id: string }>;
};

export async function POST(req: NextRequest, context: RouteContext) {
  try {
    const { id: caseId } = await context.params;

    const admin = getSupabaseAdmin();

    const userId = await getAuthUserIdFromBearer(admin, req);
    if (!userId) {
      return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
    }

    const body = (await req.json().catch(() => null)) as
      | { visibilityMode?: unknown; companyId?: unknown }
      | null;
    const visibilityMode = body?.visibilityMode;

    if (!visibilityMode) {
      return NextResponse.json({ error: 'visibilityMode is required' }, { status: 400 });
    }
    if (!isOrgAlignmentVisibilityMode(visibilityMode)) {
      return NextResponse.json({ error: 'visibilityMode is invalid' }, { status: 400 });
    }

    const { data: caseRow, error: caseError } = await admin
      .from('org_alignment_cases')
      .select('id, company_id, created_by, visibility_mode')
      .eq('id', caseId)
      .maybeSingle();

    if (caseError || !caseRow) {
      return NextResponse.json({ error: 'case_not_found' }, { status: 404 });
    }

    const companyId = (caseRow as any).company_id as string;

    // 企業IDと投稿IDの照合。一致しない場合は投稿の存在を明かさない
    if (body?.companyId !== undefined && body.companyId !== companyId) {
      return NextResponse.json({ error: 'case_not_found' }, { status: 404 });
    }

    // 投稿の会社に対する所属で判定する（複数所属でも、対象企業の権限を使う）
    const { data: memberships, error: memberError } = await admin
      .from('company_members')
      .select('role')
      .eq('company_id', companyId)
      .eq('user_id', userId);

    if (memberError || !memberships || memberships.length === 0) {
      return NextResponse.json({ error: 'not_a_member' }, { status: 403 });
    }

    const isAdmin = (memberships[0] as any).role === 'admin';
    const isAuthor = (caseRow as any).created_by === userId;

    // 他人の投稿への依頼は、会社の管理者のみ。一般社員・管理職は自分の投稿だけ
    if (!isAuthor && !isAdmin) {
      return NextResponse.json({ error: 'forbidden' }, { status: 403 });
    }

    // 公開範囲は投稿者本人だけが変えられる（管理者でも本人の同意なく変更しない）
    const currentMode = (caseRow as any).visibility_mode as string;
    if (visibilityMode !== currentMode && !isAuthor) {
      return NextResponse.json({ error: 'visibility_change_requires_author' }, { status: 403 });
    }

    const now = new Date().toISOString();
    const caseUpdate: Record<string, unknown> = {
      status: 'alignment_requested',
      requested_at: now,
      updated_at: now,
    };
    if (isAuthor) {
      caseUpdate.visibility_mode = visibilityMode;
    }

    const { error: updateCaseError } = await admin
      .from('org_alignment_cases')
      .update(caseUpdate)
      .eq('id', caseId)
      .eq('company_id', companyId);

    if (updateCaseError) {
      console.error('[request-alignment] Failed to update case:', updateCaseError.code ?? 'unknown');
      return NextResponse.json({ error: 'failed_to_update_case' }, { status: 500 });
    }

    const { data: request, error: insertError } = await admin
      .from('org_alignment_requests')
      .insert({
        company_id: companyId,
        case_id: caseId,
        requested_by: userId,
      })
      .select()
      .single();

    if (insertError) {
      console.error('[request-alignment] Failed to insert request:', insertError.code ?? 'unknown');
      return NextResponse.json({ error: 'failed_to_create_request' }, { status: 500 });
    }

    return NextResponse.json({ ok: true, requestId: (request as any).id }, { status: 201 });
  } catch (err: any) {
    console.error('[request-alignment] Exception:', err?.name ?? 'unknown');
    return NextResponse.json({ error: 'internal_server_error' }, { status: 500 });
  }
}
