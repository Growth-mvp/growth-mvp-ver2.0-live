// /utils/supabase/client.ts
'use client';

/**
 * 役割：
 *  - ブラウザ用 Supabase クライアントの “唯一の入り口”
 *  - クライアント二重化を排除し、RLS 判定の不一致を防ぐ
 *  - レガシーテーブルへの誤書き込みを Proxy でブロック（環境で無効化可）
 *  - 互換API（safeGetSession など）を提供
 *  - company_id Cookie 補助ユーティリティ
 *
 * 重要：
 *  - サーバ実行時にも import だけで落ちないよう、トップレベルでは**生成しない**
 *  - ブラウザ外では NOOP クライアント/Proxy を返し、アクセス時にのみ分かりやすくエラー
 */

import { createClient, type SupabaseClient, type Session, type AuthError } from '@supabase/supabase-js';
import type { PostgrestFilterBuilder } from '@supabase/postgrest-js';

/* =========================================================
 * 環境判定
 * ========================================================= */
const isBrowser = () => typeof window !== 'undefined';

declare global {
  // eslint-disable-next-line no-var
  var __growth_supabase_singleton__: SupabaseClient | undefined;
}

/* =========================================================
 * 開発環境限定：fetch フック (Authorization 有無ログ)
 * ========================================================= */
function createDebugFetch(): typeof fetch {
  return async (resource, config) => {
    const isDev = process.env.NODE_ENV === 'development';
    let url: string | undefined;

    if (typeof resource === 'string') {
      url = resource;
    } else if (resource instanceof URL) {
      url = resource.href;
    }

    // /rest/v1/company_members のリクエストだけをログ
    if (isDev && typeof url === 'string' && url.includes('/rest/v1/company_members')) {
      const headers = config?.headers as Record<string, string> | undefined;
      const hasAuth = !!headers?.Authorization;
      console.log('[fetch-hook] /rest/v1/company_members', {
        method: config?.method || 'GET',
        hasAuthorization: hasAuth,
        authPrefix: hasAuth ? headers?.Authorization?.substring(0, 20) : 'none',
      });
    }

    return fetch(resource, config);
  };
}

/* =========================================================
 * ブラウザ用クライアント生成（まだ呼ばない）
 * ========================================================= */
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
      fetch: createDebugFetch(),
    },
  });
}

