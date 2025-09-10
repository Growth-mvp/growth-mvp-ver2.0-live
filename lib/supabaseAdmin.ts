// /lib/supabaseAdmin.ts
import 'server-only';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

declare global {
  // eslint-disable-next-line no-var
  var __growth_sb_admin__: SupabaseClient | undefined;
}

/**
 * サーバ専用の Supabase 管理クライアント（Service Role）
 * 必要な環境変数:
 *  - SUPABASE_URL                  （※ NEXT_PUBLIC_ ではない）
 *  - SUPABASE_SERVICE_ROLE_KEY     （※ 公開禁止、RLSを無視できる強力な鍵）
 */
export function getSupabaseAdmin(): SupabaseClient {
  const url = process.env.SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url) {
    throw new Error('Missing env: SUPABASE_URL');
  }
  if (!serviceRoleKey) {
    throw new Error('Missing env: SUPABASE_SERVICE_ROLE_KEY');
  }

  // URLの妥当性チェック（早期失敗で原因特定を容易に）
  try {
    const u = new URL(url);
    if (!/^https?:$/.test(u.protocol)) {
      throw new Error('SUPABASE_URL must start with http/https');
    }
  } catch {
    throw new Error('Invalid SUPABASE_URL');
  }

  // シングルトン（開発のHMRでも1つだけ維持）
  if (!globalThis.__growth_sb_admin__) {
    globalThis.__growth_sb_admin__ = createClient(url, serviceRoleKey, {
      auth: {
        persistSession: false,   // サーバではセッション保存しない
        autoRefreshToken: false, // 自動更新も不要
      },
      db: {
        schema: 'public',        // 必要ならここを切替
      },
      global: {
        // 必要に応じて fetch オプションをここで拡張可能
        // headers: { 'X-Client-Name': 'growth-admin' },
      },
    });
  }
  return globalThis.__growth_sb_admin__!;
}

/* 例:
import { getSupabaseAdmin } from '@/lib/supabaseAdmin';
const admin = getSupabaseAdmin();
// admin.auth.admin.listUsers() など、管理系APIが利用可能
*/
