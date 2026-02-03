import { useStrategyStore } from '@/store/strategyStore';
import {
  loadStage1SnapshotFromLocalStorage,
  loadStage2SnapshotFromLocalStorage,
  clearStage2Snapshot,
} from '@/utils/stageSnapshot';
import { getFullStrategyDataByCompany } from '@/utils/supabase/strategy';
import type { StrategyData } from '@/types/strategy';

/**
 * 復元決定の詳細情報
 */
export type RestoreDecision = {
  sourceUsed: 'db' | 'store' | 'snapshot' | 'none';
  reason: string;
  strategyId?: string;
  revision?: number;
  didHydrateStore: boolean;
  didClearSnapshot: boolean;
  snapshotData?: any;
  dbData?: any;
};

/**
 * 復元監査ログの統一インターフェース
 *
 * 責務：
 * - 「DB → store → snapshot」の復元優先順位を統一
 * - 採用ソースと理由を必ずログ出しする
 * - companyId 未確定時は snapshot 判定/clear をしない（STAGE2 パターンを全体化）
 * - snapshot.companyId !== effectiveCompanyId なら snapshot を clear（ただし理由ログ必須）
 * - DB に確定データがある場合は原則 snapshot 不使用
 * - 復元後、store の revision/strategyId が DB と一致するように同期
 *
 * 監査ログ：
 * - [audit][restore:start] { stage, effectiveCompanyId, ... }
 * - [audit][restore:decision] { sourceUsed, reason }
 * - [audit][restore:done] { strategyId, revision, didClearSnapshot }
 * - [audit][restore:fail] { error }
 */
export async function restoreWithAudit(
  stage: 'stage1' | 'stage2' | 'cascade' | 'execution' | 'stage6',
  effectiveCompanyId: string | null | undefined,
  options?: { allowSnapshot?: boolean },
): Promise<RestoreDecision> {
  const startTime = Date.now();
  const allowSnapshot = options?.allowSnapshot !== false;

  console.log(
    `[audit][restore:start] stage=${stage} effectiveCompanyId=${effectiveCompanyId}`,
    {
      timestamp: new Date().toISOString(),
      allowSnapshot,
    },
  );

  try {
    // ★ Check 1: companyId が未確定 → snapshot 判定と clear をしない
    if (!effectiveCompanyId) {
      console.log(
        `[audit][restore:decision] sourceUsed=none reason="companyId_not_ready"`,
      );
      return {
        sourceUsed: 'none',
        reason: 'companyId_not_ready',
        didHydrateStore: false,
        didClearSnapshot: false,
      };
    }

    const store = useStrategyStore.getState();
    let snapshotData: any = null;
    let dbData: any = null;

    // ★ Snapshot ロード試行（存在確認のみ）
    if (allowSnapshot && stage === 'stage2') {
      snapshotData = loadStage2SnapshotFromLocalStorage();
      // stage1, cascade, execution, stage6 は後で追加可能
    }

    // ★ Check 2: snapshot.companyId !== effectiveCompanyId → clear＆skip
    if (snapshotData && snapshotData.companyId && snapshotData.companyId !== effectiveCompanyId) {
      console.warn(
        `[audit][restore:decision] sourceUsed=none reason="snapshot_company_mismatch" snapshotCompanyId=${snapshotData.companyId} effectiveCompanyId=${effectiveCompanyId}`,
      );
      if (stage === 'stage2') {
        clearStage2Snapshot();
        console.log(`[audit][restore:decision] didClearSnapshot=true reason="mismatch"`);
      }
      return {
        sourceUsed: 'none',
        reason: 'snapshot_company_mismatch',
        didHydrateStore: false,
        didClearSnapshot: true,
        snapshotData,
      };
    }

    // ★ DB から最新データを取得
    const { data: dbDataResult, error: dbError } = await getFullStrategyDataByCompany(
      effectiveCompanyId,
    );

    if (dbError) {
      console.warn(
        `[audit][restore:decision] sourceUsed=snapshot reason="db_error" error="${dbError?.message || 'unknown'}"`,
      );
      if (snapshotData && stage === 'stage2') {
        return {
          sourceUsed: 'snapshot',
          reason: 'db_error_fallback_to_snapshot',
          strategyId: snapshotData.state?.id,
          revision: undefined,
          didHydrateStore: false,
          didClearSnapshot: false,
          snapshotData,
        };
      }
      return {
        sourceUsed: 'store',
        reason: 'db_error_use_store',
        strategyId: store.id,
        revision: store.revision,
        didHydrateStore: false,
        didClearSnapshot: false,
      };
    }

    dbData = dbDataResult;

    // ★ Check 3: DB に確定データがある → DB 優先、snapshot 不使用
    const hasDataInDB = !!dbData && typeof dbData === 'object';
    const hasMVVInDB =
      hasDataInDB && (dbData.thought || dbData.mission || dbData.vision || dbData.value);
    const hasMVVInStore = !!(
      store.thought ||
      store.mission ||
      store.vision ||
      store.value
    );

    if (hasMVVInDB) {
      console.log(
        `[audit][restore:decision] sourceUsed=db reason="db_has_mvv" dbRevision=${dbData.revision} strategyId=${dbData.id}`,
      );
      return {
        sourceUsed: 'db',
        reason: 'db_has_mvv',
        strategyId: dbData.id,
        revision: dbData.revision,
        didHydrateStore: false, // DB から hydrate する処理は呼び出し側で行う
        didClearSnapshot: false,
        dbData,
      };
    }

    // ★ DB にデータがないが store に data がある → store 優先
    if (hasMVVInStore) {
      console.log(
        `[audit][restore:decision] sourceUsed=store reason="store_has_mvv" strategyId=${store.id} revision=${store.revision}`,
      );
      return {
        sourceUsed: 'store',
        reason: 'store_has_mvv',
        strategyId: store.id,
        revision: store.revision,
        didHydrateStore: false,
        didClearSnapshot: false,
      };
    }

    // ★ DB にも store にもデータがない → snapshot を使用（companyId checked OK）
    if (snapshotData && stage === 'stage2') {
      console.log(
        `[audit][restore:decision] sourceUsed=snapshot reason="db_and_store_empty_fallback"`,
      );
      return {
        sourceUsed: 'snapshot',
        reason: 'db_and_store_empty_fallback',
        strategyId: snapshotData.state?.id,
        revision: undefined,
        didHydrateStore: true, // snapshot から store を hydrate する
        didClearSnapshot: false,
        snapshotData,
      };
    }

    // ★ すべてが空 → none
    console.log(`[audit][restore:decision] sourceUsed=none reason="all_empty"`);
    return {
      sourceUsed: 'none',
      reason: 'all_empty',
      didHydrateStore: false,
      didClearSnapshot: false,
    };
  } catch (err) {
    const duration = Date.now() - startTime;
    const errorMsg = err instanceof Error ? err.message : String(err);
    console.error(
      `[audit][restore:fail] stage=${stage} duration=${duration}ms error="${errorMsg}"`,
      {
        error: err,
      },
    );
    return {
      sourceUsed: 'none',
      reason: `exception: ${errorMsg}`,
      didHydrateStore: false,
      didClearSnapshot: false,
    };
  }
}
