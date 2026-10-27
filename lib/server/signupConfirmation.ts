import 'server-only';

import { createClient } from '@supabase/supabase-js';

export type ResendResult = 'sent' | 'rate_limited' | 'failed';

const REQUEST_TIMEOUT_MS = 10_000;

/**
 * 未確認アカウントへ Supabase 標準の確認メールを再送する（auth.resend）。
 * パスワードは不要で、アカウントは削除・再作成しない。
 */
export async function resendSignupConfirmation(email: string, emailRedirectTo: string): Promise<ResendResult> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  if (!url || !key) return 'failed';

  const client = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    global: {
      fetch: (input, init) => fetch(input, { ...init, signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) }),
    },
  });

  try {
    const { error } = await client.auth.resend({ type: 'signup', email, options: { emailRedirectTo } });
    if (!error) return 'sent';

    const { code, status } = error as { code?: string; status?: number };
    if (code === 'over_email_send_rate_limit' || status === 429) return 'rate_limited';
    return 'failed';
  } catch {
    return 'failed';
  }
}
