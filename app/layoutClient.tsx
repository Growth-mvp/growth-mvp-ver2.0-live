// /app/layoutClient.tsx
'use client';

import React, { useEffect, useRef, useState } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import Sidebar from '@/components/Sidebar';
import CEOChatPanel from '@/components/CEOChatPanel';
import { supabase } from '@/lib/supabaseClient';
import { useUserStore } from '@/store/userStore';
import { useStrategyStore } from '@/store/strategyStore';

const AUTH_PREFIXES = [
  '/login',
  '/register',
  '/signup',
  '/signup-admin',
  '/auth',
  '/auth/callback',
  '/auth/welcome', // 認証系扱い（サイドバー非表示）
  '/404',
];

const isAuthPath = (p?: string | null) => !!p && AUTH_PREFIXES.some((x) => p.startsWith(x));
const isAdminPath = (p?: string | null) => !!p && p.startsWith('/admin');

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

export default function LayoutClient({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();

  // ===== User store =====
  const user = useUserStore((s) => s.user);
  const role = useUserStore((s) => s.role);
  const setUser = useUserStore((s) => s.setUser);
  const setRole = useUserStore((s) => s.setRole);
  const setMembership = useUserStore((s) => s.setMembership);

  const companyId = useUserStore(selectCompanyId);

  // ===== Strategy store =====
  const setStrategyId = useStrategyStore((s) => s.setStrategyId);

  // layout 側で “同一ストア識別子” を刻印（Panel と一致するか確認用）
  useEffect(() => {
    const g = (window as any);
    if (!g.__STRATEGY_STORE_GETSTATE__) {
      g.__STRATEGY_STORE_GETSTATE__ = useStrategyStore.getState;
      console.log('[layout] store marker set');
    } else {
      console.log(
        '[layout] store marker already set, same =',
        g.__STRATEGY_STORE_GETSTATE__ === useStrategyStore.getState
      );
    }
  }, []);

  // ===== Guard state =====
  const [checking, setChecking] = useState(true);          // セッション判定中
  const [bootstrapped, setBootstrapped] = useState(false); // membership 同期完了

  // StrictMode/再入対策
  const initInFlight = useRef(false);
  const memInFlight = useRef(false);
  const cleaned = useRef(false);
  const routedRef = useRef(false);

  // membership待ちフェイルセーフ
  const bootstrapTimer = useRef<number | null>(null);

  // provision 多重実行ガード
  const provisionInFlight = useRef(false);
  const lastProvisionForCompany = useRef<string | null>(null);

  // 事前フェッチ
  useEffect(() => {
    router.prefetch('/login');
    router.prefetch('/');
    router.prefetch('/auth/welcome');
  }, [router]);

  /** 6秒フェイルセーフ：user がいても membership/companyId が上がらない時に UI を ready 化 */
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

  // 1) セッション初期確認 + 監視
  useEffect(() => {
    if (initInFlight.current) return;
    initInFlight.current = true;

    const ac = new AbortController();
    const signal = ac.signal;

    const finishChecking = () => {
      if (!cleaned.current) setChecking(false);
    };

    const bootstrapSession = async () => {
      try {
        const { data: sres, error: serr } = await supabase.auth.getSession();
        if (signal.aborted) return;

        if (serr && serr?.status !== 400) {
          console.warn('[init] getSession error:', exposeError(serr));
        }

        const session = sres?.session ?? null;

        if (!session) {
          // 未ログイン：store クリア
          setUser(null);
          setRole(null);
          setMembership({ companyId: undefined, departmentId: undefined });
          setStrategyId(null); // 戦略IDもクリア

          if (!isAuthPath(pathname) && !routedRef.current) {
            routedRef.current = true;
            router.replace('/login');
          }
          return;
        }

        // ログイン中：ユーザー情報セット
        const uid = session.user.id;
        const email = session.user.email ?? '';

        setUser({
          id: uid,
          email,
          name: '',
          role: 'member', // 仮置き。membership で上書き
        });
      } finally {
        finishChecking();
      }
    };

    // 初回実行
    bootstrapSession();

    // セッション変化に追従
    const { data: sub } = supabase.auth.onAuthStateChange((_evt, sess) => {
      if (signal.aborted) return;

      if (!sess?.user) {
        // ログアウト
        setUser(null);
        setRole(null);
        setMembership({ companyId: undefined, departmentId: undefined });
        setStrategyId(null);
        setBootstrapped(true); // UIは進める
        if (!isAuthPath(pathname) && !routedRef.current) {
          routedRef.current = true;
          router.replace('/login');
        }
        return;
      }

      // ログイン/トークン更新
      setUser({
        id: sess.user.id,
        email: sess.user.email ?? '',
        name: '',
        role: 'member',
      });
      setBootstrapped(false);
    });

    return () => {
      cleaned.current = true;
      ac.abort();
      sub?.subscription?.unsubscribe?.();
      initInFlight.current = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // 初回のみ

  // 2) membership 読み込み（user.id が確定してから）
  useEffect(() => {
    if (!user?.id) return;
    if (memInFlight.current) return;
    memInFlight.current = true;

    const ac = new AbortController();
    const signal = ac.signal;

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
          // 所属なし
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

  // 2.5) strategyId provision：bootstrapped かつ companyId 確定、認証系画面以外のみ
  useEffect(() => {
    const onAuthScene = isAuthPath(pathname);
    if (!bootstrapped) {
      console.log('[layout] skip provision: bootstrapped=false');
      return;
    }
    if (!companyId) {
      // 所属不明：一旦クリア
      setStrategyId(null);
      return;
    }
    if (onAuthScene) return;

    // 同じ companyId で多重呼び出ししない
    if (provisionInFlight.current) return;
    if (lastProvisionForCompany.current === companyId) {
      console.log('[layout] skip provision: already provisioned for', companyId);
      return;
    }

    console.log('[layout] companyId, bootstrapped =', companyId, bootstrapped);

    provisionInFlight.current = true;
    const ac = new AbortController();
    const { signal } = ac;

    (async () => {
      try {
        const res = await fetch('/api/companies/provision', { method: 'POST', signal });
        const json = await res.json().catch(() => null);

        // 期待: { ok: true, companyId: '...', strategyId: '...', note: '...' }
        console.log('[layout] provision json =', json ?? 'null');
        if (signal.aborted) return;

        if (json?.ok) {
          // 念のため companyId の整合
          if (json.companyId && json.companyId !== companyId) {
            useUserStore.getState().setMembership({
              companyId: json.companyId,
              departmentId: undefined,
            });
          }

          console.log('[layout] setStrategyId(', json.strategyId, ')');
          setStrategyId(json.strategyId ?? null);

          // 反映確認（read-back）
          const readBack = useStrategyStore.getState().strategyId;
          console.log('[layout] read-back strategyId =', readBack);

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

  // 3) ルーティング制御（checking 完了後）
  useEffect(() => {
    if (checking) return; // セッション未判定
    if (routedRef.current) return;

    const authed = !!user?.id;
    const onAuthScene = isAuthPath(pathname);

    // 未ログインで保護ルート → /login
    if (!authed && !onAuthScene) {
      routedRef.current = true;
      router.replace('/login');
      return;
    }

    // ログイン済みで所属なし → /auth/welcome
    if (authed && !onAuthScene && bootstrapped && !companyId) {
      routedRef.current = true;
      router.replace('/auth/welcome');
      return;
    }

    // /admin は admin のみ
    if (authed && isAdminPath(pathname) && bootstrapped) {
      const r = (role ?? 'member') as 'admin' | 'manager' | 'member';
      if (r !== 'admin') {
        routedRef.current = true;
        router.replace('/');
        return;
      }
    }
  }, [checking, bootstrapped, user?.id, pathname, router, role, companyId]);

  // ==== 表示制御 ====
  const hideSidebar = isAuthPath(pathname);

  // Sidebar と CEOChatPanel を同幅に揃える（base:16rem=64、md:18rem=72）
  // ここで定義した CSS 変数 --pane-w を本文左右の margin にも共用
  const dockWidthExpr = 'var(--pane-w, 16rem)';

  // 認証チェック中のみローディング
  if (!hideSidebar && checking) {
    return (
      <div className="grid min-h-dvh place-items-center text-sm text-gray-500">
        初期化中…
      </div>
    );
  }

  return (
    // ▼ base: 16rem (=w-64), md以上: 18rem (=w-72)
    <div
      className={[
        'relative min-h-dvh overflow-hidden',
        '[--pane-w:16rem] md:[--pane-w:18rem]',
      ].join(' ')}
    >
      {/* 左サイドバー（内部はおそらく w-64 md:w-72） */}
      {!hideSidebar && <Sidebar />}

      {/* 右ドック：Sidebar と同幅に統一 */}
      {!hideSidebar && (
        <aside
          className={[
            'fixed top-0 right-0 z-10 h-dvh',
            'border-l border-black/5 bg-white/70 backdrop-blur-md supports-[backdrop-filter]:bg-white/60',
            'shadow-[0_0_24px_rgba(0,0,0,0.04)]',
            'flex flex-col box-border overflow-hidden',
          ].join(' ')}
          style={{ width: dockWidthExpr }}
          aria-label="AIアシスタントドック"
        >
          <div className="min-h-0 flex-1 overflow-y-auto">
            <div
              className={[
                'ml-auto w-full h-full',
                'max-w-[var(--pane-w)]',
                '[&>*]:w-full [&>*]:max-w-none [&>*]:ml-0',
              ].join(' ')}
            >
              <CEOChatPanel />
            </div>
          </div>
        </aside>
      )}

      {/* メイン：左右のマージンを --pane-w で同期（Sidebar・Dock と完全一致） */}
      <main
        className={[
          'absolute inset-0 overflow-y-auto overflow-x-hidden',
          'bg-gradient-to-b from-white to-slate-50/60',
          'p-4 md:p-8 pb-[calc(2rem+env(safe-area-inset-bottom))]',
          'min-w-0',
        ].join(' ')}
        style={{
          marginLeft: !hideSidebar ? dockWidthExpr : undefined,
          marginRight: !hideSidebar ? dockWidthExpr : undefined,
        }}
        role="main"
        aria-live="polite"
      >
        {children}
      </main>
    </div>
  );
}
