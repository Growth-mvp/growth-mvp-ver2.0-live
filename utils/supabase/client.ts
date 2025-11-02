// /utils/supabase/client.ts
'use client';

/**
 * 役割：
 *  - ブラウザ用 Supabase クライアントの “唯一の入り口”
 *  - クライアント二重化を排除し、RLS 判定の不一致を防ぐ
 *  - レガシーテーブルへの誤書き込みを Proxy でブロック（環境で無効化可）
 *  - 互換API（safeGetSession, getSupabaseClient など）を提供
 *
 * 注意：
 *  - ここから他の自作 util（./strategy や ./membership など）を import しない（循環防止）
 */

import { createClient, type SupabaseClient, type Session, type AuthError } from '@supabase/supabase-js';
import type { PostgrestFilterBuilder } from '@supabase/postgrest-js';

/* =========================================================
 * ブラウザ用クライアント（唯一の実体）
 * ========================================================= */
let __browserSingleton: SupabaseClient | null = null;

function createBrowserClient(): SupabaseClient {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anonKey) {
    throw new Error('Supabase env is missing: NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY');
  }

  return createClient(url, anonKey, {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: true,
    },
    global: {
      headers: { 'x-growth-app': 'growth-mvp-ver2.0' },
    },
  });
}

/* =========================================================
 * レガシーテーブル書き込みガード
 * ========================================================= */
const LEGACY_TABLES = new Set<string>([
  'simulationresults',
  'simulationresult',
  'financesummary',
  'business_portfolio',
  'CSVFinance',
  'csvfinance',
]);

const BLOCK_LEGACY =
  String(process.env.NEXT_PUBLIC_SUPABASE_BLOCK_LEGACY ?? process.env.SUPABASE_BLOCK_LEGACY ?? 'true') ===
  'true';

function wrapWithLegacyGuards<T = any>(client: SupabaseClient<T>): SupabaseClient<T> {
  if (!BLOCK_LEGACY) return client;

  const clientHandler: ProxyHandler<SupabaseClient<T>> = {
    get(target, prop, recv) {
      const original = Reflect.get(target, prop, recv);

      if (prop === 'from') {
        // intercept .from('table')
        return (table: string) => {
          const t = String(table || '').trim();
          const builder = (target as any).from(t) as PostgrestFilterBuilder<any, any, any>;

          if (!LEGACY_TABLES.has(t)) return builder;

          // 書き込み系を封じる
          const writeOps = new Set(['insert', 'update', 'upsert', 'delete']);
          const builderHandler: ProxyHandler<typeof builder> = {
            get(bTarget, bProp, bRecv) {
              const fn = Reflect.get(bTarget, bProp, bRecv);
              if (writeOps.has(String(bProp))) {
                return (..._args: any[]) => {
                  throw new Error(
                    `[SupabaseGuard] ${String(bProp)} to LEGACY table "${t}" is blocked. ` +
                      `Use unified tables/columns instead of legacy ones.`
                  );
                };
              }
              return typeof fn === 'function' ? fn.bind(bTarget) : fn;
            },
          };

          return new Proxy(builder, builderHandler);
        };
      }

      return typeof original === 'function' ? original.bind(target) : original;
    },
  };

  return new Proxy(client, clientHandler);
}

/* =========================================================
 * 共有クライアント → ガード付ラッパ（Proxy）
 *   - 実体は 1個（__browserSingleton）
 *   - 参照は Proxy で追加保護（必要なときのみ）
 * ========================================================= */
let __guardedSingleton: SupabaseClient<any> | null = null;

function getGuardedSharedClient(): SupabaseClient {
  if (__guardedSingleton) return __guardedSingleton;
  if (!__browserSingleton) {
    __browserSingleton = createBrowserClient();
  }
  __guardedSingleton = wrapWithLegacyGuards(__browserSingleton);
  return __guardedSingleton;
}

