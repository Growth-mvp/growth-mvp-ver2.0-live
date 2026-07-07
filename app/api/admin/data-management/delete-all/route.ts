import 'server-only';
import { NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabaseAdmin';
import { getAuthUserIdFromBearer } from '@/lib/server/rbacGuard';

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
    const updatePayload: any = {
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
        details: (updateError as any).details,
        hint: (updateError as any).hint,
        status: (updateError as any).status,
        columns: updateColumns,
      });

      return NextResponse.json(
        {
          error: 'Failed to update strategy_data',
          detail: {
            message: updateError.message,
            code: updateError.code,
            details: (updateError as any).details,
            hint: (updateError as any).hint,
            status: (updateError as any).status,
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

    return NextResponse.json(
      {
        ok: true,
        operationId,
        companyId,
        updatedCount: updatedRows?.length ?? 0,
        message: 'All data deleted successfully',
        beforeState,
        updateState,
        afterState: {
          final_story: immediateVerification.strategy_data.final_story_length,
          story_draft: immediateVerification.strategy_data.story_draft_length,
          final_story_draft: immediateVerification.strategy_data.final_story_draft_length,
          final_story_final: immediateVerification.strategy_data.final_story_final_length,
          stage3_strategy_bridge: immediateVerification.strategy_data.stage3_strategy_bridge_exists,
          departments: immediateVerification.strategy_data.departments_length,
        },
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
