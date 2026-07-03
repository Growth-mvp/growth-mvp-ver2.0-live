import 'server-only';
import { NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabaseAdmin';
import { getAuthUserIdFromBearer } from '@/lib/server/rbacGuard';

export async function POST(req: Request) {
  console.log('[DELETE_ALL_API] ===== START =====');

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

    console.log('[DELETE_ALL_API] authUserId:', authUserId);

    // 2) userId から company_members を取得（admin/owner のみ）
    const { data: membershipData, error: membershipError } = await admin
      .from('company_members')
      .select('company_id, role')
      .eq('user_id', authUserId)
      .eq('role', 'admin')
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    console.log('[DELETE_ALL_API] membership query result:', {
      found: !!membershipData,
      companyId: membershipData?.company_id,
      role: membershipData?.role,
    });

    if (membershipError || !membershipData) {
      console.error('[DELETE_ALL_API] Membership not found or error:', membershipError?.message);
      return NextResponse.json(
        { error: 'No membership found' },
        { status: 403 }
      );
    }

    const companyId = membershipData.company_id;
    console.log('[DELETE_ALL_API] Confirmed companyId from membership:', companyId);

    // ★ 修正：削除前の詳細状態確認（execution_plan_baseline, stage4_plans, final_story_edited は strategy_data に存在しないため除外）
    const beforeCheck = await admin
      .from('strategy_data')
      .select('id, company_id, final_story, story_draft, final_story_draft, final_story_final, stage3_strategy_bridge, answers2, answers12, departments')
      .eq('company_id', companyId);

    const beforeData = beforeCheck.data?.[0];
    const beforeState = {
      final_story: Array.isArray(beforeData?.final_story) ? beforeData.final_story.length : (beforeData?.final_story ? 'non-array' : 'null'),
      story_draft: Array.isArray(beforeData?.story_draft) ? beforeData.story_draft.length : (beforeData?.story_draft ? 'non-array' : 'null'),
      final_story_draft: Array.isArray(beforeData?.final_story_draft) ? beforeData.final_story_draft.length : (beforeData?.final_story_draft ? 'non-array' : 'null'),
      final_story_final: Array.isArray(beforeData?.final_story_final) ? beforeData.final_story_final.length : (beforeData?.final_story_final ? 'non-array' : 'null'),
      stage3_strategy_bridge: beforeData?.stage3_strategy_bridge ? Object.keys(beforeData.stage3_strategy_bridge).length : 'null',
      answers2: Array.isArray(beforeData?.answers2) ? beforeData.answers2.length : (beforeData?.answers2 ? 'non-array' : 'null'),
      answers12: Array.isArray(beforeData?.answers12) ? beforeData.answers12.length : (beforeData?.answers12 ? 'non-array' : 'null'),
      departments: Array.isArray(beforeData?.departments) ? beforeData.departments.length : (beforeData?.departments ? 'non-array' : 'null'),
    };

    console.log('[deleteAll] before', { companyId, ...beforeState });

    // 分離テーブルから削除
    console.log('[DELETE_ALL_API] Deleting from story_answers2...');
    const delAns = await admin
      .from('story_answers2')
      .delete()
      .eq('company_id', companyId);
    console.log('[DELETE_ALL_API] story_answers2 deleted:', { error: delAns.error?.code });

    console.log('[DELETE_ALL_API] Deleting from final_stories...');
    const delFinal = await admin
      .from('final_stories')
      .delete()
      .eq('company_id', companyId);
    console.log('[DELETE_ALL_API] final_stories deleted:', { error: delFinal.error?.code });

    console.log('[DELETE_ALL_API] Deleting from progress_logs...');
    const delProg = await admin
      .from('progress_logs')
      .delete()
      .eq('company_id', companyId);
    console.log('[DELETE_ALL_API] progress_logs deleted:', { error: delProg.error?.code });

    // ★ 修正：削除対象カラム名をログ（execution_plan_baseline, stage4_plans, final_story_edited は strategy_data に存在しないため除外）
    const updateColumns = [
      'story_draft', 'final_story', 'final_story_draft', 'final_story_final',
      'answers2', 'answers12', 'swot_suggestions', 'win_patterns_candidate', 'stage3_strategy_bridge',
      'editable_cascade_result', 'departments', 'company_targets', 'project_target_impacts',
      'project_issue_links', 'okr_target_scores', 'updated_at'
    ];
    console.log('[DELETE_ALL_API] Update payload columns:', { columns: updateColumns });

    // strategy_data の STAGE2+ カラムを初期化
    console.log('[DELETE_ALL_API] Updating strategy_data columns...');
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
    console.log('[DELETE_ALL_API] Immediate verification:', immediateVerification);

    // 1秒待機してから delayed verification
    await new Promise(r => setTimeout(r, 1000));
    const delayedVerification = await verifyData('delayed');
    console.log('[DELETE_ALL_API] Delayed verification (after 1000ms):', delayedVerification);

    console.log('[deleteAll] after', {
      companyId,
      final_story: immediateVerification.strategy_data.final_story_length,
      story_draft: immediateVerification.strategy_data.story_draft_length,
      final_story_draft: immediateVerification.strategy_data.final_story_draft_length,
      final_story_final: immediateVerification.strategy_data.final_story_final_length,
      stage3_strategy_bridge: immediateVerification.strategy_data.stage3_strategy_bridge_exists,
      departments: immediateVerification.strategy_data.departments_length,
    });

    // ★ 修正：before/after の verify 成功判定（execution_plan_baseline, stage4_plans, final_story_edited 除外）
    const isVerifySuccess =
      immediateVerification.strategy_data.final_story_length === 0 &&
      immediateVerification.strategy_data.story_draft_length === 0 &&
      immediateVerification.strategy_data.final_story_draft_length === 0 &&
      immediateVerification.strategy_data.final_story_final_length === 0 &&
      !immediateVerification.strategy_data.stage3_strategy_bridge_exists &&
      immediateVerification.strategy_data.departments_length === 0;

    console.log('[deleteAll] verify ' + (isVerifySuccess ? 'success' : 'failed'), {
      companyId,
      beforeState,
      updateState,
      afterState: immediateVerification.strategy_data,
    });

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
