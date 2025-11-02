// /lib/supabaseClient.ts（堅牢化・互換維持：utils 側を再エクスポート一本化）
'use client';

// ここからは utils 側の単一シングルトン／ガード実装をそのまま利用します。
// 既存コードが `@/lib/supabaseClient` を import していても、内部的には
// `@/utils/supabase/client` の同一インスタンスを参照します。

export * from '@/utils/supabase/client';
export { default } from '@/utils/supabase/client';
