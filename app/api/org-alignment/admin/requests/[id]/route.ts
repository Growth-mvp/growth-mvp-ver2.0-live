// PATCH /api/org-alignment/admin/requests/[id]
// 管理者がすり合わせ依頼のステータスを更新

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

import { NextResponse, NextRequest } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabaseAdmin';
import { getAuthUserIdFromBearer } from '@/lib/server/rbacGuard';

type RouteContext = {
  params: Promise<{ id: string }>;
};

export async function PATCH(req: NextRequest, context: RouteContext) {
  try {
    const { id: requestId } = await context.params;
    const admin = getSupabaseAdmin();

    // 認証確認
    const userId = await getAuthUserIdFromBearer(admin, req);
    if (!userId) {
      return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
    }

    // リクエストボディ
    const body = await req.json();
    const { status, adminNote } = body;

    if (!status) {
      return NextResponse.json(
        { error: 'status is required' },
        { status: 400 }
      );
    }

    // ステータスの検証
    const validStatuses = ['pending', 'reviewing', 'scheduled', 'resolved', 'on_hold'];
    if (!validStatuses.includes(status)) {
      return NextResponse.json(
        { error: 'invalid_status' },
        { status: 400 }
      );
    }

    console.log('[admin/requests/[id]] Updating request:', {
      userId,
      requestId,
      status,
    });

    // 依頼を取得（自社のもののみ）
    const { data: request, error: fetchError } = await admin
      .from('org_alignment_requests')
      .select('id, company_id')
      .eq('id', requestId)
      .single();

    if (fetchError || !request) {
      console.error('[admin/requests/[id]] Request not found:', {
        requestId,
        fetchError,
      });
      return NextResponse.json({ error: 'request_not_found' }, { status: 404 });
    }

    const companyId = (request as any).company_id;

    // ユーザーがこの会社の admin か確認
    const { data: membership, error: memberError } = await admin
      .from('company_members')
      .select('role')
      .eq('company_id', companyId)
      .eq('user_id', userId)
      .single();

    if (memberError || !membership || (membership as any).role !== 'admin') {
      console.warn('[admin/requests/[id]] Not admin:', {
        userId,
        companyId,
      });
      return NextResponse.json({ error: 'not_admin' }, { status: 403 });
    }

    // 依頼を更新
    const { data: updated, error: updateError } = await admin
      .from('org_alignment_requests')
      .update({
        status,
        admin_note: adminNote || null,
        handled_by: userId,
        handled_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq('id', requestId)
      .select()
      .single();

    if (updateError) {
      console.error('[admin/requests/[id]] Failed to update request:', updateError);
      return NextResponse.json(
        { error: 'failed_to_update_request' },
        { status: 500 }
      );
    }

    console.log('[admin/requests/[id]] Request updated:', {
      requestId,
      status,
      handledBy: user.id,
    });

    return NextResponse.json(
      {
        ok: true,
        request: updated,
      },
      { status: 200 }
    );
  } catch (err: any) {
    console.error('[admin/requests/[id]] Exception:', err);
    return NextResponse.json(
      { error: 'internal_server_error' },
      { status: 500 }
    );
  }
}
