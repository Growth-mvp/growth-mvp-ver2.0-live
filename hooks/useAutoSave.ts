// /hooks/useAutoSave.ts
'use client';

import { useCallback, useEffect, useMemo, useRef } from 'react';
import { useStrategyStore } from '@/store/strategyStore';
import { useUserStore } from '@/store/userStore';

// ★ 可能なら：ブラウザ用 Supabase クライアント（無ければ try/catch でフォールバック）
let getBrowserSupabase: (() => any) | null = null;
try {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const mod = require('@/utils/supabase/client');
  getBrowserSupabase = mod?.getBrowserSupabase ?? null;
} catch {
  // noop
}

/* ============================================
 * AutoSave Mode Type
 * ========================================== */
type AutoSaveMode = 'legacy' | 'payload';

type Options = {
  enabled?: boolean;
  debounceMs?: number;
  forceSkipWhenDeleting?: boolean;
  requireSession?: boolean;
  requireHydrated?: boolean;
  minIntervalMs?: number;
  isFetchingSelector?: (strategyState: any) => boolean;
  initialDelayMs?: number;
  mode?: AutoSaveMode;
};

/* ============================================
 * 定数：削除フラグ
 * ========================================== */
const DELETION_FLAG_KEY = '__deleting_company__';
function isCompanyDeleting(targetCompanyId?: string | null): boolean {
  try {
    const v =
      typeof localStorage !== 'undefined'
        ? localStorage.getItem(DELETION_FLAG_KEY)
        : null;
    if (!v) return false;
    return targetCompanyId ? v === targetCompanyId : true;
  } catch {
    return false;
  }
}

/* ============================================
 * ユーティリティ
 * ========================================== */

/** JSON安定化（循環対策＋Date→ISO） */
function safeStableStringify(obj: unknown): string {
  try {
    return JSON.stringify(obj, (_k, v) =>
      v instanceof Date ? v.toISOString() : v,
    );
  } catch {
    return '';
  }
}

/** セッション確認（安全にフォールバック） */
async function hasActiveSession(): Promise<boolean> {
  if (!getBrowserSupabase) return false;
  try {
    const supabase = getBrowserSupabase();
    const { data } = await supabase.auth.getSession();
    return !!data?.session?.user?.id;
  } catch {
    return false;
  }
}

/* ============================================
 * オーバーロード宣言
 * ========================================== */
export function useAutoSave(deps?: any[]): void;
export function useAutoSave(options?: Options, deps?: any[]): void;

/* ============================================
 * 実装
 * ========================================== */
