// /hooks/useAuthGuard.ts
'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { supabase } from '@/utils/supabase/client';

/**
 * 未ログインなら指定のURLにリダイレクトする Hook
 * @param redirectTo リダイレクト先（デフォルト: /login）
 */
export function useAuthGuard(redirectTo: string = '/login') {
  const router = useRouter();

  useEffect(() => {
    const ac = new AbortController();

    (async () => {
      const { data } = await supabase.auth.getSession();
      if (ac.signal.aborted) return;

      if (!data.session) {
        router.replace(redirectTo);
      }
    })();

    // セッション状態の変化も監視
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      if (ac.signal.aborted) return;
      if (!session) {
        router.replace(redirectTo);
      }
    });

    return () => {
      ac.abort();
      subscription.unsubscribe();
    };
  }, [router, redirectTo]);
}
