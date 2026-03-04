// /app/auth/callback/CallbackClient.tsx
'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { supabase } from '@/utils/supabase/client';

export default function CallbackClient() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [status, setStatus] = useState<'processing' | 'error'>('processing');

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

      // 2) Check if we already have a session
      const { data: sessionData, error: sessionError } = await supabase.auth.getSession();

      if (cancelled) return;

      if (sessionError) {
        console.error('[auth/callback] Session error:', sessionError);
        setStatus('error');
        router.replace('/login');
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
        router.replace(`/login?next=${encodeURIComponent(nextParam)}`);
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
          <>
            <p className="text-gray-600">ログイン画面へ移動します…</p>
            <p className="text-sm text-gray-500">セッションの確立に失敗しました。</p>
          </>
        )}
      </div>
    </main>
  );
}
