// /utils/supabase/client.ts
'use client';

/**
 * 役割：
 *  - ブラウザ用 Supabase クライアントの “唯一の入り口”
 *  - ストレージキーを環境ごとに分離し、Refresh Token 衝突を回避
 *  - レガシーテーブルへの誤書き込みを Proxy でブロック
 *  - 互換API（safeGetSession, getSupabaseClient など）を提供
 *
 * 要件：
 *  - NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY を設定
 */

import { createBrowserClient } from '@supabase/ssr';
import type { SupabaseClient, Session, AuthError } from '@supabase/supabase-js';
import type { PostgrestFilterBuilder } from '@supabase/postgrest-js';

/* =========================================================
 * 環境 & ストレージ設定（環境切替のたびに prefix を変えられる）
 * ========================================================= */
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SUPABASE_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
if (!SUPABASE_URL || !SUPABASE_KEY) {
  // eslint-disable-next-line no-console
  console.warn('[supabase] URL/ANON KEY is missing. Check env.');
}

// 例：growth-v4:yuerkbxpivdhaikrnsar
const APP_STORAGE_PREFIX =
  (process.env.NEXT_PUBLIC_APP_STORAGE_PREFIX ?? 'growth-v4') +
  ':' +
  (process.env.NEXT_PUBLIC_SUPABASE_PROJECT ?? 'yuerkbxpivdhaikrnsar');

/** localStorage を prefix 付きでラップ（環境切替でキー衝突を回避） */
const prefixedStorage = {
  getItem: (k: string) =>
    typeof window !== 'undefined'
      ? window.localStorage.getItem(`${APP_STORAGE_PREFIX}:${k}`)
      : null,
  setItem: (k: string, v: string) =>
    typeof window !== 'undefined'
      ? window.localStorage.setItem(`${APP_STORAGE_PREFIX}:${k}`, v)
      : undefined,
  removeItem: (k: string) =>
    typeof window !== 'undefined'
      ? window.localStorage.removeItem(`${APP_STORAGE_PREFIX}:${k}`)
      : undefined,
};

/** 任意：prefix 領域だけを安全に掃除（ログアウト時の取り残し防止） */
export function clearPrefixedSupabaseStorage() {
  if (typeof window === 'undefined') return;
  try {
    const keys: string[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (!k) continue;
      if (k.startsWith(`${APP_STORAGE_PREFIX}:`)) keys.push(k);
    }
    for (const k of keys) localStorage.removeItem(k);
  } catch (e) {
    console.warn('[supabase] clearPrefixedSupabaseStorage failed:', e);
  }
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
  const clientHandler: ProxyHandler<SupabaseClient<T>> = {
    get(target, prop, recv) {
      const original = Reflect.get(target, prop, recv);

      if (prop === 'from') {
        return (table: string) => {
          const t = String(table || '').trim();
          const builder = (target as any).from(t) as PostgrestFilterBuilder<any, any, any>;

          if (!BLOCK_LEGACY || !LEGACY_TABLES.has(t)) {
            return builder;
          }

          const writeOps = new Set(['insert', 'update', 'upsert', 'delete']);
          const builderHandler: ProxyHandler<typeof builder> = {
            get(bTarget, bProp, bRecv) {
              const fn = Reflect.get(bTarget, bProp, bRecv);
              if (writeOps.has(String(bProp))) {
                return (..._args: any[]) => {
                  throw new Error(
                    `[SupabaseGuard] ${String(bProp)} to LEGACY table "${t}" is blocked. ` +
                      `Stop writing legacy tables (use unified "strategy_data" fields instead).`
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
 * シングルトン生成（autoRefresh & persistSession を有効）
 * ========================================================= */
let __singleton: SupabaseClient<any> | null = null;

function createClientSingleton(): SupabaseClient {
  if (__singleton) return __singleton;

  const base = createBrowserClient(SUPABASE_URL, SUPABASE_KEY, {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: true,
      storage: prefixedStorage,
    },
  });

  // 任意：イベントログ（デバッグに便利、不要なら消してOK）
  base.auth.onAuthStateChange((event) => {
    if (event === 'TOKEN_REFRESHED') console.log('[auth] token refreshed');
    if (event === 'SIGNED_OUT') console.log('[auth] signed out');
    if (event === 'SIGNED_IN') console.log('[auth] signed in');
  });

  __singleton = wrapWithLegacyGuards(base);
  return __singleton;
}

/* =========================================================
 * 推奨：ブラウザ用単一インスタンス getter（ガード付き）
 * ========================================================= */
export function getBrowserSupabase(): SupabaseClient {
  return createClientSingleton();
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
 * 互換：attachAuthGuards（必要ならここで追加のラップを実装）
 * いまは no-op で互換シグネチャだけ提供
 * ========================================================= */
export function attachAuthGuards(client?: SupabaseClient): SupabaseClient {
  // 将来的に 401/400 抑止や再ログイン誘導をここに差し込める
  return client ?? getBrowserSupabase();
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
    // ★ 追加：prefix 付き Supabase セッション領域の掃除
    clearPrefixedSupabaseStorage();
    clearDisplayCookies();
  } catch {}
  if (typeof window !== 'undefined' && redirectTo) {
    location.assign(redirectTo);
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
