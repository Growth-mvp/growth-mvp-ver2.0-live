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

    // ★ 修正：expiresAt をチェック（JSON パースに失敗した場合は文字列として扱う）
    let flagData: any = v;
    try {
      const parsed = JSON.parse(v);
      if (parsed && typeof parsed === 'object' && 'expiresAt' in parsed) {
        flagData = parsed;
        // 期限切れなら削除フラグをクリア
        if (parsed.expiresAt && Date.now() > parsed.expiresAt) {
          localStorage.removeItem(DELETION_FLAG_KEY);
          return false;
        }
      }
    } catch {
      // JSON パース失敗 → 古い形式（単なる companyId 文字列）として扱う
    }

    // companyId チェック
    if (typeof flagData === 'string') {
      return targetCompanyId ? flagData === targetCompanyId : true;
    }
    if (typeof flagData === 'object' && flagData.companyId) {
      return targetCompanyId ? flagData.companyId === targetCompanyId : true;
    }
    return false;
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
   * ★ FIX: useMemo ではなく、trigger() 内で毎回計算する（deps が [mode] だけでは更新されないため）
   * ========================================== */
  // payloadSignature は useMemo ではなく、trigger() 内で毎回計算します

  /* ============================================
   * 変更シグネチャ
   * ★ FIX: 保存対象フィールドのみ（hydrated/isFetching/version は除外）
   * ========================================== */
  const internalSignature = useMemo(() => {
    const pick = {
      companyId,
      // ★ 重要：以下はガード条件であって、署名対象ではない
      // hydrated,
      // isFetching,
      // version,
      // revision,
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

    // ★ FIX: signature 対象フィールドの snapshot をログ（answers2/departments が入っているか確認）
    console.log('[autosave:signature-snapshot]', {
      answers2Len: Array.isArray(pickH) ? pickH.length : 0,
      departmentsLen: Array.isArray(pickI) ? pickI.length : 0,
      hasAnswers2: !!pickH,
      hasDepartments: !!pickI,
      companyName: !!pickA,
      mission: !!pickB,
      timestamp: new Date().toISOString(),
    });

    return safeStableStringify(pick);
  }, [
    companyId,
    // ★ hydrated/isFetching は deps から外す（ガード条件であって、署名要因ではない）
    // hydrated,
    // isFetching,
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

  // ★ FIX: payloadSignature を毎回計算するため、trigger() 内で signature を計算
  // combinedSignature は Effect の外での deps 比較用（legacy mode用）
  const combinedSignature = useMemo(() => {
    if (mode === 'payload') {
      // mode='payload' の場合は、trigger() 内で毎回計算するため、ここでは古い値を返す
      // （実際の signature 比較は trigger() 内で行われる）
      return '';
    }
    return internalSignature + '|' + depsSignature;
  }, [mode, internalSignature, depsSignature]);

  // ---- 保存制御 ----
  const savingRef = useRef(false);
  const lastSavedAtRef = useRef<number>(0);
  const mountedAtRef = useRef<number>(Date.now());
  const triggerTimeRef = useRef<number | null>(null);  // ★ FIX: trigger 時刻を記録（保存完了時間計測用）
  const postRestoreFirstSaveDoneRef = useRef<boolean>(false);  // ★ FIX: post-restore 初回保存完了フラグ

  /* ============================================
   * ★ FIX: companyId 切替時のリセット + restore 状態のトラッキング
   * ========================================== */
  useEffect(() => {
    mountedAtRef.current = Date.now();
    lastSavedAtRef.current = 0;
    savingRef.current = false;
    postRestoreFirstSaveDoneRef.current = false;  // ★ FIX: restore 時にフラグをリセット
  }, [companyId]);

  // ★ FIX: restoreReady が false → true に変わったときにフラグをリセット
  useEffect(() => {
    if (restoreReady) {
      postRestoreFirstSaveDoneRef.current = false;
      console.log('[autosave:restore-ready]', {
        restoreReady,
        lastServerSyncAt,
        timestamp: new Date().toISOString(),
      });
    }
  }, [restoreReady]);

  const doSave = useCallback(async () => {
    try {
      const timestamp = new Date().toISOString();

      // ★ FIX: enabled 条件を詳しくログ出力（未発火の原因特定用）
      if (!enabled) {
        console.log('[autosave:guard-enabled]', {
          enabled,
          reason: 'not enabled',
          timestamp,
        });
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
          const DELETION_FLAG_KEY = '__deleting_company__';
          let flagInfo = {};
          try {
            const flagStr = typeof localStorage !== 'undefined' ? localStorage.getItem(DELETION_FLAG_KEY) : null;
            if (flagStr) {
              const flag = JSON.parse(flagStr);
              flagInfo = { operationId: flag.operationId, expiresAt: new Date(flag.expiresAt).toISOString() };
            }
          } catch (e) {}
          console.log('[AutoSave][guard-check] SKIP: company deleting (deletion flag active)', { companyId, ...flagInfo, timestamp });
        }
        return;
      }

      // ★ FIX: Check if generation save is in progress (block autosave during critical period)
      const GENERATION_SAVE_FLAG_KEY = '__generation_save_in_progress__';
      try {
        const flagStr = typeof localStorage !== 'undefined' ? localStorage.getItem(GENERATION_SAVE_FLAG_KEY) : null;
        if (flagStr) {
          try {
            const flag = JSON.parse(flagStr);
            if (flag.expiresAt && Date.now() < flag.expiresAt) {
              if (mode === 'payload') {
                console.log('[AutoSave][guard-check] SKIP: generation save in progress', {
                  operationId: flag.operationId,
                  expiresAt: new Date(flag.expiresAt).toISOString(),
                  timestamp,
                });
              }
              return;
            } else {
              // 期限切れなら削除
              if (typeof localStorage !== 'undefined') {
                localStorage.removeItem(GENERATION_SAVE_FLAG_KEY);
              }
            }
          } catch (e) {
            // JSON パースエラー → フラグ削除
            if (typeof localStorage !== 'undefined') {
              localStorage.removeItem(GENERATION_SAVE_FLAG_KEY);
            }
          }
        }
      } catch (e) {
        console.warn('[AutoSave] failed to check generation save flag:', e);
      }

      // ★ 修正：確定保存中フラグをチェック
      const MANUAL_SAVE_FLAG_KEY = '__manual_saving_strategy__';
      try {
        const flagStr = typeof localStorage !== 'undefined' ? localStorage.getItem(MANUAL_SAVE_FLAG_KEY) : null;
        if (flagStr) {
          try {
            const flag = JSON.parse(flagStr);
            if (flag.expiresAt && Date.now() < flag.expiresAt) {
              if (mode === 'payload') {
                console.log('[AutoSave][guard-check] SKIP: manual save in progress', {
                  operationId: flag.operationId,
                  expiresAt: new Date(flag.expiresAt).toISOString(),
                  timestamp,
                });
              }
              return;
            } else {
              // 期限切れなら削除
              if (typeof localStorage !== 'undefined') {
                localStorage.removeItem(MANUAL_SAVE_FLAG_KEY);
              }
            }
          } catch (e) {
            // JSON パースエラー → フラグ削除
            if (typeof localStorage !== 'undefined') {
              localStorage.removeItem(MANUAL_SAVE_FLAG_KEY);
            }
          }
        }
      } catch (e) {
        console.warn('[AutoSave] failed to check manual save flag:', e);
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

      // ★ TASK 3: Check for post-restore cooldown (only for first save after restore)
      if (restoreReady && lastServerSyncAt && !postRestoreFirstSaveDoneRef.current) {
        const timeSinceSync = Date.now() - lastServerSyncAt;
        // ★ FIX: 初回 post-restore 保存は 500ms のみ待機（STAGE3 の入力速度に対応）
        const postRestoreCooldownMs = debounceMs >= 500 ? 500 : debounceMs;
        if (timeSinceSync < postRestoreCooldownMs) {
          if (mode === 'payload') {
            console.log('[AutoSave][guard-check] SKIP: post-restore cooldown (first-save-only)', {
              timeSinceSync,
              postRestoreCooldownMs,
              firstSaveDone: postRestoreFirstSaveDoneRef.current,
              timestamp,
            });
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
      const doneTime = Date.now();
      console.log('[AutoSave][saveStrategyData-done]', { timestamp });

      // ★ FIX: post-restore 初回保存が完了したらフラグを設定
      if (restoreReady && !postRestoreFirstSaveDoneRef.current) {
        postRestoreFirstSaveDoneRef.current = true;
        console.log('[autosave:post-restore-first-save-done]', {
          timestamp,
          restoreReady,
        });
      }

      // ★ FIX: trigger から saveStrategyData 完了までの経過時間をログ
      if (triggerTimeRef.current) {
        const elapsedMs = doneTime - triggerTimeRef.current;
        console.log('[autosave:save-timing]', {
          triggerToSaveMs: elapsedMs,
          debounceMs,
          timestamp,
        });
      }

      lastSavedAtRef.current = doneTime;
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
    debounceMs,  // ★ FIX: post-restore cooldown 計算で使用
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

  // ★ FIX: 毎回 signature を計算・比較して trigger するための ref
  const lastFingerprintRef = useRef<string | null>(null);

  const trigger = useCallback(() => {
    triggerTimeRef.current = Date.now();

    // ★ FIX: 毎回、現在の fingerprint を計算
    let currentFingerprint: string;
    let fingerprintChanged = false;

    if (mode === 'payload') {
      const store = useStrategyStore.getState();
      const payload = store.buildPayload?.();
      currentFingerprint = payload ? safeStableStringify(payload) : '';

      // ★ FIX: 前回と比較
      if (lastFingerprintRef.current !== currentFingerprint) {
        fingerprintChanged = true;
        console.log('[autosave:fingerprint-changed]', {
          prevHash: lastFingerprintRef.current ? `len=${lastFingerprintRef.current.length}` : 'null',
          nextHash: `len=${currentFingerprint.length}`,
          timestamp: new Date().toISOString(),
        });
      }
      lastFingerprintRef.current = currentFingerprint;
    } else {
      currentFingerprint = internalSignature + '|' + depsSignature;
      if (lastFingerprintRef.current !== currentFingerprint) {
        fingerprintChanged = true;
      }
      lastFingerprintRef.current = currentFingerprint;
    }

    // ★ FIX: trigger-reason ログに fingerprint-changed を含める
    console.log('[autosave:trigger-reason]', {
      timestamp: new Date().toISOString(),
      mode,
      fingerprintChanged,
      enabled,
      hydrated,
      isFetching,
      companyId,
      debounceMs,
    });

    if (!fingerprintChanged) {
      console.log('[autosave:no-trigger]', {
        reason: 'fingerprint same',
        timestamp: new Date().toISOString(),
      });
      return;
    }

    // ★ FIX: 前の debounce をキャンセル
    if (timerRef.current) {
      console.log('[autosave:debounce-cancelled]', {
        reason: 'new-trigger',
        timestamp: new Date().toISOString(),
      });
    }
    cancel();

    // ★ FIX: 新しい debounce をスケジュール
    console.log('[autosave:debounce-scheduled]', {
      debounceMs,
      minIntervalMs,
      timestamp: new Date().toISOString(),
    });

    timerRef.current = setTimeout(() => {
      timerRef.current = null;
      console.log('[autosave:debounce-fired]', {
        timestamp: new Date().toISOString(),
      });
      void doSave();
    }, Math.max(0, debounceMs));
  }, [debounceMs, cancel, doSave, mode, internalSignature, depsSignature, enabled, hydrated, isFetching, companyId]);

  // ★ FIX: combinedSignature 変更をトラッキング（legacy mode 用）
  // mode='payload' の場合は、trigger() 内で毎回 signature を計算・比較するため、
  // ここでは combinedSignature が更新されるたびに trigger() を呼ぶ（legacy mode 用）
  const lastCombinedSigRef = useRef<string | null>(null);
  useEffect(() => {
    if (!enabled) return;
    if (mode === 'payload') {
      // payload mode では trigger() 内で毎回 signature を計算するため、ここでは何もしない
      return;
    }

    if (lastCombinedSigRef.current && lastCombinedSigRef.current !== combinedSignature) {
      console.log('[AutoSave][signature-changed]', {
        timestamp: new Date().toISOString(),
        mode,
        prevLen: lastCombinedSigRef.current?.length ?? 0,
        nextLen: combinedSignature.length,
        diff: Math.abs((combinedSignature.length ?? 0) - (lastCombinedSigRef.current?.length ?? 0)),
      });
    }
    lastCombinedSigRef.current = combinedSignature;

    trigger();
    return cancel;
  }, [enabled, trigger, cancel, combinedSignature, mode]);

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
   * ★ FIX: payload mode で departments/answers2 変更時に trigger
   * ========================================== */
  useEffect(() => {
    if (!enabled || mode !== 'payload') return;

    console.log('[autosave:payload-deps-change]', {
      timestamp: new Date().toISOString(),
      pickH_len: Array.isArray(pickH) ? pickH.length : 0,
      pickI_len: Array.isArray(pickI) ? pickI.length : 0,
    });

    trigger();
  }, [enabled, mode, trigger, pickH, pickI]);

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