function getOrInitBrowserSingleton(): SupabaseClient {
  if (!isBrowser()) {
    throw new Error('getOrInitBrowserSingleton must be called in the browser.');
  }
  if (!window.__growth_supabase_singleton__) {
    window.__growth_supabase_singleton__ = createBrowserClient();
  }
  return window.__growth_supabase_singleton__;
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
  String(process.env.NEXT_PUBLIC_SUPABASE_BLOCK_LEGACY ?? process.env.SUPABASE_BLOCK_LEGACY ?? 'true') === 'true';

function wrapWithLegacyGuards<T = any>(client: SupabaseClient<T>): SupabaseClient<T> {
  if (!BLOCK_LEGACY) return client;

  const handler: ProxyHandler<SupabaseClient<T>> = {
    get(target, prop, recv) {
      const original = Reflect.get(target, prop, recv);

      if (prop === 'from') {
        return (table: string) => {
          const t = String(table || '').trim();
          const builder = (target as any).from(t) as PostgrestFilterBuilder<any, any, any>;

          if (!LEGACY_TABLES.has(t)) return builder;

          const writeOps = new Set(['insert', 'update', 'upsert', 'delete']);
          const builderHandler: ProxyHandler<typeof builder> = {
            get(bTarget, bProp, bRecv) {
              const fn = Reflect.get(bTarget, bProp, bRecv);
              if (writeOps.has(String(bProp))) {
                return () => {
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

  return new Proxy(client, handler);
}

/* =========================================================
 * クライアント解決：ブラウザでは実体、サーバでは NOOP
 * ========================================================= */
let __cachedGuarded__: SupabaseClient | null = null;

function resolveGuardedClient(): SupabaseClient<any> {
  if (isBrowser()) {
    if (!__cachedGuarded__) {
      __cachedGuarded__ = wrapWithLegacyGuards(getOrInitBrowserSingleton());
    }
    return __cachedGuarded__;
  }

  const serverNoop = new Proxy({} as SupabaseClient, {
    get(_t, prop) {
      const msg =
        `[Supabase Client] You are trying to use the **browser** Supabase client on the server (prop: ${String(
          prop
        )}).\n` +
        `• Call this API inside a Client Component (or useEffect) or \n` +
        `• Use a dedicated server-side Supabase client instead.\n` +
        `Import path: "@/utils/supabase/client"`;
      throw new Error(msg);
    },
  });
  return serverNoop;
}

/* =========================================================
 * 推奨：明示的に取得（クライアントで呼ぶこと）
 * ========================================================= */
export function getBrowserSupabase(): SupabaseClient {
  return resolveGuardedClient();
}

/* 既存互換 */
export const getSupabaseClient = getBrowserSupabase;

/**
 * 互換のため `supabase` をそのまま import 可能にする Proxy。
 * ブラウザなら初アクセス時に実体を解決。サーバで触ると即エラー。
 */
export const supabase: SupabaseClient = new Proxy({} as SupabaseClient, {
  get(_t, prop) {
    const c = resolveGuardedClient() as any;
    const v = c[prop];
    return typeof v === 'function' ? v.bind(c) : v;
  },
});
export default supabase;

/* =========================================================
 * セッションユーティリティ
 * ========================================================= */
export async function safeGetSession(
  client?: SupabaseClient
): Promise<{ ok: boolean; data: { session: Session | null }; error: AuthError | null }> {
  try {
    const c = client ?? (isBrowser() ? getBrowserSupabase() : undefined);
    if (!c) return { ok: false, data: { session: null }, error: null };
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
    if (isBrowser()) {
      await getBrowserSupabase().auth.signOut({ scope: 'global' });
    }
  } catch (e) {
    console.warn('[auth] signOut failed (ignored):', e);
  }
  try {
    clearAllSupabaseLikeStorage();
    clearDisplayCookies();
  } catch {}
  if (isBrowser() && redirectTo) location.assign(redirectTo);
}

export function clearAllSupabaseLikeStorage() {
  if (!isBrowser()) return;
  try {
    const prefixes = ['sb-', 'supabase', (process.env.NEXT_PUBLIC_APP_STORAGE_PREFIX ?? '').trim()].filter(Boolean);
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
  if (!isBrowser()) return;
  try {
    document.cookie
      .split(';')
      .map((c) => c.trim())
      .forEach((pair) => {
        const [name] = pair.split('=');
        if (!name) return;
        if (name.startsWith('company_id') || name.startsWith('growth-')) {
          const isHttps = location.protocol === 'https:';
          const attrs = ['Path=/', 'SameSite=Lax', isHttps ? 'Secure' : ''].filter(Boolean).join('; ');
          document.cookie = `${name}=; Max-Age=0; ${attrs}`;
        }
      });
  } catch (e) {
    console.warn('[auth] clearDisplayCookies failed:', e);
  }
}

/* =========================================================
 * UUID / Cookie ユーティリティ
 * ========================================================= */
// ★ isValidUUID を server-safe utility から import して再エクスポート
import { isValidUUID } from '@/lib/utils/isValidUUID';
export { isValidUUID };

export function getCompanyIdFromCookie(): string | null {
  if (!isBrowser()) return null;
  const m = /(?:^|;\s*)company_id=([^;]+)/.exec(document.cookie || '');
  const v = m ? decodeURIComponent(m[1].trim()) : null;
  return v && isValidUUID(v) ? v : null;
}

export function setCompanyIdCookie(companyId: string) {
  if (!isBrowser()) return;
  if (!isValidUUID(companyId)) {
    console.warn('setCompanyIdCookie: invalid UUID, skip');
    return;
  }
  try {
    const maxAgeDays = 30;
    const maxAge = 60 * 60 * 24 * maxAgeDays;
    const isHttps = location.protocol === 'https:';
    const attrs = ['Path=/', 'SameSite=Lax', `Max-Age=${maxAge}`, isHttps ? 'Secure' : '']
      .filter(Boolean)
      .join('; ');
    document.cookie = `company_id=${encodeURIComponent(companyId)}; ${attrs}`;
  } catch (e) {
    console.warn('setCompanyIdCookie failed:', e);
  }
}

export function clearCompanyIdCookie() {
  if (!isBrowser()) return;
  try {
    const isHttps = location.protocol === 'https:';
    const attrs = ['Path=/', 'SameSite=Lax', isHttps ? 'Secure' : ''].filter(Boolean).join('; ');
    document.cookie = `company_id=; Max-Age=0; ${attrs}`;
  } catch (e) {
    console.warn('clearCompanyIdCookie failed:', e);
  }
}

export function ensureCompanyIdCookie(companyId?: string | null) {
  if (companyId && isValidUUID(companyId)) setCompanyIdCookie(companyId);
}

/* =========================================================
 * company_id スコープ補助
 * ！！ここを any 固定にして TS2344 を解消（GenericSchema 制約を回避）
 * ========================================================= */
export function withCompanyScope(
  qb: PostgrestFilterBuilder<any, any, any>,
  companyId: string | null | undefined
): PostgrestFilterBuilder<any, any, any> {
  if (!companyId || !isValidUUID(companyId)) {
    console.warn('[withCompanyScope] invalid companyId. Did you resolve it via cookie/membership?');
    return qb;
  }
  return qb.eq('company_id', companyId);
}

export function assertCompanyId(companyId: string | null | undefined): asserts companyId is string {
  if (!companyId || !isValidUUID(companyId)) {
    throw new Error('company_id is missing or invalid. Ensure cookie is set or resolve via membership.');
  }
}

/* =========================================================
 * デバッグフラグ
 * ========================================================= */
export const __SUPABASE_BLOCK_LEGACY__ = BLOCK_LEGACY;
export const __SUPABASE_LEGACY_TABLES__ = LEGACY_TABLES;
