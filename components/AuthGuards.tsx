// /components/AuthGuards.tsx
'use client';

import { useEffect } from 'react';
import {
  supabase,
  safeGetSession,
  signOutLocalAndRedirect,
  clearAllSupabaseLikeStorage,
  clearDisplayCookies,
} from '@/utils/supabase/client';

/**
 * Headless auth watcher:
 * - 起動時 / フォーカス復帰時に軽く getSession() をプローブ
 * - Refresh Token 破損などで取得に失敗したら安全にローカルサインアウト → /login へ
 * - auth state 変化を window のカスタムイベントで通知（必要なら他所で購読）
 */
export default function AuthGuards() {
  useEffect(() => {
    let mounted = true;

    const probe = async () => {
      // セッション取得（safe wrapper）
      const { ok } = await safeGetSession(supabase);
      if (!ok && mounted) {
        // PUBLIC ページ（未認証でアクセス可能）は スキップ
        if (typeof location !== 'undefined') {
          const path = location.pathname || '';
          const isPublicPage = /^\/(login|signup|welcome|terms|privacy|contact)/.test(path);
          if (isPublicPage) {
            return;
          }
        }
        // セッションが壊れている／取得不可 → ローカルクリーン＆ログインへ
        await signOutLocalAndRedirect('/login');
      }
    };

    // 起動時に一度実行
    probe().catch(() => {});

    // フォーカス復帰 / タブ可視化で再プローブ（HMRやスリープ復帰対策）
    const onFocus = () => probe();
    const onVisible = () => {
      if (document.visibilityState === 'visible') probe();
    };
    window.addEventListener('focus', onFocus);
    document.addEventListener('visibilitychange', onVisible);

    // 認証状態の購読
    const { data } = supabase.auth.onAuthStateChange((event, session) => {
      if (!mounted) return;

      // アプリ全体に通知（必要に応じて任意の場所で監視）
      try {
        window.dispatchEvent(
          new CustomEvent('auth:state', {
            detail: { event, session },
          }),
        );
      } catch {
        /* noop */
      }

      // サインアウト時：ストレージ掃除＋必要ならリダイレクト
      if (event === 'SIGNED_OUT') {
        try {
          clearAllSupabaseLikeStorage();
          clearDisplayCookies();
        } catch {
          /* noop */
        }
        // 既に /login 等なら何もしない
        if (typeof location !== 'undefined') {
          const path = location.pathname || '';
          const isAuthPage = /^\/(login|signup|welcome|terms|privacy|contact)/.test(path);
          if (!isAuthPage) {
            // 軽い遅延で画面遷移（UI反映の猶予）
            setTimeout(() => {
              try {
                location.assign('/login');
              } catch {
                /* noop */
              }
            }, 0);
          }
        }
      }
    });

    return () => {
      mounted = false;
      try {
        data.subscription.unsubscribe();
      } catch {
        /* noop */
      }
      window.removeEventListener('focus', onFocus);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, []);

  // UI は描画しない（ヘッドレス）
  return null;
}