export function useAutoSave(arg1?: Options | any[], arg2?: any[]): void {
  const isArg1Array = Array.isArray(arg1);
  const options: Options = isArg1Array ? {} : (arg1 ?? {});
  const externalDeps: any[] = isArg1Array
    ? (arg1 as any[])
    : Array.isArray(arg2)
    ? arg2
    : [];

  const {
    enabled = true,
    debounceMs = 1200,
    forceSkipWhenDeleting = true,
    requireSession = true,
    requireHydrated = true,
    minIntervalMs = 1500,
    isFetchingSelector,
    initialDelayMs = 1000,
    mode = 'legacy',
  } = options;

  // ---- ユーザー情報 ----
  const userId = useUserStore((s) => s.user?.id);
  const companyIdFromUserStore = useUserStore((s: any) =>
    s?.membership?.companyId ?? s?.companyId ?? s?.user?.companyId ?? undefined,
  );

  // ---- Strategy ----
  const hydrated = useStrategyStore(
    (s: any) => !!(s?.hydrated ?? s?.boot?.isHydrated),
  );
  const companyIdFromStore = useStrategyStore(
    (s: any) => s?.companyId as string | null,
  );
  const isFetching = useStrategyStore((s: any) =>
    typeof isFetchingSelector === 'function'
      ? !!isFetchingSelector(s)
      : !!s?.__isFetchingFromServer,
  );

  // ---- TASK 1 & 3: Conflict recovery state ----
  const restoreReady = useStrategyStore((s: any) => s?.restoreReady);
  const lastServerSyncAt = useStrategyStore((s: any) => s?.lastServerSyncAt);
  const conflictCooldownUntil = useStrategyStore((s: any) => s?.conflictCooldownUntil);
  const pendingConflictRecovery = useStrategyStore((s: any) => s?.pendingConflictRecovery);

  // ---- Version for payload signature ----
  const storeVersion = useStrategyStore((s: any) => s?.version);

  // ---- 保存対象フィールド（署名用）----
  const pickA = useStrategyStore((s: any) => s?.companyName);
  const pickB = useStrategyStore((s: any) => s?.mission);
  const pickC = useStrategyStore((s: any) => s?.vision);
  const pickD = useStrategyStore((s: any) => s?.value);
  const pickE = useStrategyStore((s: any) => s?.thought);
  const pickF = useStrategyStore((s: any) => s?.story);
  const pickG = useStrategyStore((s: any) => s?.finalStory);
  const pickH = useStrategyStore((s: any) => s?.answers2);
  const pickI = useStrategyStore((s: any) => s?.departments);
  const pickJ = useStrategyStore((s: any) => s?.csvFinanceData);
  const pickK = useStrategyStore((s: any) => s?.financeSummary);
  const pickL = useStrategyStore((s: any) => s?.businessPortfolio);
  const pickM = useStrategyStore(
    (s: any) => s?.simulationResults ?? s?.simulationResult,
  );

  // ---- STAGE2 フィールド（署名用）----
  const pickN = useStrategyStore((s: any) => s?.ceoIntent);
  const pickO = useStrategyStore((s: any) => s?.storyDraft);
  const pickP = useStrategyStore((s: any) => (s as any)?.answers12);
  const pickQ = useStrategyStore((s: any) => (s as any)?.winPatternsCandidate);
  const pickR = useStrategyStore((s: any) => (s as any)?.finalStoryDraft);
  const pickS = useStrategyStore((s: any) => (s as any)?.finalStoryEdited);
  const pickT = useStrategyStore((s: any) => (s as any)?.finalStoryFinal);
  const pickU = useStrategyStore((s: any) => (s as any)?.companyTargets);

  // ---- STAGE2 フィールド（追加分、署名用）----
  const pickV = useStrategyStore((s: any) => s?.strength);
  const pickW = useStrategyStore((s: any) => s?.weakness);
  const pickX = useStrategyStore((s: any) => s?.opportunity);
  const pickY = useStrategyStore((s: any) => s?.threat);
  const pickZ = useStrategyStore((s: any) => s?.swotSuggestions);
  const pickAA = useStrategyStore((s: any) => s?.winPatterns);
  const pickAB = useStrategyStore((s: any) => s?.winPatternPrimary);
  const pickAC = useStrategyStore((s: any) => s?.winPatternSecondary);

  const companyId = companyIdFromStore ?? companyIdFromUserStore;

  /* ============================================
   * Payload Signature（mode='payload'時のみ計算）
   * ========================================== */
  const payloadSignature = useMemo(() => {
    if (mode !== 'payload') return '';

    const store = useStrategyStore.getState();
    const payload = store.buildPayload?.();
    return payload ? safeStableStringify(payload) : '';
  }, [mode, storeVersion]);

  /* ============================================
   * 変更シグネチャ
   * ★ FIX: hydrated / isFetching / companyId を含める
   * ========================================== */
  const internalSignature = useMemo(() => {
    const pick = {
      companyId,
      hydrated,
      isFetching,
      companyName: pickA,
      mission: pickB,
      vision: pickC,
      value: pickD,
      thought: pickE,
      story: pickF,
      finalStory: pickG,
      answers2: pickH,
      departments: pickI,
      csvFinanceData: pickJ,
      financeSummary: pickK,
      businessPortfolio: pickL,
      simulationResults: pickM,
      // ★ STAGE2 フィールド追加
      ceoIntent: pickN,
      storyDraft: pickO,
      answers12: pickP,
      winPatternsCandidate: pickQ,
      finalStoryDraft: pickR,
      finalStoryEdited: pickS,
      finalStoryFinal: pickT,
      companyTargets: pickU,
      // ★ STAGE2 フィールド追加分
      strength: pickV,
      weakness: pickW,
      opportunity: pickX,
      threat: pickY,
      swotSuggestions: pickZ,
      winPatterns: pickAA,
      winPatternPrimary: pickAB,
      winPatternSecondary: pickAC,
    };
    return safeStableStringify(pick);
  }, [
    companyId,
    hydrated,
    isFetching,
    pickA,
    pickB,
    pickC,
    pickD,
    pickE,
    pickF,
    pickG,
    pickH,
    pickI,
    pickJ,
    pickK,
    pickL,
    pickM,
    pickN,
    pickO,
    pickP,
    pickQ,
    pickR,
    pickS,
    pickT,
    pickU,
    pickV,
    pickW,
    pickX,
    pickY,
    pickZ,
    pickAA,
    pickAB,
    pickAC,
  ]);

  const depsSignature = useMemo(() => {
    if (!externalDeps || externalDeps.length === 0) return '';
    return safeStableStringify(externalDeps);
  }, [externalDeps]);

  const combinedSignature = useMemo(() => {
    if (mode === 'payload') {
      return payloadSignature;
    }
    return internalSignature + '|' + depsSignature;
  }, [mode, payloadSignature, internalSignature, depsSignature]);

  // ---- 保存制御 ----
  const savingRef = useRef(false);
  const lastSavedAtRef = useRef<number>(0);
  const mountedAtRef = useRef<number>(Date.now());

  /* ============================================
   * ★ FIX: companyId 切替時のリセット
   * ========================================== */
  useEffect(() => {
    mountedAtRef.current = Date.now();
    lastSavedAtRef.current = 0;
    savingRef.current = false;
  }, [companyId]);

  const doSave = useCallback(async () => {
    try {
      const timestamp = new Date().toISOString();

      if (!enabled) {
        if (mode === 'payload') {
          console.log('[AutoSave][guard-check] SKIP: not enabled', { timestamp });
        }
        return;
      }
      if (requireHydrated && !hydrated) {
        if (mode === 'payload') {
          console.log('[AutoSave][guard-check] SKIP: not hydrated', { hydrated, timestamp });
        }
        return;
      }
      if (!userId) {
        if (mode === 'payload') {
          console.log('[AutoSave][guard-check] SKIP: no userId', { timestamp });
        }
        return;
      }
      if (!companyId) {
        if (mode === 'payload') {
          console.log('[AutoSave][guard-check] SKIP: no companyId', { timestamp });
        }
        return;
      }
      if (forceSkipWhenDeleting && isCompanyDeleting(companyId)) {
        if (mode === 'payload') {
          console.log('[AutoSave][guard-check] SKIP: company deleting', { companyId, timestamp });
        }
        return;
      }

      // ★ isFetching チェック（最重要）
      if (isFetching) {
        if (mode === 'payload') {
          const store = useStrategyStore.getState();
          const isFetchingSelectorResult = isFetchingSelector ? isFetchingSelector(store) : undefined;
          const __isFetching = (store as any)?.__isFetchingFromServer;
          const _loadingRefetch = (store as any)?._loadingRefetch;
          const isHydrating = (store as any)?.boot?.isHydrating;

          console.log('[AutoSave][guard-check] SKIP: isFetching', {
            isFetching,
            isFetchingSelector: !!isFetchingSelector,
            isFetchingSelectorResult,
            timestamp,
          });

          // 詳細な store 状態確認
          console.log('[AutoSave][isFetching-debug-detailed]', {
            __isFetchingFromServer: __isFetching,
            _loadingRefetch,
            isHydrating,
            pendingCompanyId: (store as any)?.pendingCompanyId,
            companyId: (store as any)?.companyId,
            isRestoring: (store as any)?.isRestoring,
            restoreReady: (store as any)?.restoreReady,
            conflictCooldownUntil: conflictCooldownUntil ? new Date(conflictCooldownUntil).toISOString() : null,
            pendingConflictRecovery,
          });
        }
        return;
      }

      // ★ TASK 1: Check for conflict cooldown
      if (conflictCooldownUntil && Date.now() < conflictCooldownUntil) {
        if (mode === 'payload') {
          console.log('[AutoSave][guard-check] SKIP: in conflict cooldown period', { conflictCooldownUntil, timestamp });
        }
        return;
      }

      // ★ TASK 3: Check for post-restore cooldown (2 second grace period)
      if (restoreReady && lastServerSyncAt) {
        const timeSinceSync = Date.now() - lastServerSyncAt;
        if (timeSinceSync < 2000) {
          if (mode === 'payload') {
            console.log('[AutoSave][guard-check] SKIP: post-restore cooldown', { timeSinceSync, timestamp });
          }
          return;
        }
      }

      // ★ TASK 1: Block autosave during conflict recovery
      if (pendingConflictRecovery) {
        if (mode === 'payload') {
          console.log('[AutoSave][guard-check] SKIP: pending conflict recovery', { timestamp });
        }
        return;
      }

      if (Date.now() - mountedAtRef.current < initialDelayMs) {
        if (mode === 'payload') {
          console.log('[AutoSave][guard-check] SKIP: initialDelayMs not elapsed', {
            elapsed: Date.now() - mountedAtRef.current,
            initialDelayMs,
            timestamp
          });
        }
        return;
      }

      if (requireSession) {
        const active = await hasActiveSession();
        if (!active) {
          if (mode === 'payload') {
            console.log('[AutoSave][guard-check] SKIP: no active session', { timestamp });
          }
          return;
        }
      }

      const now = Date.now();
      if (now - lastSavedAtRef.current < minIntervalMs) {
        if (mode === 'payload') {
          console.log('[AutoSave][guard-check] SKIP: minIntervalMs not elapsed', {
            elapsed: now - lastSavedAtRef.current,
            minIntervalMs,
            timestamp
          });
        }
        return;
      }
      if (savingRef.current) {
        if (mode === 'payload') {
          console.log('[AutoSave][guard-check] SKIP: already saving', { timestamp });
        }
        return;
      }

      // ★ すべてのガードを通過したので、saveStrategyData 呼び出し直前ログ
      if (mode === 'payload') {
        console.log('[AutoSave][before-saveStrategyData] 全ガードを通過', {
          isFetching,
          isDirty: true,
          isHydrating: !hydrated,
          canSave: true,
          timestamp,
        });
      }

      savingRef.current = true;

      const storeApi = useStrategyStore.getState();
      console.log('[AutoSave][saveStrategyData-enter]', { timestamp });
      await storeApi.saveStrategyData();
      console.log('[AutoSave][saveStrategyData-done]', { timestamp });

      lastSavedAtRef.current = Date.now();
    } catch (e) {
      console.error('[AutoSave][SAVE] ❌ Error:', e);
    } finally {
      savingRef.current = false;
    }
  }, [
    enabled,
    requireHydrated,
    hydrated,
    userId,
    companyId,
    forceSkipWhenDeleting,
    isFetching,
    isFetchingSelector,
    requireSession,
    minIntervalMs,
    initialDelayMs,
    mode,
    // ★ TASK 1 & 3: Conflict recovery dependencies
    restoreReady,
    lastServerSyncAt,
    conflictCooldownUntil,
    pendingConflictRecovery,
  ]);

  /* ============================================
   * デバウンス
   * ========================================== */
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const cancel = useCallback(() => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  const trigger = useCallback(() => {
    if (mode === 'payload') {
      const store = useStrategyStore.getState();
      const payload = store.buildPayload?.();
      const sig = payloadSignature;
      console.log('[AutoSave][signature-length]', {
        length: sig.length,
        mode,
        payload_keys: payload ? Object.keys(payload).filter(k => k.includes('project')).length : 0,
        has_projectTargetImpacts: payload ? 'projectTargetImpacts' in payload : false,
        has_projectIssueLinks: payload ? 'projectIssueLinks' in payload : false,
      });
    }
    cancel();
    timerRef.current = setTimeout(() => {
      timerRef.current = null;
      void doSave();
    }, Math.max(0, debounceMs));
  }, [debounceMs, cancel, doSave, mode, payloadSignature]);

  useEffect(() => {
    if (!enabled) return;
    trigger();
    return cancel;
  }, [enabled, trigger, cancel, combinedSignature]);

  /* ============================================
   * isFetching トラッキング（デバッグ用）
   * ========================================== */
  const lastIsFetchingRef = useRef<boolean | null>(null);
  useEffect(() => {
    if (lastIsFetchingRef.current !== isFetching) {
      const timestamp = new Date().toISOString();
      console.log('[AutoSave][isFetching-change]', {
        prev: lastIsFetchingRef.current,
        current: isFetching,
        reason: isFetching ? 'fetch started' : 'fetch completed',
        timestamp,
      });
      lastIsFetchingRef.current = isFetching;
    }
  }, [isFetching]);

  /* ============================================
   * ★ FIX: gate解除時に再トリガ
   * ========================================== */
  useEffect(() => {
    if (!enabled) return;
    if (hydrated && !isFetching) {
      trigger();
    }
  }, [enabled, hydrated, isFetching, trigger]);

  useEffect(() => {
    return () => {
      cancel();
    };
  }, [cancel]);
}
