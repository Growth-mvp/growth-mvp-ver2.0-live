// /app/auth/callback/page.tsx
'use client';

import { useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { supabase } from '@/utils/supabase/client';

export default function AuthCallbackPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [status, setStatus] = useState<'processing' | 'success' | 'error'>('processing');
  const [errorMsg, setErrorMsg] = useState<string>('');

  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        console.log('[auth/callback] Started processing callback');

        // 1) Extract 'next' parameter with open redirect prevention (ENHANCED)
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
        const nextParam =
          decoded.startsWith('/') && !decoded.startsWith('//') ? decoded : '/';

        if (decoded !== nextParam) {
          console.warn('[auth/callback] Blocked open redirect attempt:', {
            raw: rawNext,
            decoded,
            blocked: true,
          });
        }

        console.log('[auth/callback] Validated next parameter:', nextParam);

        // 2) Check if we already have a session
        // The Supabase client has detectSessionInUrl: true, so it should
        // automatically parse hash fragments or PKCE code from URL
        const { data: sessionData, error: sessionError } = await supabase.auth.getSession();

        if (cancelled) return;

        if (sessionError) {
          console.error('[auth/callback] Session error:', sessionError);
          setErrorMsg(`Session error: ${sessionError.message}`);
          setStatus('error');
          return;
        }

        // 3) If no session yet, wait briefly for callback to complete
        if (!sessionData?.session) {
          console.log('[auth/callback] No session yet, waiting for callback completion...');

          // Wait up to 3 seconds for session to be established
          let retries = 0;
          const maxRetries = 6;
          const delayMs = 500;

          while (retries < maxRetries) {
            await new Promise(resolve => setTimeout(resolve, delayMs));

            if (cancelled) return;

            const { data: retryData } = await supabase.auth.getSession();

            if (retryData?.session) {
              console.log('[auth/callback] Session established after retry:', {
                attempt: retries + 1,
                userId: retryData.session.user?.id,
              });
              break;
            }
            retries++;
          }

          // Check one more time
          const { data: finalData, error: finalError } = await supabase.auth.getSession();
          if (cancelled) return;

          if (finalError || !finalData?.session) {
            console.error('[auth/callback] No session after retries:', {
              error: finalError?.message,
              maxRetries,
            });
            setErrorMsg('Failed to establish session. Please try the invitation link again.');
            setStatus('error');

            // Redirect to login after delay
            setTimeout(() => {
              router.replace(`/login?next=${encodeURIComponent(nextParam)}`);
            }, 3000);
            return;
          }
        }

        // 4) Session established, redirect to next destination
        console.log('[auth/callback] Session established, redirecting to:', nextParam);
        setStatus('success');

        // Small delay to show success message
        setTimeout(() => {
          router.replace(nextParam);
        }, 500);
      } catch (e: any) {
        if (cancelled) return;

        console.error('[auth/callback] Exception:', {
          error: e?.message || String(e),
          code: e?.code || 'unknown',
          stack: e?.stack,
        });
        setErrorMsg(`Unexpected error: ${e?.message || 'unknown'}`);
        setStatus('error');

        // Redirect to login after delay
        setTimeout(() => {
          router.replace('/login');
        }, 3000);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [router, searchParams]);

  if (status === 'processing') {
    return (
      <main className="mx-auto max-w-md p-6">
        <div className="flex flex-col items-center justify-center py-12 space-y-4">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-gray-900"></div>
          <p className="text-gray-600">Authenticating...</p>
          <p className="text-sm text-gray-500">Please wait while we verify your invitation.</p>
        </div>
      </main>
    );
  }

  if (status === 'success') {
    return (
      <main className="mx-auto max-w-md p-6">
        <div className="flex flex-col items-center justify-center py-12 space-y-4">
          <div className="text-green-600 text-5xl">✓</div>
          <p className="text-gray-600">Authentication successful!</p>
          <p className="text-sm text-gray-500">Redirecting...</p>
        </div>
      </main>
    );
  }

  // error state
  return (
    <main className="mx-auto max-w-md p-6">
      <div className="rounded-lg border border-red-200 bg-red-50 p-6">
        <h1 className="text-xl font-bold text-red-900 mb-4">Authentication Error</h1>
        <p className="text-red-800 mb-4">{errorMsg || 'An error occurred during authentication.'}</p>
        <p className="text-sm text-red-700">
          If this problem persists, please contact support or request a new invitation.
        </p>
      </div>
    </main>
  );
}
