// /app/layoutClient.tsx
'use client';

import React, { useEffect, useRef, useState } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import Sidebar from '@/components/Sidebar';
import CEOChatPanel from '@/components/CEOChatPanel';
import { supabase } from '@/lib/supabaseClient';
import { safeGetSession } from '@/utils/supabase/client';
import { useUserStore } from '@/store/userStore';
import { useStrategyStore } from '@/store/strategyStore';
import { CompanyProvider } from '@/context/CompanyContext';

/* ================================
 * ルート判定
 * ============================== */
const AUTH_PREFIXES = [
  '/login',
  '/register',
  '/signup',
  '/signup-admin',
  '/auth',
  '/auth/callback',
  '/auth/welcome',
  '/404',
];
const isAuthPath = (p?: string | null) => !!p && AUTH_PREFIXES.some((x) => p.startsWith(x));
const isAdminPath = (p?: string | null) => !!p && p.startsWith('/admin');

/* ================================
 * ★ 全削除フラグ（再生成ブロック）
 * ============================== */
const DELETION_FLAG_KEY = '__deleting_company__';
function isCompanyDeleting(companyId?: string) {
  try {
    const v = localStorage.getItem(DELETION_FLAG_KEY);
    return companyId ? v === companyId : !!v;
  } catch {
    return false;
  }
}

/* ================================
 * デバッグ用
 * ============================== */
function exposeError(e: any) {
  if (!e) return { message: 'unknown' };
  try {
    const out: Record<string, any> = {};
    Object.getOwnPropertyNames(e).forEach((k) => (out[k] = (e as any)[k]));
    return out;
  } catch {
    return { message: String(e) };
  }
}

/** 会社所属を安全に読むためのセレクタ */
function selectCompanyId(state: any): string | undefined {
  return (
    state?.membership?.companyId ??
    state?.companyId ??
    state?.user?.companyId ??
    undefined
  );
}

/* ===========================================================
 * メインレイアウト本体
 * =========================================================== */
