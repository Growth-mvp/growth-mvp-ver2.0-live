// /utils/supabase/client.ts
// 役割：アプリ側からの“入口”をここに寄せる（段階的分割のためのハブ）
// 互換性：既存挙動は保ちつつ、"レガシーテーブル誤書き込み" をガードする
// 注意：ブラウザAPI（document.cookie等）を扱うため、確実にクライアント側で評価
'use client';
// /utils/supabase/client.ts
// 役割：アプリ側からの“入口”をここに寄せる（段階的分割のためのハブ）
// 互換性：既存挙動は保ちつつ、"レガシーテーブル誤書き込み" をガードする
// 追加：safeGetSession を { ok, data, error } で統一（引数なし/ありどちらも可）

import baseClient, {
  supabase as libSupabase,
  getSupabaseClient,
  attachAuthGuards,
  signOutLocalAndRedirect,
  clearDisplayCookies,
} from '@/lib/supabaseClient';

import type { SupabaseClient, Session, AuthError } from '@supabase/supabase-js';
import type { PostgrestFilterBuilder } from '@supabase/postgrest-js';

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

/** SupabaseClient を Proxy で包み、レガシーテーブルへの書き込みを検知・阻止 */
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
 * 互換 safeGetSession（戻り値を { ok, data:{session}, error } に統一）
 *  - 引数なし/あり（SupabaseClient）両対応
 * ========================================================= */
export async function safeGetSession(
  client?: SupabaseClient
): Promise<{ ok: boolean; data: { session: Session | null }; error: AuthError | null }> {
  const c = client ?? libSupabase;
  try {
    const { data, error } = await c.auth.getSession();
    return { ok: !error, data: { session: data?.session ?? null }, error: error ?? null };
  } catch (e: any) {
    return { ok: false, data: { session: null }, error: e ?? null };
  }
}

/* =========================================================
 * 再エクスポート（既存互換）
 * ========================================================= */
export {
  getSupabaseClient,
  attachAuthGuards,
  signOutLocalAndRedirect,
  clearDisplayCookies,
};

/* =========================================================
 * supabase エクスポート（ガード付き）
 * ========================================================= */
const guardedSupabase = wrapWithLegacyGuards(libSupabase);
export default guardedSupabase;
export const supabase: SupabaseClient = guardedSupabase;

/* =========================================================
 * 推奨：ブラウザ用単一インスタンス getter（ガード付き）
 * ========================================================= */
let __singleton: SupabaseClient<any> | null = null;
export function getBrowserSupabase(): SupabaseClient {
  if (__singleton) return __singleton;
  __singleton = guardedSupabase;
  return __singleton;
}

/* =========================================================
 * ユーティリティ（UUID / Cookie）
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
