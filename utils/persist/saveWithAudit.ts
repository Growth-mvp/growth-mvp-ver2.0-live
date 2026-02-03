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
 * 監査ログ付きの保存ラッパー関数
 *
 * 既存の saveStrategyData() を呼び出しながら、
 * 保存前後のログを記録して観測性を向上させる。
 * DB保存自体は既存の saveStrategyData に委譲。
 *
 * 監査ログは [audit][save] として以下を記録：
 * - effectiveCompanyId: 実際に保存対象の企業ID
 * - strategyId: 保存対象の strategy_id
 * - revision (before/after): リビジョン遷移
 * - payloadSize: JSON文字列長
 * - caller: 呼び出し元の識別子（e.g., "stage2:handleGenerate"）
 * - result: 'success' | 'fail'、失敗時はエラー内容
 *
 * @param payload - 保存するStrategyDataオブジェクト
 * @param userId - ユーザーID（省略時は自動取得される）
 * @param companyIdOverride - 企業IDオーバーライド
 * @param revision - リビジョン番号
 * @param opts - オプション（mode: 'upsert' | 'updateOnly'）
 * @param caller - 呼び出し元の識別子（e.g., "store:saveStrategyData", "stage2:save", "autoSave:tick"）
 * @returns 保存結果（data と error）
 */
export async function saveWithAudit(
  payload: StrategyData,
  userId?: string,
  companyIdOverride?: string | null,
  revision?: number,
  opts?: { mode?: 'upsert' | 'updateOnly' },
  caller?: string,
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

  console.log(`[audit][save:start] caller=${callerLabel}`, {
    userId,
    effectiveCompanyId: companyIdOverride ?? payload?.company_id,
    strategyId: payload?.id,
    revisionBefore,
    payloadSize,
    mode: opts?.mode ?? 'upsert',
    timestamp: new Date().toISOString(),
  });

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

    if (result.error) {
      console.warn(
        `[audit][save:fail] caller=${callerLabel} duration=${duration}ms`,
        {
          effectiveCompanyId: companyIdOverride ?? payload?.company_id,
          strategyId: payload?.id,
          revisionBefore,
          error: result.error,
        },
      );
    } else {
      console.log(
        `[audit][save:done] caller=${callerLabel} duration=${duration}ms`,
        {
          effectiveCompanyId: companyIdOverride ?? payload?.company_id,
          strategyId: result.data?.id,
          revisionBefore,
          revisionAfter,
          result: 'success',
        },
      );
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
