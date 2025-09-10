// /lib/supabaseClient.ts（フル置き換え）
'use client';

import { createBrowserClient } from '@supabase/ssr';
import type { SupabaseClient, Session } from '@supabase/supabase-js';

declare global {
  // eslint-disable-next-line no-var
  var __growth_supabase__: SupabaseClient | undefined;
  // ガード多重登録防止
  // eslint-disable-next-line no-var
  var __growth_supabase_guards_attached__: boolean | undefined;
}

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseAnon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

// fail-fast（設定漏れは即検知）
if (!supabaseUrl || !supabaseAnon) {
  throw new Error(
    'Supabase env is missing: set NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY in .env.local'
  );
}

/** ブラウザ用クライアント（@supabase/ssr / シングルトン）
 *  - これにより HTTP-Only Cookie がサーバーへ同期され、/lib/supabaseServer.ts 側で正しく読める
 */
export function getSupabaseClient(): SupabaseClient {
  if (!globalThis.__growth_supabase__) {
    globalThis.__growth_supabase__ = createBrowserClient(supabaseUrl!, supabaseAnon!, {
      // App Router では client 側は cookies オプション指定不要でOK
      // （サーバー側は /lib/supabaseServer.ts で cookies() を扱う）
    });
  }
  return globalThis.__growth_supabase__!;
}

/** 表示用Cookie（自前）を掃除：SupabaseのセッションCookieではない */
export function clearDisplayCookies() {
  try {
    // 以前の名称や現在使用中の名称をまとめて掃除
    document.cookie = 'user_id=; Path=/; Max-Age=0; SameSite=Lax';
    document.cookie = 'user_role=; Path=/; Max-Age=0; SameSite=Lax';
    document.cookie = 'company_id=; Path=/; Max-Age=0; SameSite=Lax';
  } catch {
    /* noop */
  }
}

/** ローカルのみサインアウト→ログインへ（トークン不整合時の安全退避） */
export async function signOutLocalAndRedirect(redirectTo: string = '/login?reason=expired') {
  const supabase = getSupabaseClient();
  try {
    await supabase.auth.signOut({ scope: 'local' }); // ← 重要：local（HTTPOnly Cookieは触らない）
  } catch {
    /* noop */
  } finally {
    clearDisplayCookies();
    if (typeof window !== 'undefined') {
      window.location.replace(redirectTo);
    }
  }
}

/** Magic Link のハッシュを綺麗に消す（任意） */
function scrubMagicLinkHash() {
  try {
    if (typeof window === 'undefined') return;
    if (window.location.hash.includes('access_token')) {
      history.replaceState({}, document.title, window.location.pathname + window.location.search);
    }
  } catch {
    /* noop */
  }
}

/**
 * 起動時に一度だけ呼ぶガード（クライアントのみ想定）。
 * - onAuthStateChange：SIGNED_OUT 時の後処理（表示用Cookieを掃除）
 * - フォーカス/可視化時に getSession() を軽くプローブし、失敗なら安全にサインアウト
 * 返り値：デタッチ関数（任意で呼び出し元がクリーンアップ可能）
 */
export function attachAuthGuards() {
  if (globalThis.__growth_supabase_guards_attached__) return;
  globalThis.__growth_supabase_guards_attached__ = true;

  const supabase = getSupabaseClient();

  const authSub = supabase.auth.onAuthStateChange((event /*, session */) => {
    if (event === 'SIGNED_OUT') {
      clearDisplayCookies();
    }
    // TOKEN_REFRESHED は通知のみ、特に処理不要
  });

  // セッション健全性の軽量チェック
  const probe = async () => {
    try {
      const { data, error } = await supabase.auth.getSession();
      if (error) {
        await signOutLocalAndRedirect('/login?reason=expired');
        return;
      }
      // data.session === null は未ログイン。ここでは何もしない。
      scrubMagicLinkHash();
    } catch {
      await signOutLocalAndRedirect('/login?reason=expired');
    }
  };

  if (typeof window !== 'undefined') {
    // 起動時に1回チェック
    void probe();

    // フォーカス復帰時（古いタブ対策）
    const onFocus = () => void probe();
    window.addEventListener('focus', onFocus);

    // 可視化時（バックグラウンド復帰対策）
    const onVisible = () => {
      if (document.visibilityState === 'visible') void probe();
    };
    document.addEventListener('visibilitychange', onVisible);

    // オプション：デタッチ関数を返す（HMRや明示的解除用）
    return () => {
      authSub.data?.subscription?.unsubscribe?.();
      window.removeEventListener('focus', onFocus);
      document.removeEventListener('visibilitychange', onVisible);
      globalThis.__growth_supabase_guards_attached__ = false;
    };
  }
}

/** 便利ヘルパ：APIや初期化で安全にセッション取得 */
export async function safeGetSession(): Promise<{ ok: boolean; session: Session | null }> {
  const supabase = getSupabaseClient();
  try {
    const { data, error } = await supabase.auth.getSession();
    if (error) {
      await supabase.auth.signOut({ scope: 'local' });
      clearDisplayCookies();
      return { ok: false, session: null };
    }
    return { ok: true, session: data.session };
  } catch {
    await supabase.auth.signOut({ scope: 'local' });
    clearDisplayCookies();
    return { ok: false, session: null };
  }
}

// 既存互換：そのまま import { supabase } でも使える
export const supabase = getSupabaseClient();

// 追加：default export も提供（既存コードの互換性を最大化）
export default supabase;
