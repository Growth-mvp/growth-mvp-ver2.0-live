// /utils/supabase/client.ts
// 役割：アプリ側からの“入口”をここに寄せる（段階的分割のためのハブ）
// 互換性：既存挙動は変えず、lib/supabaseClient を再エクスポート

import baseClient, {
  supabase as libSupabase,
  getSupabaseClient,
  attachAuthGuards,
  safeGetSession,
  signOutLocalAndRedirect,
  clearDisplayCookies,
} from '@/lib/supabaseClient';

import type { SupabaseClient } from '@supabase/supabase-js';

// ---- 再エクスポート（既存互換）----
export {
  getSupabaseClient,
  attachAuthGuards,
  safeGetSession,
  signOutLocalAndRedirect,
  clearDisplayCookies,
};

// default / named 互換（lib のものをそのまま流す）
export default baseClient;

// ⚠️ freeze/seal 禁止：Supabaseクライアントは内部状態を書き換えるため
export const supabase: SupabaseClient = libSupabase;

// ---- 推奨：ブラウザ用の単一インスタンス getter（将来の入口一本化用）----
let __singleton: SupabaseClient<any> | null = null;
/** ブラウザで常に同一の SupabaseClient を返す（将来の入口一本化用） */
export function getBrowserSupabase(): SupabaseClient {
  if (__singleton) return __singleton;
  // lib 側が既に singleton を返す前提。将来差し替える場合もここだけ直せばOK。
  __singleton = libSupabase;
  return __singleton;
}

/** UUID v1–v5 を許容 */
export function isValidUUID(v?: string | null): v is string {
  return !!v && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(v);
}

/** SSR安全：ブラウザ環境でのみ Cookie を読む */
export function getCompanyIdFromCookie(): string | null {
  if (typeof document === 'undefined') return null;
  const m = /(?:^|;\s*)company_id=([^;]+)/.exec(document.cookie || '');
  return m ? decodeURIComponent(m[1].trim()) : null;
}

/**
 * company_id Cookie を設定
 * - Path=/, SameSite=Lax（既定）
 * - https 環境では Secure を自動付与
 * - 有効期限は 30 日
 */
export function setCompanyIdCookie(companyId: string) {
  if (typeof document === 'undefined') return;
  try {
    const maxAgeDays = 30;
    const maxAge = 60 * 60 * 24 * maxAgeDays;
    const isHttps = typeof location !== 'undefined' && location.protocol === 'https:';
    const attrs = ['Path=/', 'SameSite=Lax', `Max-Age=${maxAge}`, isHttps ? 'Secure' : '']
      .filter(Boolean)
      .join('; ');
    document.cookie = `company_id=${encodeURIComponent(companyId)}; ${attrs}`;
  } catch (e) {
    console.warn('setCompanyIdCookie failed:', e);
  }
}

/** 明示的に company_id Cookie を消す */
export function clearCompanyIdCookie() {
  if (typeof document === 'undefined') return;
  try {
    const isHttps = typeof location !== 'undefined' && location.protocol === 'https:';
    const attrs = ['Path=/', 'SameSite=Lax', isHttps ? 'Secure' : ''].filter(Boolean).join('; ');
    document.cookie = `company_id=; Max-Age=0; ${attrs}`;
  } catch (e) {
    console.warn('clearCompanyIdCookie failed:', e);
  }
}
