// /lib/supabaseClient.ts（堅牢化・互換維持：utils 側を再エクスポート一本化）
'use client';

/**
 * 役割：
 *  - 既存コードが `@/lib/supabaseClient` を import していても動く互換レイヤ
 *  - 実体はすべて `@/utils/supabase/client` の単一シングルトンを参照
 * 注意：
 *  - `@/utils/supabase/client` 側は “leaf” として他の自作 util を import しないこと
 */

export {
  supabase,
  default,
  getBrowserSupabase,
  getSupabaseClient,
  safeGetSession,
  signOutLocalAndRedirect,
  clearAllSupabaseLikeStorage,
  clearDisplayCookies,
  isValidUUID,
  getCompanyIdFromCookie,
  setCompanyIdCookie,
  clearCompanyIdCookie,
  __SUPABASE_BLOCK_LEGACY__,
  __SUPABASE_LEGACY_TABLES__,
} from '@/utils/supabase/client';