/* =========================================================
 * 推奨：ブラウザ用単一インスタンス getter（ガード付き）
 * ========================================================= */
export function getBrowserSupabase(): SupabaseClient {
  return getGuardedSharedClient();
}

// 既存互換：getSupabaseClient という名前でのエクスポートも維持
export const getSupabaseClient = getBrowserSupabase;

/* デフォルト / 名前付き：supabase をそのまま使いたい箇所用 */
export const supabase: SupabaseClient = getBrowserSupabase();
export default supabase;

/* =========================================================
 * 互換 safeGetSession（戻り値を { ok, data:{session}, error } に統一）
 * ========================================================= */
export async function safeGetSession(
  client?: SupabaseClient
): Promise<{ ok: boolean; data: { session: Session | null }; error: AuthError | null }> {
  const c = client ?? getBrowserSupabase();
  try {
    const { data, error } = await c.auth.getSession();
    return { ok: !error, data: { session: data?.session ?? null }, error: error ?? null };
  } catch (e: any) {
    return { ok: false, data: { session: null }, error: e ?? null };
  }
}

/* =========================================================
 * ログアウト/表示系ユーティリティ
 * ========================================================= */
export async function signOutLocalAndRedirect(redirectTo?: string) {
  try {
    const c = getBrowserSupabase();
    await c.auth.signOut({ scope: 'global' });
  } catch (e) {
    console.warn('[auth] signOut failed (ignored):', e);
  }
  try {
    clearAllSupabaseLikeStorage();
    clearDisplayCookies();
  } catch {}
  if (typeof window !== 'undefined' && redirectTo) {
    location.assign(redirectTo);
  }
}

/** Supabase が使いがちな localStorage キーを包括的に削除 */
export function clearAllSupabaseLikeStorage() {
  if (typeof window === 'undefined') return;
  try {
    const prefixes = [
      'sb-',            // Supabase v2 既定
      'supabase',       // 互換系
      // 任意：プロジェクト固有の prefix がある場合はここに追加
      (process.env.NEXT_PUBLIC_APP_STORAGE_PREFIX ?? '').trim(),
    ].filter(Boolean);

    const keys: string[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i) || '';
      if (prefixes.some((p) => k.startsWith(p))) keys.push(k);
    }
    keys.forEach((k) => localStorage.removeItem(k));
  } catch (e) {
    console.warn('[supabase] clearAllSupabaseLikeStorage failed:', e);
  }
}

export function clearDisplayCookies() {
  if (typeof document === 'undefined') return;
  try {
    // 必要に応じてアプリの表示用 cookie をここで全て除去
    // 例: company_id / growth-*
    document.cookie
      .split(';')
      .map((c) => c.trim())
      .forEach((pair) => {
        const [name] = pair.split('=');
        if (!name) return;
        if (name.startsWith('company_id') || name.startsWith('growth-')) {
          const isHttps = typeof location !== 'undefined' && location.protocol === 'https:';
          const attrs = ['Path=/', 'SameSite=Lax', isHttps ? 'Secure' : ''].filter(Boolean).join('; ');
          document.cookie = `${name}=; Max-Age=0; ${attrs}`;
        }
      });
  } catch (e) {
    console.warn('[auth] clearDisplayCookies failed:', e);
  }
}

/* =========================================================
 * UUID / Cookie ユーティリティ（既存互換）
 * ========================================================= */
export function isValidUUID(v?: string | null): v is string {
  return !!v && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(v);
}

export function getCompanyIdFromCookie(): string | null {
  if (typeof document === 'undefined') return null;
  const m = /(?:^|;\s*)company_id=([^;]+)/.exec(document.cookie || '');
  return m ? decodeURIComponent(m[1].trim()) : null;
}

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

/* =========================================================
 * デバッグフラグ
 * ========================================================= */
export const __SUPABASE_BLOCK_LEGACY__ = BLOCK_LEGACY;
export const __SUPABASE_LEGACY_TABLES__ = LEGACY_TABLES;
