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

type Options = {
  enabled?: boolean;
  debounceMs?: number;
  /** 既存行がある場合のみ UPDATE（INSERTしない）→ ※現行は store.saveStrategyData に委譲するため未使用 */
  updateOnly?: boolean;
  /** 削除フラグ中は自動保存スキップ（既定: true） */
  forceSkipWhenDeleting?: boolean;
  /** セッション必須（既定: true） */
  requireSession?: boolean;
  /** hydratedになるまでは保存しない（既定: true） */
  requireHydrated?: boolean;
  /** 連続保存の最小間隔（ms）。既定: 1500 */
  minIntervalMs?: number;
  /** 「サーバ再取得中」を示すセレクタ（任意） */
  isFetchingSelector?: (strategyState: any) => boolean;
  /** 初回マウント後の猶予（ms）。既定: 1000 */
  initialDelayMs?: number;
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
    return JSON.stringify(obj, (key, value) => {
      if (value instanceof Date) return value.toISOString();
      return value;
    });
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
 * オーバーロード宣言（旧/新両対応）
 * ========================================== */
// 旧: 依存配列のみ
export function useAutoSave(deps?: any[]): void;
// 新: オプション + 依存配列
export function useAutoSave(options?: Options, deps?: any[]): void;

/**
 * 実装（ランタイムはユニオンで解釈）
 */
export function useAutoSave(arg1?: Options | any[], arg2?: any[]): void {
  const isArg1Array = Array.isArray(arg1);
  const options: Options = isArg1Array ? {} : (arg1 ?? {});
  const externalDeps: any[] = isArg1Array ? (arg1 as any[]) : (Array.isArray(arg2) ? arg2! : []);

  const {
    enabled = true,
    debounceMs = 1200,
    // updateOnly は現行ではストアに委譲しているため未使用
    // updateOnly = false,
    forceSkipWhenDeleting = true,
    requireSession = true,
    requireHydrated = true,
    minIntervalMs = 1500,
    isFetchingSelector,
    initialDelayMs = 1000,
  } = options;

  // ---- ユーザー情報 ----
  const userId = useUserStore((s) => s.user?.id);
  const companyIdFromUserStore = useUserStore((s: any) =>
    s?.membership?.companyId ?? s?.companyId ?? s?.user?.companyId ?? undefined,
  );

  // ---- Strategy の必要フィールドを個別購読 ----
  const hydrated = useStrategyStore(
    (s: any) => !!(s?.hydrated ?? s?.boot?.isHydrated),
  );
  const companyIdFromStore = useStrategyStore((s: any) => s?.companyId as string | null);
  const isFetching = useStrategyStore((s: any) =>
    typeof isFetchingSelector === 'function'
      ? !!isFetchingSelector(s)
      : !!s?.__isFetchingFromServer,
  );

  // 主要フィールド（保存対象）※シグネチャ用
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

  // companyId は store 優先
  const companyId = companyIdFromStore ?? companyIdFromUserStore;

  // 変更シグネチャ（※オブジェクトそのものではなく、安定JSONで比較）
  const internalSignature = useMemo(() => {
    const pick = {
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
    };
    return safeStableStringify(pick);
  }, [pickA, pickB, pickC, pickD, pickE, pickF, pickG, pickH, pickI, pickJ, pickK, pickL, pickM]);

  // 互換: 依存配列を与えられた場合もトリガに含める
  const depsSignature = useMemo(() => {
    if (!externalDeps || externalDeps.length === 0) return '';
    return safeStableStringify(externalDeps);
  }, [externalDeps]);

  const combinedSignature = internalSignature + '|' + depsSignature;

  // 保存中フラグ & 最終保存時刻
  const savingRef = useRef(false);
  const lastSavedAtRef = useRef<number>(0);

  // 初回猶予
  const mountedAtRef = useRef<number>(Date.now());

  const doSave = useCallback(async () => {
    try {
      if (!enabled) return;
      if (requireHydrated && !hydrated) return;
      if (!userId) return;
      if (!companyId) return;
      if (forceSkipWhenDeleting && isCompanyDeleting(companyId)) return;
      if (isFetching) return;

      // 初回マウントからの猶予時間
      if (Date.now() - mountedAtRef.current < initialDelayMs) return;

      // セッション必須ならチェック
      if (requireSession) {
        const active = await hasActiveSession();
        if (!active) return;
      }

      const now = Date.now();
      // 連続保存抑止
      if (now - lastSavedAtRef.current < (minIntervalMs ?? 1500)) return;

      // 二重保存抑止
      if (savingRef.current) return;
      savingRef.current = true;

      // ★ ここがポイント：Supabase 直叩きではなく、Zustand ストアの saveStrategyData に一本化
      const storeApi = useStrategyStore.getState();
      await storeApi.saveStrategyData();

      lastSavedAtRef.current = Date.now();
    } catch (e) {
      // ここでは詳細ログは出さず、store側のログに任せる
      // console.warn('[useAutoSave] save error:', e);
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
    requireSession,
    minIntervalMs,
    initialDelayMs,
  ]);

  /* -----------------------------
   * デバウンス（変更検知 → doSave実行）
   * --------------------------- */
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const cancel = useCallback((): void => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }, []);
  const trigger = useCallback((): void => {
    cancel();
    timerRef.current = setTimeout(() => {
      timerRef.current = null;
      void doSave();
    }, Math.max(0, debounceMs));
  }, [debounceMs, cancel, doSave]);

  useEffect(() => {
    if (!enabled) return;
    trigger();
    return cancel;
  }, [enabled, trigger, cancel, combinedSignature]);

  useEffect(() => {
    return () => {
      cancel();
    };
  }, [cancel]);
}
