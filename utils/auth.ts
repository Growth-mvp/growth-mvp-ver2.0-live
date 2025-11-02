// /utils/auth.ts
'use client';

import {
  getBrowserSupabase,
  clearDisplayCookies,
  clearCompanyIdCookie,
} from '@/utils/supabase/client';

/** Supabaseが使う/使いがちな localStorageキーの語頭（とりこぼし防止のため広め） */
const SB_KEY_HINTS = [
  'sb-',           // 公式既定: sb-<project-ref>-auth-token
  'supabase',      // 将来バージョンや外部ライブラリの癖対策
  'auth',          // 念のため（prefixedStorage下で混ざる可能性）
];

/** こちらは “接頭辞” ではなく “含む” 判定で洗う（prefix付きでも確実に消す） */
function purgeSupabaseLocalStorage() {
  if (typeof window === 'undefined') return;
  try {
    const keys = Array.from({ length: localStorage.length }, (_, i) => localStorage.key(i) || '');
    keys.forEach((k) => {
      const key = String(k);
      if (SB_KEY_HINTS.some((hint) => key.includes(hint))) {
        localStorage.removeItem(key);
      }
    });
  } catch (e) {
    console.warn('[auth] purgeSupabaseLocalStorage failed (ignored):', e);
  }

  // 念のため sessionStorage 側も掃除（通常は使用しないが保険）
  try {
    const skeys = Array.from({ length: sessionStorage.length }, (_, i) => sessionStorage.key(i) || '');
    skeys.forEach((k) => {
      const key = String(k);
      if (SB_KEY_HINTS.some((hint) => key.includes(hint))) {
        sessionStorage.removeItem(key);
      }
    });
  } catch (e) {
    console.warn('[auth] purgeSupabaseSessionStorage failed (ignored):', e);
  }
}

/** 自前Cookieの明示削除（company_id 等） */
function purgeOwnCookies() {
  try {
    clearCompanyIdCookie?.();
  } catch {}
  try {
    clearDisplayCookies?.(); // growth-* なども一括削除
  } catch {}

  // 明示キーを個別に削除（環境によって名称が違っても安全）
  try {
    const names = ['user_id', 'company_id', 'user_role', 'department_id'];
    names.forEach((n) => {
      document.cookie = `${n}=; Path=/; Max-Age=0; SameSite=Lax`;
    });
  } catch (e) {
    console.warn('[auth] purgeOwnCookies fallback failed (ignored):', e);
  }
}

/**
 * 最低限のハードサインアウト：
 * - Supabase グローバルサインアウト
 * - localStorage/sessionStorage の supabase系キー削除
 * - 自前Cookie削除
 */
export async function hardSignOut(): Promise<void> {
  try {
    const supabase = getBrowserSupabase();
    await supabase.auth.signOut({ scope: 'global' });
  } catch (e) {
    console.warn('[auth] supabase signOut failed (ignored):', e);
  }

  // 端末側の痕跡を除去
  purgeSupabaseLocalStorage();
  purgeOwnCookies();
}

/**
 * 便利版：ハードサインアウト＋必要ならリダイレクト
 * 例）await hardSignOutAndPurge('/login')
 */
export async function hardSignOutAndPurge(redirectTo?: string): Promise<void> {
  await hardSignOut();

  if (redirectTo && typeof window !== 'undefined') {
    try {
      location.assign(redirectTo);
    } catch {
      // 何もしない
    }
  }
}

/**
 * トークン不整合が疑われるときに使う“強制再ログイン誘導”ハンドラ。
 * - UI側：トースト等で「セッションが切れました。再ログインしてください。」と案内してから呼ぶ想定
 * - 画面遷移先は /login を想定（必要に応じて変更）
 */
export async function forceRelogin(next: string = '/login'): Promise<void> {
  await hardSignOutAndPurge(next);
}
