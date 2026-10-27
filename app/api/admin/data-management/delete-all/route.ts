import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import { NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabaseAdmin';
import { getAuthUserIdFromBearer } from '@/lib/server/rbacGuard';
import { isValidUUID } from '@/lib/utils/isValidUUID';
import { requireAdminMfa } from '@/lib/server/mfaGuard';
import { logAuditEvent, extractAuditMetadata } from '@/lib/server/auditLog';

// メールアドレスをマスキングする（ログ出力用）
// eslint-disable-next-line @typescript-eslint/no-unused-vars
function maskEmail(email: string): string {
  if (!email || email.length < 3) return '***';
  const [local, domain] = email.split('@');
  if (!local || !domain) return '***';
  const maskedLocal = local.charAt(0) + '*'.repeat(Math.max(1, local.length - 2)) + local.charAt(local.length - 1);
  return `${maskedLocal}@${domain}`;
}

type DeleteAllAuditPhase = 'started' | 'success' | 'failure';
type AuditMeta = { ip: string | null; userAgent: string | null };
type AuditCtx = { companyId: string; actorUserId: string; beforeState: unknown; auditMeta: AuditMeta };

/**
 * 全データ削除の監査（audit_logs）。件数と結果のみを記録し、本文は記録しない。
 * logAuditEvent は失敗を false で返すため、呼び出し側は戻り値で必ず判断する。
 */
async function recordDeleteAllAudit(params: {
  companyId: string;
  actorUserId: string;
  phase: DeleteAllAuditPhase;
  metadata: Record<string, unknown>;
  auditMeta: AuditMeta;
}): Promise<boolean> {
  return logAuditEvent({
    companyId: params.companyId,
    actorUserId: params.actorUserId,
    action: 'data:delete-all',
    targetType: 'company',
    targetId: params.companyId,
    metadata: { phase: params.phase, ...params.metadata },
    ip: params.auditMeta.ip,
    userAgent: params.auditMeta.userAgent,
  });
}

const MISSING_TABLE_CODES = new Set(['42P01', 'PGRST205']);

function isMissingTableError(error: { code?: string } | null): boolean {
  return !!error?.code && MISSING_TABLE_CODES.has(error.code);
}

/**
 * 会社の経営計画書を削除する。
 * 会社移動で参照対象外になった旧計画書も含めるため、company_id のみで対象を限定する
 * （計画書の company_id は作成時の会社のまま残り、他社の計画書とは混ざらない）。
 * テーブルが存在しない環境のみスキップし、それ以外の失敗は必ず失敗として返す。
 */
async function deleteCompanyPlans(
  admin: SupabaseClient,
  companyId: string
): Promise<{ ok: boolean; deletedCount: number; skipped?: 'table_missing'; error?: string; code?: string }> {
  const deleted = await admin
    .from('generated_plans')
    .delete({ count: 'exact' })
    .eq('company_id', companyId);

  if (deleted.error) {
    if (isMissingTableError(deleted.error)) {
      return { ok: true, deletedCount: 0, skipped: 'table_missing' };
    }
    return { ok: false, deletedCount: 0, error: deleted.error.message, code: deleted.error.code };
  }

  const remaining = await admin
    .from('generated_plans')
    .select('id', { count: 'exact', head: true })
    .eq('company_id', companyId);

  if (remaining.error) {
    return { ok: false, deletedCount: deleted.count ?? 0, error: remaining.error.message, code: remaining.error.code };
  }
  if ((remaining.count ?? 0) > 0) {
    return { ok: false, deletedCount: deleted.count ?? 0, error: 'generated_plans rows remain after deletion' };
  }
  return { ok: true, deletedCount: deleted.count ?? 0 };
}

export async function POST(req: Request) {
  let auditCtx: AuditCtx | null = null;
  let mutationStarted = false;
  try {
    const admin = getSupabaseAdmin();

    // 1) Bearer トークンから userId を取得
    const mfa = await requireAdminMfa(admin, req);
    if (!mfa.ok) return NextResponse.json({ error: mfa.error }, { status: mfa.status });
    const authUserId = await getAuthUserIdFromBearer(admin, req);
    if (!authUserId) {
      console.error('[DELETE_ALL_API] Not authenticated');
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 401 }
      );
    }

    // 2) 対象会社 ID をリクエストから取得する（利用者が確認した会社を明示的に指定させる）
    const body: unknown = await req.json().catch(() => null);
    const requestedCompanyId = (body as { companyId?: unknown } | null)?.companyId;
    if (typeof requestedCompanyId !== 'string' || !isValidUUID(requestedCompanyId)) {
      return NextResponse.json(
        { error: 'companyId is required' },
        { status: 400 }
      );
    }

    // 3) 指定会社への admin 所属を確認する（他社の会社 ID や member/manager による削除は拒否）
    const { data: membershipData, error: membershipError } = await admin
      .from('company_members')
      .select('company_id, role')
      .eq('user_id', authUserId)
      .eq('company_id', requestedCompanyId)
      .maybeSingle();

    if (membershipError || !membershipData || membershipData.role !== 'admin') {
      console.error('[DELETE_ALL_API] Not an admin of the requested company:', membershipError?.message);
      return NextResponse.json(
        { error: 'forbidden' },
        { status: 403 }
      );
    }

    const companyId = requestedCompanyId;

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

    const auditMeta = extractAuditMetadata(req);
    auditCtx = { companyId, actorUserId: authUserId, beforeState, auditMeta };
    const recordFailure = (reason: string, extra: Record<string, unknown> = {}) =>
      recordDeleteAllAudit({
        companyId,
        actorUserId: authUserId,
        phase: 'failure',
        metadata: { reason, beforeState, ...extra },
        auditMeta,
      });

    const started = await recordDeleteAllAudit({
      companyId,
      actorUserId: authUserId,
      phase: 'started',
      metadata: { beforeState },
      auditMeta,
    });
    if (!started) {
      console.error('[DELETE_ALL_API] start audit could not be recorded; deletion not started', { companyId });
      return NextResponse.json(
        {
          ok: false,
          error: 'audit_unavailable',
          message: '監査ログを記録できなかったため、削除を開始していません。',
          companyId,
        },
        { status: 503 }
      );
    }

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
    mutationStarted = true;
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
      const auditRecorded = await recordFailure('strategy_data update failed', { error: updateError.message });

      return NextResponse.json(
        {
          error: 'Failed to update strategy_data',
          auditRecorded,
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
      const auditRecorded = await recordFailure('strategy_data verification failed');
      return NextResponse.json(
        {
          ok: false,
          error: 'strategy_data verification failed',
          auditRecorded,
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
      const auditRecorded = await recordFailure('story_answers2 deletion failed', { separatedTableDeletions });
      return NextResponse.json(
        {
          ok: false,
          error: 'Failed to delete story_answers2',
          auditRecorded,
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
      const auditRecorded = await recordFailure('final_stories deletion failed', { separatedTableDeletions });
      return NextResponse.json(
        {
          ok: false,
          error: 'Failed to delete final_stories',
          auditRecorded,
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
      const auditRecorded = await recordFailure('progress_logs deletion failed', { separatedTableDeletions });
      return NextResponse.json(
        {
          ok: false,
          error: 'Failed to delete progress_logs',
          auditRecorded,
          operationId: `delete_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`,
          companyId,
          separatedTableDeletions,
          message: 'Data deletion failed at progress_logs deletion step.',
        },
        { status: 500 }
      );
    }

    // generated_plans 削除（分離テーブルと同じく、失敗時は成功応答を返さない）
    const planDeletion = await deleteCompanyPlans(admin, companyId);
    separatedTableDeletions.generated_plans = {
      deleted_count: planDeletion.deletedCount,
      skipped: planDeletion.skipped ?? null,
      error: planDeletion.ok ? null : { message: planDeletion.error, code: planDeletion.code },
    };

    if (!planDeletion.ok) {
      console.error('[DELETE_ALL_API] generated_plans deletion failed, aborting', { companyId, code: planDeletion.code });
      const auditRecorded = await recordFailure('generated_plans deletion failed', { error: planDeletion.error });
      return NextResponse.json(
        {
          ok: false,
          error: 'Failed to delete generated_plans',
          auditRecorded,
          operationId: `delete_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`,
          companyId,
          separatedTableDeletions,
          message: 'Data deletion failed at generated_plans deletion step. Saved plans may still exist; retry delete-all.',
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

    const successAudit = await recordDeleteAllAudit({
      companyId,
      actorUserId: authUserId,
      phase: 'success',
      metadata: {
        beforeState,
        afterState,
        deletedCount: updatedRows?.length ?? 0,
        separatedTableDeletions,
      },
      auditMeta,
    });
    if (!successAudit) {
      console.error('[DELETE_ALL_API] success audit could not be recorded after deletion', { companyId });
      return NextResponse.json(
        {
          ok: false,
          error: 'audit_record_failed_after_deletion',
          message: '削除は完了していますが、監査ログを記録できませんでした。運用担当へ連絡してください。',
          deletionCompleted: true,
          operationId,
          companyId,
          updatedCount: updatedRows?.length ?? 0,
          separatedTableDeletions,
        },
        { status: 500 }
      );
    }

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
    let auditRecorded: boolean | null = null;
    const ctx = auditCtx as AuditCtx | null;
    if (ctx && mutationStarted) {
      auditRecorded = await recordDeleteAllAudit({
        companyId: ctx.companyId,
        actorUserId: ctx.actorUserId,
        phase: 'failure',
        metadata: { reason: 'exception', beforeState: ctx.beforeState },
        auditMeta: ctx.auditMeta,
      });
    }
    return NextResponse.json(
      {
        error: 'Internal server error',
        details: error instanceof Error ? error.message : String(error),
        deletionMayBeIncomplete: mutationStarted,
        auditRecorded,
      },
      { status: 500 }
    );
  }
}
