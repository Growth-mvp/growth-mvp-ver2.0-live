// /hooks/useAutoSave.ts
'use client';

import { useCallback, useEffect, useMemo, useRef } from 'react';
import { saveStrategyData, getFullStrategyDataByCompany } from '@/utils/supabase/strategy';
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
  /** 既存行がある場合のみ UPDATE（INSERTしない） */
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
    const v = typeof localStorage !== 'undefined'
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

/** undefined/null を深い階層まで除去（“意図しない上書き”防止） */
function pruneUndefinedDeep<T = any>(input: T): T {
  if (Array.isArray(input)) {
    // @ts-ignore
    return input.map((v) => pruneUndefinedDeep(v)).filter((v) => v !== undefined) as T;
  }
  if (input && typeof input === 'object') {
    const obj = input as any;
    const entries = Object.entries(obj)
      .filter(([, v]) => v !== undefined)
      .map(([k, v]) => [k, pruneUndefinedDeep(v)]);
    // @ts-ignore
    return Object.fromEntries(entries);
  }
  return input;
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

/** PostgRESTの「条件UPDATEで0行だった」系かどうかの判定（rev不一致など） */
function isOptimisticConflict(err: any): boolean {
  const code = err?.code ?? err?.status;
  const msg: string = err?.message ?? '';
  return (
    code === 'PGRST116' ||
    code === 406 ||
    /no\s+rows\s+returned/i.test(msg) ||
    /multiple\s*\(or\s*no\)\s*rows\s*returned/i.test(msg)
  );
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
export function useAutoSave(
  arg1?: Options | any[],
  arg2?: any[],
): void {
  const isArg1Array = Array.isArray(arg1);
  const options: Options = isArg1Array ? {} : (arg1 ?? {});
  const externalDeps: any[] = isArg1Array ? (arg1 as any[]) : (Array.isArray(arg2) ? arg2! : []);

  const {
    enabled = true,
    debounceMs = 1200,
    updateOnly = false,
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
    s?.membership?.companyId ?? s?.companyId ?? s?.user?.companyId ?? undefined
  );

  // ---- Strategy の必要フィールドを個別購読（※オブジェクトselectorを使わない）----
  const hydrated = useStrategyStore((s: any) => !!s?.hydrated);
  const revision: number | undefined = useStrategyStore((s: any) => s?.revision);
  const companyIdFromStore = useStrategyStore((s: any) => s?.companyId as string | null);
  const isFetching = useStrategyStore((s: any) =>
    typeof isFetchingSelector === 'function' ? !!isFetchingSelector(s) : !!s?.__isFetchingFromServer
  );
  const afterSave = useStrategyStore((s: any) => s?.__afterSave as (undefined | ((d: any)=>void)));

  // 主要フィールド（保存対象）
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
  const pickM = useStrategyStore((s: any) => s?.simulationResults ?? s?.simulationResult);

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

  // 直近の認証エラー抑止（一定時間は保存を止める）
  const authErrorUntilRef = useRef<number>(0);
  const AUTH_SUPPRESS_MS = 15_000; // 15秒

  // 初回猶予
  const mountedAtRef = useRef<number>(Date.now());

  const doSave = useCallback(async () => {
    try {
      // 基本ガード
      if (!enabled) return;
      if (requireHydrated && !hydrated) return;
      if (!userId) return;
      if (!companyId) return;
      if (forceSkipWhenDeleting && isCompanyDeleting(companyId)) return;
      if (isFetching) return;

      // 初回猶予
      if (Date.now() - mountedAtRef.current < initialDelayMs) return;

      // セッション必須ならチェック
      if (requireSession) {
        const active = await hasActiveSession();
        if (!active) return;
      }

      // 認証エラー抑止ウィンドウ
      const now = Date.now();
      if (authErrorUntilRef.current > now) return;

      // 連打抑止
      if (now - lastSavedAtRef.current < (minIntervalMs ?? 1500)) return;

      // 2重保存抑止
      if (savingRef.current) return;
      savingRef.current = true;

      // 送信前サニタイズ
      const payload = pruneUndefinedDeep({
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
      });

      let res = await (saveStrategyData as any)(
        payload,
        userId,
        null, // companyIdOverride: 内部解決
        revision,
        { mode: updateOnly ? 'updateOnly' : 'upsert' }
      );

      // 競合（rev不一致など）なら 1回だけ最新版を取得して再保存
      if (res?.error && isOptimisticConflict(res.error)) {
        const latest = await getFullStrategyDataByCompany(companyId);
        if (!latest.error && latest.data) {
          const nextRev = (latest.data as any)?.revision;
          res = await (saveStrategyData as any)(
            payload,
            userId,
            null,
            typeof nextRev === 'number' ? nextRev : undefined,
            { mode: updateOnly ? 'updateOnly' : 'upsert' }
          );
        }
      }

      lastSavedAtRef.current = Date.now();

      if (res?.error) {
        const status = res?.error?.status ?? res?.error?.code ?? res?.error?.statusCode;
        if (status === 401 || status === 400) {
          authErrorUntilRef.current = Date.now() + AUTH_SUPPRESS_MS;
        }
        return;
      }

      if (res?.data && typeof afterSave === 'function') {
        try {
          afterSave(res.data);
        } catch {
          /* noop */
        }
      }
    } catch (e: any) {
      const msg: string = e?.message ?? '';
      if (/Invalid\s+Refresh\s+Token/i.test(msg) || /JWT/i.test(msg) || e?.status === 401 || e?.status === 400) {
        authErrorUntilRef.current = Date.now() + AUTH_SUPPRESS_MS;
      }
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
    revision,
    updateOnly,
    minIntervalMs,
    initialDelayMs,
    afterSave,
    // 依存：購読値
    pickA, pickB, pickC, pickD, pickE, pickF, pickG, pickH, pickI, pickJ, pickK, pickL, pickM,
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
