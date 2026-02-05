import { useStrategyStore } from '@/store/strategyStore';
import {
  loadStage1SnapshotFromLocalStorage,
  loadStage2SnapshotFromLocalStorage,
  clearStage1Snapshot,
  clearStage2Snapshot,
} from '@/utils/stageSnapshot';
import { getFullStrategyDataByCompany } from '@/utils/supabase/strategy';
import { normalizeStrategyData } from '@/utils/supabase/normalize';  // ★ TASK 11-2
import type { StrategyData } from '@/types/strategy';

/**
 * 復元決定の詳細情報
 *
 * ★ TASK 5-1: decisionId を導入し、決定の一意性を保証
 * - decisionId: 復元決定の unique identifier（UUID）
 * - sourceUsed: decision と done で一致（絶対に上書きしない）
 * - decision が確定した後、それ以上評価を変えない
 */
export type RestoreDecision = {
  decisionId: string; // UUID: start/decision/done で統一
  sourceUsed: 'db' | 'store' | 'snapshot' | 'none';
  reason: string;
  strategyId?: string | null;
  revision?: number;
  didHydrateStore: boolean;
  didClearSnapshot: boolean;
  snapshotData?: any;
  dbData?: any;
  // ★ TASK 11-2: caller が hydrate できるよう hydratedState を返す
  hydratedState?: any; // 通常化済みの StrategyData（DB採用時）
  // 診断用（ログに出す）
  hasDbData?: boolean;
  hasStoreData?: boolean;
  hasSnapshot?: boolean;
  snapshotCompanyId?: string;
  effectiveCompanyId?: string | null;
};

/**
 * 復元監査ログの統一インターフェース（TASK 5 強化版）
 *
 * 責務：
 * - 「DB → store → snapshot」の復元優先順位を統一
 * - decision を1回だけ行い、sourceUsed を上書きしない（decisionId で追跡）
 * -採用ソースと理由を必ずログ出しする
 * - companyId 未確定時は snapshot 判定/clear をしない（STAGE2 パターンを全体化）
 * - snapshot.companyId !== effectiveCompanyId なら snapshot を clear（ただし理由ログ必須）
 * - DB に確定データがある場合は原則 snapshot 不使用
 * - 復元後、store の revision/strategyId が DB と一致するように同期
 *
 * 監査ログ（TASK 5）：
 * - [audit][restore:start] { decisionId, stage, effectiveCompanyId, ... }
 * - [audit][restore:decision] { decisionId, sourceUsed, reason, hasDbData, hasStoreData, ... }
 * - [audit][restore:done] { decisionId, sourceUsed, strategyId, revision, didClearSnapshot }
 * - [audit][restore:fail] { decisionId, error }
 */
