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
 * @param payload - 保存するStrategyDataオブジェクト
 * @param userId - ユーザーID（省略時は自動取得される）
 * @param companyIdOverride - 企業IDオーバーライド
 * @param revision - リビジョン番号
 * @param opts - オプション（mode: 'upsert' | 'updateOnly'）
 * @returns 保存結果（data と error）
 */
export async function saveWithAudit(
  payload: StrategyData,
  userId?: string,
  companyIdOverride?: string | null,
  revision?: number,
  opts?: { mode?: 'upsert' | 'updateOnly' },
): Promise<WriteResult> {
  const startTime = Date.now();

  console.log('[saveWithAudit] 💾 Save operation started', {
    userId,
    companyId: companyIdOverride,
    revision,
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

    if (result.error) {
      console.warn('[saveWithAudit] ⚠️ Save operation failed', {
        duration,
        error: result.error,
      });
    } else {
      console.log('[saveWithAudit] ✅ Save operation completed', {
        duration,
        hasData: !!result.data,
        revision: result.data?.revision,
      });
    }

    return result;
  } catch (err) {
    const duration = Date.now() - startTime;
    console.error('[saveWithAudit] ❌ Save operation threw exception', {
      duration,
      error: err,
    });
    return {
      data: null,
      error:
        err instanceof Error
          ? { message: err.message, stack: err.stack }
          : String(err),
    };
  }
}
