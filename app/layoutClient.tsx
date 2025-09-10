// /app/layoutClient.tsx
'use client';

import React, { useEffect, useRef, useState } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import Sidebar from '@/components/Sidebar';
import CEOChatPanel from '@/components/CEOChatPanel';
import { supabase } from '@/lib/supabaseClient';
import { useUserStore } from '@/store/userStore';

const AUTH_PREFIXES = [
  '/login',
  '/register',
  '/signup',
  '/signup-admin',
  '/auth',
  '/auth/callback',
  '/auth/welcome', // ← 追加：ウェルカムも認証系扱い（サイドバー非表示）
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

/**
 * ストアの“会社所属”を安全に読むためのセレクタ。
 * - membership?.companyId があればそれを返す
 * - なければ companyId 単体、user?.companyId など将来拡張も吸収
 * - 型揺れを許容するため any を限定使用（UI側TSエラー回避）
 */
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

  // ===== Store =====
  const user = useUserStore((s) => s.user);
  const role = useUserStore((s) => s.role);
  const setUser = useUserStore((s) => s.setUser);
  const setRole = useUserStore((s) => s.setRole); // 'admin' | 'manager' | 'member' | null
  const setMembership = useUserStore((s) => s.setMembership); // { companyId?: string; departmentId?: string }

  // “会社所属の有無”を型に縛られず取得
  const companyId = useUserStore(selectCompanyId);

  // ===== Guard state =====
  const [checking, setChecking] = useState(true);          // セッション判定中のみ true
  const [bootstrapped, setBootstrapped] = useState(false); // membership 同期完了フラグ

  // StrictMode/再入対策フラグ
  const initInFlight = useRef(false);
  const memInFlight = useRef(false);
  const cleaned = useRef(false);
  const routedRef = useRef(false);

  // 単一タイムアウト（membership待ちフェイルセーフ）
  const bootstrapTimer = useRef<number | null>(null);

  // 事前フェッチ
  useEffect(() => {
    router.prefetch('/login');
    router.prefetch('/');
    router.prefetch('/auth/welcome'); // ← 追加
  }, [router]);

  /** 6秒フェイルセーフ：user がいても membership/companyId が上がらない時に UI を ready 化 */
  useEffect(() => {
    if (!user?.id || bootstrapped) return;
    if (bootstrapTimer.current != null) return;

    bootstrapTimer.current = window.setTimeout(() => {
      if (!cleaned.current && !bootstrapped) {
        console.warn('[bootstrap] membership timeout → force ready');
        setBootstrapped(true); // UIは進める
      }
    }, 6000);

    return () => {
      if (bootstrapTimer.current != null) {
        clearTimeout(bootstrapTimer.current);
        bootstrapTimer.current = null;
      }
    };
  }, [user?.id, bootstrapped]);

  // 1) セッション初期確認 + 監視（onAuthStateChange）
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
          // 未ログイン：storeクリア→保護ページなら /login
          setUser(null);
          setRole(null);
          setMembership({ companyId: undefined, departmentId: undefined });

          if (!isAuthPath(pathname) && !routedRef.current) {
            routedRef.current = true;
            router.replace('/login');
          }
          return;
        }

        // ログイン中：ユーザー情報セット（emailはセッションから）
        const uid = session.user.id;
        const email = session.user.email ?? '';

        setUser({
          id: uid,
          email,
          name: '',
          role: 'member', // 仮置き。membershipで上書き
        });

        // membership を別エフェクトで取得するため、ここでは終わり
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
        setBootstrapped(true); // UIは進める
        if (!isAuthPath(pathname) && !routedRef.current) {
          routedRef.current = true;
          router.replace('/login');
        }
        return;
      }

      // ログイン（またはトークン更新）→ user反映 & membership再取得へ
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
          // RLS等の可能性。UIは先に進める（ウェルカム誘導は後段で）
          if (status && status !== 406) {
            console.warn('[init] company_members error:', exposeError(error), { status });
          }
          setMembership({ companyId: undefined, departmentId: undefined });
          setRole('member');
          return;
        }

        if (!data) {
          // 所属なし：正常
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

  // 3) ルーティング制御（checking 完了後に判定）
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

    // ログイン済みで所属なし → /auth/welcome（ただし認証系画面は除外）
    if (authed && !onAuthScene && bootstrapped && !companyId) {
      routedRef.current = true;
      router.replace('/auth/welcome');
      return;
    }

    // /admin は admin のみ（bootstrapped 後にロール判定）
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
  const dockWidthExpr = 'min(calc(100vw - 8px), var(--agent-dock-w, 360px))';

  // ローディングは “認証チェック中のみ” に限定
  if (!hideSidebar && checking) {
    return (
      <div className="grid min-h-dvh place-items-center text-sm text-gray-500">
        初期化中…
      </div>
    );
  }

  return (
    <div className="relative min-h-dvh overflow-hidden">
      {!hideSidebar && <Sidebar />}

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
                'max-w-[var(--agent-dock-w,360px)]',
                '[&>*]:w-full [&>*]:max-w-none [&>*]:ml-0',
              ].join(' ')}
            >
              <CEOChatPanel />
            </div>
          </div>
        </aside>
      )}

      <main
        className={[
          'absolute inset-0 overflow-y-auto overflow-x-hidden',
          'bg-gradient-to-b from-white to-slate-50/60',
          'p-4 md:p-8 pb-[calc(2rem+env(safe-area-inset-bottom))]',
          'min-w-0',
          !hideSidebar ? 'ml-64 md:ml-72' : '',
        ].join(' ')}
        style={{ marginRight: !hideSidebar ? `calc(${dockWidthExpr})` : undefined }}
        role="main"
        aria-live="polite"
      >
        {children}
      </main>
    </div>
  );
}
