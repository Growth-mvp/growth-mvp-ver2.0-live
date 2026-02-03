import { saveStrategyData } from '@/utils/supabase/strategy';
import type { StrategyData } from '@/types/strategy';

/**
 * 保存操作の結果型
 */
export type WriteResult = {
  data?: (StrategyData & { revision?: number }) | null;
  error: any | null;
};

/**
 * Multi-table 保存結果（TASK 5-4）
 */
export type SubSaveResult = {
  name: string; // 'story_answers2', 'final_stories', 'progress_logs' など
  ok: boolean;
  error?: any;
};

/**
 * 監査ログ付きの保存ラッパー関数（TASK 5 強化版）
 *
 * 既存の saveStrategyData() を呼び出しながら、
 * 保存前後のログを記録して観測性を向上させる。
 * DB保存自体は既存の saveStrategyData に委譲。
 *
 * 監査ログは [audit][save] として以下を記録：
 * - decisionId（optional）: restore との関連付け用
 * - effectiveCompanyId: 実際に保存対象の企業ID
 * - strategyId: 保存対象の strategy_id
 * - revision (before/after): リビジョン遷移
 * - payloadSize: JSON文字列長
 * - caller: 呼び出し元の識別子（e.g., "stage2:handleGenerate"）
 * - trigger: 保存のトリガー（manual/autosave/generate等）
 * - subSaves: multi-table 保存結果（TASK 5-4）
 * - result: 'success' | 'fail'、失敗時はエラー内容
 *
 * @param payload - 保存するStrategyDataオブジェクト
 * @param userId - ユーザーID（省略時は自動取得される）
 * @param companyIdOverride - 企業IDオーバーライド
 * @param revision - リビジョン番号
 * @param opts - オプション（mode: 'upsert' | 'updateOnly'）
 * @param caller - 呼び出し元の識別子（e.g., "store:saveStrategyData", "stage2:save", "autoSave:tick"）
 * @param restoreDecisionId - (optional) restore decision との関連付け（TASK 5-3）
 * @param trigger - (optional) 保存トリガー（manual/autosave/generate等）
 * @param subSaves - (optional) multi-table 保存結果（TASK 5-4）
 * @returns 保存結果（data と error）
 */
export async function saveWithAudit(
  payload: StrategyData,
  userId?: string,
  companyIdOverride?: string | null,
  revision?: number,
  opts?: { mode?: 'upsert' | 'updateOnly' },
  caller?: string,
  restoreDecisionId?: string,
  trigger?: string,
  subSaves?: SubSaveResult[],
): Promise<WriteResult> {
  const startTime = Date.now();
  const callerLabel = caller ?? 'unknown';
  let payloadSize = 0;

  try {
    payloadSize = JSON.stringify(payload).length;
  } catch {
    payloadSize = -1; // stringify失敗
  }

  // revision(before)
  const revisionBefore = revision ?? payload?.revision;

  // ★ 含有チェックログ（DEV限定）
  const hasFounderMind = typeof (payload as any)?.ceoIntent === 'string' && (payload as any).ceoIntent.trim() !== '';
  const hasDraftStory = Array.isArray((payload as any)?.storyDraft) && (payload as any).storyDraft.length > 0;

  if (process.env.NEXT_PUBLIC_DEBUG_HYDRATE === '1') {
    console.log('[audit][save:payload_diagnosis] hasFounderMind/hasDraftStory', {
      hasFounderMind,
      hasDraftStory,
      ceoIntent_len: typeof (payload as any)?.ceoIntent === 'string' ? (payload as any).ceoIntent.length : 0,
      storyDraft_len: Array.isArray((payload as any)?.storyDraft) ? (payload as any).storyDraft.length : 0,
    });
  }

  console.log(
    `[audit][save:start] caller=${callerLabel}${restoreDecisionId ? ` relatedRestoreDecisionId=${restoreDecisionId}` : ''}`,
    {
      userId,
      effectiveCompanyId: companyIdOverride ?? payload?.company_id,
      strategyId: payload?.id,
      revisionBefore,
      payloadSize,
      mode: opts?.mode ?? 'upsert',
      trigger: trigger ?? 'unknown',
      hasFounderMind,
      hasDraftStory,
      timestamp: new Date().toISOString(),
    },
  );

  try {
    const result = await saveStrategyData(
      payload,
      userId,
      companyIdOverride,
      revision,
      opts,
    );

    const duration = Date.now() - startTime;
    const revisionAfter = result.data?.revision;

    // ★ TASK 5-3: ガード：revision 不一致を検出
    if (revisionAfter && revisionBefore && revisionAfter < revisionBefore) {
      console.error(
        `[audit][save:warning] caller=${callerLabel} REVISION_ROLLBACK_DETECTED!`,
        {
          revisionBefore,
          revisionAfter,
          effectiveCompanyId: companyIdOverride ?? payload?.company_id,
          strategyId: result.data?.id,
        },
      );
    }

    if (result.error) {
      console.warn(
        `[audit][save:fail] caller=${callerLabel} duration=${duration}ms${subSaves?.length ? ` subSaves=${subSaves.length}` : ''}`,
        {
          effectiveCompanyId: companyIdOverride ?? payload?.company_id,
          strategyId: payload?.id,
          revisionBefore,
          error: result.error,
          subSaveResults: subSaves?.map((s) => ({ name: s.name, ok: s.ok })),
        },
      );
    } else {
      // ★ TASK 5-4: subSaves 結果を記録
      const subSaveFailures = subSaves?.filter((s) => !s.ok) ?? [];
      if (subSaveFailures.length > 0) {
        console.warn(
          `[audit][save:done:partial] caller=${callerLabel} duration=${duration}ms subSaveFailed=${subSaveFailures.length}`,
          {
            effectiveCompanyId: companyIdOverride ?? payload?.company_id,
            strategyId: result.data?.id,
            revisionBefore,
            revisionAfter,
            result: 'success_with_partial_failure',
            failedSubSaves: subSaveFailures.map((s) => ({ name: s.name, error: s.error })),
          },
        );
      } else {
        console.log(
          `[audit][save:done] caller=${callerLabel} duration=${duration}ms${subSaves?.length ? ` subSaves=${subSaves.length}` : ''}`,
          {
            effectiveCompanyId: companyIdOverride ?? payload?.company_id,
            strategyId: result.data?.id,
            revisionBefore,
            revisionAfter,
            result: 'success',
            subSaveResults: subSaves?.map((s) => ({ name: s.name, ok: s.ok })),
          },
        );
      }
    }

    return result;
  } catch (err) {
    const duration = Date.now() - startTime;
    const errorMsg =
      err instanceof Error ? err.message : String(err);
    console.error(
      `[audit][save:exception] caller=${callerLabel} duration=${duration}ms error="${errorMsg}"`,
      {
        effectiveCompanyId: companyIdOverride ?? payload?.company_id,
        strategyId: payload?.id,
        revisionBefore,
        error: err,
      },
    );
    return {
      data: null,
      error:
        err instanceof Error
          ? { message: err.message, stack: err.stack }
          : String(err),
    };
  }
}
