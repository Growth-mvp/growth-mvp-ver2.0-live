// /lib/supabaseClient.ts（堅牢化・互換維持）
'use client';

import { createBrowserClient } from '@supabase/ssr';
import type { SupabaseClient, Session } from '@supabase/supabase-js';

declare global {
  // eslint-disable-next-line no-var
  var __growth_supabase__: SupabaseClient | undefined;
  // eslint-disable-next-line no-var
  var __growth_supabase_guards_attached__: boolean | undefined;
}

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseAnon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseAnon) {
  throw new Error(
    'Supabase env is missing: set NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY in .env.local'
  );
}

/** ブラウザ用クライアント（@supabase/ssr / シングルトン） */
export function getSupabaseClient(): SupabaseClient {
  if (!globalThis.__growth_supabase__) {
    globalThis.__growth_supabase__ = createBrowserClient(supabaseUrl!, supabaseAnon!, {
      db: { schema: 'public' },             // ★ 明示
      auth: {
        persistSession: true,               // ★ 明示（将来の既定値揺れに備える）
        autoRefreshToken: true,             // ★ 明示
        detectSessionInUrl: true,           // ★ 明示（Magic Link対応）
      },
      // cookies オプションは App Router では client 側不要（server 側で扱う）
    });
  }
  return globalThis.__growth_supabase__!;
}

/** 表示用Cookie（自前）を掃除：SupabaseのセッションCookieではない */
export function clearDisplayCookies() {
  try {
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
    await supabase.auth.signOut({ scope: 'local' }); // HTTPOnly Cookieは触らない
  } catch {
    /* noop */
  } finally {
    clearDisplayCookies();
    if (typeof window !== 'undefined') {
      // ★ 二重遷移防止
      if (window.location.pathname + window.location.search !== redirectTo) {
        window.location.replace(redirectTo);
      }
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
 * - SIGNED_OUT 時は表示用Cookieを掃除
 * - フォーカス/可視化時に getSession を軽くプローブし、失敗なら安全にサインアウト
 * 戻り値：デタッチ関数（SSR時は no-op を返す）
 */
export function attachAuthGuards() {
  if (globalThis.__growth_supabase_guards_attached__) {
    return () => { /* no-op */ };
  }
  globalThis.__growth_supabase_guards_attached__ = true;

  const supabase = getSupabaseClient();

  const authSub = supabase.auth.onAuthStateChange((event /*, session */) => {
    if (event === 'SIGNED_OUT') clearDisplayCookies();
  });

  const probe = async () => {
    try {
      const { data, error } = await supabase.auth.getSession();
      if (error) {
        await signOutLocalAndRedirect('/login?reason=expired');
        return;
      }
      // 未ログイン(null)は何もしない
      scrubMagicLinkHash();
    } catch {
      await signOutLocalAndRedirect('/login?reason=expired');
    }
  };

  if (typeof window === 'undefined') {
    // SSR: デタッチだけ返す
    return () => {
      authSub.data?.subscription?.unsubscribe?.();
      globalThis.__growth_supabase_guards_attached__ = false;
    };
  }

  // CSR: 起動時 + 復帰時に健全性チェック
  void probe();
  const onFocus = () => void probe();
  const onVisible = () => { if (document.visibilityState === 'visible') void probe(); };

  window.addEventListener('focus', onFocus);
  document.addEventListener('visibilitychange', onVisible);

  // デタッチ
  return () => {
    authSub.data?.subscription?.unsubscribe?.();
    window.removeEventListener('focus', onFocus);
    document.removeEventListener('visibilitychange', onVisible);
    globalThis.__growth_supabase_guards_attached__ = false;
  };
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

// 既存互換
export const supabase = getSupabaseClient();
export default supabase;
