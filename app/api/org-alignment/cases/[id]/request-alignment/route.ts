// POST /api/org-alignment/cases/[id]/request-alignment
// member がすり合わせ依頼を作成

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

import { NextResponse, NextRequest } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabaseAdmin';
import { getAuthUserIdFromBearer } from '@/lib/server/rbacGuard';

type RouteContext = {
  params: Promise<{ id: string }>;
};

export async function POST(req: NextRequest, context: RouteContext) {
  try {
    const { id: caseId } = await context.params;

    const admin = getSupabaseAdmin();

    // 認証確認
    const userId = await getAuthUserIdFromBearer(admin, req);
    if (!userId) {
      return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
    }

    // リクエストボディ
    const body = await req.json();
    const { visibilityMode } = body;

    if (!visibilityMode) {
      return NextResponse.json(
        { error: 'visibilityMode is required' },
        { status: 400 }
      );
    }

    console.log('[request-alignment] Creating request:', {
      userId,
      caseId,
      visibilityMode,
    });

    // ケースを取得
    const { data: caseData, error: caseError } = await admin
      .from('org_alignment_cases')
      .select('id, company_id')
      .eq('id', caseId)
      .single();

    if (caseError || !caseData) {
      console.error('[request-alignment] Case not found:', { caseId, caseError });
      return NextResponse.json({ error: 'case_not_found' }, { status: 404 });
    }

    const companyId = (caseData as any).company_id;
    console.log('[request-alignment] case found:', {
      caseId,
      caseCompanyId: companyId,
      userId,
    });

    // ユーザーがこの会社のメンバーか確認
    console.log('[request-alignment] membership query:', {
      companyId,
      userId,
    });

    const { data: membership, error: memberError } = await admin
      .from('company_members')
      .select('id, company_id, user_id, role')
      .eq('company_id', companyId)
      .eq('user_id', userId);

    console.log('[request-alignment] membership result:', {
      memberError,
      membership,
      count: membership ? membership.length : 0,
    });

    if (memberError || !membership || membership.length === 0) {
      console.error('[request-alignment] Not a member:', {
        userId,
        companyId,
        memberError,
        membership,
      });
      return NextResponse.json({ error: 'not_a_member' }, { status: 403 });
    }

    // org_alignment_cases の status を 'alignment_requested' に更新
    const { error: updateCaseError } = await admin
      .from('org_alignment_cases')
      .update({
        status: 'alignment_requested',
        visibility_mode: visibilityMode,
        requested_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq('id', caseId);

    if (updateCaseError) {
      console.error('[request-alignment] Failed to update case:', updateCaseError);
      return NextResponse.json(
        { error: 'failed_to_update_case' },
        { status: 500 }
      );
    }

    // org_alignment_requests に依頼を記録
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
      console.error('[request-alignment] Failed to insert request:', insertError);
      // ケースの更新は既に完了しているので、エラーをログして返す
      return NextResponse.json(
        { error: 'failed_to_create_request' },
        { status: 500 }
      );
    }

    console.log('[request-alignment] Request created:', {
      requestId: (request as any).id,
      caseId,
      companyId,
    });

    return NextResponse.json(
      {
        ok: true,
        requestId: (request as any).id,
      },
      { status: 201 }
    );
  } catch (err: any) {
    console.error('[request-alignment] Exception:', err);
    return NextResponse.json(
      { error: 'internal_server_error' },
      { status: 500 }
    );
  }
}