function LayoutInner({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();

  /* ================================
   * User store
   * ============================== */
  const user = useUserStore((s) => s.user);
  const role = useUserStore((s) => s.role);
  const setUser = useUserStore((s) => s.setUser);
  const setRole = useUserStore((s) => s.setRole);
  const setMembership = useUserStore((s) => s.setMembership);
  const companyId = useUserStore(selectCompanyId);

  /* ================================
   * Strategy store
   * ============================== */
  const setStrategyId = useStrategyStore((s) => s.setStrategyId);

  /* ================================ */
  const mainRef = useRef<HTMLDivElement | null>(null);
  const [checking, setChecking] = useState(true);
  const [bootstrapped, setBootstrapped] = useState(false);
  const [hydrated, setHydrated] = useState(false);

  const initInFlight = useRef(false);
  const memInFlight = useRef(false);
  const provisionInFlight = useRef(false);
  const lastProvisionForCompany = useRef<string | null>(null);
  const cleaned = useRef(false);
  const routedRef = useRef(false);
  const bootstrapTimer = useRef<number | null>(null);

  /* ================================
   * デバッグマーカー
   * ============================== */
  useEffect(() => {
    const g = window as any;
    if (!g.__STRATEGY_STORE_GETSTATE__) {
      g.__STRATEGY_STORE_GETSTATE__ = useStrategyStore.getState;
      console.log('[layout] store marker set');
    }
  }, []);

  /* ================================
   * Rehydrate ガード
   * ============================== */
  useEffect(() => {
    const id = requestAnimationFrame(() => setHydrated(true));
    return () => cancelAnimationFrame(id);
  }, []);

  /* ================================
   * 事前ルートプリフェッチ
   * ============================== */
  useEffect(() => {
    router.prefetch('/login');
    router.prefetch('/');
    router.prefetch('/auth/welcome');
  }, [router]);

  /* ================================
   * スクロール復元無効化
   * ============================== */
  useEffect(() => {
    const prev = window.history.scrollRestoration;
    window.history.scrollRestoration = 'manual';
    return () => {
      window.history.scrollRestoration = prev;
    };
  }, []);

  /* ================================
   * ルート遷移ごとに main をトップへ
   * ============================== */
  useEffect(() => {
    const el = mainRef.current;
    if (!el) return;
    requestAnimationFrame(() => {
      el.scrollTo({ top: 0, left: 0, behavior: 'auto' });
      requestAnimationFrame(() => {
        el.scrollTo({ top: 0, left: 0, behavior: 'auto' });
      });
    });
  }, [pathname]);

  /* ================================
   * 6秒フェイルセーフ
   * ============================== */
  useEffect(() => {
    if (!user?.id || bootstrapped) return;
    if (bootstrapTimer.current != null) return;
    bootstrapTimer.current = window.setTimeout(() => {
      if (!cleaned.current && !bootstrapped) {
        console.warn('[bootstrap] membership timeout → force ready');
        setBootstrapped(true);
      }
    }, 6000);
    return () => {
      if (bootstrapTimer.current != null) {
        clearTimeout(bootstrapTimer.current);
        bootstrapTimer.current = null;
      }
    };
  }, [user?.id, bootstrapped]);

  /* ================================
   * 1) セッション初期確認
   * ============================== */
  useEffect(() => {
    if (initInFlight.current) return;
    initInFlight.current = true;
    const ac = new AbortController();
    const { signal } = ac;

    const finishChecking = () => {
      if (!cleaned.current) setChecking(false);
    };

    const bootstrapSession = async () => {
      try {
        const { data: sres, error: serr } = await safeGetSession(); // 互換ラッパー
        if (signal.aborted) return;

        if (serr && (serr as any)?.status !== 400) {
          console.warn('[init] getSession error:', exposeError(serr));
        }

        const session = sres?.session ?? null;
        if (!session) {
          setUser(null);
          setRole(null);
          setMembership({ companyId: undefined, departmentId: undefined });
          setStrategyId(null);
          if (!isAuthPath(pathname) && !routedRef.current) {
            routedRef.current = true;
            router.replace('/login');
          }
          return;
        }

        const uid = session.user.id;
        const email = session.user.email ?? '';
        setUser({ id: uid, email, name: '', role: 'member' });
      } finally {
        finishChecking();
      }
    };

    bootstrapSession();

    const { data: sub } = supabase.auth.onAuthStateChange((_evt, sess) => {
      if (signal.aborted) return;

      // user が無ければ未ログイン扱い（イベントコード個別比較は不要）
      if (!sess?.user) {
        setUser(null);
        setRole(null);
        setMembership({ companyId: undefined, departmentId: undefined });
        setStrategyId(null);
        setBootstrapped(true);
        if (!isAuthPath(pathname) && !routedRef.current) {
          routedRef.current = true;
          router.replace('/login');
        }
        return;
      }
      setUser({ id: sess.user.id, email: sess.user.email ?? '', name: '', role: 'member' });
      setBootstrapped(false);
    });

    return () => {
      cleaned.current = true;
      ac.abort();
      sub?.subscription?.unsubscribe?.();
      initInFlight.current = false;
    };
  }, [pathname, router, setMembership, setRole, setStrategyId, setUser]);

  /* ================================
   * 2) membership 読み込み
   * ============================== */
  useEffect(() => {
    if (!user?.id) return;
    if (memInFlight.current) return;
    memInFlight.current = true;
    const ac = new AbortController();
    const { signal } = ac;

    const loadMembership = async () => {
      try {
        const { data, error, status } = await supabase
          .from('company_members')
          .select('company_id, role')
          .eq('user_id', user.id)
          .limit(1)
          .maybeSingle();

        if (signal.aborted) return;

        if (error) {
          if (status && status !== 406) {
            console.warn('[init] company_members error:', exposeError(error), { status });
          }
          setMembership({ companyId: undefined, departmentId: undefined });
          setRole('member');
          return;
        }

        if (!data) {
          setMembership({ companyId: undefined, departmentId: undefined });
          setRole('member');
          return;
        }

        setMembership({ companyId: data.company_id ?? undefined, departmentId: undefined });
        setRole((data.role as 'admin' | 'manager' | 'member') ?? 'member');
      } finally {
        memInFlight.current = false;
        if (!cleaned.current) setBootstrapped(true);
      }
    };

    loadMembership();
    return () => {
      ac.abort();
      memInFlight.current = false;
    };
  }, [user?.id, setMembership, setRole]);

  /* ================================
   * 2.5) strategyId provision
   * ============================== */
  useEffect(() => {
    const onAuthScene = isAuthPath(pathname);
    if (!bootstrapped) return;

    // 全削除フラグONのときは provision を抑止
    if (companyId && isCompanyDeleting(companyId)) {
      if (!provisionInFlight.current) {
        console.log('[layout] skip provision (deleting company in progress):', companyId);
        setStrategyId(null);
      }
      return;
    }

    if (!companyId) {
      setStrategyId(null);
      return;
    }
    if (onAuthScene) return;
    if (provisionInFlight.current) return;
    if (lastProvisionForCompany.current === companyId) return;

    provisionInFlight.current = true;
    const ac = new AbortController();
    const { signal } = ac;

    (async () => {
      try {
        const res = await fetch('/api/companies/provision', { method: 'POST', signal });
        const json = await res.json().catch(() => null);
        if (signal.aborted) return;

        if (json?.ok) {
          if (json.companyId && json.companyId !== companyId) {
            useUserStore
              .getState()
              .setMembership({ companyId: json.companyId, departmentId: undefined });
          }
          setStrategyId(json.strategyId ?? null);
          lastProvisionForCompany.current = json.companyId ?? companyId;
        } else {
          console.warn('[layout] provision response not ok:', json);
          setStrategyId(null);
        }
      } catch (e) {
        if (!signal.aborted) {
          console.warn('[layout] provision failed:', exposeError(e));
          setStrategyId(null);
        }
      } finally {
        provisionInFlight.current = false;
      }
    })();

    return () => {
      ac.abort();
      provisionInFlight.current = false;
    };
  }, [bootstrapped, companyId, pathname, setStrategyId]);

  /* ================================
   * 3) ルーティング制御
   * ============================== */
  useEffect(() => {
    if (checking) return;
    if (routedRef.current) return;

    const authed = !!user?.id;
    const onAuthScene = isAuthPath(pathname);

    if (!authed && !onAuthScene) {
      routedRef.current = true;
      router.replace('/login');
      return;
    }
    if (authed && !onAuthScene && bootstrapped && !companyId) {
      routedRef.current = true;
      router.replace('/auth/welcome');
      return;
    }
    if (authed && isAdminPath(pathname) && bootstrapped) {
      const r = (role ?? 'member') as 'admin' | 'manager' | 'member';
      if (r !== 'admin') {
        routedRef.current = true;
        router.replace('/');
        return;
      }
    }
  }, [checking, bootstrapped, user?.id, pathname, router, role, companyId]);

  /* ================================
   * 表示制御
   * ============================== */
  const hideSidebar = isAuthPath(pathname);
  const leftVar = 'var(--left-w, 0px)';
  const rightVar = 'var(--right-w, 0px)';
  const [openLeft, setOpenLeft] = useState(false);
  const [openRight, setOpenRight] = useState(false);

  const deletingNow = companyId ? isCompanyDeleting(companyId) : false;
  if (!hideSidebar && (checking || !hydrated)) {
    return (
      <div className="grid min-h-dvh place-items-center text-sm text-gray-500">
        初期化中…
      </div>
    );
  }
  if (!hideSidebar && deletingNow) {
    return (
      <div className="grid min-h-dvh place-items-center text-sm text-gray-500">
        会社データを削除中です…（完了までプロビジョンと自動保存を停止）
      </div>
    );
  }

  return (
    <div
      className={[
        'relative min-h-dvh overflow-hidden',
        '[--left-w:0] [--right-w:0]',
        'lg:[--left-w:16rem] lg:[--right-w:16rem]',
        'xl:[--left-w:18rem] xl:[--right-w:18rem]',
      ].join(' ')}
    >
      {/* 左サイドバー */}
      {!hideSidebar && (
        <>
          <div className="hidden lg:block fixed left-0 top-0 z-10 h-dvh w-[var(--left-w)]">
            <Sidebar />
          </div>

          <div
            className={[
              'lg:hidden fixed inset-0 z-40',
              openLeft ? 'pointer-events-auto' : 'pointer-events-none',
            ].join(' ')}
            aria-hidden={!openLeft}
          >
            <div
              className={[
                'absolute inset-0 bg-black/40 transition-opacity',
                openLeft ? 'opacity-100' : 'opacity-0',
              ].join(' ')}
              onClick={() => setOpenLeft(false)}
            />
            <div
              className={[
                'absolute left-0 top-0 h-dvh w-[16rem] max-w-[80vw]',
                'bg-white shadow-xl border-r border-black/5',
                'transition-transform duration-200',
                openLeft ? 'translate-x-0' : '-translate-x-full',
              ].join(' ')}
            >
              <Sidebar />
            </div>
          </div>
        </>
      )}

      {/* 右AIドック */}
      {!hideSidebar && (
        <>
          <aside
            className={[
              'hidden lg:flex fixed top-0 right-0 z-10 h-dvh',
              'border-l border-black/5 bg-white/70 backdrop-blur-md supports-[backdrop-filter]:bg-white/60',
              'shadow-[0_0_24px_rgba(0,0,0,0.04)]',
              'flex-col box-border overflow-hidden',
              'w-[var(--right-w)]',
            ].join(' ')}
          >
            <div className="min-h-0 flex-1 overflow-y-auto">
              <div className="ml-auto w-full h-full max-w-[var(--right-w)] [&>*]:w-full [&>*]:max-w-none [&>*]:ml-0">
                <CEOChatPanel />
              </div>
            </div>
          </aside>

          <div
            className={[
              'lg:hidden fixed inset-0 z-40',
              openRight ? 'pointer-events-auto' : 'pointer-events-none',
            ].join(' ')}
            aria-hidden={!openRight}
          >
            <div
              className={[
                'absolute inset-0 bg-black/40 transition-opacity',
                openRight ? 'opacity-100' : 'opacity-0',
              ].join(' ')}
              onClick={() => setOpenRight(false)}
            />
            <div
              className={[
                'absolute right-0 top-0 h-dvh w-[16rem] max-w-[90vw]',
                'bg-white shadow-xl border-l border-black/5',
                'transition-transform duration-200',
                openRight ? 'translate-x-0' : 'translate-x-full',
              ].join(' ')}
            >
              <div className="min-h-0 flex-1 overflow-y-auto">
                <div className="[&>*]:w-full [&>*]:max-w-none [&>*]:ml-0">
                  <CEOChatPanel />
                </div>
              </div>
            </div>
          </div>
        </>
      )}

      {/* メイン */}
      <main
        id="app-scroll"
        ref={mainRef}
        className={[
          'absolute inset-0 overflow-y-auto overflow-x-hidden',
          'bg-gradient-to-b from-white to-slate-50/60',
          'p-3 sm:p-4 md:p-6 lg:p-8 pb-[calc(2rem+env(safe-area-inset-bottom))]',
          'min-w-0',
        ].join(' ')}
        style={{
          marginLeft: !hideSidebar ? 'var(--left-w)' : undefined,
          marginRight: !hideSidebar ? 'var(--right-w)' : undefined,
        }}
      >
        {!hideSidebar && (
          <div className="lg:hidden sticky top-0 z-20 -mt-3 -mx-3 sm:-mx-4 md:-mx-6 mb-3 sm:mb-4 bg-white/70 backdrop-blur supports-[backdrop-filter]:bg-white/60 border-b border-black/5">
            <div className="px-3 sm:px-4 md:px-6 py-2 flex items-center justify-between">
              <button
                onClick={() => setOpenLeft(true)}
                className="rounded-lg border border-black/10 px-3 py-1.5 text-sm shadow-sm bg-white active:scale-[0.99]"
              >
                メニュー
              </button>
              <button
                onClick={() => setOpenRight(true)}
                className="rounded-lg border border-black/10 px-3 py-1.5 text-sm shadow-sm bg-white active:scale-[0.99]"
              >
                AIアシスタント
              </button>
            </div>
          </div>
        )}

        {children}
      </main>
    </div>
  );
}

/* ===========================================================
 * CompanyProviderで全体を包む
 * =========================================================== */
export default function LayoutClient({ children }: { children: React.ReactNode }) {
  return (
    <CompanyProvider>
      <LayoutInner>{children}</LayoutInner>
    </CompanyProvider>
  );
}
