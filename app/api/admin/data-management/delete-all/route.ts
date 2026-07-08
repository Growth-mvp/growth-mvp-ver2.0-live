import 'server-only';
import { NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabaseAdmin';
import { getAuthUserIdFromBearer } from '@/lib/server/rbacGuard';

// メールアドレスをマスキングする（ログ出力用）
// eslint-disable-next-line @typescript-eslint/no-unused-vars
function maskEmail(email: string): string {
  if (!email || email.length < 3) return '***';
  const [local, domain] = email.split('@');
  if (!local || !domain) return '***';
  const maskedLocal = local.charAt(0) + '*'.repeat(Math.max(1, local.length - 2)) + local.charAt(local.length - 1);
  return `${maskedLocal}@${domain}`;
}

/**
 * audit_log テーブルに記録
 * - companyId, userId, 対象件数, 実行理由, 結果を記録
 * - 機密本文（メール・本文・戦略本文等）はログに出さない
 */
async function recordAuditLog(
  admin: Record<string, any>,
  companyId: string,
  userId: string,
  action: string,
  details: {
    beforeState?: Record<string, any>;
    afterState?: Record<string, any>;
    deletedCount?: number;
    status: 'success' | 'failure';
    reason?: string;
    error?: string;
  }
) {
  try {
    // 機密情報をマスキング・除外
    const safeDetails: Record<string, any> = {
      status: details.status,
      deletedCount: details.deletedCount ?? 0,
      reason: details.reason,
      error: details.error ? 'Error occurred (details masked)' : undefined,
    };

    // beforeState/afterState から機密項目を除外
    if (details.beforeState) {
      safeDetails.beforeState = {
        final_story_count: details.beforeState.final_story,
        story_draft_count: details.beforeState.story_draft,
        final_story_draft_count: details.beforeState.final_story_draft,
        final_story_final_count: details.beforeState.final_story_final,
        stage3_strategy_bridge_exists: details.beforeState.stage3_strategy_bridge,
        departments_count: details.beforeState.departments,
      };
    }

    if (details.afterState) {
      safeDetails.afterState = {
        final_story_count: details.afterState.final_story,
        story_draft_count: details.afterState.story_draft,
        final_story_draft_count: details.afterState.final_story_draft,
        final_story_final_count: details.afterState.final_story_final,
        stage3_strategy_bridge_exists: details.afterState.stage3_strategy_bridge,
        departments_count: details.afterState.departments,
      };
    }

    // audit_log テーブルに記録（テーブルが存在する場合）
    try {
      await admin
        .from('audit_log')
        .insert({
          company_id: companyId,
          user_id: userId,
          action,
          details: safeDetails,
          created_at: new Date().toISOString(),
        });
    } catch (auditErr) {
      // audit_log テーブルが無い場合は、ここでは掛けずにサーバーログに委譲
      console.warn('[DELETE_ALL_API] audit_log table not available or insert failed (ignored)', auditErr);
    }
  } catch (e) {
    console.warn('[DELETE_ALL_API] recordAuditLog failed (ignored):', e);
  }
}

export async function POST(req: Request) {
  try {
    const admin = getSupabaseAdmin();

    // 1) Bearer トークンから userId を取得
    const authUserId = await getAuthUserIdFromBearer(admin, req);
    if (!authUserId) {
      console.error('[DELETE_ALL_API] Not authenticated');
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 401 }
      );
    }

    // 2) userId から company_members を取得（admin/owner のみ）
    const { data: membershipData, error: membershipError } = await admin
      .from('company_members')
      .select('company_id, role')
      .eq('user_id', authUserId)
      .eq('role', 'admin')
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (membershipError || !membershipData) {
      console.error('[DELETE_ALL_API] Membership not found or error:', membershipError?.message);
      return NextResponse.json(
        { error: 'No membership found' },
        { status: 403 }
      );
    }

    const companyId = membershipData.company_id;

    // ★ 修正：削除前の詳細状態確認（execution_plan_baseline, stage4_plans, final_story_edited は strategy_data に存在しないため除外）
    const beforeCheck = await admin
      .from('strategy_data')
      .select('id, company_id, final_story, story_draft, final_story_draft, final_story_final, stage3_strategy_bridge, answers2, answers12, departments')
      .eq('company_id', companyId);

    const beforeData = beforeCheck.data?.[0];

    // ★ 修正：削除前の状態スナップショット
    const beforeState = {
      final_story: Array.isArray(beforeData?.final_story) ? beforeData.final_story.length : (beforeData?.final_story ? 'non-array' : 'null'),
      story_draft: Array.isArray(beforeData?.story_draft) ? beforeData.story_draft.length : (beforeData?.story_draft ? 'non-array' : 'null'),
      final_story_draft: Array.isArray(beforeData?.final_story_draft) ? beforeData.final_story_draft.length : (beforeData?.final_story_draft ? 'non-array' : 'null'),
      final_story_final: Array.isArray(beforeData?.final_story_final) ? beforeData.final_story_final.length : (beforeData?.final_story_final ? 'non-array' : 'null'),
      stage3_strategy_bridge: beforeData?.stage3_strategy_bridge ? 'not-null' : 'null',
      answers2: Array.isArray(beforeData?.answers2) ? beforeData.answers2.length : (beforeData?.answers2 ? 'non-array' : 'null'),
      answers12: Array.isArray(beforeData?.answers12) ? beforeData.answers12.length : (beforeData?.answers12 ? 'non-array' : 'null'),
      departments: Array.isArray(beforeData?.departments) ? beforeData.departments.length : (beforeData?.departments ? 'non-array' : 'null'),
    };

    // ★ 修正：削除対象カラム名（execution_plan_baseline, stage4_plans, final_story_edited は strategy_data に存在しないため除外）
    const updateColumns = [
      'story_draft', 'final_story', 'final_story_draft', 'final_story_final',
      'answers2', 'answers12', 'swot_suggestions', 'win_patterns_candidate', 'stage3_strategy_bridge',
      'editable_cascade_result', 'departments', 'company_targets', 'project_target_impacts',
      'project_issue_links', 'okr_target_scores', 'updated_at'
    ];

    // strategy_data の STAGE2+ カラムを初期化
    const updatePayload: Record<string, any> = {
      story_draft: [],
      final_story: [],
      final_story_draft: [],
      final_story_final: [],
      answers2: [],
      answers12: [],
      swot_suggestions: null,
      win_patterns_candidate: [],
      stage3_strategy_bridge: null,
      editable_cascade_result: [],
      departments: [],
      company_targets: [],
      project_target_impacts: [],
      project_issue_links: [],
      okr_target_scores: {},
      updated_at: new Date().toISOString(),
    };

    // ★ 修正：update 後に select() を付けて更新結果を確認（execution_plan_baseline, stage4_plans, final_story_edited 除外）
    const { data: updatedRows, error: updateError } = await admin
      .from('strategy_data')
      .update(updatePayload)
      .eq('company_id', companyId)
      .select('id, company_id, final_story, story_draft, final_story_draft, final_story_final, stage3_strategy_bridge, answers2, answers12, departments');

    if (updateError) {
      // ★ 修正：エラー詳細情報をすべてログ出力
      console.error('[DELETE_ALL_API] Update error details:', {
        message: updateError.message,
        code: updateError.code,
        details: (updateError as Record<string, any>).details,
        hint: (updateError as Record<string, any>).hint,
        status: (updateError as Record<string, any>).status,
        columns: updateColumns,
      });

      // ★ 修正：失敗時もaudit logに記録
      await recordAuditLog(admin, companyId, authUserId, 'data:delete-all', {
        beforeState,
        status: 'failure',
        error: updateError.message,
      });

      return NextResponse.json(
        {
          error: 'Failed to update strategy_data',
          detail: {
            message: updateError.message,
            code: updateError.code,
            details: (updateError as Record<string, any>).details,
            hint: (updateError as Record<string, any>).hint,
            status: (updateError as Record<string, any>).status,
          },
          operationId: `delete_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`,
        },
        { status: 500 }
      );
    }

    // ★ 修正：update 結果をログ（execution_plan_baseline, stage4_plans, final_story_edited 除外）
    const updateData = updatedRows?.[0];
    const updateState = {
      final_story: Array.isArray(updateData?.final_story) ? updateData.final_story.length : (updateData?.final_story ? 'non-array' : 'null'),
      story_draft: Array.isArray(updateData?.story_draft) ? updateData.story_draft.length : (updateData?.story_draft ? 'non-array' : 'null'),
      final_story_draft: Array.isArray(updateData?.final_story_draft) ? updateData.final_story_draft.length : (updateData?.final_story_draft ? 'non-array' : 'null'),
      final_story_final: Array.isArray(updateData?.final_story_final) ? updateData.final_story_final.length : (updateData?.final_story_final ? 'non-array' : 'null'),
      stage3_strategy_bridge: updateData?.stage3_strategy_bridge ? 'not-null' : 'null',
      answers2: Array.isArray(updateData?.answers2) ? updateData.answers2.length : (updateData?.answers2 ? 'non-array' : 'null'),
      answers12: Array.isArray(updateData?.answers12) ? updateData.answers12.length : (updateData?.answers12 ? 'non-array' : 'null'),
      departments: Array.isArray(updateData?.departments) ? updateData.departments.length : (updateData?.departments ? 'non-array' : 'null'),
    };

    console.log('[deleteAll] update result', { companyId, ...updateState });

    // ★ 削除後の即座検証（immediate verification）
    const verifyData = async (label: string) => {
      const strategyCheck = await admin
        .from('strategy_data')
        .select('*')
        .eq('company_id', companyId)
        .maybeSingle();

      const finalStoriesCount = await admin
        .from('final_stories')
        .select('id', { count: 'exact', head: true })
        .eq('company_id', companyId);

      const storyAnswers2Count = await admin
        .from('story_answers2')
        .select('id', { count: 'exact', head: true })
        .eq('company_id', companyId);

      const storyVersionsCount = await admin
        .from('story_versions')
        .select('id', { count: 'exact', head: true })
        .eq('company_id', companyId);

      const progressLogsCount = await admin
        .from('progress_logs')
        .select('id', { count: 'exact', head: true })
        .eq('company_id', companyId);

      const row = strategyCheck.data;
      return {
        timestamp: new Date().toISOString(),
        label,
        strategy_data: {
          exists: !!row,
          story_draft_length: Array.isArray(row?.story_draft) ? row.story_draft.length : (row?.story_draft ? 'non-array' : 'null'),
          final_story_length: Array.isArray(row?.final_story) ? row.final_story.length : (row?.final_story ? 'non-array' : 'null'),
          final_story_draft_length: Array.isArray(row?.final_story_draft) ? row.final_story_draft.length : (row?.final_story_draft ? 'non-array' : 'null'),
          final_story_edited_length: Array.isArray(row?.final_story_edited) ? row.final_story_edited.length : (row?.final_story_edited ? 'non-array' : 'null'),
          final_story_final_length: Array.isArray(row?.final_story_final) ? row.final_story_final.length : (row?.final_story_final ? 'non-array' : 'null'),
          answers2_length: Array.isArray(row?.answers2) ? row.answers2.length : (row?.answers2 ? 'non-array' : 'null'),
          answers12_length: Array.isArray(row?.answers12) ? row.answers12.length : (row?.answers12 ? 'non-array' : 'null'),
          swot_suggestions_exists: !!row?.swot_suggestions,
          win_patterns_candidate_length: Array.isArray(row?.win_patterns_candidate) ? row.win_patterns_candidate.length : (row?.win_patterns_candidate ? 'non-array' : 'null'),
          stage3_strategy_bridge_exists: !!row?.stage3_strategy_bridge,
          editable_cascade_result_length: Array.isArray(row?.editable_cascade_result) ? row.editable_cascade_result.length : (row?.editable_cascade_result ? 'non-array' : 'null'),
          departments_length: Array.isArray(row?.departments) ? row.departments.length : (row?.departments ? 'non-array' : 'null'),
        },
        separated_tables: {
          final_stories_count: finalStoriesCount.count ?? 0,
          story_answers2_count: storyAnswers2Count.count ?? 0,
          story_versions_count: storyVersionsCount.count ?? 0,
          progress_logs_count: progressLogsCount.count ?? 0,
        },
      };
    };

    // immediate verification
    const immediateVerification = await verifyData('immediate');

    // 1秒待機してから delayed verification
    await new Promise(r => setTimeout(r, 1000));
    const delayedVerification = await verifyData('delayed');

    // ★ 修正：before/after の verify 成功判定（execution_plan_baseline, stage4_plans, final_story_edited 除外）
    const isVerifySuccess =
      immediateVerification.strategy_data.final_story_length === 0 &&
      immediateVerification.strategy_data.story_draft_length === 0 &&
      immediateVerification.strategy_data.final_story_draft_length === 0 &&
      immediateVerification.strategy_data.final_story_final_length === 0 &&
      !immediateVerification.strategy_data.stage3_strategy_bridge_exists &&
      immediateVerification.strategy_data.departments_length === 0;

    // ★ 修正：strategy_data verify 成功後にのみ、分離テーブルを削除
    // verify 失敗時は分離テーブル削除を実行しない（データ損失防止）
    if (!isVerifySuccess) {
      console.error('[DELETE_ALL_API] strategy_data verify failed, aborting separated table deletion', { companyId });
      return NextResponse.json(
        {
          ok: false,
          error: 'strategy_data verification failed',
          operationId: `delete_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`,
          companyId,
          beforeState,
          updateState,
          afterState: immediateVerification.strategy_data,
          message: 'Data deletion failed at strategy_data verification step. Separated tables were not deleted.',
        },
        { status: 500 }
      );
    }

    // ★ 修正：strategy_data verify 成功後、分離テーブルを削除
    const separatedTableDeletions: any = {};

    // story_answers2 削除
    const delAns = await admin
      .from('story_answers2')
      .delete()
      .eq('company_id', companyId);
    separatedTableDeletions.story_answers2 = {
      deleted_count: delAns.count ?? 0,
      error: delAns.error ? { message: delAns.error.message, code: delAns.error.code } : null,
    };

    if (delAns.error) {
      console.error('[DELETE_ALL_API] story_answers2 deletion failed, aborting', delAns.error);
      return NextResponse.json(
        {
          ok: false,
          error: 'Failed to delete story_answers2',
          operationId: `delete_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`,
          companyId,
          separatedTableDeletions,
          message: 'Data deletion failed at story_answers2 deletion step.',
        },
        { status: 500 }
      );
    }

    // final_stories 削除
    const delFinal = await admin
      .from('final_stories')
      .delete()
      .eq('company_id', companyId);
    separatedTableDeletions.final_stories = {
      deleted_count: delFinal.count ?? 0,
      error: delFinal.error ? { message: delFinal.error.message, code: delFinal.error.code } : null,
    };

    if (delFinal.error) {
      console.error('[DELETE_ALL_API] final_stories deletion failed, aborting', delFinal.error);
      return NextResponse.json(
        {
          ok: false,
          error: 'Failed to delete final_stories',
          operationId: `delete_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`,
          companyId,
          separatedTableDeletions,
          message: 'Data deletion failed at final_stories deletion step.',
        },
        { status: 500 }
      );
    }

    // progress_logs 削除
    const delProg = await admin
      .from('progress_logs')
      .delete()
      .eq('company_id', companyId);
    separatedTableDeletions.progress_logs = {
      deleted_count: delProg.count ?? 0,
      error: delProg.error ? { message: delProg.error.message, code: delProg.error.code } : null,
    };

    if (delProg.error) {
      console.error('[DELETE_ALL_API] progress_logs deletion failed, aborting', delProg.error);
      return NextResponse.json(
        {
          ok: false,
          error: 'Failed to delete progress_logs',
          operationId: `delete_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`,
          companyId,
          separatedTableDeletions,
          message: 'Data deletion failed at progress_logs deletion step.',
        },
        { status: 500 }
      );
    }

    // operationId を生成してレスポンスに含める
    const operationId = `delete_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;

    // ★ 修正：成功時もaudit logに記録
    const afterState = {
      final_story: immediateVerification.strategy_data.final_story_length,
      story_draft: immediateVerification.strategy_data.story_draft_length,
      final_story_draft: immediateVerification.strategy_data.final_story_draft_length,
      final_story_final: immediateVerification.strategy_data.final_story_final_length,
      stage3_strategy_bridge: immediateVerification.strategy_data.stage3_strategy_bridge_exists,
      departments: immediateVerification.strategy_data.departments_length,
    };

    await recordAuditLog(admin, companyId, authUserId, 'data:delete-all', {
      beforeState,
      afterState,
      deletedCount: updatedRows?.length ?? 0,
      status: 'success',
    });

    return NextResponse.json(
      {
        ok: true,
        operationId,
        companyId,
        updatedCount: updatedRows?.length ?? 0,
        message: 'All data deleted successfully',
        beforeState,
        updateState,
        afterState,
        _note: 'execution_plan_baseline, stage4_plans, final_story_edited are frontend-only, not in strategy_data table',
        verifySuccess: isVerifySuccess,
        separatedTableDeletions,
        verification: {
          immediate: immediateVerification,
          delayed: delayedVerification,
        },
      },
      { status: 200 }
    );
  } catch (error) {
    console.error('[DELETE_ALL_API] Exception:', error);
    return NextResponse.json(
      { error: 'Internal server error', details: error instanceof Error ? error.message : String(error) },
      { status: 500 }
    );
  }
}
