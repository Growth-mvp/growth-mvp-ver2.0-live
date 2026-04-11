// /app/api/cascade/cleanup-deleted-projects/route.ts
import 'server-only';
import { NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabaseAdmin';
import { getAuthUserIdFromBearer } from '@/lib/server/rbacGuard';

/**
 * POST /api/cascade/cleanup-deleted-projects
 *
 * STAGE3再生成で削除されたプロジェクトに紐づく downstream data を cleanup
 *
 * Body:
 *   {
 *     deletedProjectIds: string[],     // ["proj-xxx", "proj-yyy"]
 *     departmentId: string             // "営業部" or "dept-xxx"
 *   }
 *
 * 処理：
 * 1. Bearer token から userId を認証
 * 2. userId の membership から companyId をサーバ側で解決
 * 3. okrs テーブル：project_id IN (deletedProjectIds) → is_deleted = true
 * 4. progress_logs テーブル：metadata.projectId IN (deletedProjectIds) → is_deleted = true
 */
export async function POST(req: Request) {
  try {
    const admin = getSupabaseAdmin();

    // === Step 1: 認証 ===
    const userId = await getAuthUserIdFromBearer(admin, req);
    if (!userId) {
      console.warn('[api/cascade/cleanup] unauthorized');
      return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
    }

    // === Step 2: companyId をサーバ側で解決（admin query）===
    const { data: membershipRows, error: membershipError } = await admin
      .from('company_members')
      .select('company_id, role, created_at')
      .eq('user_id', userId);

    if (membershipError) {
      console.warn('[api/cascade/cleanup] membership query failed:', membershipError);
      return NextResponse.json({ error: 'forbidden' }, { status: 403 });
    }

    if (!Array.isArray(membershipRows) || membershipRows.length === 0) {
      console.warn('[api/cascade/cleanup] no company membership for user:', { userId });
      return NextResponse.json({ error: 'forbidden' }, { status: 403 });
    }

    // 複数所属の場合は role 優先度で1件選ぶ
    const weight: Record<string, number> = { admin: 3, manager: 2, member: 1 };
    const selectedMembership = [...membershipRows].sort((a, b) => {
      const roleA = String(a?.role ?? 'member').toLowerCase();
      const roleB = String(b?.role ?? 'member').toLowerCase();
      const wa = weight[roleA] ?? 0;
      const wb = weight[roleB] ?? 0;
      if (wa !== wb) return wb - wa;
      const ca = String(a?.created_at ?? '');
      const cb = String(b?.created_at ?? '');
      return cb.localeCompare(ca);
    })[0];

    const companyId = selectedMembership?.company_id;
    if (!companyId) {
      console.warn('[api/cascade/cleanup] no company_id found in membership:', { userId });
      return NextResponse.json({ error: 'forbidden' }, { status: 403 });
    }

    // ★ Role チェック: admin のみ許可
    const role = String(selectedMembership?.role ?? 'member').toLowerCase();
    if (role !== 'admin') {
      console.warn('[api/cascade/cleanup] insufficient_role:', { userId, role });
      return NextResponse.json({ error: 'insufficient_role' }, { status: 403 });
    }

    // === Step 3: Request body パース ===
    const body = await req.json();
    const { deletedProjectIds, departmentId } = body as {
      deletedProjectIds?: string[];
      departmentId?: string;
    };

    if (!Array.isArray(deletedProjectIds) || deletedProjectIds.length === 0) {
      console.log('[api/cascade/cleanup] empty deletedProjectIds, skipping cleanup');
      return NextResponse.json({
        ok: true,
        cleaned: { okrs: 0, progressLogs: 0 },
        timestamp: new Date().toISOString(),
      });
    }

    console.log('[diag][cascade:regen:cleanup:request]', {
      userId,
      companyId,
      departmentId,
      deletedProjectIds,
      timestamp: new Date().toISOString(),
    });

    // === Step 4a: okrs soft_delete ===
    const { error: okrError, count: okrCount } = await admin
      .from('okrs')
      .update({ is_deleted: true, updated_at: new Date().toISOString() })
      .eq('company_id', companyId)
      .in('project_id', deletedProjectIds)
      .eq('is_deleted', false)
      .select('id', { count: 'exact' });

    if (okrError) {
      console.error('[api/cascade/cleanup] okrs soft_delete failed:', okrError);
      return NextResponse.json(
        { error: 'okrs_cleanup_failed', detail: okrError.message },
        { status: 500 }
      );
    }

    console.log('[diag][cascade:regen:cleanup:okrs]', {
      companyId,
      departmentId,
      deletedProjectIds,
      deletedCount: okrCount,
      timestamp: new Date().toISOString(),
    });

    // === Step 4b: progress_logs cleanup ===
    // metadata.projectId は progress_logs.progress_text に embedded JSON 形式で存在
    // 全行を取得 → projectId チェック → soft_delete フラグを立てる方式

    let progressLogsDeletedCount = 0;
    try {
      // progress_logs から全データを取得（company_id でフィルタ）
      const { data: allProgressLogs, error: fetchError } = await admin
        .from('progress_logs')
        .select('id, progress_text')
        .eq('company_id', companyId)
        .eq('is_deleted', false);

      if (fetchError) {
        console.warn('[api/cascade/cleanup] progress_logs fetch failed:', fetchError);
        // 失敗してもcleanup は続行（non-blocking）
      } else if (Array.isArray(allProgressLogs) && allProgressLogs.length > 0) {
        // projectId マッチするログ を特定
        const idsToDelete: string[] = [];

        for (const log of allProgressLogs) {
          if (!log.progress_text) continue;

          try {
            // metadata パース
            const match = log.progress_text.match(/^__META__:({.+?})\n/);
            if (match) {
              const metadata = JSON.parse(match[1]);
              if (
                metadata.projectId &&
                deletedProjectIds.includes(metadata.projectId)
              ) {
                idsToDelete.push(log.id);
              }
            }
          } catch (e) {
            // parse error は無視
          }
        }

        // soft_delete
        if (idsToDelete.length > 0) {
          const { error: delError, count: delCount } = await admin
            .from('progress_logs')
            .update({ is_deleted: true, updated_at: new Date().toISOString() })
            .in('id', idsToDelete)
            .eq('is_deleted', false)
            .select('id', { count: 'exact' });

          if (delError) {
            console.warn('[api/cascade/cleanup] progress_logs soft_delete failed:', delError);
          } else {
            progressLogsDeletedCount = delCount || 0;
          }
        }
      }
    } catch (e) {
      console.warn('[api/cascade/cleanup] progress_logs cleanup exception:', e);
      // non-blocking exception
    }

    console.log('[diag][cascade:regen:cleanup:progress-logs]', {
      companyId,
      departmentId,
      deletedProjectIds,
      deletedCount: progressLogsDeletedCount,
      timestamp: new Date().toISOString(),
    });

    // === 結果 ===
    return NextResponse.json({
      ok: true,
      cleaned: {
        okrs: okrCount || 0,
        progressLogs: progressLogsDeletedCount,
      },
      deletedProjectIds,
      timestamp: new Date().toISOString(),
      diag: '[diag][cascade:regen:cleanup:result] Check server logs for details',
    });
  } catch (e) {
    const err = e instanceof Error ? e.message : String(e);
    console.error('[api/cascade/cleanup] fatal error:', err);
    return NextResponse.json(
      { error: 'internal_error', detail: err },
      { status: 500 }
    );
  }
}
