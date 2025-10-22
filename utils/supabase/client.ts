// /utils/supabase/client.ts
// 役割：アプリ側からの“入口”をここに寄せる（段階的分割のためのハブ）
// 互換性：既存挙動は保ちつつ、"レガシーテーブル誤書き込み" をガードする

import baseClient, {
  supabase as libSupabase,
  getSupabaseClient,
  attachAuthGuards,
  safeGetSession,
  signOutLocalAndRedirect,
  clearDisplayCookies,
} from '@/lib/supabaseClient';

import type { SupabaseClient } from '@supabase/supabase-js';
import type { PostgrestFilterBuilder } from '@supabase/postgrest-js';

/* =========================================================
 * レガシーテーブル書き込みガード
 *   - from('<legacy>').insert/update/upsert/delete を実行すると即 throw
 *   - select は許可（必要に応じてここもブロック可能）
 *   - どこから呼ばれたかを Error stack で特定できる
 *   - ON/OFF は env で切替え
 * ========================================================= */
const LEGACY_TABLES = new Set<string>([
  // よく残ってしまう旧テーブル群（表記揺れも含む）
  'simulationresults',
  'simulationresult',
  'financesummary',
  'business_portfolio',
  'CSVFinance',
  'csvfinance',
]);

// 本番は true を推奨。開発で一時的に無効化したい場合は false
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

          // まず通常の builder を取得
          const builder = (target as any).from(t) as PostgrestFilterBuilder<any, any, any>;

          // ブロックOFF or レガシー対象外なら素の builder を返す
          if (!BLOCK_LEGACY || !LEGACY_TABLES.has(t)) {
            return builder;
          }

          // 書き込みメソッドのみをブロック（select 系は許容）
          const writeOps = new Set(['insert', 'update', 'upsert', 'delete']);
          const builderHandler: ProxyHandler<typeof builder> = {
            get(bTarget, bProp, bRecv) {
              const fn = Reflect.get(bTarget, bProp, bRecv);
              if (writeOps.has(String(bProp))) {
                return (...args: any[]) => {
                  // ここで止める：スタックトレースから呼び出し元を特定できる
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
 * 再エクスポート（既存互換）
 * ========================================================= */
export {
  getSupabaseClient,
  attachAuthGuards,
  safeGetSession,
  signOutLocalAndRedirect,
  clearDisplayCookies,
};

/* =========================================================
 * supabase エクスポート
 *  - 既存 import { supabase } from '@/utils/supabase/client' を
 *    そのまま "ガード付き" に置換
 *  - default もガード付きにして、誤って default を使っても保護されるようにする
 * ========================================================= */
const guardedSupabase = wrapWithLegacyGuards(libSupabase);

// default / named 互換（※ここでは "ガード付き" を返す）
export default guardedSupabase;
export const supabase: SupabaseClient = guardedSupabase;

/* =========================================================
 * 推奨：ブラウザ用単一インスタンス getter（将来的入口一本化）
 *  - こちらもガード付きインスタンスを返す
 * ========================================================= */
let __singleton: SupabaseClient<any> | null = null;
/** ブラウザで常に同一の SupabaseClient を返す（ガード付き） */
export function getBrowserSupabase(): SupabaseClient {
  if (__singleton) return __singleton;
  __singleton = guardedSupabase;
  return __singleton;
}

/* =========================================================
 * ユーティリティ（UUID / Cookie）
 * ========================================================= */
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

/* =========================================================
 * デバッグ用：現在のブロック設定を知りたい場合のフラグ
 * ========================================================= */
export const __SUPABASE_BLOCK_LEGACY__ = BLOCK_LEGACY;
export const __SUPABASE_LEGACY_TABLES__ = LEGACY_TABLES;
