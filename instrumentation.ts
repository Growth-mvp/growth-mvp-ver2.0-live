/**
 * サーバー起動時の接続先チェック。失敗したら起動を止める（fail closed）。
 * 同期チェック（変数の有無・URL の一致・ref の一致）が通った後にだけ、非本番でキーの有効性を確認する。
 */
export async function register() {
  if (process.env.NEXT_RUNTIME !== 'nodejs') return;

  const envGuard = await import('./lib/envGuard');
  envGuard.assertSupabaseEnv(process.env);

  if (process.env.APP_ENV !== 'production') {
    const keys = await envGuard.verifySupabaseKeys({
      url: process.env.NEXT_PUBLIC_SUPABASE_URL as string,
      publishableKey: process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY as string,
      serviceRoleKey: process.env.SUPABASE_SERVICE_ROLE_KEY as string,
    });
    if (!keys.ok) {
      throw new Error(`envGuard: ${keys.reason} (${keys.detail})`);
    }
  }
}
