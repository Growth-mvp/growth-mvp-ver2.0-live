// GET /api/org-alignment/admin/requests
// 管理者が未対応のすり合わせ依頼を取得

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

import { NextResponse, NextRequest } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabaseAdmin';
import { getAuthUserIdFromBearer } from '@/lib/server/rbacGuard';

export async function GET(req: NextRequest) {
  try {
    const admin = getSupabaseAdmin();

    // 認証確認
    const userId = await getAuthUserIdFromBearer(admin, req);
    if (!userId) {
      return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
    }

    // クエリパラメータ
    const searchParams = req.nextUrl.searchParams;
    const companyId = searchParams.get('companyId');
    const status = searchParams.get('status') || 'pending';

    if (!companyId) {
      return NextResponse.json(
        { error: 'companyId is required' },
        { status: 400 }
      );
    }

    // ユーザーがこの会社の admin か確認
    const { data: membership, error: memberError } = await admin
      .from('company_members')
      .select('role')
      .eq('company_id', companyId)
      .eq('user_id', userId)
      .single();

    if (memberError || !membership || (membership as any).role !== 'admin') {
      console.warn('[admin/requests] Not admin:', {
        userId,
        companyId,
        role: (membership as any)?.role,
      });
      return NextResponse.json({ error: 'not_admin' }, { status: 403 });
    }

    // 未対応のすり合わせ依頼を取得
    const statuses = status === 'all'
      ? ['pending', 'reviewing', 'scheduled', 'resolved', 'on_hold']
      : [status];

    const { data: requests, error: fetchError } = await admin
      .from('org_alignment_requests')
      .select(`
        id,
        case_id,
        requested_by,
        requested_at,
        status,
        handled_by,
        handled_at,
        admin_note,
        created_at,
        updated_at,
        org_alignment_cases!inner(
          id,
          situation_text,
          counterparty_type,
          counterparty_detail,
          visibility_mode,
          created_at,
          created_by
        )
      `)
      .eq('company_id', companyId)
      .in('status', statuses)
      .order('requested_at', { ascending: false });

    if (fetchError) {
      console.error('[admin/requests] Failed to fetch requests:', fetchError);
      return NextResponse.json(
        { error: 'failed_to_fetch_requests' },
        { status: 500 }
      );
    }

    // ユーザー情報を取得（visibility_mode に応じて投稿者情報を出し分け）
    const enrichedRequests = await Promise.all(
      (requests || []).map(async (req: any) => {
        const caseData = req.org_alignment_cases;
        const visibilityMode = caseData.visibility_mode;

        let requesterName: string | null = null;
        let requesterEmail: string | null = null;
        let posterName: string | null = null;
        let posterEmail: string | null = null;

        // 依頼者情報
        if (req.requested_by) {
          const { data: requester, error: requesterError } = await admin
            .from('profiles')
            .select('full_name, email')
            .eq('id', req.requested_by)
            .single();

          if (!requesterError && requester) {
            requesterName = (requester as any).full_name || null;
            requesterEmail = (requester as any).email || null;
          }
        }

        // 投稿者情報（visibility_mode に応じて）
        if (visibilityMode !== 'anonymous' && caseData.created_by) {
          const { data: poster, error: posterError } = await admin
            .from('profiles')
            .select('full_name, email')
            .eq('id', caseData.created_by)
            .single();

          if (!posterError && poster) {
            posterName = (poster as any).full_name || null;
            posterEmail = (poster as any).email || null;
          }
        }

        return {
          id: req.id,
          caseId: req.case_id,
          requestedBy: req.requested_by,
          requesterName,
          requesterEmail,
          requestedAt: req.requested_at,
          status: req.status,
          handledBy: req.handled_by,
          handledAt: req.handled_at,
          adminNote: req.admin_note,
          createdAt: req.created_at,
          updatedAt: req.updated_at,
          // ケース情報
          case: {
            id: caseData.id,
            situationText: caseData.situation_text,
            counterpartyType: caseData.counterparty_type,
            counterpartyDetail: caseData.counterparty_detail,
            visibilityMode: caseData.visibility_mode,
            createdAt: caseData.created_at,
            createdBy: caseData.created_by,
            posterName,
            posterEmail,
          },
        };
      })
    );

    console.log('[admin/requests] Fetched requests:', {
      companyId,
      count: enrichedRequests.length,
      statuses,
    });

    return NextResponse.json({ requests: enrichedRequests }, { status: 200 });
  } catch (err: any) {
    console.error('[admin/requests] Exception:', err);
    return NextResponse.json(
      { error: 'internal_server_error' },
      { status: 500 }
    );
  }
}
