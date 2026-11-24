// /app/auth/callback/CallbackClient.tsx
'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { supabase } from '@/utils/supabase/client';
import { authErrorFromHash } from '@/lib/safeRedirect';

const INVITE_ACCEPT_PATH = '/invite/accept';

function errorMessageOf(code: string | null): string {
  if (code === 'otp_expired' || code === 'access_denied') {
    return '確認リンクの有効期限が切れているか、既に使用されています。招待の受諾画面から確認メールを再送するか、最新の確認メールのリンクを開いてください。';
  }
  return '認証に失敗しました。もう一度お試しください。';
}

export default function CallbackClient() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [status, setStatus] = useState<'processing' | 'error'>('processing');
  const [errorCode, setErrorCode] = useState<string | null>(null);

  const nextParam = useMemo(() => {
    const rawNext = searchParams?.get('next') || '/';

    // ✅ Security: Decode first, then validate
    let decoded = rawNext;
    try {
      decoded = decodeURIComponent(rawNext);
    } catch {
      decoded = rawNext; // If decode fails, use as-is
    }

    // ✅ Security: Strip newlines/tabs (CRLF injection prevention)
    decoded = decoded.replace(/[\r\n\t]/g, '');

    // ✅ Security: Only allow paths starting with '/' but NOT '//' (protocol-relative URLs)
    const validated =
      decoded.startsWith('/') && !decoded.startsWith('//') ? decoded : '/';

    if (decoded !== validated) {
      console.warn('[auth/callback] Blocked open redirect attempt:', {
        raw: rawNext,
        decoded,
        blocked: true,
      });
    }

    return validated;
  }, [searchParams]);

  useEffect(() => {
    let cancelled = false;

    (async () => {
      console.log('[auth/callback] Started processing callback');

      // 1) 確認リンクが失敗した（期限切れ・使用済み）場合は、セッションを待たずに案内する
      const hashError = authErrorFromHash(window.location.hash);
      if (hashError) {
        console.warn('[auth/callback] Confirmation link failed:', { code: hashError.code });
        setErrorCode(hashError.code);
        setStatus('error');
        return;
      }

      // 2) Check if we already have a session
      const { data: sessionData, error: sessionError } = await supabase.auth.getSession();

      if (cancelled) return;

      if (sessionError) {
        console.error('[auth/callback] Session error:', sessionError);
        setStatus('error');
        return;
      }

      // 3) If no session yet, wait briefly for callback to complete
      if (!sessionData?.session) {
        console.log('[auth/callback] No session yet, waiting for callback completion...');

        // Wait up to 3 seconds for session to be established
        const maxRetries = 6;
        const delayMs = 500;

        for (let retries = 0; retries < maxRetries; retries++) {
          await new Promise(resolve => setTimeout(resolve, delayMs));

          if (cancelled) return;

          const { data: retryData } = await supabase.auth.getSession();

          if (retryData?.session) {
            console.log('[auth/callback] Session established after retry:', {
              attempt: retries + 1,
              userId: retryData.session.user?.id,
            });
            router.replace(nextParam);
            return;
          }
        }

        // Check one more time
        const { data: finalData } = await supabase.auth.getSession();
        if (cancelled) return;

        if (finalData?.session) {
          console.log('[auth/callback] Session established after final check');
          router.replace(nextParam);
          return;
        }

        console.error('[auth/callback] No session after retries');
        setStatus('error');
        return;
      }

      // 4) Session already established, redirect to next destination
      console.log('[auth/callback] Session already ready, redirecting to:', nextParam);
      router.replace(nextParam);
    })();

    return () => {
      cancelled = true;
    };
  }, [router, nextParam]);

  return (
    <main className="mx-auto max-w-md p-6">
      <div className="flex flex-col items-center justify-center py-12 space-y-4">
        {status === 'processing' ? (
          <>
            <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-gray-900"></div>
            <p className="text-gray-600">認証処理中…</p>
            <p className="text-sm text-gray-500">Please wait while we verify your invitation.</p>
          </>
        ) : (
          <div className="w-full space-y-4 rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-800">
            <p className="whitespace-pre-wrap">❌ {errorMessageOf(errorCode)}</p>
            <button
              type="button"
              onClick={() => router.replace(INVITE_ACCEPT_PATH)}
              className="w-full rounded-md bg-gray-900 px-4 py-2 text-sm font-semibold text-white hover:bg-black/90"
            >
              招待の受諾画面へ
            </button>
            <button
              type="button"
              onClick={() => router.replace(`/login?redirect_to=${encodeURIComponent(INVITE_ACCEPT_PATH)}`)}
              className="w-full rounded-md border border-gray-300 bg-white px-4 py-2 text-sm font-semibold text-gray-800 hover:bg-gray-50"
            >
              ログイン画面へ
            </button>
          </div>
        )}
      </div>
    </main>
  );
}