export async function restoreWithAudit(
  stage: 'stage1' | 'stage2' | 'cascade' | 'execution' | 'stage6',
  effectiveCompanyId: string | null | undefined,
  options?: { allowSnapshot?: boolean },
): Promise<RestoreDecision> {
  const startTime = Date.now();
  const allowSnapshot = options?.allowSnapshot !== false;
  const decisionId = generateUUID(); // ★ TASK 5-1: decisionId を一意に生成

  console.log(
    `[audit][restore:start] decisionId=${decisionId} stage=${stage} effectiveCompanyId=${effectiveCompanyId}`,
    {
      timestamp: new Date().toISOString(),
      allowSnapshot,
    },
  );

  try {
    // ★ Check 1: companyId が未確定 → snapshot 判定と clear をしない
    if (!effectiveCompanyId) {
      const decision: RestoreDecision = {
        decisionId,
        sourceUsed: 'none',
        reason: 'companyId_not_ready',
        didHydrateStore: false,
        didClearSnapshot: false,
        effectiveCompanyId,
      };
      console.log(
        `[audit][restore:decision] decisionId=${decisionId} sourceUsed=${decision.sourceUsed} reason="${decision.reason}"`,
      );
      return decision;
    }

    const store = useStrategyStore.getState();
    let snapshotData: any = null;
    let dbData: any = null;
    let hasDbData = false;
    let hasSnapshot = false;
    let snapshotCompanyId: string | undefined;

    // ★ Snapshot ロード試行（存在確認のみ）
    if (allowSnapshot && stage === 'stage2') {
      snapshotData = loadStage2SnapshotFromLocalStorage();
      hasSnapshot = !!snapshotData;
      snapshotCompanyId = snapshotData?.companyId;
    } else if (allowSnapshot && stage === 'stage1') {
      snapshotData = loadStage1SnapshotFromLocalStorage();
      hasSnapshot = !!snapshotData;
      snapshotCompanyId = snapshotData?.companyId;
      // cascade, execution, stage6 は後で追加可能
    }

    // ★ Check 2: snapshot.companyId !== effectiveCompanyId → clear＆skip
    if (snapshotData && snapshotData.companyId && snapshotData.companyId !== effectiveCompanyId) {
      if (stage === 'stage2') {
        clearStage2Snapshot();
      } else if (stage === 'stage1') {
        clearStage1Snapshot();
      }
      const decision: RestoreDecision = {
        decisionId,
        sourceUsed: 'none',
        reason: 'snapshot_company_mismatch',
        didHydrateStore: false,
        didClearSnapshot: true,
        snapshotData,
        hasSnapshot,
        snapshotCompanyId,
        effectiveCompanyId,
      };
      console.log(
        `[audit][restore:decision] decisionId=${decisionId} sourceUsed=${decision.sourceUsed} reason="${decision.reason}" didClearSnapshot=true snapshotCompanyId=${snapshotCompanyId}`,
      );
      return decision;
    }

    // ★ DB から最新データを取得
    const { data: dbDataResult, error: dbError } = await getFullStrategyDataByCompany(
      effectiveCompanyId,
    );

    if (dbError) {
      // DB 取得失敗時の fallback
      if (snapshotData && stage === 'stage2') {
        const decision: RestoreDecision = {
          decisionId,
          sourceUsed: 'snapshot',
          reason: 'db_error_fallback_to_snapshot',
          strategyId: snapshotData.state?.id,
          revision: undefined,
          didHydrateStore: false,
          didClearSnapshot: false,
          snapshotData,
          hasDbData: false,
          hasStoreData: false,
          hasSnapshot: true,
          effectiveCompanyId,
        };
        console.log(
          `[audit][restore:decision] decisionId=${decisionId} sourceUsed=${decision.sourceUsed} reason="${decision.reason}"`,
        );
        return decision;
      }
      const decision: RestoreDecision = {
        decisionId,
        sourceUsed: 'store',
        reason: 'db_error_use_store',
        strategyId: store.strategyId,
        revision: store.revision,
        didHydrateStore: false,
        didClearSnapshot: false,
        hasDbData: false,
        hasStoreData: true,
        hasSnapshot: false,
        effectiveCompanyId,
      };
      console.log(
        `[audit][restore:decision] decisionId=${decisionId} sourceUsed=${decision.sourceUsed} reason="${decision.reason}"`,
      );
      return decision;
    }

    dbData = dbDataResult;
    hasDbData = !!dbData;

    // ★ Check 3: DB に確定データがある → DB 優先、snapshot 不使用
    const hasMVVInDB =
      hasDbData && (dbData.thought || dbData.mission || dbData.vision || dbData.value);
    const hasMVVInStore = !!(
      store.thought ||
      store.mission ||
      store.vision ||
      store.value
    );

    if (hasMVVInDB) {
      // ★ TASK 11-2: hydratedState を準備（caller が store に反映できるよう）
      let hydratedState = normalizeStrategyData(dbData);

      // ★ TASK 12-1: revision/strategyId を必ず入れる（normalizeで落ちた場合の補填）
      hydratedState = {
        ...hydratedState,
        revision: dbData.revision ?? hydratedState.revision,
        strategyId: dbData.id ?? hydratedState.strategyId,
      };

      const decision: RestoreDecision = {
        decisionId,
        sourceUsed: 'db',
        reason: 'db_has_mvv',
        strategyId: dbData.id,
        revision: dbData.revision,
        didHydrateStore: false, // DB から hydrate する処理は呼び出し側で行う
        didClearSnapshot: false,
        dbData,
        hydratedState,  // ★ TASK 11-2: caller に hydrate 可能な状態を返す
        hasDbData: true,
        hasStoreData: hasMVVInStore,
        hasSnapshot,
        snapshotCompanyId,
        effectiveCompanyId,
      };
      console.log(
        `[audit][restore:decision] decisionId=${decisionId} sourceUsed=${decision.sourceUsed} reason="${decision.reason}" dbRevision=${decision.revision}`,
      );

      // ★ TASK 11.5: field_check ログを return 直前に置く（DEBUG無し、常時出力）
      console.log('[audit][restore:field_check]', {
        decisionId: decision.decisionId,
        sourceUsed: decision.sourceUsed,
        ceoIntentLen: (hydratedState as any)?.ceoIntent?.length ?? 0,
        revision: hydratedState?.revision,
      });

      // ★ TASK 4: answers12 restore confirmation log
      const answers12Len = Array.isArray((hydratedState as any)?.answers12) ? (hydratedState as any).answers12.length : 0;
      if (answers12Len > 0) {
        console.log('[audit][restore] TASK 4 answers12 confirmed', {
          sourceUsed: decision.sourceUsed,
          answers12Len,
          first: (hydratedState as any)?.answers12?.[0] ?? null,
        });
      }

      return decision;
    }

    // ★ DB にデータがないが store に data がある → store 優先
    if (hasMVVInStore) {
      // ★ TASK 11-2: hydratedState を準備（caller が一貫性確認できるよう）
      const hydratedState = normalizeStrategyData(store as any);

      const decision: RestoreDecision = {
        decisionId,
        sourceUsed: 'store',
        reason: 'store_has_mvv',
        strategyId: store.strategyId,
        revision: store.revision,
        didHydrateStore: false,
        didClearSnapshot: false,
        hydratedState,  // ★ TASK 11-2: store 側も正規化済み状態を返す
        hasDbData: false,
        hasStoreData: true,
        hasSnapshot,
        snapshotCompanyId,
        effectiveCompanyId,
      };
      console.log(
        `[audit][restore:decision] decisionId=${decisionId} sourceUsed=${decision.sourceUsed} reason="${decision.reason}"`,
      );
      return decision;
    }

    // ★ DB にも store にもデータがない → snapshot を使用（companyId checked OK）
    if (snapshotData && stage === 'stage2') {
      const decision: RestoreDecision = {
        decisionId,
        sourceUsed: 'snapshot',
        reason: 'db_and_store_empty_fallback',
        strategyId: snapshotData.state?.id,
        revision: undefined,
        didHydrateStore: true, // snapshot から store を hydrate する
        didClearSnapshot: false,
        snapshotData,
        hasDbData: false,
        hasStoreData: false,
        hasSnapshot: true,
        snapshotCompanyId,
        effectiveCompanyId,
      };
      console.log(
        `[audit][restore:decision] decisionId=${decisionId} sourceUsed=${decision.sourceUsed} reason="${decision.reason}"`,
      );
      return decision;
    }

    // ★ すべてが空 → none
    const decision: RestoreDecision = {
      decisionId,
      sourceUsed: 'none',
      reason: 'all_empty',
      didHydrateStore: false,
      didClearSnapshot: false,
      hasDbData: false,
      hasStoreData: false,
      hasSnapshot: false,
      effectiveCompanyId,
    };
    console.log(
      `[audit][restore:decision] decisionId=${decisionId} sourceUsed=${decision.sourceUsed} reason="${decision.reason}"`,
    );
    return decision;
  } catch (err) {
    const duration = Date.now() - startTime;
    const errorMsg = err instanceof Error ? err.message : String(err);
    console.error(
      `[audit][restore:fail] decisionId=${decisionId} stage=${stage} duration=${duration}ms error="${errorMsg}"`,
      {
        error: err,
      },
    );
    return {
      decisionId,
      sourceUsed: 'none',
      reason: `exception: ${errorMsg}`,
      didHydrateStore: false,
      didClearSnapshot: false,
      effectiveCompanyId,
    };
  }
}

/**
 * 簡易的な UUID 生成（TASK 5-1 用）
 * 本番では uuid パッケージを使うことを推奨
 */
function generateUUID(): string {
  return `restore_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
}
